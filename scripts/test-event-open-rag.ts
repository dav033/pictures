import assert from "node:assert/strict";
import { parseEventSearchIntent } from "../src/lib/rag/query-parser/event-search";
import {
  evidenceForEventMatch,
  planComponentQueries,
  type EventSearchIntent,
} from "../src/lib/rag/retrieval/event-query-planner";
import { puntuarYOrdenar } from "../src/lib/rag/retrieval/rerank";

function intent(message: string): EventSearchIntent {
  return parseEventSearchIntent(message);
}

const open = intent("revelación de género azul y rosado elegante");
assert.equal(open.event_label, "revelación de género");
assert.deepEqual(open.occasion_filter, []);
assert.deepEqual(open.hard_filters.colores.sort(), ["azul", "rosado"]);

const unknown = intent("evento carnaval de las luciérnagas verde y dorado");
assert.equal(unknown.event_label, "evento carnaval de las luciérnagas");
assert.deepEqual(unknown.occasion_filter, []);
assert.ok(unknown.event_terms.includes("carnaval"));

const genericProduct = intent("globos para arco azul");
assert.equal(genericProduct.event_label, null, "producto no debe convertirse en evento abierto");

for (const message of [
  "revelación de género azul y rosado",
  "bautizo blanco y dorado",
  "primera comunión elegante",
  "evento corporativo verde y blanco",
  "quinceañero fucsia",
  "aniversario plateado",
  "evento carnaval de las luciérnagas",
]) {
  const parsed = intent(message);
  assert.ok(parsed.event_label, `preserva label: ${message}`);
  assert.equal(typeof parsed.semantic_query, "string");
  assert.ok(!parsed.occasion_filter.includes("boda"), `no inventa boda: ${message}`);
}

const queries = planComponentQueries({
  request: "elegante revelación de género azul y rosado",
  event: open,
  space: { type: "salón interior", width_cm: 300, height_cm: 240 },
  budget_cop: 800_000,
  complexity: "full_event",
});
assert.ok(queries.length >= 4);
assert.equal(new Set(queries.map((query) => query.query)).size, queries.length, "queries por componente deben diferir");
assert.ok(queries.every((query) => query.hard_filters.colores?.join() === open.hard_filters.colores.join()));
assert.ok(queries.every((query) => query.ladder.length === 4));
assert.ok(queries.every((query) => query.ladder.slice(1).every((tier) => tier.hard_filters.precioMax === query.budget_cop)));
// Color is explicit physical/customer intent. Event ladder may relax only
// occasion evidence; it must never silently replace requested colors.
assert.ok(queries.every((query) => query.ladder.every((tier) => tier.hard_filters.colores?.join() === open.hard_filters.colores.join())));
assert.ok(queries.every((query) => query.ladder.slice(1).every((tier) => !tier.relaxations.some((relaxation) => /color/i.test(relaxation)))));

const exact = evidenceForEventMatch(
  { title: "Kit revelación de género azul y rosado", tags: ["REVELACION DE GENERO"] },
  open,
);
assert.equal(exact.match_level, "exact_event");

const thematic = evidenceForEventMatch(
  { title: "Kit arco de globos azul y rosado", description: "ideal para revelación especial" },
  open,
);
assert.ok(["thematic", "exact_event"].includes(thematic.match_level));

const adaptable = evidenceForEventMatch({ title: "Arco de globos blanco" }, open);
assert.equal(adaptable.match_level, "adaptable");

const reranked = puntuarYOrdenar([
  {
    rol: "focal", productId: "exact", variantId: "e-1", titulo: "Kit revelación", categoria: "kit",
    colores: ["azul"], ocasiones: ["revelacion de genero"], acabados: [], disponible: true, imagen: null, precio: 90_000,
    inventario: 4, sku: null, rankRrf: 0.029, eventEvidence: exact,
  },
  {
    rol: "focal", productId: "generic", variantId: "g-1", titulo: "Arco blanco", categoria: "guirnalda_arco",
    colores: ["blanco"], ocasiones: [], acabados: [], disponible: true, imagen: null, precio: 80_000,
    inventario: 4, sku: null, rankRrf: 0.03, eventEvidence: adaptable,
  },
], { topeCop: 100_000, coloresPedidos: [], ocasionesPedidas: [], acabadosPedidos: [] });
assert.equal(reranked[0]?.productId, "exact", "event evidence adds ranking, never blocks generic fallback");

console.log("[PASS] parser evento abierto + planner C1 + ladder/evidencia C2-C3");
