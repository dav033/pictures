/**
 * Arco de cuartetos del taller 3D (`armarArco`): la trenza de Sempertex sobre una curva de piso a piso. Sin coste.
 * - un arco redondo de 3 × 2,4 m con R-12 a 25 cm recorre ~6,2 m: ~32 cuartetos (5 por metro + el del extremo);
 * - empieza y termina en el piso, y arriba llega a la altura pedida;
 * - cada cuarteto queda perpendicular al recorrido (arriba su eje es horizontal; en la pata recta del
 *   rectangular, vertical).
 */
import assert from "node:assert/strict";
import { armarArco, recorridoArco } from "../../src/lib/globos3d/arcos";
import { formatoPorId } from "../../src/lib/globos3d/formatos";
import { longitudRecorrido } from "../../src/lib/globos3d/trenza";

const r12 = formatoPorId("R-12")!;
const arco = armarArco({ formato: r12, infladoCm: 25, forma: "redondo", anchoCm: 300, altoCm: 240, patron: "espiral", colores: ["020", "038", "012", "031"] });
assert.ok(Math.abs(arco.longitudCm - 621) < 8, `recorrido del arco 3 × 2,4: ${arco.longitudCm} cm`);
assert.equal(arco.niveles, Math.round(arco.longitudCm / 20) + 1);
assert.equal(arco.globos.length, arco.niveles * 4);
assert.equal(arco.materiales.reduce((s, m) => s + m.cantidad, 0), arco.globos.length);

// Extremos en el piso y cumbre a la altura pedida (centros de los cuartetos: promedio de sus 4 nudos).
const centro = (nivel: number) => {
  const gs = arco.globos.filter((g) => g.nivel === nivel);
  return { x: gs.reduce((s, g) => s + g.nudo.x, 0) / gs.length, y: gs.reduce((s, g) => s + g.nudo.y, 0) / gs.length };
};
assert.ok(Math.abs(centro(0).y) < 3 && Math.abs(centro(0).x + 150) < 3, `pata izquierda en el piso: ${JSON.stringify(centro(0))}`);
assert.ok(Math.abs(centro(arco.niveles - 1).y) < 3 && Math.abs(centro(arco.niveles - 1).x - 150) < 3, "pata derecha en el piso");
const cumbre = centro(Math.floor((arco.niveles - 1) / 2));
assert.ok(Math.abs(cumbre.y - 240) < 6, `la cumbre llega a 2,4 m: ${cumbre.y}`);

// En la cumbre el cuarteto rodea un eje horizontal: sus globos salen hacia arriba/abajo y hacia los lados (z).
const enCumbre = arco.globos.filter((g) => g.nivel === Math.floor((arco.niveles - 1) / 2));
assert.ok(enCumbre.every((g) => Math.abs(g.direccion.x) < 0.35), "arriba el cuarteto es perpendicular al recorrido");

// Rectangular: patas rectas (los primeros cuartetos suben en vertical, con su anillo horizontal).
const rect = armarArco({ formato: r12, infladoCm: 25, forma: "rectangular", anchoCm: 300, altoCm: 240, patron: "un_color", colores: ["005"] });
assert.ok(rect.globos.filter((g) => g.nivel === 2).every((g) => Math.abs(g.direccion.y) < 0.35), "en la pata recta el cuarteto queda horizontal");
assert.ok(longitudRecorrido(recorridoArco("rectangular", 300, 240)) > longitudRecorrido(recorridoArco("redondo", 300, 240)), "el rectangular recorre más que el redondo");

console.log(`OK test-arco3d: arco redondo 3 × 2,4 m con R-12 = ${arco.niveles} cuartetos (${arco.globos.length} globos) de piso a piso; cuartetos perpendiculares al recorrido`);
