/**
 * T28: línea de helio (litros y ft³ por tamaño) y cinta (total y por globo) para la lista de materiales.
 * Prueba `helio-bom.ts` sobre `resumenHelio` real. Las cifras salen de la esfera (4/3·π·r³) con 7 % de pérdida.
 * Run: npx tsx --conditions=react-server scripts/test/test-bom-helio-cinta.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { METROS_CINTA_POR_GLOBO, resumenHelio } from "../../src/lib/globos3d/helio-cinta";
import { LITROS_POR_PIE3, bomHelio, litrosAPies3 } from "../../src/lib/globos3d/helio-bom";

const helio = (formatoId: string, infladoCm: number) => ({ formatoId, infladoCm, helio: true as const });

test("sin globos de helio no hay línea (null), y un globo de aire no cuenta", () => {
  assert.equal(bomHelio(resumenHelio([])), null);
  assert.equal(bomHelio(resumenHelio([{ globos: [{ formatoId: "R-12", infladoCm: 28 }] }])), null);
});

test("10 globos de 30 cm: 151,3 L, su ft³ y 1,2 m de cinta por globo cuando la pieza no la dice", () => {
  const bom = bomHelio(resumenHelio([{ globos: Array.from({ length: 10 }, () => helio("R-12", 30)) }]));
  assert.ok(bom);
  assert.equal(bom.litros, 151.3);
  assert.equal(bom.pies3, litrosAPies3(151.3));
  assert.ok(Math.abs(bom.pies3 - 151.3 / 28.316846592) < 0.01);
  assert.equal(bom.metrosCinta, 10 * METROS_CINTA_POR_GLOBO);
  assert.equal(bom.metrosCintaPorGlobo, METROS_CINTA_POR_GLOBO);
  assert.equal(bom.lineas.length, 1);
  assert.equal(bom.lineas[0]!.cantidad, 10);
});

test("cada tamaño distinto es su propia línea y los litros por globo crecen con el diámetro", () => {
  const bom = bomHelio(resumenHelio([{ globos: [helio("R-12", 25), helio("R-12", 25), helio("R-18", 42)] }]))!;
  assert.equal(bom.lineas.length, 2);
  const [chico, grande] = [...bom.lineas].sort((a, b) => a.infladoCm - b.infladoCm);
  assert.ok(grande!.litrosPorGlobo > chico!.litrosPorGlobo);
  assert.ok(Math.abs(bom.litros - bom.lineas.reduce((s, l) => s + l.litros, 0)) < 0.11);
});

test("la cinta que dice la pieza manda sobre la de por defecto, y se promedia por globo", () => {
  const bom = bomHelio(resumenHelio([{ globos: [helio("R-12", 28), helio("R-12", 28)], metrosCinta: 5 }]))!;
  assert.equal(bom.metrosCinta, 5);
  assert.equal(bom.metrosCintaPorGlobo, 2.5);
});

test("los formatos que no flotan (tubito, Link-O-Loon) no entran en el helio", () => {
  assert.equal(bomHelio(resumenHelio([{ globos: [helio("T-260", 5), helio("LOL-12", 25)] }])), null);
});

test("la constante de conversión es la del pie cúbico", () => {
  assert.equal(LITROS_POR_PIE3, 28.316846592);
  assert.equal(litrosAPies3(28.316846592), 1);
});
