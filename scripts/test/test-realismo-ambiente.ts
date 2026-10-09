/**
 * Realismo del visor 3D (lentejuelas, confeti, achatado, ambiente de la sala). Sin red ni coste, sin WebGL:
 * - `ambiente` de la sala: viaja por el esquema de la IA, `cambiar_sala` lo conserva y lo cambia, una lectura de foto compilada y
 *   la sala de la captura para comparar con la foto salen neutras, la escena guardada lo normaliza, y la frase de la sala para FLUX
 *   dice «wooden plank floor» solo cuando hay piso de madera;
 * - `ejePanel`: qué cajas son paneles (pared, tapete) y cuáles bloques;
 * - `lentejuelasDePanel`: tope de 7 000, matrices deterministas y todas por delante del tablero en los tres ejes;
 * - confeti: cada escama dentro del globo (R-5 a R-36), tope por globo, presupuesto y reparto reutilizado;
 * - `achatadoDe`: el nudo no se mueve, determinista y dentro de ±8 %.
 *
 * Run: npx tsx scripts/test/test-realismo-ambiente.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { AmbienteSalaSchema } from "@/lib/globos3d/ambiente-sala";
import { SALA_INICIAL, ambienteNormalizado, armarEscena, escenaEnIngles, type Escena } from "@/lib/globos3d/escena";
import { aplicarHerramienta } from "@/lib/globos3d/herramientas-escena";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import { salaParaFoto } from "@/lib/globos3d/encuadre-foto";
import { centroCuerpo, perfilRedondo } from "@/lib/globos3d/geometria";
import { ambienteActivo, ambienteDe } from "@/components/tres-d/sala-ambiente";
import { ejePanel, lentejuelasDePanel } from "@/components/tres-d/lentejuelas-instanciadas";
import { MINIMO_CONFETI, PRESUPUESTO_CONFETI, TOPE_CONFETI, cantidadConfeti, discosConfeti, radioEscamaCm, topePorGlobo } from "@/components/tres-d/confeti-visor";
import { achatadoDe } from "@/components/tres-d/deformacion-globo";
import { papelDeConfeti } from "@/components/tres-d/armada-visor";

let fallos = 0;
function prueba(nombre: string, f: () => void) {
  try { f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

const vacia: Escena = { sala: { ...SALA_INICIAL }, nodos: [] };
const conAmbiente: Escena = { sala: { ...SALA_INICIAL, ambiente: { piso: "madera", luces: true } }, nodos: [] };

// ----------------------------------------------------------------------------------------------------------
// Ambiente de la sala
// ----------------------------------------------------------------------------------------------------------
prueba("el ambiente pasa por el esquema de la IA y lo inválido se descarta al normalizar", () => {
  assert.deepEqual(AmbienteSalaSchema.parse({ piso: "madera", luces: true }), { piso: "madera", luces: true });
  assert.throws(() => AmbienteSalaSchema.parse({ piso: "marmol" }));
  assert.deepEqual(ambienteNormalizado({ piso: "madera", luces: "si", ventana: true, extra: 1 }), { piso: "madera", ventana: true });
  assert.equal(ambienteNormalizado({ piso: "marmol" }), undefined);
  assert.equal(ambienteNormalizado(null), undefined);
  assert.equal(ambienteNormalizado([1]), undefined);
});

prueba("sin ambiente la sala es neutra (nada cambia en las escenas que ya existen)", () => {
  assert.deepEqual(ambienteDe(undefined), { piso: "liso", luces: false, ventana: false });
  assert.equal(ambienteActivo(undefined), false);
  assert.equal(ambienteActivo({ piso: "liso" }), false);
  assert.equal(ambienteActivo({ piso: "madera" }), true);
  assert.equal(ambienteActivo({ luces: true }), true);
  assert.equal(SALA_INICIAL.ambiente, undefined);
});

prueba("cambiar_sala conserva el ambiente al cambiar otra cosa y lo cambia cuando se pide", () => {
  const medidas = aplicarHerramienta(conAmbiente, "cambiar_sala", { ancho_cm: 700 }).escena.sala;
  assert.equal(medidas.anchoCm, 700);
  assert.deepEqual(medidas.ambiente, { piso: "madera", luces: true });
  const sinLuces = aplicarHerramienta(conAmbiente, "cambiar_sala", { luces_techo: false, ventana: true }).escena.sala;
  assert.deepEqual(sinLuces.ambiente, { piso: "madera", luces: false, ventana: true });
  const liso = aplicarHerramienta(conAmbiente, "cambiar_sala", { piso_madera: false }).escena.sala;
  assert.equal(liso.ambiente?.piso, "liso");
  const desdeNeutra = aplicarHerramienta(vacia, "cambiar_sala", { tono_piso: "#aa8855" }).escena.sala;
  assert.equal(desdeNeutra.ambiente, undefined, "pedir otra cosa no inventa un ambiente");
  assert.deepEqual(aplicarHerramienta(vacia, "cambiar_sala", { piso_madera: true }).escena.sala.ambiente, { piso: "madera" });
});

prueba("una foto compilada y la sala de la captura para compararla con la foto salen neutras", () => {
  for (const r of REFERENCIAS_DUENO.slice(0, 5)) {
    const escena = compilarLectura(r.lectura).escena;
    assert.equal(ambienteActivo(escena.sala.ambiente), false, `foto ${r.numero}: sin ambiente`);
  }
  const sala = salaParaFoto({ ...SALA_INICIAL, ambiente: { piso: "madera", luces: true, ventana: true } }, { aspecto: 1, altoCm: 300, centroYCm: 120 });
  assert.equal(ambienteActivo(sala.ambiente), false, "la captura para comparar no lleva madera ni luz cálida");
});

prueba("la frase de la sala para FLUX dice piso de tablones solo con piso de madera", () => {
  const frase = (e: Escena) => escenaEnIngles(e, armarEscena(e));
  assert.ok(!/wooden plank floor/.test(frase(vacia)));
  assert.ok(/plain and empty/.test(frase(vacia)), "la sala neutra sigue como estaba");
  const madera = frase(conAmbiente);
  assert.ok(/wooden plank floor/.test(madera), madera);
  assert.ok(/recessed lights/.test(madera), madera);
  assert.ok(!/plain and empty/.test(madera), madera);
});

// ----------------------------------------------------------------------------------------------------------
// Lentejuelas
// ----------------------------------------------------------------------------------------------------------
prueba("ejePanel: paneles planos sí, bloques y cajas finas pero angostas no", () => {
  assert.equal(ejePanel({ x: 240, y: 240, z: 2 }), 2, "pared de lentejuelas");
  assert.equal(ejePanel({ x: 400, y: 0.6, z: 190 }), 1, "tapete");
  assert.equal(ejePanel({ x: 2, y: 100, z: 200 }), 0, "panel de canto");
  assert.equal(ejePanel({ x: 82, y: 212, z: 2 }), 2, "panel de plata de la idea 319");
  assert.equal(ejePanel({ x: 100, y: 100, z: 6 }), 2, "el límite de grueso entra");
  assert.equal(ejePanel({ x: 100, y: 100, z: 6.1 }), null, "más grueso es un bloque");
  assert.equal(ejePanel({ x: 50, y: 20, z: 30 }), null, "una caja de bloque");
  assert.equal(ejePanel({ x: 10, y: 100, z: 2 }), null, "una cinta angosta no lleva cuadrícula");
});

const ENTORNO = new THREE.Texture();
const CAJAS: Array<{ nombre: string; tamano: { x: number; y: number; z: number }; eje: 0 | 1 | 2 }> = [
  { nombre: "pared (z delgado)", tamano: { x: 240, y: 240, z: 2 }, eje: 2 },
  { nombre: "tapete (y delgado)", tamano: { x: 400, y: 0.6, z: 190 }, eje: 1 },
  { nombre: "panel de canto (x delgado)", tamano: { x: 3, y: 150, z: 200 }, eje: 0 },
];

prueba("lentejuelasDePanel: tope de 7 000, todas por delante del tablero y dentro de su cara, en los tres ejes", () => {
  for (const { nombre, tamano, eje } of CAJAS) {
    assert.equal(ejePanel(tamano), eje, nombre);
    const malla = lentejuelasDePanel(tamano, eje, "#d4af5a", ENTORNO);
    assert.ok(malla.count > 100 && malla.count <= 7000, `${nombre}: ${malla.count}`);
    assert.equal(malla.material instanceof THREE.MeshStandardMaterial ? malla.material.envMap : null, ENTORNO, "lleva el entorno que se le dio");
    const medidas = [tamano.x, tamano.y, tamano.z];
    const grueso = medidas[eje]! * 0.01;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const lado = (malla.geometry as THREE.PlaneGeometry).parameters.width / 2;
    for (let i = 0; i < malla.count; i++) {
      malla.getMatrixAt(i, m);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        v.set(sx * lado, sy * lado, 0).applyMatrix4(m);
        const arr = [v.x, v.y, v.z];
        assert.ok(arr[eje]! > grueso / 2, `${nombre}: la esquina de la lentejuela ${i} (${arr[eje]!.toFixed(4)}) queda detrás de la cara del tablero (${(grueso / 2).toFixed(4)})`);
        for (let k = 0; k < 3; k++) if (k !== eje) assert.ok(Math.abs(arr[k]!) <= medidas[k]! * 0.005 + 0.01, `${nombre}: dentro de la cara en el eje ${k}`);
      }
    }
    const toques: THREE.Intersection[] = [];
    malla.raycast(new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)), toques);
    assert.equal(toques.length, 0, `${nombre}: las lentejuelas no se eligen por clic`);
  }
  const enorme = lentejuelasDePanel({ x: 3000, y: 3000, z: 2 }, 2, "#ffffff", ENTORNO);
  assert.ok(enorme.count <= 7000, `un panel de 30 × 30 m tiene ${enorme.count}`);
});

prueba("lentejuelasDePanel: mismas matrices y colores en cada llamada (determinista)", () => {
  const a = lentejuelasDePanel({ x: 240, y: 240, z: 2 }, 2, "#d4af5a", ENTORNO), b = lentejuelasDePanel({ x: 240, y: 240, z: 2 }, 2, "#d4af5a", ENTORNO);
  assert.equal(a.count, b.count);
  assert.deepEqual(Array.from(a.instanceMatrix.array), Array.from(b.instanceMatrix.array));
  assert.deepEqual(Array.from(a.instanceColor!.array), Array.from(b.instanceColor!.array));
  const otra = lentejuelasDePanel({ x: 200, y: 240, z: 2 }, 2, "#d4af5a", ENTORNO);
  assert.notDeepEqual(Array.from(a.instanceMatrix.array.slice(0, 64)), Array.from(otra.instanceMatrix.array.slice(0, 64)));
});

// ----------------------------------------------------------------------------------------------------------
// Confeti
// ----------------------------------------------------------------------------------------------------------
/** Radio del globo (cm) a la altura `y` (cm desde el nudo), por el perfil del torno. */
function radioDelPerfil(perfil: ReadonlyArray<{ r: number; y: number }>, y: number): number {
  let mejor = 0;
  for (let i = 1; i < perfil.length; i++) {
    const a = perfil[i - 1]!, b = perfil[i]!;
    if ((y >= a.y && y <= b.y) || (y >= b.y && y <= a.y)) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      mejor = Math.max(mejor, a.r + (b.r - a.r) * t);
    }
  }
  return mejor;
}

prueba("confeti: cada escama (con sus esquinas) queda dentro del globo, de R-5 a R-36", () => {
  const TAMANOS = [{ nombre: "R-5", cm: 12 }, { nombre: "R-9", cm: 22 }, { nombre: "R-12", cm: 30 }, { nombre: "R-18", cm: 45 }, { nombre: "R-24", cm: 60 }, { nombre: "R-36", cm: 90 }];
  for (const { nombre, cm } of TAMANOS) {
    const perfil = perfilRedondo(cm, 0);
    const centro = centroCuerpo("redondo", cm);
    for (const semilla of [1, 2, 3]) {
      const escamas = discosConfeti((cm / 2) * 0.01, semilla, TOPE_CONFETI);
      assert.ok(escamas.length >= 1 && escamas.length <= TOPE_CONFETI, `${nombre}: ${escamas.length} escamas`);
      const radioEscama = radioEscamaCm(cm / 2);
      const p = new THREE.Vector3();
      for (const m of escamas) {
        for (const [sx, sy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          p.set(sx * 0.01, sy * 0.01, 0).applyMatrix4(m).multiplyScalar(100);
          const radial = Math.hypot(p.x, p.z);
          const limite = radioDelPerfil(perfil, centro + p.y);
          assert.ok(radial <= limite, `${nombre}: una esquina a ${radial.toFixed(2)} cm del eje, el globo mide ${limite.toFixed(2)} a esa altura (escama de ${radioEscama.toFixed(2)} cm)`);
        }
      }
    }
  }
});

prueba("confeti: la escama crece con el globo, el tope manda y el presupuesto se reparte", () => {
  assert.ok(radioEscamaCm(6) < radioEscamaCm(15) && radioEscamaCm(15) <= 1.05 && radioEscamaCm(2) >= 0.35);
  assert.ok(cantidadConfeti(15, TOPE_CONFETI) <= TOPE_CONFETI && cantidadConfeti(15, 50) <= 50);
  assert.ok(cantidadConfeti(6, TOPE_CONFETI) >= MINIMO_CONFETI);
  assert.equal(topePorGlobo(0), TOPE_CONFETI);
  assert.equal(topePorGlobo(5), TOPE_CONFETI);
  for (const n of [14, 50, 200, 1000]) {
    const tope = topePorGlobo(n);
    assert.ok(tope >= MINIMO_CONFETI && tope <= TOPE_CONFETI);
    if (n * MINIMO_CONFETI <= PRESUPUESTO_CONFETI) assert.ok(n * tope <= PRESUPUESTO_CONFETI, `${n} globos × ${tope}`);
  }
});

prueba("confeti: el reparto de un tamaño y variante se reutiliza (mismas matrices, sin recalcular)", () => {
  const a = discosConfeti(0.15, 5, 200), b = discosConfeti(0.15, 5 + 16, 200);
  assert.equal(a, b, "la variante 5 y la 21 son la misma");
  assert.notEqual(discosConfeti(0.15, 6, 200), a);
});

prueba("confeti: el papel sale del metal de la pieza (dorado con dorados, plateado si no)", () => {
  assert.equal(papelDeConfeti([{ codigo: "970" }, { codigo: "970" }, { codigo: "971" }]), "#e0b33f");
  assert.equal(papelDeConfeti([{ codigo: "981" }, { codigo: "970" }]), "#d9d9e0");
  assert.equal(papelDeConfeti([{ codigo: "390" }, { codigo: "005" }]), "#d9d9e0");
});

// ----------------------------------------------------------------------------------------------------------
// Achatado
// ----------------------------------------------------------------------------------------------------------
prueba("achatadoDe: el nudo (el origen) no se mueve, es determinista y varía poco", () => {
  const nudo = { x: 12.5, y: 80, z: -40 };
  const a = achatadoDe(nudo, 25, "R-12"), b = achatadoDe({ ...nudo }, 25, "R-12");
  assert.deepEqual(Array.from(a.elements), Array.from(b.elements));
  const origen = new THREE.Vector3(0, 0, 0).applyMatrix4(a);
  assert.deepEqual(origen.toArray(), [0, 0, 0]);
  const escala = new THREE.Vector3().setFromMatrixScale(a);
  for (const e of [escala.x, escala.y, escala.z]) assert.ok(e > 0.92 && e < 1.08, `escala ${e}`);
  const distintos = new Set(Array.from({ length: 30 }, (_, i) => achatadoDe({ x: i * 7, y: 50, z: i }, 25, "R-12").elements[5]!.toFixed(4)));
  assert.ok(distintos.size > 20, "cada globo sale distinto");
  // No depende del lugar del globo en una lista: solo cuentan su nudo, su tamaño y su formato.
  assert.notDeepEqual(Array.from(achatadoDe(nudo, 30, "R-12").elements), Array.from(a.elements));
});

prueba("armar una escena con ambiente no cambia lo armado (el ambiente es solo visual)", () => {
  const base = compilarLectura(REFERENCIAS_DUENO[2]!.lectura).escena;
  const conSala: Escena = { ...base, sala: { ...base.sala, ambiente: { piso: "madera", luces: true, ventana: true } } };
  const cuenta = (e: Escena) => armarEscena(e).porNodo.reduce((n, x) => n + x.globos.length, 0);
  assert.equal(cuenta(base), cuenta(conSala));
});

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
