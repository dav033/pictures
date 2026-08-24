import assert from "node:assert/strict";
import { bloqueMezclaPorEstructura } from "../src/lib/ia/tamano-fisico";
import { verificarCoherenciaPrompt } from "../src/lib/plan/coherencia";
import type { PlanResuelto } from "../src/lib/plan/resuelto";

const plan = { plan: { estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco rojo", rol_escena: "focal" }], concepto: { titulo: "x" } }, estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco rojo", total_unidades: 10, mezcla_real: [{ diam_pulg: 5, forma: "redondo", unidades: 3, pct: 30 }, { diam_pulg: 12, forma: "redondo", unidades: 7, pct: 70 }] }], compras: [{ diam_pulg: 5, tamano_codigo: "R-5" }, { diam_pulg: 12, tamano_codigo: "R-12" }], totales: {} } as unknown as PlanResuelto;
const block = bloqueMezclaPorEstructura(plan.estructuras.map((estructura) => ({ ...estructura, mezcla_real: estructura.mezcla_real.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades, pct: linea.pct })) })));
assert.ok(block?.includes("EST_01_ARCO"));
assert.ok(block?.includes("3 balloons (30%): 5-inch (12.7 cm)"));
assert.ok(block?.includes("7 balloons (70%): 12-inch (30.5 cm)"));
assert.ok(block?.includes("smaller-than-12-inch balloon must be one of its listed, quoted sizes"));
assert.ok(block?.includes("30.5 cm"));
const coherence = verificarCoherenciaPrompt(`${block}\nArco rojo\n5-inch (12.7 cm)\n12-inch (30.5 cm)`, plan);
assert.equal(coherence.ok, true);
assert.equal(verificarCoherenciaPrompt("Arco rojo 9-inch (22.9 cm)", plan).ok, false);
console.log("[PASS] coherencia prompt ↔ plan — tamaños e identidad de estructura verificables");
