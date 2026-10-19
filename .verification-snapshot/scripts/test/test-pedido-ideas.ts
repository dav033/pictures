/**
 * «Muéstrame otras ideas con columnas» es un pedido de VER ideas, no un cambio del plan (pedido-ideas.ts).
 * Verificador (2026-10-06, guiada-20261006-231824-v43qux, solicitud 2c18cf03): con un plan hecho, el modelo llamó
 * proponer_composicion y se armó y cobró un plan nuevo de 149 globos sin carrusel. Determinista, sin red y sin coste.
 *
 * Run: npx tsx scripts/test/test-pedido-ideas.ts
 */
import assert from "node:assert/strict";
import { bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import { ideasGuiadas } from "@/lib/ia/guiado/ideas-guiadas";
import { ordenarIdeasPorPieza, pedidoDeIdeas } from "@/lib/ia/guiado/pedido-ideas";

// --- Qué es un pedido de ideas -------------------------------------------------------------------------------------
assert.deepEqual(pedidoDeIdeas("Muéstrame otras ideas con columnas"), { piezas: ["columna", "columna_asimetrica", "columna_no_densa"], palabra: "columna" });
assert.deepEqual(pedidoDeIdeas("Muéstrame más ideas de decoraciones"), { piezas: [], palabra: null });
assert.equal(pedidoDeIdeas("¿tienes fotos de arcos?")?.palabra, "arco");
assert.equal(pedidoDeIdeas("quiero ver ideas con semiarco")?.palabra, "semiarco", "semiarco antes que arco");
assert.equal(pedidoDeIdeas("dame ejemplos de centros de mesa")?.palabra, "centro de mesa");
// Lo que es un cambio o una propuesta sigue siendo del modelo.
for (const texto of ["Agrégale dos columnas", "Cambia las columnas por un arco", "Propónme otras ideas con columnas", "hazla más grande", "¿Cuánto cuesta?", "Sí, arma mi plan con estas 2 piezas", "columnas", "4 a 6 años"]) {
  assert.equal(pedidoDeIdeas(texto), null, texto);
}

// --- El orden: primero las que llevan la pieza nombrada ------------------------------------------------------------
const catalogo = bibliotecaVisible();
const brief = { evento: "cumpleaños", edad: 5, tematica: "Rosa y dorado" };
const buscadas = ideasGuiadas({ ...brief, ultimoUsuario: "Muéstrame otras ideas con columnas" }).ideas;
const delEvento = ideasGuiadas({ evento: brief.evento, edad: brief.edad, tematica: "" }).ideas;
const piezas = pedidoDeIdeas("Muéstrame otras ideas con columnas")!.piezas;
const { ideas, conPieza } = ordenarIdeasPorPieza(buscadas, delEvento, piezas);
assert.ok(ideas.length > 0 && ideas.length <= 6);
assert.equal(new Set(ideas.map((idea) => idea.id)).size, ideas.length, "sin repetidas");
const llevan = (idea: (typeof ideas)[number]) => idea.piezas.some((pieza) => (piezas as readonly string[]).includes(pieza.estructura));
const hayConColumnas = catalogo.some((idea) => idea.piezas.some((pieza) => (piezas as readonly string[]).includes(pieza.estructura)));
if (hayConColumnas && conPieza > 0) {
  assert.ok(ideas.slice(0, conPieza).every(llevan), "las primeras llevan columnas");
  assert.ok(ideas.slice(conPieza).every((idea) => !llevan(idea)), "después, las demás");
}
assert.deepEqual(ordenarIdeasPorPieza(buscadas, delEvento, []).ideas, buscadas.slice(0, 6), "sin pieza nombrada, la búsqueda tal cual");

console.log(`test-pedido-ideas: OK — «Muéstrame otras ideas con columnas» → ${ideas.length} ideas (${conPieza} con columnas): ${ideas.map((idea) => idea.titulo).join(" · ")}`);
