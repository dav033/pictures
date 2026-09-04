import assert from "node:assert/strict";
import { parseEventSearchIntent, EventSearchIntentSchema } from "../src/lib/rag/query-parser/event-search";
import { extraerFiltrosDurosBusqueda, textoContextoRestricciones } from "../src/lib/rag/query-parser/hard-filters";

const cases = [
  ["revelación de género azul y rosado", "revelación de género", [], ["azul", "rosado"]],
  ["bautizo blanco y dorado", "bautizo", [], ["blanco", "dorado"]],
  ["primera comunión elegante", "primera comunión", [], []],
  ["evento corporativo verde y blanco", "evento corporativo", [], ["verde", "blanco"]],
  ["quinceañero fucsia", "quinceañero", [], ["fucsia"]],
  ["aniversario plateado", "aniversario", [], ["plateado"]],
  ["festival de las luciérnagas azul", "festival de las luciérnagas", [], ["azul"]],
] as const;

for (const [query, label, occasionFilter, colors] of cases) {
  const parsed = parseEventSearchIntent(query);
  assert.equal(parsed.event_label, label, `preserva etiqueta: ${query}`);
  assert.deepEqual(parsed.occasion_filter, occasionFilter, `no inventa ocasión: ${query}`);
  assert.deepEqual(parsed.hard_filters.colores, colors, `conserva colores: ${query}`);
  assert.equal(parsed.semantic_query, query, `conserva consulta original: ${query}`);
  assert.deepEqual(parsed, parseEventSearchIntent(query), `determinista: ${query}`);
  EventSearchIntentSchema.parse(parsed);
}

const closed = parseEventSearchIntent("boda globos azules R-12 hasta $50.000");
assert.deepEqual(closed.occasion_filter, ["boda"]);
assert.deepEqual(closed.hard_filters.colores, ["azul"]);
assert.deepEqual(closed.hard_filters.diametros_pulgadas, [12]);
assert.equal(closed.hard_filters.precio_max, 50_000);

// A component query may mention a conflicting color, but only original + brief
// are allowed to produce locked SQL filters (criterion 10).
const context = textoContextoRestricciones("quiero azul para una boda", {
  tipo_evento: "boda",
  colores: ["azul"],
});
assert.match(context, /quiero azul/);
const locked = extraerFiltrosDurosBusqueda("quiero azul para una boda", {
  tipo_evento: "boda",
  colores: ["azul"],
});
assert.deepEqual(locked.colores, ["azul"]);
assert.deepEqual(locked.ocasiones, ["boda"]);

console.log(`[PASS] open-intent foundation: ${cases.length + 2} cases`);
