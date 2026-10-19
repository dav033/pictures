/**
 * El foil (metalizado) y los materiales metálicos del visor del taller 3D (P-017). Sin red ni coste, sin WebGL:
 * - cada color de foil × cada forma (números 0–9, letras A–Z, palabras como «Love»/«LOVE»/«HBD», corazón, estrella, redondo,
 *   luna, flor, nube) arma paneles cuyo material tiene el color del foil y NO es negro ni casi negro (salvo el foil negro),
 *   con el entorno que se le dio puesto en el material: sin entorno, un metal se ve negro;
 * - el entorno de los metalizados es de cada visor y llega a las fábricas de materiales como parámetro (foil, cromado, metal,
 *   lentejuelas, confeti, piso): una captura fuera de pantalla (la del refinado) que se crea y se destruye en medio no toca
 *   los materiales del taller, ni al revés. Esa era la causa del «Love» dorado negro, y no queda ninguna variable de módulo con un entorno;
 * - los colores de látex cromado y metal se aclaran hasta su luminosidad mínima (no salen negros).
 *
 * Run: npx tsx scripts/test/test-foil-visor.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { colorDeLatex, materialDe, materialEscenografia } from "@/components/tres-d/materiales-visor";
import { lentejuelasDePanel } from "@/components/tres-d/lentejuelas-instanciadas";
import { materialConfeti } from "@/components/tres-d/confeti-visor";
import { materialPiso } from "@/components/tres-d/sala-ambiente";
import type { SolidoEscenografia } from "@/lib/globos3d/escenografia";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { materialFoil } from "@/components/tres-d/impresos-visor";
import { metalizadoMasParecido, referenciaDePedido } from "@/lib/globos3d/herramientas-escena-colores";
import { CARACTERES_METALIZADO, COLORES_METALIZADO, armarMetalizado, type ColorMetalizado, type FormaMetalizado } from "@/lib/globos3d/metalizados";
import { FORMATOS_GLOBO, coloresDelFormato } from "@/lib/globos3d/formatos";

let fallos = 0;
function prueba(nombre: string, f: () => void) {
  try { f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

/** Negro o casi negro: la luminosidad (HSL) del color del material. */
const luminosidad = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 }).l;
const MIN_LUMINOSIDAD_FOIL = 0.2;

const FORMAS: FormaMetalizado[] = [
  ...Array.from({ length: 10 }, (_, valor): FormaMetalizado => ({ tipo: "numero", valor })),
  ...CARACTERES_METALIZADO.filter((c) => /[A-Z]/.test(c)).map((valor): FormaMetalizado => ({ tipo: "letra", valor })),
  { tipo: "letras", texto: "Love" }, { tipo: "letras", texto: "love" }, { tipo: "letras", texto: "LOVE" }, { tipo: "letras", texto: "HBD" },
  { tipo: "corazon" }, { tipo: "estrella" }, { tipo: "redondo" }, { tipo: "luna" }, { tipo: "flor" }, { tipo: "nube" },
];
const COLORES = Object.keys(COLORES_METALIZADO) as ColorMetalizado[];
const entornoDePrueba = new THREE.Texture();

prueba("cada color de foil × cada forma da paneles de foil con el color del foil, con entorno y sin ser negros", () => {
  let paneles = 0;
  for (const color of COLORES) for (const forma of FORMAS) {
    const armado = armarMetalizado({ forma, pulgadas: 18, color });
    assert.ok(armado.elementos.length > 0, `${color} ${JSON.stringify(forma)} arma`);
    for (const e of armado.elementos) {
      if (e.forma !== "panel") continue;
      paneles++;
      assert.ok(e.acabado === "foil" || e.acabado === "foil_mate", `${color} ${JSON.stringify(forma)}: acabado de foil`);
      const material = materialFoil(e.hex, e.acabado === "foil_mate", entornoDePrueba);
      assert.equal(material.envMap, entornoDePrueba, "el material lleva el entorno que se le dio");
      assert.ok(material.metalness > 0, "el foil es metal");
      // El disco dorado del centro de la flor es oro aunque la flor sea de otro color.
      const esperado = e.hex === COLORES_METALIZADO.oro.hex ? "oro" : color;
      if (esperado !== "negro_mate") {
        assert.ok(luminosidad(material.color) > MIN_LUMINOSIDAD_FOIL, `${color} ${JSON.stringify(forma)}: ${e.hex} es casi negro (l = ${luminosidad(material.color).toFixed(2)})`);
      }
    }
  }
  assert.ok(paneles > COLORES.length * FORMAS.length, "se revisaron todos los paneles");
});

prueba("el foil negro es el único oscuro de la tabla", () => {
  const oscuros = COLORES.filter((c) => luminosidad(new THREE.Color(COLORES_METALIZADO[c].hex)) <= MIN_LUMINOSIDAD_FOIL);
  assert.deepEqual(oscuros, ["negro_mate"]);
});

prueba("pedir «dorado», «oro» o «gold» a un metalizado da un foil dorado, nunca negro", () => {
  for (const pedido of ["dorado", "dorada", "oro", "gold", "dorado metalizado", "dorado cromado"]) {
    const ref = referenciaDePedido(pedido);
    assert.ok(ref, `«${pedido}» existe en la tabla Sempertex`);
    const color = metalizadoMasParecido(ref.codigo);
    assert.notEqual(color, "negro_mate", `«${pedido}» (${ref.codigo}) → ${color}`);
  }
});

prueba("los cromados y metales de látex se aclaran hasta su luminosidad mínima", () => {
  for (const f of FORMATOS_GLOBO) for (const ref of coloresDelFormato(f.id)) {
    const familia = ref.familia as string;
    const minimo = familia === "reflex" ? 0.35 : familia === "metal" ? 0.5 : 0;
    if (!minimo) continue;
    const l = luminosidad(colorDeLatex(familia, ref.hexGlobo));
    assert.ok(l >= minimo - 0.02 || l >= luminosidad(new THREE.Color(ref.hexGlobo)), `${f.id} ${ref.codigo} ${ref.hexGlobo}: l = ${l.toFixed(2)}`);
  }
});

/**
 * El entorno es de cada visor y llega como parámetro: nunca hay «el entorno de ahora». Un entorno es un recurso de un
 * contexto WebGL; con una variable de módulo (o un registro), la captura fuera de pantalla del refinado (otro visor, otro
 * contexto) pisaba el del taller y lo liberaba, o los materiales del taller se quedaban con el de la captura: negros.
 */
const caja = (acabado: SolidoEscenografia["acabado"], hex = "#d4af5a"): SolidoEscenografia => ({
  forma: "caja", tamano: { x: 100, y: 100, z: 2 }, origen: { x: 0, y: 0, z: 0 }, ejeX: { x: 1, y: 0, z: 0 }, ejeY: { x: 0, y: 1, z: 0 }, ejeZ: { x: 0, y: 0, z: 1 }, hex, acabado,
} as SolidoEscenografia);
const envMapDe = (m: THREE.Material) => (m as THREE.MeshStandardMaterial).envMap;

prueba("cada fábrica de materiales usa el entorno que se le da, sin importar los de otros visores", () => {
  const taller = new THREE.Texture(), captura = new THREE.Texture();
  const fabricas: Array<[string, (e: THREE.Texture) => THREE.Material]> = [
    ["reflex", (e) => materialDe("reflex", "#a08344", "alta", e)], ["metal", (e) => materialDe("metal", "#deb25b", "editor", e)],
    ["foil", (e) => materialEscenografia(caja("foil"), e)], ["foil mate", (e) => materialEscenografia(caja("foil_mate"), e)],
    ["metal de utilería", (e) => materialEscenografia(caja("metal"), e)], ["lentejuelas (bloque grueso, con textura)", (e) => materialEscenografia({ ...caja("lentejuelas"), tamano: { x: 50, y: 50, z: 30 } } as SolidoEscenografia, e)],
    ["lentejuelas (instancias)", (e) => lentejuelasDePanel({ x: 100, y: 100, z: 2 }, 2, "#d4af5a", e).material as THREE.Material],
    ["confeti", (e) => materialConfeti("#e0b33f", e)], ["piso de madera", (e) => materialPiso("#d8cbbb", new THREE.Texture() as THREE.CanvasTexture, e, 600, 500)],
  ];
  for (const [nombre, hacer] of fabricas) {
    const deTaller = hacer(taller);
    const deCaptura = hacer(captura);
    // Crear y liberar la captura en medio no toca el material del taller, ni el que se cree después con el del taller.
    captura.dispose();
    assert.equal(envMapDe(deTaller), taller, `${nombre}: el material del taller lleva el entorno del taller`);
    assert.equal(envMapDe(deCaptura), captura, `${nombre}: el de la captura lleva el de la captura`);
    assert.equal(envMapDe(hacer(taller)), taller, `${nombre}: lo que el taller crea después de la captura lleva el del taller`);
  }
});

prueba("no queda un entorno global: el módulo del registro no existe y ninguna variable de módulo guarda un entorno", () => {
  const dir = path.resolve(__dirname, "../../src/components/tres-d");
  assert.equal(existsSync(path.join(dir, "entorno-metal.ts")), false, "entorno-metal.ts (el registro) ya no existe");
  const culpables: string[] = [];
  for (const archivo of readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const texto = readFileSync(path.join(dir, archivo), "utf8");
    if (/^(export )?let \w*[eE]ntorno\w*\s*[:=]/m.test(texto) || /entorno-metal/.test(texto)) culpables.push(archivo);
  }
  assert.deepEqual(culpables, [], "variables de módulo con un entorno");
});

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
