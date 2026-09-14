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

// A structure word names the figure to build from balloons, not the ready-made
// garland/arch kit category. Locking guirnalda_arco excluded every balloon and
// made each catalog search NO_MATCH (smoke 2026-09-14).
const structureCases = [
  ["quiero un arco de globos rosados", [], ["rosado"]],
  ["un semiarco de globos dorados", [], ["dorado"]],
  ["un semi arco de globos dorados", [], ["dorado"]],
  ["guirnalda de globos blancos para boda", [], ["blanco"]],
  ["Quiero solo un arco de globos látex redondos rosados y blancos para un cumpleaños", ["globo_latex"], ["rosado", "blanco"]],
] as const;
for (const [request, categorias, colores] of structureCases) {
  const filters = extraerFiltrosDurosBusqueda(request, {});
  assert.deepEqual(filters.categorias, categorias, `estructura no bloquea categoría: ${request}`);
  assert.deepEqual(filters.colores, colores, `conserva colores: ${request}`);
}
const structureWithBrief = extraerFiltrosDurosBusqueda("un arco para la entrada hasta $300.000", { tipo_evento: "boda", colores: ["blanco"] });
assert.deepEqual(structureWithBrief.categorias, []);
assert.deepEqual(structureWithBrief.ocasiones, ["boda"]);
assert.deepEqual(structureWithBrief.colores, ["blanco"]);
assert.equal(structureWithBrief.precio_max, 300_000);
const sizedArch = extraerFiltrosDurosBusqueda("arco de globos satin R-12", {});
assert.deepEqual(sizedArch.categorias, []);
assert.deepEqual(sizedArch.acabados, ["satin"]);
assert.deepEqual(sizedArch.diametros_pulgadas, [12]);
// An explicit ready-made kit request keeps the product category.
assert.deepEqual(extraerFiltrosDurosBusqueda("quiero un kit de arco de globos", {}).categorias, ["kit", "guirnalda_arco"]);
assert.deepEqual(extraerFiltrosDurosBusqueda("una guirnalda prediseñada rosada", {}).categorias, ["guirnalda_arco"]);

// Regression: a number followed by a people/age noun is a count, never a
// balloon size. Explicit size mentions keep working.
const guestRequest = "Quiero un arco de globos látex rosados y blancos para un cumpleaños de 40 invitados en un salón.";
assert.deepEqual(extraerFiltrosDurosBusqueda(guestRequest, {}).diametros_pulgadas, [], "40 invitados no es tamaño");
for (const counted of ["fiesta de 12 personas", "cumpleaños de 5 años", "piñata de 9 niños", "evento de 24 asistentes"]) {
  assert.deepEqual(extraerFiltrosDurosBusqueda(`globos dorados para una ${counted}`, {}).diametros_pulgadas, [], `conteo no es tamaño: ${counted}`);
}
for (const [sized, expected] of [["globos de 40 pulgadas", 40], ["globos R-12 para 40 invitados", 12], ["globos de 12 para 40 personas", 12], ["globos 18 pulgadas", 18]] as const) {
  assert.deepEqual(extraerFiltrosDurosBusqueda(sized, {}).diametros_pulgadas, [expected], `tamaño explícito: ${sized}`);
}

console.log(`[PASS] open-intent foundation: ${cases.length + 2 + structureCases.length + 4 + 9} cases`);
