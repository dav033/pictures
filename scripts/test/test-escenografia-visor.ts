/**
 * La escenografía de un visor (`escenografia-visor.ts`): sus cachés de materiales y geometrías son de ESE visor. Un caché
 * de módulo con el reflejo de otro visor ya liberado deja negro lo metálico (el defecto del foil tras una captura): dos
 * visores no comparten materiales, cada uno refleja su entorno, y lo de un visor sigue vivo cuando se libera el otro.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-escenografia-visor.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { crearEscenografiaVisor } from "@/components/tres-d/escenografia-visor";
import { armarEscenografia, type SolidoEscenografia } from "@/lib/globos3d/escenografia";

let fallos = 0;
function prueba(nombre: string, f: () => void) {
  try { f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

const entornoA = new THREE.Texture();
const entornoB = new THREE.Texture();
const caja = (x: number, tamano: { x: number; y: number; z: number }, hex: string, acabado: "metal" | "madera"): SolidoEscenografia =>
  armarEscenografia([{ forma: "caja", centro: { x, y: 40, z: 0 }, tamano, hex, acabado }])[0]!;
const metal = (x: number) => caja(x, { x: 10, y: 80, z: 10 }, "#c0c0c0", "metal");
const madera = (x: number) => caja(x, { x: 40, y: 3, z: 40 }, "#8a5a3c", "madera");
const materialesDe = (objetos: THREE.Object3D[]) => {
  const salida: THREE.Material[] = [];
  for (const o of objetos) o.traverse((h) => { if (h instanceof THREE.Mesh) salida.push(...(Array.isArray(h.material) ? h.material : [h.material])); });
  return salida;
};
const envMapDe = (m: THREE.Material) => (m as THREE.MeshStandardMaterial).envMap;

prueba("cada visor refleja su propio entorno y no comparte materiales con otro", () => {
  const a = crearEscenografiaVisor(() => entornoA), b = crearEscenografiaVisor(() => entornoB);
  const ma = materialesDe(a.piezas([metal(0)])), mb = materialesDe(b.piezas([metal(0)]));
  assert.ok(ma.length && mb.length);
  assert.ok(ma.every((m) => envMapDe(m) === entornoA), "los metales de A reflejan A");
  assert.ok(mb.every((m) => envMapDe(m) === entornoB), "los metales de B reflejan B");
  assert.ok(ma.every((m) => !mb.includes(m)), "ningún material compartido entre visores");
});

prueba("dentro de un visor lo del mismo color comparte material y lo igual se junta en una malla por pieza", () => {
  const v = crearEscenografiaVisor(() => entornoA);
  const pieza = v.piezas([madera(0), madera(50), madera(100)]);
  assert.equal(pieza.length, 1, "tres tablas iguales, una malla");
  const otra = v.piezas([madera(0)]);
  assert.equal(materialesDe(pieza)[0], materialesDe(otra)[0], "el mismo material entre piezas del mismo visor");
});

prueba("liberar un visor no toca lo de otro visor", () => {
  const a = crearEscenografiaVisor(() => entornoA), b = crearEscenografiaVisor(() => entornoB);
  const mb = materialesDe(b.piezas([metal(0)]));
  let liberadosB = 0;
  for (const m of mb) m.addEventListener("dispose", () => { liberadosB++; });
  a.piezas([metal(0)]);
  a.liberar();
  assert.equal(liberadosB, 0, "los materiales de B siguen vivos");
  b.liberar();
  assert.ok(liberadosB > 0, "B libera los suyos");
});

prueba("los sólidos ocultos no se dibujan", () => {
  const v = crearEscenografiaVisor(() => entornoA);
  assert.equal(v.piezas([{ ...madera(0), oculto: true }]).length, 0);
});

const pluma = (x: number, hex = "#d8c3a0"): SolidoEscenografia =>
  armarEscenografia([{ forma: "cilindro", base: { x, y: 60, z: 0 }, radioCm: 5, altoCm: 34, hex, acabado: "pampa" }])[0]!;
const mapasDe = (objetos: THREE.Object3D[]) => materialesDe(objetos).map((m) => (m as THREE.MeshBasicMaterial).map);

prueba("las plumas de pampa de una pieza se juntan en una malla translúcida con la textura de hebras de SU visor", () => {
  const v = crearEscenografiaVisor(() => entornoA);
  const malla = v.piezas([pluma(0), pluma(20), pluma(40)]);
  assert.equal(malla.length, 1, "tres plumas del mismo color, una malla");
  const [m] = materialesDe(malla) as THREE.MeshBasicMaterial[];
  assert.ok(m!.transparent && !m!.depthWrite && m!.map, "translúcida, sin escribir profundidad, con textura");
  assert.equal(m!.color.getHexString(), "d8c3a0");
  const otra = v.piezas([pluma(0, "#f6f1e8")]);
  assert.notEqual(materialesDe(otra)[0], m, "otro color, otro material");
  assert.equal(mapasDe(otra)[0], m!.map, "la textura se comparte dentro del visor");
  const geo = (malla[0] as THREE.Mesh).geometry;
  geo.computeBoundingBox();
  assert.ok(geo.boundingBox!.max.y > 0.9 && geo.boundingBox!.max.y < 1.01, `la pluma de 34 cm sube ${(geo.boundingBox!.max.y).toFixed(2)} m desde su base a 60 cm`);
  assert.equal((malla[0] as THREE.Mesh).castShadow, false, "las hebras no echan sombra");
});

prueba("la textura de la pluma es de cada visor: liberar uno no suelta la del otro", () => {
  const a = crearEscenografiaVisor(() => entornoA), b = crearEscenografiaVisor(() => entornoB);
  const [mapaA] = mapasDe(a.piezas([pluma(0)])), [mapaB] = mapasDe(b.piezas([pluma(0)]));
  assert.ok(mapaA && mapaB && mapaA !== mapaB, "una textura por visor");
  let sueltaA = 0, sueltaB = 0;
  mapaA.addEventListener("dispose", () => { sueltaA++; });
  mapaB.addEventListener("dispose", () => { sueltaB++; });
  a.liberar();
  assert.equal(sueltaA, 1, "A suelta la suya");
  assert.equal(sueltaB, 0, "la de B sigue viva");
  const [nueva] = mapasDe(a.piezas([pluma(0)]));
  assert.ok(nueva && nueva !== mapaA, "tras liberar, A crea una textura nueva y no reusa la soltada");
  b.liberar();
  assert.equal(sueltaB, 1);
});

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
