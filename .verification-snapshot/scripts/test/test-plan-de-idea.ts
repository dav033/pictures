/**
 * El plan EXACTO de una idea (plan-de-idea.ts + planes-ideas.json): «Crear mi plan con esta idea» y «Agregar a mi
 * plan» ya no pasan por el modelo. Verificador (2026-10-06, v43qux): el plan que salía de una idea perdía los globos de
 * más de 12″ y cambiaba los productos Sempertex (columnas negras y doradas: la idea 90 globos con la bola R-36, el plan
 * 72 de 12″). Determinista, sin red, sin Python y sin coste.
 *
 * Run: npx tsx scripts/test/test-plan-de-idea.ts
 */
import assert from "node:assert/strict";
import planesIdeas from "@/lib/biblioteca-sempertex/planes-ideas.json";
import { decoracionesSempertex } from "@/lib/biblioteca-sempertex/biblioteca";
import { PlanesIdeasArchivoSchema, planConIdea, unirAllowlist, unirRestricciones } from "@/lib/plan/plan-de-idea";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";

const { ideas } = PlanesIdeasArchivoSchema.parse(planesIdeas);
const idea = (prefijo: string) => {
  const entrada = Object.entries(ideas).find(([id]) => id.startsWith(prefijo));
  assert.ok(entrada, `falta ${prefijo} en planes-ideas.json`);
  return entrada[1];
};

// --- El archivo -----------------------------------------------------------------------------------------------------
assert.ok(Object.keys(ideas).length >= 20, "las ideas con plan resuelto tienen su plan guardado");
for (const [id, guardado] of Object.entries(ideas)) {
  assert.ok(decoracionesSempertex.some((decoracion) => decoracion.id === id), `${id} es una idea de la biblioteca`);
  assert.ok(PlanDecoracionSchema.safeParse(guardado.plan).success, `${id}: plan válido`);
  assert.ok(guardado.plan.estructuras.every((estructura) => !estructura.referencia_element_id && !estructura.colores_referencia), `${id}: sin ids de la foto de la biblioteca`);
  const armado = planConIdea(guardado.plan, null);
  assert.ok(armado.ok && armado.plan.estructuras.every((estructura) => estructura.repeticiones === 1), `${id}: piezas individuales al armar el plan`);
  const titulo = decoracionesSempertex.find((decoracion) => decoracion.id === id)!.titulo;
  assert.equal(guardado.plan.concepto.titulo, titulo.slice(0, 160), `${id}: «Tu plan» se llama como la idea`);
}

// --- Columnas negras y doradas: sus productos, su R-36 y sus 90 globos --------------------------------------------
const columnas = idea("deco-real-08");
assert.equal(columnas.globos, 90);
assert.ok(columnas.plan.estructuras.every((estructura) => estructura.armado_columna?.remate?.tamano === 36), "la bola negra de arriba es R-36");
const sola = planConIdea(columnas.plan, null);
assert.ok(sola.ok);
assert.deepEqual(sola.plan.estructuras.map((estructura) => estructura.nombre), ["Columna izquierda", "Columna derecha"], "nombres individuales");
assert.deepEqual(sola.plan.estructuras.map((estructura) => estructura.estructura_id), ["EST_01_COLUMNA", "EST_02_COLUMNA"]);

// --- Agregar a mi plan: las de antes intactas, las nuevas con ids libres, y las tallas de la idea -----------------
const guirnalda = idea("deco-real-09");
assert.deepEqual(guirnalda.plan.restricciones?.tamanos.map((talla) => talla.valor), ["R-5", "R-12"]);
const sumada = planConIdea(guirnalda.plan, columnas.plan, { restriccionesDeIdea: true });
assert.ok(sumada.ok, JSON.stringify(sumada));
assert.deepEqual(sumada.plan.estructuras.slice(0, 2).map((estructura) => ({ ...estructura, nombre: "" })), columnas.plan.estructuras.map((estructura) => ({ ...estructura, nombre: "" })), "las columnas no cambian (solo reciben su nombre)");
assert.deepEqual(sumada.nuevas, ["EST_03_GUIRNALDA"]);
assert.deepEqual(sumada.plan.restricciones?.tamanos.map((talla) => talla.valor), ["R-5", "R-12"], "la guirnalda conserva sus tallas (sin ellas: 35 de 41 globos)");
const sinTallas = planConIdea(guirnalda.plan, columnas.plan);
assert.ok(sinTallas.ok && sinTallas.plan.restricciones === undefined, "sin la opción, las restricciones del plan vigente");
assert.equal(unirRestricciones(undefined, undefined), undefined);
const dos = unirRestricciones(guirnalda.plan.restricciones, guirnalda.plan.restricciones);
assert.deepEqual(dos?.tamanos.map((talla) => talla.valor), ["R-5", "R-12"], "sin repetir");
// Dos piezas en la pared del fondo no caben: la vista sigue por el camino del modelo.
const otraGuirnalda = planConIdea(idea("deco-real-11").plan, guirnalda.plan);
assert.equal(otraGuirnalda.ok ? "ok" : otraGuirnalda.motivo, "ubicacion_ocupada");
// La lista de productos: la unión, sin repetir variantes.
const union = unirAllowlist(columnas.allowlist, columnas.allowlist, guirnalda.allowlist);
assert.equal(new Set(union.map((entrada) => entrada.product_id)).size, union.length);
assert.ok(union.every((entrada) => new Set(entrada.variant_ids).size === entrada.variant_ids.length));

console.log(`test-plan-de-idea: OK — ${Object.keys(ideas).length} ideas con plan exacto; columnas ${columnas.globos} globos con R-36; guirnalda sumada con sus tallas`);
