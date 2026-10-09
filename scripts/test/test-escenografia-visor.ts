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

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
