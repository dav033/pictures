/**
 * Fixtures doradas del motor 3D de la vista guiada (REQ-007, fase 1). Sin coste: no llama a ninguna IA.
 * Una por cada una de las 28 ideas guardadas y por cada una de las 18 estructuras oficiales
 * (`contracts/domain/v1/golden/motor-guiada/`): las cantidades por (formato, código) por pieza y en total, el hash de
 * la espec, lo que no se pudo representar y la caja de cada pieza ± 5 cm.
 *
 * Si falla porque el motor cambió a propósito: sube `VERSION_MOTOR` (src/lib/globos3d/motor/v1.ts) y regenera con
 *   npx tsx --conditions=react-server scripts/motor/generar-golden-motor-guiada.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DIRECTORIO_DORADO, registroDe, todosLosCasos, type RegistroDorado } from "../lib/casos-motor-guiada";
import { VERSION_MOTOR } from "../../src/lib/globos3d/motor/v1";

const TOLERANCIA_CAJA_CM = 5;
const casos = todosLosCasos();
assert.equal(casos.length, 28 + 18, "28 ideas guardadas y 18 estructuras oficiales");

const esperados = new Set(casos.map((c) => `${c.id}.json`));
const sobrantes = readdirSync(DIRECTORIO_DORADO).filter((f) => f.endsWith(".json") && !esperados.has(f));
assert.deepEqual(sobrantes, [], `fixtures doradas sin caso: ${sobrantes.join(", ")}`);

let piezas = 0;
for (const caso of casos) {
  const ruta = path.join(DIRECTORIO_DORADO, `${caso.id}.json`);
  assert.ok(existsSync(ruta), `falta la fixture dorada ${caso.id}`);
  const dorado = JSON.parse(readFileSync(ruta, "utf8")) as RegistroDorado;
  const actual = registroDe(caso);
  const donde = `${caso.id}`;

  assert.equal(dorado.motor.version, VERSION_MOTOR, `${donde}: la fixture se tomó con el motor ${dorado.motor.version} y ahora es ${VERSION_MOTOR}: regenera las fixtures`);
  assert.equal(actual.especHash, dorado.especHash, `${donde}: la espec cambió (especHash)`);
  assert.deepEqual(actual.noRepresentable, dorado.noRepresentable, `${donde}: cambió lo que no se representa`);
  assert.deepEqual(Object.keys(actual.piezas), Object.keys(dorado.piezas), `${donde}: cambiaron las piezas`);
  for (const id of Object.keys(dorado.piezas)) {
    assert.deepEqual(actual.piezas[id]!.lineas, dorado.piezas[id]!.lineas, `${donde}/${id}: cambió la lista de materiales`);
    actual.piezas[id]!.caja.forEach((v, k) => assert.ok(Math.abs(v - dorado.piezas[id]!.caja[k]!) <= TOLERANCIA_CAJA_CM, `${donde}/${id}: la caja se movió más de ${TOLERANCIA_CAJA_CM} cm en el eje ${k} (${v} contra ${dorado.piezas[id]!.caja[k]})`));
    piezas += 1;
  }
  assert.deepEqual(actual.total.lineas, dorado.total.lineas, `${donde}: cambió el total`);
  assert.equal(actual.total.unidades, dorado.total.unidades);
  actual.caja.forEach((v, k) => assert.ok(Math.abs(v - dorado.caja[k]!) <= TOLERANCIA_CAJA_CM, `${donde}: la caja total se movió más de ${TOLERANCIA_CAJA_CM} cm en el eje ${k}`));
  assert.deepEqual(actual.referenciaPython, dorado.referenciaPython, `${donde}: cambió la referencia de Python`);
}

// Las ideas con pieza representable cuentan algo; lo que no se representa queda dicho, no en cero callado.
for (const caso of casos) {
  const dorado = JSON.parse(readFileSync(path.join(DIRECTORIO_DORADO, `${caso.id}.json`), "utf8")) as RegistroDorado;
  if (dorado.noRepresentable.length === 0) assert.ok(dorado.total.unidades > 0, `${caso.id}: sin globos y sin motivo`);
  else assert.ok(dorado.noRepresentable.every((n) => n.motivo.length > 10 && n.piezaId in Object.fromEntries(caso.espec.piezas.map((p) => [p.id, 1]))), `${caso.id}: un no representable sin motivo o sin pieza`);
}

console.log(`test-motor-guiada-golden: ok (${casos.length} casos, ${piezas} piezas, motor ${VERSION_MOTOR})`);
