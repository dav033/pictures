/**
 * T25: «inflar a N cm» y segundos de bomba por capa. Prueba `inflado.ts` y la tabla de `bomba-segundos.ts`.
 * Los segundos son una estimación (no medida en una bomba concreta); el test verifica la coherencia, no el valor real.
 * Run: npx tsx --conditions=react-server scripts/test/test-inflado-capas.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FORMATOS_GLOBO } from "../../src/lib/globos3d/formatos";
import { segundosParaTamano } from "../../src/lib/globos3d/bomba-segundos";
import { infladoDeCapa, tablaInflado, textoInflarA } from "../../src/lib/globos3d/inflado";

test("la tabla trae un formato por fila con su tamaño de decoración y segundos positivos", () => {
  const tabla = tablaInflado();
  assert.ok(tabla.length >= 10);
  for (const fila of tabla) {
    const formato = FORMATOS_GLOBO.find((f) => f.id === fila.formatoId);
    assert.ok(formato, fila.formatoId);
    assert.equal(fila.infladoCm, formato.infladoDecoracionCm);
    assert.ok(fila.segundos > 0);
  }
  assert.equal(new Set(tabla.map((f) => f.formatoId)).size, tabla.length);
});

test("un globo más grande tarda más: los redondos crecen con el diámetro", () => {
  const s = (id: string) => tablaInflado().find((f) => f.formatoId === id)!.segundos;
  assert.ok(s("R-5") < s("R-9") && s("R-9") < s("R-12") && s("R-12") < s("R-18") && s("R-18") < s("R-24") && s("R-24") < s("R-36"));
});

test("la calibración del taller reemplaza los segundos de un formato", () => {
  assert.equal(tablaInflado({ "R-12": 5 }).find((f) => f.formatoId === "R-12")!.segundos, 5);
});

test("una capa agrupa por formato con su rango en cm y suma los segundos globo a globo (cubo del diámetro)", () => {
  const capa = [
    { formatoId: "R-12", infladoCm: 25 }, { formatoId: "R-12", infladoCm: 25 }, { formatoId: "R-12", infladoCm: 30 },
    { formatoId: "R-5", infladoCm: 12 },
  ];
  const filas = infladoDeCapa(capa);
  assert.deepEqual(filas.map((f) => f.formatoId), ["R-5", "R-12"]);
  const r12 = filas.find((f) => f.formatoId === "R-12")!;
  assert.equal(r12.cantidad, 3);
  assert.deepEqual([r12.cmMin, r12.cmMax], [25, 30]);
  const esperado = 2 * segundosParaTamano("R-12", 25)! + segundosParaTamano("R-12", 30)!;
  assert.ok(Math.abs(r12.segundos - esperado) <= 0.05, `${r12.segundos} vs ${esperado}`);
  assert.ok(segundosParaTamano("R-12", 30)! > segundosParaTamano("R-12", 25)!);
});

test("los globos de helio no pasan por la bomba y una capa sin bomba queda vacía", () => {
  assert.deepEqual(infladoDeCapa([{ formatoId: "R-12", infladoCm: 28, helio: true }]), []);
  assert.deepEqual(infladoDeCapa([]), []);
});

test("el texto dice a cuántos cm inflar, con un solo valor o un rango", () => {
  assert.equal(textoInflarA({ cmMin: 25, cmMax: 25 }), "Inflar a 25 cm");
  assert.equal(textoInflarA({ cmMin: 25, cmMax: 30 }), "Inflar a 25–30 cm");
});
