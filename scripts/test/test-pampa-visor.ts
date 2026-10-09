/**
 * La pluma de pampa del visor (`pampa-visor.ts`, `flores-visor.ts`): su textura de hebras, su geometría, las partes de una pampa de
 * guirnalda y la regla D-017 (nada de GPU en cachés de módulo: la textura y el material son de quien los crea y los suelta al liberarse).
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-pampa-visor.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { geometriaParteFlor, materialParteFlor, partesFlor, type FlorADibujar } from "@/components/tres-d/flores-visor";
import { ALTO_TEXTURA, ANCHO_TEXTURA, crearTexturaPluma, geometriaPluma, materialPlumaConTextura, pixelesPluma, semianchoPluma } from "@/components/tres-d/pampa-visor";

let fallos = 0;
function prueba(nombre: string, f: () => void) {
  try { f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

const alfaDe = (datos: Uint8Array, x: number, y: number) => datos[(y * ANCHO_TEXTURA + x) * 4 + 3]!;

prueba("la textura de hebras es una gota alargada: vacía en las esquinas, firme en el raquis y estable entre llamadas", () => {
  const a = pixelesPluma(), b = pixelesPluma();
  assert.equal(a.length, ANCHO_TEXTURA * ALTO_TEXTURA * 4);
  assert.deepEqual(a, b, "la misma semilla da la misma pluma");
  assert.notDeepEqual(a, pixelesPluma(12), "otra semilla, otra pluma");
  for (const [x, y] of [[0, 0], [ANCHO_TEXTURA - 1, 0], [0, ALTO_TEXTURA - 1], [ANCHO_TEXTURA - 1, ALTO_TEXTURA - 1], [0, ALTO_TEXTURA / 2]] as const) assert.equal(alfaDe(a, x, y), 0, `esquina ${x},${y}`);
  assert.ok(Math.max(alfaDe(a, ANCHO_TEXTURA / 2 - 1, Math.floor(ALTO_TEXTURA / 3)), alfaDe(a, ANCHO_TEXTURA / 2, Math.floor(ALTO_TEXTURA / 3))) > 200, "el raquis central");
  let cubierto = 0, firmes = 0;
  for (let i = 3; i < a.length; i += 4) { if (a[i]! > 8) cubierto++; if (a[i]! > 160) firmes++; }
  const total = ANCHO_TEXTURA * ALTO_TEXTURA;
  assert.ok(cubierto / total > 0.2 && cubierto / total < 0.7, `cubre ${(cubierto / total).toFixed(2)}`);
  assert.ok(firmes / total > 0.02 && firmes / total < cubierto / total, `hebras firmes ${(firmes / total).toFixed(2)}`);
  assert.ok(semianchoPluma(0.4) > semianchoPluma(0.9) && semianchoPluma(0.4) > semianchoPluma(0.05) && semianchoPluma(1) === 0, "más ancha por abajo del medio, afinada en la punta");
});

prueba("la geometría es de alto 1 sobre +Y, con tres tarjetas cruzadas y sus uv", () => {
  const g = geometriaPluma();
  g.computeBoundingBox();
  const caja = g.boundingBox!;
  assert.ok(Math.abs(caja.min.y) < 1e-6 && Math.abs(caja.max.y - 1) < 1e-6, "base en 0 y punta en 1");
  assert.ok(caja.max.x - caja.min.x > 1.8 && caja.max.z - caja.min.z > 1.5, "las tarjetas se abren en x y en z");
  assert.equal(g.getAttribute("uv").count, g.getAttribute("position").count);
  assert.equal(g.index!.count % 3, 0);
  assert.ok(Math.max(...g.index!.array) < g.getAttribute("position").count, "los índices caen dentro");
  assert.equal(g.index!.count / 3, 3 * 8 * 2 * 2, "3 tarjetas de 8×2 celdas");
});

const pampa = (extra: Partial<FlorADibujar> = {}): FlorADibujar => ({ tipo: "pampa", hex: "#e8dcc2", diametroCm: 52, ...extra });
const mundo = (q: THREE.Quaternion, p: THREE.Vector3) => p.clone().applyQuaternion(q);

prueba("una pampa lleva su tallo curvo y, al final, UNA pluma esponjosa: no es un abanico de hoja seca", () => {
  const partes = partesFlor(pampa(), 7);
  assert.equal(partes.filter((p) => p.parte === "pluma").length, 1);
  assert.ok(partes.filter((p) => p.parte === "tallo").length >= 3, "el tallo va en tramos");
  assert.ok(!partes.some((p) => p.parte === "foliolo"), "sin foliolos de abanico");
  const seca = partesFlor({ tipo: "hoja_seca", hex: "#c8a24f", diametroCm: 32 }, 7);
  assert.ok(seca.every((p) => p.parte === "foliolo"), "la hoja seca sigue siendo el abanico");
  const alto = new THREE.Vector3(), escala = new THREE.Vector3();
  partes.find((p) => p.parte === "pluma")!.local.decompose(alto, new THREE.Quaternion(), escala);
  assert.ok(escala.y > 0.25 && escala.y < 0.4, `pluma de ${(escala.y * 100).toFixed(0)} cm`);
  assert.ok(escala.x > 0.04 && escala.x < 0.09, `semiancho ${(escala.x * 100).toFixed(1)} cm`);
  assert.deepEqual(partesFlor(pampa(), 7).map((p) => p.local.elements), partes.map((p) => p.local.elements), "determinista");
  assert.notDeepEqual(partesFlor(pampa(), 8).map((p) => p.local.elements), partes.map((p) => p.local.elements), "cada pampa, la suya");
});

prueba("la punta de la pampa mira hacia arriba del mundo aunque salga de un hueco de lado", () => {
  const lado = { x: 1, y: 0, z: 0 };
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(lado.x, lado.y, lado.z));
  for (let semilla = 1; semilla <= 12; semilla++) {
    const pluma = partesFlor(pampa({ normal: lado }), semilla).find((p) => p.parte === "pluma")!;
    const base = new THREE.Vector3(), rot = new THREE.Quaternion(), escala = new THREE.Vector3();
    pluma.local.decompose(base, rot, escala);
    const punta = base.clone().add(new THREE.Vector3(0, escala.y, 0).applyQuaternion(rot));
    assert.ok(mundo(q, punta).y > mundo(q, new THREE.Vector3(0, 0, 0)).y + 0.15, `semilla ${semilla}: punta a ${mundo(q, punta).y.toFixed(2)} m`);
  }
});

prueba("cada visor trae su textura de pluma: nada de cachés de módulo con objetos de la GPU", () => {
  const a = materialParteFlor("pluma"), b = materialParteFlor("pluma");
  assert.notEqual(a, b);
  assert.ok(a.map && b.map && a.map !== b.map, "una textura por material");
  assert.notEqual(geometriaParteFlor("pluma"), geometriaParteFlor("pluma"));
  let sueltaA = 0, sueltaB = 0;
  a.map!.addEventListener("dispose", () => { sueltaA++; });
  b.map!.addEventListener("dispose", () => { sueltaB++; });
  a.dispose();
  assert.equal(sueltaA, 1, "soltar el material de A suelta su textura");
  assert.equal(sueltaB, 0, "la de B sigue viva");
  b.dispose();
  assert.equal(sueltaB, 1);
  const suelto = materialPlumaConTextura("#d8c3a0");
  assert.equal(suelto.color.getHexString(), "d8c3a0");
  suelto.dispose();
});

prueba("la textura es mipmapeada, translúcida y sin canvas", () => {
  const t = crearTexturaPluma();
  assert.equal(t.image.width, ANCHO_TEXTURA);
  assert.equal(t.minFilter, THREE.LinearMipmapLinearFilter);
  const m = materialParteFlor("pluma");
  assert.ok(m.transparent && !m.depthWrite && m.side === THREE.DoubleSide);
  m.dispose();
  t.dispose();
});

if (fallos) { console.log(`${fallos} pruebas fallaron`); process.exit(1); }
console.log("test-pampa-visor: ok");
