/**
 * Rótulos en cursiva (`rotulos.ts`, `rotulo-contornos.ts`, `rotulo-visor.ts`): el nombre en vinilo sobre un panel, un arco o un
 * marco con tela y el nombre de acrílico suelto. Sin coste: ninguna IA ni red.
 *   npx tsx scripts/test/test-rotulos.ts
 * - contornos: una máscara de píxeles da sus manchas y sus huecos;
 * - la cara que lleva el rótulo, dónde queda y de qué tamaño (se achica a lo ancho del arco);
 * - NINGÚN CAMPO HUÉRFANO: cambiar texto, color, acabado, alto o altura del rótulo cambia lo que dibuja el visor;
 * - el visor guarda la geometría de cada texto por visor (no de módulo) y la libera con él;
 * - editar (inspector, IA, lectura de foto) conserva y valida el rótulo: pasa por el esquema de /api/escena-ia y vuelve igual;
 * - el inventario en inglés para FLUX, `ver_escena`, la miniatura del panel «Añadir» y la colocación del nombre de acrílico.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { DibujoFondo } from "../../src/components/tres-d/DibujoFondo";
import { crearEscenografiaVisor } from "../../src/components/tres-d/escenografia-visor";
import type { Rasterizador } from "../../src/components/tres-d/rotulo-visor";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { armarEscenografia, type ElementoEscenografia, type RotuloEscenografia } from "../../src/lib/globos3d/escenografia";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { entradaDeCatalogo, FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { LecturaFotoSchema } from "../../src/lib/globos3d/lectura-foto";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { colocacionPorDefecto } from "../../src/lib/globos3d/mobiliario-colocar";
import { admiteRotulo, conRotuloPieza, conTextoPieza, elementosDeEscenografia, MuebleDePiezaSchema, piezaDeEntrada, piezaDeMueble, type PiezaEscenografia } from "../../src/lib/globos3d/mobiliario-pieza";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { areaConSigno, contornosDeMascara, type Mascara } from "../../src/lib/globos3d/rotulo-contornos";
import { caraDe, colocarRotulo, conRotulo, limpiarTexto, normalizarRotulo, rotuloInicial, tintaSobre } from "../../src/lib/globos3d/rotulos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(3)} (esperado ${esperado} ±${tol})`);
const herramienta = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  if (!r.ok) assert.fail(r.error);
  return r;
};
const escenografia = (p: Pieza): PiezaEscenografia => (p.tipo === "escenografia" ? p : assert.fail("no es escenografía"));
const rotuloDe = (escena: Escena, id: string): RotuloEscenografia | undefined => escenografia(escena.nodos.find((n) => n.id === id)!.pieza).mueble?.rotulo;
const ultimo = (p: PiezaEscenografia) => armarEscenografia(elementosDeEscenografia(p)).at(-1)!;
const color = (nombre: string, hex: string, acabado: "mate" | "brillante" | "cromado" | "perla" = "mate") => ({ nombre, hex, peso: 100, acabado });

/** Una máscara de `ancho` × `alto` píxeles: lo que valga 1 en `f(x, y)` es tinta. */
const mascara = (ancho: number, alto: number, f: (x: number, y: number) => boolean): Mascara => {
  const datos = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) datos[y * ancho + x] = f(x, y) ? 1 : 0;
  return { datos, ancho, alto };
};

// ---------------------------------------------------------------------------------------------------------- contornos

prueba("contornos: un rectángulo es una mancha de 4 vértices; un anillo, una mancha con un hueco; dos manchas, dos", () => {
  const rect = contornosDeMascara(mascara(12, 6, () => true));
  assert.equal(rect.length, 1);
  assert.equal(rect[0]!.externo.length, 4);
  assert.equal(rect[0]!.huecos.length, 0);
  cerca(Math.abs(areaConSigno(rect[0]!.externo)) / 2, 72, 0.01, "área del rectángulo");

  const anillo = contornosDeMascara(mascara(20, 20, (x, y) => x >= 2 && x < 18 && y >= 2 && y < 18 && !(x >= 7 && x < 13 && y >= 7 && y < 13)));
  assert.equal(anillo.length, 1);
  assert.equal(anillo[0]!.huecos.length, 1, "el hueco es de la mancha que lo rodea");
  cerca(Math.abs(areaConSigno(anillo[0]!.externo)) / 2 - Math.abs(areaConSigno(anillo[0]!.huecos[0]!)) / 2, 16 * 16 - 36, 0.01, "tinta = fuera − hueco");

  const dos = contornosDeMascara(mascara(30, 10, (x) => x < 8 || x >= 20));
  assert.equal(dos.length, 2);
});

prueba("contornos: una letra redonda se simplifica (pocos puntos) sin salirse más de 1 px; el polvo se descarta", () => {
  const circulo = (x: number, y: number) => Math.hypot(x - 50, y - 50) < 40;
  const [mancha] = contornosDeMascara(mascara(100, 100, circulo));
  assert.ok(mancha!.externo.length < 90 && mancha!.externo.length > 12, `${mancha!.externo.length} puntos`);
  for (const p of mancha!.externo) cerca(Math.hypot(p.x - 50, p.y - 50), 40, 1.6, "el vértice sigue el borde");
  const conPolvo = contornosDeMascara(mascara(100, 100, (x, y) => circulo(x, y) || (x === 3 && y === 3)));
  assert.equal(conPolvo.length, 1, "un píxel suelto no es una letra");
});

prueba("contornos: dos píxeles en diagonal no cierran el lazo mal (cada uno sale completo)", () => {
  const manchas = contornosDeMascara(mascara(6, 6, (x, y) => (x === 1 && y === 1) || (x === 2 && y === 2) || (x >= 3 && x < 5 && y === 3) || (x >= 3 && x < 5 && y === 4)), 0.75, 1);
  const area = manchas.reduce((s, m) => s + Math.abs(areaConSigno(m.externo)) / 2, 0);
  cerca(area, 1 + 1 + 4, 0.01, "área total de la tinta");
});

// ---------------------------------------------------------------------------------------------------------- cara y colocación

prueba("la cara: una caja es su frente; un panel, su contorno; un cilindro no lleva rótulo", () => {
  const caja = armarEscenografia([{ forma: "caja", centro: { x: 10, y: 50, z: 0 }, tamano: { x: 100, y: 80, z: 2 }, hex: "#ffffff", acabado: "mate" }])[0]!;
  const cara = caraDe(caja)!;
  assert.deepEqual([cara.anchoCm, cara.altoCm, cara.baseYCm, cara.zCm], [100, 80, -40, 1]);
  const lentejuelas = caraDe({ ...caja, acabado: "lentejuelas" })!;
  assert.ok(lentejuelas.zCm > cara.zCm, "el vinilo se apoya sobre las lentejuelas, que sobresalen del tablero");
  const oculto = caraDe({ ...caja, oculto: true })!;
  assert.equal(oculto.zCm, -1, "un tablero que no se dibuja: las letras parten de su plano central");
  const panel = armarEscenografia([{ forma: "panel", contorno: [{ x: -30, y: 35 }, { x: 30, y: 35 }, { x: 30, y: 95 }, { x: -30, y: 95 }], zCm: 2, grosorCm: 2, hex: "#fff", acabado: "mate" }])[0]!;
  assert.deepEqual([caraDe(panel)!.anchoCm, caraDe(panel)!.altoCm, caraDe(panel)!.baseYCm, caraDe(panel)!.zCm], [60, 60, 35, 2]);
  assert.equal(caraDe(armarEscenografia([{ forma: "cilindro", base: { x: 0, y: 0, z: 0 }, radioCm: 5, altoCm: 10, hex: "#fff", acabado: "mate" }])[0]!), null);
});

prueba("colocar: el texto se achica a lo ancho de la cara y, en un arco, a lo ancho que tiene el arco en esa altura", () => {
  const rect = { anchoCm: 100, altoCm: 100, centroXCm: 0, baseYCm: 0, zCm: 1 };
  const grande = colocarRotulo(rect, { altoCm: 30, yCm: 50 }, 2);
  assert.deepEqual([grande.altoCm, grande.anchoCm, grande.yCm], [30, 60, 50]);
  const ancho = colocarRotulo(rect, { altoCm: 30, yCm: 50 }, 6);
  cerca(ancho.anchoCm, 92, 0.01, "el texto largo llena el 92 % de la cara");
  assert.ok(ancho.altoCm < 30);
  const arco = armarEscenografia([{ forma: "panel", contorno: Array.from({ length: 49 }, (_, i) => ({ x: Math.cos((i / 48) * Math.PI) * 50, y: 100 + Math.sin((i / 48) * Math.PI) * 50 })).concat([{ x: -50, y: 0 }, { x: 50, y: 0 }]), zCm: 0, grosorCm: 2, hex: "#fff", acabado: "mate" }])[0]!;
  const cara = caraDe(arco)!;
  const abajo = colocarRotulo(cara, { altoCm: 30, yCm: 40 }, 3), arriba = colocarRotulo(cara, { altoCm: 30, yCm: 140 }, 3);
  assert.ok(arriba.anchoCm < abajo.anchoCm, `arriba (${arriba.anchoCm.toFixed(0)} cm) cabe menos que abajo (${abajo.anchoCm.toFixed(0)} cm)`);
  assert.ok(arriba.anchoCm <= 100, "nunca más ancho que el arco");
  const fuera = colocarRotulo(rect, { altoCm: 30, yCm: 999 }, 2);
  assert.equal(fuera.yCm, 100 - 15, "la altura se acota para que el texto no se salga de la cara");
});

prueba("normalizar: texto limpio (3 líneas, 24 letras), color y acabado válidos, alto y altura dentro de la cara", () => {
  assert.equal(limpiarTexto("  David \n\n y \n Dayan \n sobra "), "David\ny\nDayan");
  assert.equal(limpiarTexto("   "), "");
  assert.equal(limpiarTexto("a".repeat(40)).length, 24);
  const caja: ElementoEscenografia = { forma: "caja", centro: { x: 0, y: 50, z: 0 }, tamano: { x: 100, y: 100, z: 2 }, hex: "#ffffff", acabado: "mate" };
  const r = normalizarRotulo({ texto: "Hola", color: "rojo", acabado: "neon" as never, altoCm: 5000, yCm: -4 }, caja)!;
  assert.deepEqual(r, { texto: "Hola", color: "#1c1c1c", acabado: "vinilo", altoCm: 600, yCm: 0 }, "lo que se guarda solo se acota al esquema (1–600 cm)");
  assert.deepEqual(normalizarRotulo({ texto: "Hola", altoCm: 5000, yCm: 5000 }, caja, true), { texto: "Hola", color: "#1c1c1c", acabado: "vinilo", altoCm: 100, yCm: 100 }, "y al armar, a la cara que lo lleva");
  assert.equal(limpiarTexto("Happy\nBirthday", 1), "Happy Birthday", "una sola línea: los saltos son espacios");
  assert.equal(tintaSobre("#fff"), "#1c1c1c", "un hex que no es de 6 dígitos no da una tinta inventada");
  assert.equal(normalizarRotulo({ texto: "  " }, caja), null);
  assert.equal(tintaSobre("#101014"), "#f7f6f2");
  assert.equal(rotuloInicial(caja, "Hola")!.altoCm, 22);
});

// ---------------------------------------------------------------------------------------------------------- catálogo

prueba("catálogo: marco con tela (2,4 × 1,8 m) y nombre de acrílico; lo rotulable lleva el rótulo en su último elemento (caja o panel)", () => {
  const marco = muebleDe("marco_tela")!;
  assert.deepEqual([marco.medidas.anchoCm, marco.medidas.altoCm, marco.rotulable], [240, 180, true]);
  const pieza = escenografia(piezaDeMueble(marco));
  const armada = armarPieza(pieza);
  cerca(armada.caja.max.x - armada.caja.min.x, 240, 0.5, "ancho del marco");
  cerca(armada.caja.max.y - armada.caja.min.y, 180, 0.5, "alto del marco");
  assert.equal(ultimo(pieza).hex, "#f7f6f2", "el último elemento es la tela");
  assert.equal(armarEscenografia(elementosDeEscenografia(pieza))[0]!.hex, "#1c1c1c", "y el perfil, del color del marco");
  for (const f of FONDOS_CATALOGO.filter((x) => x.rotulable)) {
    const p = escenografia(piezaDeEntrada(f));
    assert.ok(admiteRotulo(p), f.id);
    const u = ultimo(p);
    assert.ok(u.forma === "caja" || u.forma === "panel", `${f.id}: el último elemento es una caja o un panel`);
    assert.ok(caraDe(u), f.id);
  }
  assert.deepEqual(FONDOS_CATALOGO.filter((x) => x.rotulable).map((x) => x.id).sort(), ["arcos_chiara", "lentejuelas", "letrero", "marco_tela", "panel_redondo"]);
  const acrilico = muebleDe("rotulo_acrilico")!;
  assert.ok(acrilico.conTexto && acrilico.flotaCm !== undefined && !acrilico.rotulable);
  assert.ok(entradaDeCatalogo("rotulo_acrilico") === acrilico);
});

prueba("un rótulo sobre un fondo fijo queda en su último elemento; el letrero cambia su texto impreso por el rótulo; lo demás no cambia", () => {
  const panel = escenografia(piezaDeEntrada(entradaDeCatalogo("panel_redondo")!));
  const antes = armarEscenografia(elementosDeEscenografia(panel));
  const con = escenografia(conTextoPieza(panel, { texto: "Isabella", acabado: "acrilico_mate", color: "#aa8800", altoCm: 20, yCm: 100 }));
  const despues = armarEscenografia(elementosDeEscenografia(con));
  assert.equal(despues.length, antes.length);
  assert.deepEqual(despues.slice(0, -1), antes.slice(0, -1));
  assert.deepEqual(despues.at(-1)!.rotulo, { texto: "Isabella", color: "#aa8800", acabado: "acrilico_mate", altoCm: 20, yCm: 100 });
  assert.equal(panel.elementos.every((e) => !e.rotulo), true, "lo guardado no lleva el rótulo: está en mueble.rotulo");

  const letrero = escenografia(piezaDeEntrada(entradaDeCatalogo("letrero")!));
  assert.equal(ultimo(letrero).motivo?.texto, "Asher");
  const conRot = ultimo(escenografia(conTextoPieza(letrero, { texto: "Hola" })));
  assert.equal(conRot.motivo, undefined, "el texto impreso del letrero se reemplaza");
  assert.equal(conRot.rotulo?.texto, "Hola");

  const sinRotulable = escenografia(piezaDeEntrada(entradaDeCatalogo("pedestales")!));
  assert.equal(conTextoPieza(sinRotulable, { texto: "Hola" }), sinRotulable, "un fondo que no admite rótulo no lo recibe");
  assert.equal(conRotulo([], { texto: "Hola" }).length, 0);
});

prueba("poner, cambiar y quitar el rótulo: quitarlo deja la pieza como estaba", () => {
  const original = escenografia(piezaDeMueble(muebleDe("marco_tela")!));
  const uno = escenografia(conTextoPieza(original, { texto: "David\ny\nDayan" }));
  const dos = escenografia(conTextoPieza(uno, { color: "#ff0000" }));
  assert.equal(dos.mueble!.rotulo!.texto, "David\ny\nDayan", "cambiar solo el color conserva el texto");
  assert.equal(dos.mueble!.rotulo!.color, "#ff0000");
  const tres = escenografia(conTextoPieza(dos, { texto: "" }));
  assert.deepEqual(tres, original);
  assert.equal(conTextoPieza(original, { color: "#ff0000" }).tipo === "escenografia" && escenografia(conTextoPieza(original, { color: "#ff0000" })).mueble!.rotulo, undefined, "sin texto no hay rótulo que pintar");
  assert.equal(escenografia(conRotuloPieza(dos, null)).mueble!.rotulo, undefined);
  // Achicar el marco no gasta el tamaño del texto: se dibuja dentro de la cara nueva y, al agrandarlo, vuelve a lo que era.
  const grande = escenografia(conTextoPieza(dos, { altoCm: 150 }));
  const chico = escenografia(piezaDeMueble(muebleDe("marco_tela")!, { ...original.mueble!.opciones!, altoCm: 80 }, grande.mueble!.rotulo));
  assert.equal(chico.mueble!.rotulo!.texto, "David\ny\nDayan");
  assert.equal(chico.mueble!.rotulo!.altoCm, 150, "guardado como se pidió");
  assert.ok(ultimo(chico).rotulo!.altoCm <= 74, "dibujado dentro de la tela de 74 cm");
  const devuelto = escenografia(piezaDeMueble(muebleDe("marco_tela")!, { ...original.mueble!.opciones!, altoCm: 180 }, chico.mueble!.rotulo));
  assert.equal(ultimo(devuelto).rotulo!.altoCm, 150, "al agrandarlo vuelve a 150 cm");
});

// ---------------------------------------------------------------------------------------------------------- visor

/** Un rasterizador de mentira: el texto es un rectángulo con un hueco, tan ancho como letras tenga (así no hace falta un lienzo). */
const falso = (): { rasterizar: Rasterizador; llamadas: string[] } => {
  const llamadas: string[] = [];
  return {
    llamadas,
    rasterizar: (texto) => {
      llamadas.push(texto);
      const ancho = 24 * texto.length + 12;
      return mascara(ancho, 40, (x, y) => !(x >= 6 && x < ancho - 6 && y >= 14 && y < 26));
    },
  };
};
const entorno = new THREE.Texture();

/** Las letras de lo que dibujó el visor: la malla hija con la geometría de texto. */
function letrasDe(objetos: THREE.Object3D[]): THREE.Mesh[] {
  const salida: THREE.Mesh[] = [];
  for (const o of objetos) o.traverse((h) => { if (h instanceof THREE.Mesh && h.geometry instanceof THREE.ExtrudeGeometry) salida.push(h); });
  return salida;
}
const firma = (m: THREE.Mesh) => {
  const mat = m.material as THREE.MeshStandardMaterial;
  m.geometry.computeBoundingBox();
  return JSON.stringify({ ancho: Math.round(m.geometry.boundingBox!.max.x * 1e4), s: m.scale.toArray().map((n) => Math.round(n * 1e6)), p: m.position.toArray().map((n) => Math.round(n * 1e6)), c: mat.color.getHexString(), m: mat.metalness, g: m.geometry.attributes.position!.count });
};
const dibujar = (rotulo: RotuloEscenografia, visor = crearEscenografiaVisor(() => entorno, falso().rasterizar)) => {
  const caja: ElementoEscenografia = { forma: "caja", centro: { x: 0, y: 100, z: 0 }, tamano: { x: 200, y: 200, z: 2 }, hex: "#f7f6f2", acabado: "mate", rotulo };
  const letras = letrasDe(visor.piezas(armarEscenografia([caja])));
  assert.equal(letras.length, 1, "un rótulo es una malla de letras");
  return letras[0]!;
};

prueba("NINGÚN CAMPO HUÉRFANO: cada campo del rótulo cambia lo que dibuja el visor", () => {
  const base: RotuloEscenografia = { texto: "Ana", color: "#112233", acabado: "vinilo", altoCm: 30, yCm: 100 };
  const cambios = { texto: "Isabella", color: "#ddaa00", acabado: "acrilico_espejo", altoCm: 15, yCm: 150 } as const satisfies Record<keyof RotuloEscenografia, unknown>;
  const referencia = firma(dibujar(base));
  for (const campo of Object.keys(cambios) as (keyof RotuloEscenografia)[]) {
    assert.notEqual(firma(dibujar({ ...base, [campo]: cambios[campo] })), referencia, `cambiar «${campo}» no cambia nada de lo que se dibuja`);
  }
});

prueba("el visor dibuja las letras con su tamaño, su altura, su grosor (vinilo fino, acrílico de 6 mm) y su color", () => {
  const vinilo = dibujar({ texto: "Ana", color: "#112233", acabado: "vinilo", altoCm: 30, yCm: 100 });
  cerca(vinilo.scale.y, 0.3, 1e-6, "alto del texto (m)");
  cerca(vinilo.scale.z, 0.0008, 1e-9, "grosor del vinilo (m)");
  cerca(vinilo.position.y, 0, 1e-6, "centrado a 100 cm del borde de abajo de un tablero de 200 cm");
  cerca(vinilo.position.z, 0.01 + 0.0002, 1e-6, "pegado a la cara de delante");
  assert.equal((vinilo.material as THREE.MeshStandardMaterial).color.getHexString(), "112233");
  assert.equal(vinilo.castShadow, false);
  const espejo = dibujar({ texto: "Ana", color: "#d6b25a", acabado: "acrilico_espejo", altoCm: 30, yCm: 100 });
  cerca(espejo.scale.z, 0.006, 1e-9, "grosor del acrílico (m)");
  const m = espejo.material as THREE.MeshStandardMaterial;
  assert.equal(m.metalness, 1);
  assert.equal(m.envMap, entorno, "el espejo refleja el entorno de ESTE visor");
  assert.equal(espejo.castShadow, true);
  const mate = dibujar({ texto: "Ana", color: "#d6b25a", acabado: "acrilico_mate", altoCm: 30, yCm: 100 });
  assert.ok((mate.material as THREE.MeshStandardMaterial).metalness < 0.2);
  // Un texto muy largo se achica para caber en el tablero (200 cm).
  const largo = dibujar({ texto: "Una frase larga", color: "#000000", acabado: "vinilo", altoCm: 60, yCm: 100 });
  const aspecto = (24 * 15 + 12) / 40;
  assert.ok(largo.scale.y * 100 * aspecto <= 200 * 0.92 + 0.01, "no se sale del tablero");
});

prueba("la geometría de cada texto es de ESTE visor: se hace una vez, no se comparte entre visores y se libera con el visor", () => {
  const a = falso(), b = falso();
  const visorA = crearEscenografiaVisor(() => entorno, a.rasterizar), visorB = crearEscenografiaVisor(() => entorno, b.rasterizar);
  const caja = (x: number, rotulo: RotuloEscenografia): ElementoEscenografia => ({ forma: "caja", centro: { x, y: 100, z: 0 }, tamano: { x: 100, y: 200, z: 2 }, hex: "#fff", acabado: "mate", rotulo });
  const r1: RotuloEscenografia = { texto: "Ana", color: "#000000", acabado: "vinilo", altoCm: 20, yCm: 50 };
  const piezas = visorA.piezas(armarEscenografia([caja(0, r1), caja(200, { ...r1, color: "#ff0000", altoCm: 40 }), caja(400, { ...r1, acabado: "acrilico_mate" })]));
  const letras = letrasDe(piezas);
  assert.equal(letras.length, 3);
  assert.deepEqual(a.llamadas, ["Ana"], "tres rótulos con el mismo texto, un solo dibujo del texto");
  assert.ok(letras.every((l) => l.geometry === letras[0]!.geometry), "la misma geometría");
  assert.equal(letras[0]!.geometry.userData.compartido, true, "marcada compartida: vaciar una pieza no la libera");
  visorA.piezas(armarEscenografia([caja(0, r1)]));
  assert.deepEqual(a.llamadas, ["Ana"], "ni al volver a armar la pieza");
  const deB = letrasDe(visorB.piezas(armarEscenografia([caja(0, r1)])));
  assert.deepEqual(b.llamadas, ["Ana"], "otro visor hace su propia geometría (nada de módulo)");
  assert.notEqual(deB[0]!.geometry, letras[0]!.geometry);
  let liberadas = 0;
  letras[0]!.geometry.addEventListener("dispose", () => { liberadas++; });
  deB[0]!.geometry.addEventListener("dispose", () => { liberadas += 100; });
  visorA.liberar();
  assert.equal(liberadas, 1, "liberar el visor A suelta lo suyo y no lo de B");
  visorB.liberar();
  assert.equal(liberadas, 101);
  // Sin lienzo (el navegador falta), el rótulo no se dibuja pero el resto de la pieza sí.
  const sinLienzo = crearEscenografiaVisor(() => entorno, () => null).piezas(armarEscenografia([caja(0, r1)]));
  assert.equal(sinLienzo.length, 1);
  assert.equal(letrasDe(sinLienzo).length, 0);
});

prueba("el visor guarda los últimos 48 textos y suelta el que lleva más tiempo sin usarse (escribir letra por letra no llena la GPU)", () => {
  const f = falso();
  const visor = crearEscenografiaVisor(() => entorno, f.rasterizar);
  const caja = (texto: string): ElementoEscenografia => ({ forma: "caja", centro: { x: 0, y: 100, z: 0 }, tamano: { x: 100, y: 200, z: 2 }, hex: "#fff", acabado: "mate", rotulo: { texto, color: "#000000", acabado: "vinilo", altoCm: 20, yCm: 50 } });
  const primero = letrasDe(visor.piezas(armarEscenografia([caja("a")])))[0]!.geometry;
  let sueltas = 0;
  primero.addEventListener("dispose", () => { sueltas++; });
  for (let i = 0; i < 48; i++) visor.piezas(armarEscenografia([caja(`nombre ${i}`)]));
  assert.equal(sueltas, 1, "con el texto 49 sale el primero (el más viejo)");
  assert.equal(primero.userData.compartido, false, "y, si una pieza viva aún lo usa, la libera ella al vaciarse");
  visor.piezas(armarEscenografia([caja("nombre 0")]));
  visor.piezas(armarEscenografia([caja("otro más")]));
  const antes = f.llamadas.length;
  visor.piezas(armarEscenografia([caja("nombre 0")]));
  assert.equal(f.llamadas.length, antes, "lo usado hace poco sigue guardado (no sale por viejo)");
});

prueba("el nombre de acrílico suelto: el tablero no se ve pero se puede elegir; las letras sí", () => {
  const pieza = escenografia(piezaDeMueble(muebleDe("rotulo_acrilico")!));
  const visor = crearEscenografiaVisor(() => entorno, falso().rasterizar);
  const objetos = visor.piezas(armarEscenografia(elementosDeEscenografia(pieza)));
  assert.equal(objetos.length, 1);
  const tablero = objetos[0] as THREE.Mesh;
  assert.equal((tablero.material as THREE.Material).visible, false, "el tablero no se dibuja");
  assert.equal(tablero.castShadow, false);
  tablero.geometry.computeBoundingBox();
  cerca(tablero.geometry.boundingBox!.max.x * 2, 1.2, 1e-6, "pero mide lo que mide la pieza (para elegirla y mover su caja)");
  assert.equal(letrasDe(objetos).length, 1);
  const sinRotulo = armarEscenografia([{ forma: "caja", centro: { x: 0, y: 5, z: 0 }, tamano: { x: 10, y: 10, z: 1 }, hex: "#fff", acabado: "mate", oculto: true }]);
  assert.equal(visor.piezas(sinRotulo).length, 0, "un amarre oculto sin rótulo sigue sin dibujarse");
});

// ---------------------------------------------------------------------------------------------------------- IA y esquema

prueba("agregar_mobiliario y cambiar_pieza: el nombre en cursiva de un marco, un panel y un arco, y se guarda dentro del esquema de /api/escena-ia", () => {
  const a = herramienta(vacia(), "agregar_mobiliario", { id: "marco_tela", texto: "David\ny\nDayan", colores: ["negro", "blanco"], color_texto: "negro", alto_texto_cm: 80 });
  const id = a.escena.nodos[0]!.id;
  assert.deepEqual(rotuloDe(a.escena, id), { texto: "David\ny\nDayan", color: "#1c1c1c", acabado: "vinilo", altoCm: 80, yCm: 87 });
  assert.equal(EscenaSchema.safeParse(JSON.parse(JSON.stringify(a.escena))).success, true);

  const b = herramienta(a.escena, "cambiar_pieza", { id, color_texto: "dorado", acabado_texto: "acrilico_espejo", texto: "Los Pérez", altura_texto_cm: 120, alto_texto_cm: 30 });
  assert.deepEqual(rotuloDe(b.escena, id), { texto: "Los Pérez", color: "#d6b25a", acabado: "acrilico_espejo", altoCm: 30, yCm: 120 });
  const reabierta = EscenaSchema.parse(JSON.parse(JSON.stringify(b.escena)));
  assert.deepEqual(rotuloDe(reabierta, id), rotuloDe(b.escena, id), "vuelve igual del esquema");
  const c = herramienta(b.escena, "cambiar_pieza", { id, colores: ["madera", "crema"], ancho_cm: 200 });
  assert.deepEqual(rotuloDe(c.escena, id)?.texto, "Los Pérez", "cambiar el marco conserva el rótulo");
  const d = herramienta(c.escena, "cambiar_pieza", { id, texto: "" });
  assert.equal(rotuloDe(d.escena, id), undefined, "texto vacío lo quita");
  assert.equal(aplicarHerramienta(d.escena, "cambiar_pieza", { id, color_texto: "rojo" }).ok, false, "sin texto no hay a quién pintarle el color");
  const grande = herramienta(a.escena, "cambiar_pieza", { id, alto_texto_cm: 900 });
  assert.match(grande.resumen, /no cabe/);
  assert.equal(rotuloDe(grande.escena, id)!.altoCm, 600, "se guarda dentro del esquema (600 cm) y se dibuja dentro de la tela");
  assert.equal(EscenaSchema.safeParse(JSON.parse(JSON.stringify(grande.escena))).success, true);
  const neon = herramienta(vacia(), "agregar_mobiliario", { id: "neon_cursiva", texto: "Mia\n15", color_texto: "rojo" });
  assert.match(neon.resumen, /no lleva un rótulo aparte/, "color_texto no aplica al neón y se dice");
  assert.equal(escenografia(neon.escena.nodos[0]!.pieza).mueble!.opciones!.texto, "Mia 15", "el neón es de una línea");

  // Un fondo fijo: solo cambia su texto; medidas y colores siguen avisando.
  const p = herramienta(vacia(), "agregar_mobiliario", { id: "panel_redondo", texto: "Isabella", color_texto: "#aa8800" });
  const pid = p.escena.nodos[0]!.id;
  const nodo = p.escena.nodos[0]!.pieza;
  assert.equal(escenografia(nodo).elementos.every((e) => !e.rotulo), true);
  assert.equal(rotuloDe(p.escena, pid)?.color, "#aa8800");
  assert.equal(aplicarHerramienta(p.escena, "cambiar_pieza", { id: pid, ancho_cm: 100 }).ok, false, "el panel fijo no cambia de medida");
  const q = herramienta(p.escena, "cambiar_pieza", { id: pid, texto: "Camila", color_texto: "blanco" });
  assert.equal(rotuloDe(q.escena, pid)?.texto, "Camila");
  const arco = herramienta(vacia(), "agregar_mobiliario", { id: "arcos_chiara", texto: "Let's Party", acabado_texto: "vinilo" });
  assert.equal(rotuloDe(arco.escena, arco.escena.nodos[0]!.id)?.texto, "Let's Party");
  assert.equal(EscenaSchema.safeParse(JSON.parse(JSON.stringify(arco.escena))).success, true);
});

prueba("el esquema rechaza un rótulo mal formado (color, acabado, texto, medidas)", () => {
  const bueno = { texto: "Ana", color: "#112233", acabado: "vinilo", altoCm: 20, yCm: 30 };
  const mueble = (rotulo: unknown) => MuebleDePiezaSchema.safeParse({ id: "marco_tela", rotulo }).success;
  assert.equal(mueble(bueno), true);
  for (const malo of [{ ...bueno, color: "rojo" }, { ...bueno, acabado: "neon" }, { ...bueno, texto: "" }, { ...bueno, texto: "x".repeat(25) }, { ...bueno, altoCm: -1 }, { ...bueno, yCm: Infinity }, { texto: "Ana" }]) {
    assert.equal(mueble(malo), false, JSON.stringify(malo));
  }
});

prueba("el nombre de acrílico: texto, color y material salen de sus opciones; flota delante del aro sin esquivarlo", () => {
  const a = herramienta(vacia(), "agregar_mobiliario", { id: "aro_metalico" });
  const b = herramienta(a.escena, "agregar_mobiliario", { id: "rotulo_acrilico", texto: "Isabella", colores: ["oro rosa"], ancho_cm: 130, alto_cm: 28 });
  const aro = b.escena.nodos[0]!, nombre = b.escena.nodos[1]!;
  assert.equal(nombre.colocacion.en, "libre");
  if (nombre.colocacion.en !== "libre" || aro.colocacion.en !== "piso") return assert.fail("colocación");
  assert.equal(nombre.colocacion.yCm, muebleDe("rotulo_acrilico")!.flotaCm);
  assert.ok(nombre.colocacion.zCm > aro.colocacion.zCm, "delante del aro");
  assert.equal(nombre.colocacion.xCm, 0, "no lo corre de lado por chocar con el aro");
  const r = ultimo(escenografia(nombre.pieza)).rotulo!;
  assert.deepEqual([r.texto, r.color, r.acabado, r.altoCm], ["Isabella", "#e0a899", "acrilico_espejo", 28]);
  const mate = herramienta(b.escena, "cambiar_pieza", { id: nombre.id, acabado: "mate", texto: "Isabella Sofía", colores: ["blanco"], alto_cm: 20 });
  const rm = ultimo(escenografia(mate.escena.nodos[1]!.pieza)).rotulo!;
  assert.deepEqual([rm.texto, rm.color, rm.acabado, rm.altoCm], ["Isabella Sofía", "#f7f6f2", "acrilico_mate", 20]);
  assert.equal(EscenaSchema.safeParse(JSON.parse(JSON.stringify(mate.escena))).success, true);
  const solo = colocacionPorDefecto(vacia(), muebleDe("rotulo_acrilico")!, { anchoCm: 120, fondoCm: 0.6 });
  assert.equal(solo.colocacion.en, "libre");
  const armada = armarEscena(b.escena);
  cerca(armada.porNodo[1]!.caja.max.x - armada.porNodo[1]!.caja.min.x, 130, 0.01, "mide lo pedido");
});

// ---------------------------------------------------------------------------------------------------------- ver_escena, FLUX, miniatura, lectura de foto

prueba("ver_escena dice el texto, su material, su color y su tamaño; FLUX recibe el inventario en inglés", () => {
  const a = herramienta(vacia(), "agregar_mobiliario", { id: "marco_tela", texto: "David y Dayan", colores: ["negro", "blanco"], color_texto: "negro" });
  const ver = herramienta(a.escena, "ver_escena", {});
  assert.match(ver.resumen, /texto «David y Dayan» en vinilo #1c1c1c/);
  const ingles = escenaEnIngles(a.escena, armarEscena(a.escena));
  assert.match(ingles, /black[^,]*cursive vinyl lettering "David y Dayan" on a white[^,]* fabric backdrop panel in a black[^,]* rectangular frame/);
  const b = herramienta(a.escena, "agregar_mobiliario", { id: "rotulo_acrilico", texto: "Isabella", colores: ["dorado"] });
  assert.match(escenaEnIngles(b.escena, armarEscena(b.escena)), /gold \(#D6B25A\) cursive mirror acrylic cut-out lettering "Isabella"/);
  const panel = herramienta(vacia(), "agregar_mobiliario", { id: "panel_redondo", texto: "Hola", acabado_texto: "acrilico_mate" });
  assert.match(escenaEnIngles(panel.escena, armarEscena(panel.escena)), /round backdrop panel, with [^,]*cursive matte acrylic cut-out lettering "Hola" on it/);
  assert.match(herramienta(panel.escena, "ver_escena", {}).resumen, /Panel redondo[^\n]*texto «Hola» en acrílico mate/);
});

prueba("la miniatura del panel «Añadir» dibuja el nombre de acrílico y el rótulo", () => {
  const acrilico = muebleDe("rotulo_acrilico")!;
  const html = renderToStaticMarkup(createElement(DibujoFondo, { id: "test-rotulo-acrilico", elementos: acrilico.elementos }));
  assert.match(html, /<text[^>]*>[\s\S]*Isabella/, "el nombre sale en la tarjeta aunque su tablero no se dibuje");
  const marco = escenografia(conTextoPieza(escenografia(piezaDeMueble(muebleDe("marco_tela")!)), { texto: "Hola" }));
  assert.match(renderToStaticMarkup(createElement(DibujoFondo, { id: "test-rotulo-marco", elementos: () => elementosDeEscenografia(marco) })), /Hola/);
});

prueba("lectura de foto: el texto de un fondo es su rótulo (con la tinta que viene después de los colores del fondo); el nombre de acrílico sale de sus opciones", () => {
  const base = { aspecto: 0.75, escala: { altoImagenCm: 300, referencia: "puerta" }, pisoY: 0.9, sala: { pared: "#eeeeee", piso: "#d8cbbb" } };
  const lectura = (piezas: unknown[]) => compilarLectura(LecturaFotoSchema.parse({ resumen: "Fiesta con nombres", ...base, piezas }));
  const r = lectura([
    { tipo: "fondo", id: "marco_tela", texto: "David y Dayan", x: 0.5, yBase: 0.9, ancho: 0.8, alto: 0.6, colores: [color("negro", "#1c1c1c"), color("blanco", "#ffffff"), color("negro", "#222222")] },
    { tipo: "fondo", id: "panel_redondo", texto: "Let's Party", x: 0.2, yBase: 0.9, ancho: 0.3, alto: 0.3, colores: [color("blanco", "#ffffff"), color("dorado", "#d4af5a"), color("rosa", "#ff66aa")] },
    { tipo: "fondo", id: "arcos_chiara", texto: "Ana", x: 0.8, yBase: 0.9, ancho: 0.3, alto: 0.4, colores: [color("rosa", "#ff66aa")] },
    { tipo: "fondo", id: "aro_metalico", x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.5, colores: [color("dorado", "#d4af5a")] },
    { tipo: "fondo", id: "rotulo_acrilico", texto: "Isabella", x: 0.5, yBase: 0.5, ancho: 0.4, alto: 0.1, colores: [color("dorado", "#d6b25a", "cromado")] },
  ]);
  assert.equal(r.omitidas.length, 0, r.omitidas.join("; "));
  const marco = r.escena.nodos.find((n) => n.id.startsWith("marco-tela"))!;
  assert.deepEqual(escenografia(marco.pieza).mueble!.rotulo, { ...escenografia(marco.pieza).mueble!.rotulo!, texto: "David y Dayan", color: "#222222", acabado: "vinilo" });
  assert.equal(escenografia(marco.pieza).mueble!.opciones!.colores.length, 2, "los colores del marco son los suyos; el tercero es la tinta");
  const panel = r.escena.nodos.find((n) => n.id.startsWith("panel-redondo"))!;
  assert.equal(escenografia(panel.pieza).mueble!.rotulo!.color, "#ff66aa", "la tinta es el color que viene después del panel y su aro");
  const arco = r.escena.nodos.find((n) => n.id.startsWith("arcos-chiara"))!;
  assert.equal(escenografia(arco.pieza).mueble!.rotulo!.texto, "Ana");
  assert.equal(escenografia(arco.pieza).mueble!.rotulo!.color, tintaSobre("#ff66aa"), "sin tinta leída, la que se lee sobre el arco");
  const aro = r.escena.nodos.find((n) => n.id.startsWith("aro-metalico"))!;
  assert.equal(escenografia(aro.pieza).mueble!.rotulo, undefined, "un aro no lleva rótulo");
  const nombre = r.escena.nodos.find((n) => n.id.startsWith("rotulo-acrilico"))!;
  assert.equal(escenografia(nombre.pieza).mueble!.opciones!.texto, "Isabella");
  assert.equal(nombre.colocacion.en, "libre", "el nombre de acrílico leído flota delante del aro, no se apoya en el piso");
  if (nombre.colocacion.en === "libre") assert.ok(nombre.colocacion.yCm > 100 && nombre.colocacion.zCm > -250 + 20, `${nombre.colocacion.yCm} cm de alto`);
  assert.equal(ultimo(escenografia(nombre.pieza)).rotulo!.acabado, "acrilico_espejo", "cromado = espejo");
  assert.equal(EscenaSchema.safeParse(JSON.parse(JSON.stringify(r.escena))).success, true);
  const sinAro = lectura([{ tipo: "fondo", id: "panel_redondo", texto: "Mia", x: 0.5, yBase: 0.9, ancho: 0.3, alto: 0.3, colores: [color("blanco", "#ffffff"), color("negro", "#101010")] }]);
  const panelSinAro = escenografia(sinAro.escena.nodos[0]!.pieza);
  assert.equal(panelSinAro.mueble!.rotulo!.color, "#101010", "con texto, el último color es la tinta (no el aro)");
  assert.equal(elementosDeEscenografia(panelSinAro).filter((e) => e.forma === "panel").length, 1, "y el panel va sin aro");
  const dosArcos = lectura([{ tipo: "fondo", id: "arcos_chiara", texto: "Ana", x: 0.5, yBase: 0.9, ancho: 0.3, alto: 0.4, colores: [color("blanco", "#ffffff"), color("rosa", "#ffc0d9"), color("fucsia", "#c2185b")] }]);
  const arcosLeidos = escenografia(dosArcos.escena.nodos[0]!.pieza);
  assert.equal(arcosLeidos.elementos.length, 2, "dos colores de arco y la tinta: dos arcos");
  assert.equal(arcosLeidos.mueble!.rotulo!.color, "#c2185b");
  const largo = lectura([{ tipo: "fondo", id: "marco_tela", texto: "Fiesta de cumple de Valentina", x: 0.5, yBase: 0.9, ancho: 0.8, alto: 0.6, colores: [color("negro", "#1c1c1c"), color("blanco", "#ffffff")] }]);
  assert.match(largo.notas.join(" "), /pasa de 24 letras/);
  const panelLargo = lectura([{ tipo: "fondo", id: "panel_redondo", texto: "Fiesta de cumple de Valentina", x: 0.5, yBase: 0.9, ancho: 0.3, alto: 0.3, colores: [color("blanco", "#ffffff")] }]);
  assert.match(panelLargo.notas.join(" "), /pasa de 24 letras/, "también en un panel (no se corta sin avisar)");
});

console.log(`test-rotulos: ${pruebas} pruebas ok`);
