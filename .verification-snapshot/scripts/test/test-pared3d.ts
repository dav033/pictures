/**
 * Malla Link-O-Loon tipo flor del taller 3D (`armarPared`), contra las cifras de Sempertex (Celebra ed. 2, p. 40):
 * por m², LOL 6 = 8 cadenetas de 8 (64) y LOL 12 = 4 de 4 (16). Sin coste.
 * - cada nodo lleva una pareja de unión (2 globitos, al frente y atrás);
 * - cada flor (centro) tiene hasta 4 pétalos del mismo color; patrones damero y rombos;
 * - las anclas son los centros de flor, mirando al frente (+Z).
 */
import assert from "node:assert/strict";
import { armarPared } from "../../src/lib/globos3d/paredes";
import { formatoPorId } from "../../src/lib/globos3d/formatos";

const union = { formato: formatoPorId("R-5")!, infladoCm: 10, codigo: "609" };
const area = (p: { anchoCm: number; altoCm: number }) => (p.anchoCm / 100) * (p.altoCm / 100);

const lol12 = armarPared({ formato: formatoPorId("LOL-12")!, infladoCm: 24, anchoCm: 200, altoCm: 200, patron: "un_color", colores: ["009"], union });
assert.ok(Math.abs(lol12.eslabones / area(lol12) - 16) < 1.5, `LOL-12: ${(lol12.eslabones / area(lol12)).toFixed(1)} por m² (Sempertex: 16)`);
const lol6 = armarPared({ formato: formatoPorId("LOL-6")!, infladoCm: 12, anchoCm: 200, altoCm: 200, patron: "un_color", colores: ["009"], union });
assert.ok(Math.abs(lol6.eslabones / area(lol6) - 64) < 5, `LOL-6: ${(lol6.eslabones / area(lol6)).toFixed(1)} por m² (Sempertex: 64)`);

// Uniones: una pareja (2 R-5) por nodo; los materiales suman eslabones + 2 × uniones.
const total = lol12.materiales.reduce((s, m) => s + m.cantidad, 0);
assert.equal(total, lol12.eslabones + lol12.uniones * 2);
assert.equal(lol12.materiales.find((m) => m.formatoId === "R-5")?.cantidad, lol12.uniones * 2);

// Damero: flores vecinas de distinto color (los pétalos de una flor comparten color).
const damero = armarPared({ formato: formatoPorId("LOL-12")!, infladoCm: 24, anchoCm: 300, altoCm: 225, patron: "damero", colores: ["051", "012"], union });
const lol = damero.materiales.filter((m) => m.formatoId === "LOL-12");
assert.equal(lol.length, 2, "damero: dos colores de eslabón");
// Mural de la revista (3 × 2,25 m con LOL-9 a 18 cm ≈ 192 eslabones; con LOL-12 a 24 cm, ~108).
assert.ok(damero.eslabones > 90 && damero.eslabones < 130, `mural 3 × 2,25 con LOL-12: ${damero.eslabones} eslabones`);

for (const a of damero.anclas) assert.ok(a.normal.z === 1 && a.posicion.z > 0, "las anclas miran al frente");
const rombos = armarPared({ formato: formatoPorId("LOL-12")!, infladoCm: 24, anchoCm: 300, altoCm: 225, patron: "rombos", colores: ["051", "650", "012", "009"], union });
assert.equal(rombos.materiales.filter((m) => m.formatoId === "LOL-12").length, 4, "rombos: 4 colores");

console.log(`OK test-pared3d: malla LOL tipo flor a 16 LOL-12 y 64 LOL-6 por m² (Sempertex), parejas de unión en cada cruce, damero y rombos, anclas al frente`);
