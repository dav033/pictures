import assert from "node:assert/strict";
import { buildImagePrompt } from "../src/lib/ia/build-image-prompt";
import { bloqueMezclaPorEstructura, type EstructuraMezclaTamanos } from "../src/lib/ia/tamano-fisico";
import { verificarCoherenciaPrompt } from "../src/lib/plan/coherencia";
import type { PlanResuelto } from "../src/lib/plan/resuelto";
import type { SceneSpec } from "../src/lib/ia/scene-spec";

/** Lo que route.ts le pasa al bloque: nombre, repeticiones y unidades por diámetro. */
function bloqueDelPlan(plan: PlanResuelto): string | null {
  return bloqueMezclaPorEstructura(plan.estructuras.map((estructura) => ({
    nombre: estructura.nombre,
    total_unidades: estructura.total_unidades,
    repeticiones: estructura.repeticiones,
    mezcla_real: estructura.mezcla_real.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades })),
  } satisfies EstructuraMezclaTamanos)));
}

const plan = { plan: { estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco rojo", rol_escena: "focal" }], concepto: { titulo: "x" } }, estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco rojo", repeticiones: 1, total_unidades: 10, mezcla_real: [{ diam_pulg: 5, forma: "redondo", unidades: 3, pct: 30 }, { diam_pulg: 12, forma: "redondo", unidades: 7, pct: 70 }] }], compras: [{ diam_pulg: 5, tamano_codigo: "R-5" }, { diam_pulg: 12, tamano_codigo: "R-12" }], totales: {} } as unknown as PlanResuelto;
const block = bloqueDelPlan(plan);
// El bloque nombra la estructura como el cliente la ve: el prompt retira los
// IDs a propósito (build-image-prompt.ts) porque el modelo los dibuja como
// rótulos, y la coherencia acepta el nombre igual que el id.
assert.ok(block?.includes('"Arco rojo", 10 balloons total:'));
assert.doesNotMatch(block!, /EST_\d/);
assert.ok(block?.includes("3 balloons (30%): 5-inch (12.7 cm)"));
assert.ok(block?.includes("7 balloons (70%): 12-inch (30.5 cm)"));
assert.ok(block?.includes("every visible balloon must be one of its listed, quoted sizes"));
assert.ok(block?.includes("30.5 cm"));
const coherence = verificarCoherenciaPrompt(`${block}\nArco rojo\n5-inch (12.7 cm)\n12-inch (30.5 cm)`, plan);
assert.equal(coherence.ok, true);
assert.equal(verificarCoherenciaPrompt("Arco rojo 9-inch (22.9 cm)", plan).ok, false);

// Static size guidance must never smuggle an unquoted diameter into a plan
// prompt. Regression from live Festival Lunaria flow: R-24-only quote was
// rejected because generic "smaller-than-12-inch" wording tripped the gate.
const r24Only = {
  ...plan,
  estructuras: [{ ...plan.estructuras[0]!, mezcla_real: [{ diam_pulg: 24, forma: "redondo", unidades: 10, pct: 100 }] }],
  compras: [{ diam_pulg: 24, tamano_codigo: "R-24" }],
} as unknown as PlanResuelto;
const r24Block = bloqueDelPlan(r24Only);
assert.ok(r24Block);
assert.doesNotMatch(r24Block, /12-inch/);
const r24Prompt = buildImagePrompt({ sceneSpec: { elements: [] } as unknown as SceneSpec, sizeMixBlock: r24Block });
assert.doesNotMatch(r24Prompt, /12-inch/);
assert.equal(verificarCoherenciaPrompt(r24Prompt, r24Only).ok, true);

// Estructura repetida: las cantidades son POR INSTANCIA, igual que el
// INSTANCE CONTRACT y el reparto piso + resto de planBlueprint. Antes el
// bloque decía "78 balloons total" para dos columnas de 39 y el modelo podía
// dibujar dos columnas del doble de densidad.
const columnas = {
  ...plan,
  plan: { ...plan.plan, estructuras: [{ estructura_id: "EST_02_COLUMNAS", nombre: "Columnas laterales", rol_escena: "soporte" }] },
  estructuras: [{ estructura_id: "EST_02_COLUMNAS", nombre: "Columnas laterales", repeticiones: 2, total_unidades: 78, mezcla_real: [{ diam_pulg: 12, forma: "redondo", unidades: 78, pct: 100 }] }],
  compras: [{ diam_pulg: 12, tamano_codigo: "R-12" }],
} as unknown as PlanResuelto;
const bloqueColumnas = bloqueDelPlan(columnas);
assert.ok(bloqueColumnas);
assert.ok(bloqueColumnas.includes('"Columnas laterales": 2 separate identical structures, 39 balloons each (78 total across both):'), bloqueColumnas);
assert.ok(bloqueColumnas.includes("- 39 balloons each (100%): 12-inch (30.5 cm)"), bloqueColumnas);
assert.doesNotMatch(bloqueColumnas, /EST_\d/);
assert.equal(verificarCoherenciaPrompt(`${bloqueColumnas}\n12-inch (30.5 cm)`, columnas).ok, true);

// Total no divisible: rango explícito en vez de un promedio inventado.
const impares = {
  ...columnas,
  estructuras: [{ ...columnas.estructuras[0]!, total_unidades: 79, mezcla_real: [{ diam_pulg: 12, forma: "redondo", unidades: 79, pct: 100 }] }],
} as unknown as PlanResuelto;
const bloqueImpar = bloqueDelPlan(impares);
assert.ok(bloqueImpar?.includes("3 separate identical structures") === false);
assert.ok(bloqueImpar?.includes('"Columnas laterales": 2 separate identical structures, 39-40 balloons each (79 total across both):'), String(bloqueImpar));
assert.ok(bloqueImpar?.includes("- 39-40 balloons each (100%): 12-inch (30.5 cm)"), String(bloqueImpar));

// Tres instancias: "across all 3".
const tres = {
  ...columnas,
  estructuras: [{ ...columnas.estructuras[0]!, repeticiones: 3, total_unidades: 120, mezcla_real: [{ diam_pulg: 12, forma: "redondo", unidades: 120, pct: 100 }] }],
} as unknown as PlanResuelto;
assert.ok(bloqueDelPlan(tres)?.includes("3 separate identical structures, 40 balloons each (120 total across all 3):"));

// Porcentajes por mayor resto: la frase promete proporciones EXACTAS, así que
// las filas visibles tienen que sumar 100 (antes 119 globos daban 101 %).
const mezclaLarga = {
  ...plan,
  estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco rojo", repeticiones: 1, total_unidades: 119, mezcla_real: [
    { diam_pulg: 12, forma: "redondo", unidades: 64, pct: 53.78 },
    { diam_pulg: 5, forma: "redondo", unidades: 25, pct: 21.01 },
    { diam_pulg: 9, forma: "redondo", unidades: 21, pct: 17.65 },
    { diam_pulg: 18, forma: "redondo", unidades: 6, pct: 5.04 },
    { diam_pulg: 24, forma: "redondo", unidades: 3, pct: 2.52 },
  ] }],
  compras: [{ diam_pulg: 5, tamano_codigo: "R-5" }, { diam_pulg: 9, tamano_codigo: "R-9" }, { diam_pulg: 12, tamano_codigo: "R-12" }, { diam_pulg: 18, tamano_codigo: "R-18" }, { diam_pulg: 24, tamano_codigo: "R-24" }],
} as unknown as PlanResuelto;
const bloqueLargo = bloqueDelPlan(mezclaLarga)!;
const suma = [...bloqueLargo.matchAll(/\((\d+)%\)/g)].reduce((total, match) => total + Number(match[1]), 0);
assert.equal(suma, 100, bloqueLargo);

console.log("[PASS] coherencia prompt ↔ plan — tamaños, instancias repetidas y proporciones que suman 100");
