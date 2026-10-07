/**
 * «Agregar al plan» (agregar-idea.ts, pedido 3). Determinista, sin red y sin coste.
 *
 * - Colores lisos de una idea de la biblioteca real (impresos, metalizados y tubitos fuera) y su orden por cantidad.
 * - Sin plan: la propuesta es la idea, con sus piezas individuales («Columna izquierda» y «Columna derecha»).
 * - Con plan (el real del registro dgkw9b, con «2 × Columna»): las piezas de antes, individuales y con sus colores,
 *   más las nuevas en los colores de la idea; colores de la propuesta = la unión.
 * - Topes (8 piezas, 8 colores) dichos antes de llamar al modelo; ideas con figura o sin globos lisos no se agregan.
 * - La instrucción del plan: cada pieza nueva con «colores de esta pieza», las de antes conservan su participación
 *   aunque la idea traiga colores nuevos, y sin nombres ni números que disparen `extraerRestriccionesUsuario`.
 *
 * Run: npx tsx scripts/test/test-agregar-idea.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_PIEZAS_PLAN, colorDePaleta, colorLisoDeMaterial, coloresDeIdea, estadoAgregarIdea, ideaAgregable, piezasDelPlan, propuestaAgregarIdea } from "@/components/guiado/agregar-idea";
import { decoracionesSempertex } from "@/lib/biblioteca-sempertex/biblioteca";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { instruccionPlanGuiado, planActualDesdePlan } from "@/lib/ia/guiado/instruccion-plan";
import { WidgetGuiadoSchema } from "@/lib/ia/guiado/widgets";
import { extraerRestriccionesUsuario } from "@/lib/plan/restricciones";

function idea(prefijo: string): DecoracionSempertex {
  const encontrada = decoracionesSempertex.find((decoracion) => decoracion.id.startsWith(prefijo));
  assert.ok(encontrada, `falta ${prefijo} en la biblioteca`);
  return encontrada;
}

// --- Colores de la paleta -------------------------------------------------------------------------------------------
assert.equal(colorDePaleta("rosado"), "rosado");
assert.equal(colorDePaleta("dorado rosa"), "dorado rosa");
assert.equal(colorDePaleta("verde eucalipto"), "verde");
assert.equal(colorDePaleta("verde menta"), "menta", "la palabra que precisa el tono va al final");
assert.equal(colorDePaleta("café con leche"), "cafe");
assert.equal(colorDePaleta("rosa claro"), "rosado");
assert.equal(colorDePaleta("blanco perla"), "blanco");
assert.equal(colorDePaleta("multicolor"), null);
assert.equal(colorDePaleta("durazno"), null, "sin equivalente en la paleta: no se inventa");
assert.equal(colorLisoDeMaterial("B2b Globo Latex Redondo Reflex Dorado Rosa — R-12 / PAQUETE X 50 · R-12 · dorado rosa"), "dorado rosa");
assert.equal(colorLisoDeMaterial("B2b Globo Latex Redondo Infinity® Copos De Nieve Cristal Y Satin Surtido — R-12 / PAQUETE X 12 · R-12 · con copos de nieve"), null, "impreso");
assert.equal(colorLisoDeMaterial("B2b Globo Metalizado Love — 18 IN / PAQUETE X 1 · 18 IN · «LOVE» rojo y blanco"), null, "metalizado");
assert.equal(colorLisoDeMaterial("B2b Globo Latex Tubito Fashion Eucalipto — T260 / PAQUETE X 20 · T260 · verde eucalipto"), null, "para modelar");
assert.equal(colorLisoDeMaterial("B2b Cortina Metalica Roja — PAQUETE X 1 · rojo"), null, "cortina");
assert.equal(colorLisoDeMaterial(undefined), null);

const semiarcoRosa = idea("deco-real-05-");
const columnasNegras = idea("deco-real-08-");
assert.deepEqual(coloresDeIdea(semiarcoRosa), ["dorado rosa", "rosado", "beige", "rojo"], "del más presente al menos (33, 32, 20, 17)");
assert.deepEqual(coloresDeIdea(columnasNegras), ["negro", "dorado"], "46 negros (con los dos remates de 36\") y 44 dorados");
// San Valentín: los lisos (rosa claro y rosa fuerte son rosado), sin «LOVE», «Te amo» ni la cortina.
assert.deepEqual(coloresDeIdea(idea("deco-real-22-")), ["rosado", "blanco", "rojo"]);

// --- Ideas que no se agregan ------------------------------------------------------------------------------------------
for (const prefijo of ["deco-real-23-", "deco-real-26-", "deco-real-30-"]) {
  const resultado = ideaAgregable(idea(prefijo));
  assert.equal(resultado.ok, false, prefijo);
  assert.equal(!resultado.ok && resultado.motivo, "figura", prefijo);
}
const sinLisos: DecoracionSempertex = { ...columnasNegras, id: "deco-real-99-sin-lisos", materiales: columnasNegras.materiales.map((material) => ({ ...material, nota: `${material.nota ?? ""} con «Feliz cumpleaños»` })) };
assert.equal(propuestaAgregarIdea(sinLisos, null).ok, false);
// Toda idea real visible sin figura se puede agregar.
for (const decoracion of decoracionesSempertex.filter((item) => item.origen === "referencia_real" && !item.piezas.some((pieza) => pieza.estructura === "figura"))) {
  assert.equal(ideaAgregable(decoracion).ok, true, decoracion.id);
}

// --- Sin plan: la idea crea el plan ---------------------------------------------------------------------------------
const sinPlan = propuestaAgregarIdea(columnasNegras, null);
assert.ok(sinPlan.ok, JSON.stringify(sinPlan));
assert.deepEqual(sinPlan.propuesta.piezas, [
  { estructura: "columna", cantidad: 1, nombre: "Columna izquierda", colores: ["negro", "dorado"], medidas: { ancho_m: 0.55, alto_m: 2 } },
  { estructura: "columna", cantidad: 1, nombre: "Columna derecha", colores: ["negro", "dorado"], medidas: { ancho_m: 0.55, alto_m: 2 } },
], "colores y medidas de cada pieza, del detalle de la biblioteca (plan de Python de la foto)");
assert.deepEqual(sinPlan.propuesta.colores, ["negro", "dorado"]);
assert.equal(sinPlan.propuesta.frase, "Armo tu plan con «Columnas negras y doradas»: dos columnas en negro y dorado.");
assert.deepEqual([sinPlan.piezasAntes, sinPlan.piezasDespues, sinPlan.nuevas], [0, 2, ["Columna izquierda", "Columna derecha"]]);
assert.equal(PropuestaComposicionSchema.safeParse(sinPlan.propuesta).success, true);
assert.equal(WidgetGuiadoSchema.safeParse({ tipo: "propuesta", propuesta: sinPlan.propuesta, estado: "resolviendo" }).success, true, "la sesión guardada la acepta");

// --- Con plan: el real del registro dgkw9b (semiarco orgánico + «2 × Columna» en azul, plateado, blanco y rosado) ----
const plan = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
const delPlan = piezasDelPlan(plan);
assert.ok(delPlan.ok);
assert.deepEqual(delPlan.piezas.map((pieza) => [pieza.estructura, pieza.cantidad, pieza.ubicacion ?? null]), [
  ["semiarco_asimetrico", 1, null],
  ["columna", 1, "lateral_izquierdo"],
  ["columna", 1, "lateral_derecho"],
], "«2 × Columna» pasa a dos piezas individuales");

const conPlan = propuestaAgregarIdea(columnasNegras, plan);
assert.ok(conPlan.ok, JSON.stringify(conPlan));
assert.deepEqual(conPlan.propuesta.piezas.map((pieza) => [pieza.estructura, pieza.nombre, pieza.colores?.join("+") ?? null]), [
  ["semiarco_asimetrico", "Semiarco orgánico", "azul+plateado+blanco+rosado"],
  ["columna", "Columna 1", "azul+plateado+blanco+rosado"],
  ["columna", "Columna 2", "azul+plateado+blanco+rosado"],
  ["columna", "Columna 3", "negro+dorado"],
  ["columna", "Columna 4", "negro+dorado"],
]);
assert.deepEqual(conPlan.propuesta.colores, ["azul", "plateado", "blanco", "rosado", "negro", "dorado"], "la unión, primero los del plan");
assert.deepEqual(conPlan.coloresNuevos, ["negro", "dorado"]);
assert.deepEqual([conPlan.piezasAntes, conPlan.piezasDespues, conPlan.nuevas], [3, 5, ["Columna 3", "Columna 4"]]);
assert.equal(conPlan.propuesta.frase, "Sumo a tu plan dos columnas de «Columnas negras y doradas» en negro y dorado. Tu plan quedará con 5 piezas.");

// Un semiarco más junto al semiarco del plan: la pareja pasa a izquierda y derecha.
const unSemiarco = PlanGuiadoSchema.parse({ ...plan, plan: { ...plan.plan, estructuras: [{ ...plan.plan.estructuras[0]!, estructura_oficial: "semiarco", nombre: "Semiarco" }] } });
const dosSemiarcos = propuestaAgregarIdea(semiarcoRosa, unSemiarco);
assert.ok(dosSemiarcos.ok);
assert.deepEqual(dosSemiarcos.propuesta.piezas.map((pieza) => pieza.nombre), ["Semiarco izquierdo", "Semiarco derecho"]);

// --- La instrucción del plan ----------------------------------------------------------------------------------------
const anterior = planActualDesdePlan(plan);
assert.ok(anterior);
const instruccion = instruccionPlanGuiado(conPlan.propuesta, { planAnterior: anterior });
const lineasPieza = instruccion.split("\n").filter((linea) => linea.startsWith("- "));
assert.equal(lineasPieza.length, 5, instruccion);
assert.ok(lineasPieza.slice(3).every((linea) => linea.includes("colores de esta pieza: negro, dorado") && !linea.includes("participacion")), instruccion);
// Las piezas de antes conservan su proporción aunque el plan gane dos colores (antes se perdía con cualquier color nuevo).
assert.ok(/semiarco_asimetrico.*colores de esta pieza: azul, plateado, blanco, rosado.*participacion: azul 0\.2\d/.test(lineasPieza[0]!), lineasPieza[0]);
assert.ok(lineasPieza.slice(1, 3).every((linea) => /participacion: azul/.test(linea) && /medidas: /.test(linea)), instruccion);
assert.ok(instruccion.includes("SOLO esos colores"), instruccion);
assert.ok(lineasPieza.slice(3).every((linea) => linea.includes("medidas: ancho_m 0.55, alto_m 2")), "las columnas nuevas, del tamaño de la idea");
// Sin plan: el semiarco sale del tamaño de la foto (2,46 × 2,91 m), no con medidas por defecto.
const deLaIdea = propuestaAgregarIdea(semiarcoRosa, null);
assert.ok(deLaIdea.ok);
const instruccionIdea = instruccionPlanGuiado(deLaIdea.propuesta);
assert.ok(instruccionIdea.includes("medidas: ancho_m 2.46, alto_m 2.91") && instruccionIdea.includes("usa EXACTAMENTE esas medidas"), instruccionIdea);
assert.deepEqual(extraerRestriccionesUsuario(instruccionIdea).estructuras, []);
// Cada pieza en SUS colores: el centro de mesa de «Semiarco azul y plateado con centros de mesa» va solo en azul, y el bouquet de helio, sin blancos (la pesa blanca no es un globo).
const conCentros = propuestaAgregarIdea(idea("deco-real-03-"), null);
assert.ok(conCentros.ok);
assert.deepEqual(conCentros.propuesta.piezas.map((pieza) => [pieza.estructura, pieza.colores?.join("+")]), [["semiarco", "azul+plateado+blanco"], ["bouquet", "azul+plateado"], ["centro_mesa", "azul"]]);
assert.ok(instruccion.includes("Colores: usa EXACTAMENTE estos colores: azul, plateado, blanco, rosado, negro, dorado"), instruccion);
assert.ok(instruccion.includes("el plan nuevo lleva SOLO las piezas de esta lista"), instruccion);
assert.ok(!/izquierda|derecha|Columna \d/.test(instruccion), "los nombres individuales los pone el servidor, no el texto");
const restricciones = extraerRestriccionesUsuario(instruccion);
assert.deepEqual(restricciones.estructuras, [], JSON.stringify(restricciones.estructuras));
assert.deepEqual(restricciones.tamanos, []);
// Sin colores propios, la regla de antes no cambia: un color nuevo en la propuesta y la participación no viaja.
const sinPropios = instruccionPlanGuiado({ ...conPlan.propuesta, piezas: conPlan.propuesta.piezas.map((pieza) => { const copia = { ...pieza }; delete copia.colores; return copia; }) }, { planAnterior: anterior });
assert.ok(!sinPropios.includes("participacion: ") && !sinPropios.includes("colores de esta pieza"), sinPropios);

// --- Topes, dichos antes de llamar al modelo --------------------------------------------------------------------------
const base = plan.plan.estructuras[0]!;
// Sin parsear: el esquema del plan exige coherencia de tipo y ubicación que el tope no mira (solo lee oficial y colores).
const conPiezas = (cuantas: number, colores: (indice: number) => string[]): typeof plan => ({
  ...plan,
  plan: {
    ...plan.plan,
    estructuras: Array.from({ length: cuantas }, (_, indice) => ({
      ...base,
      estructura_id: `EST_0${indice + 1}_CENTRO_MESA`,
      estructura_oficial: "centro_mesa",
      nombre: `Centro de mesa con globos ${indice + 1}`,
      ubicacion: "mesas_invitados",
      materiales: colores(indice).map((color) => ({ ...base.materiales[0]!, color, participacion: 1 / colores(indice).length })),
    })),
  },
}) as typeof plan;
const siete = propuestaAgregarIdea(columnasNegras, conPiezas(7, () => ["rosado"]));
assert.equal(siete.ok, false);
assert.equal(!siete.ok && siete.motivo, "demasiadas-piezas");
assert.ok(!siete.ok && siete.mensaje.includes(`serían 9 y el máximo es ${MAX_PIEZAS_PLAN}`) && siete.mensaje.includes("Quita una pieza"), JSON.stringify(siete));
assert.equal(propuestaAgregarIdea(columnasNegras, conPiezas(6, () => ["rosado"])).ok, true, "6 + 2 = 8 cabe");
const sieteColores = conPiezas(2, (indice) => (indice === 0 ? ["azul", "plateado", "blanco", "rosado"] : ["lila", "morado", "turquesa"]));
const muchos = propuestaAgregarIdea(columnasNegras, sieteColores);
assert.equal(!muchos.ok && muchos.motivo, "demasiados-colores", JSON.stringify(muchos));
assert.ok(!muchos.ok && muchos.mensaje.includes("serían 9") && muchos.mensaje.includes("Quita un color"), JSON.stringify(muchos));

// --- Lo que dice el botón ----------------------------------------------------------------------------------------------
assert.deepEqual(estadoAgregarIdea(columnasNegras, null), { estado: "listo", ayuda: "Te armo el plan con las cantidades exactas para esta idea." });
assert.deepEqual(estadoAgregarIdea(columnasNegras, plan), { estado: "listo", ayuda: "Tu plan quedará con 5 piezas, ahora también en negro y dorado. Recalculo las cantidades de todo." });
assert.deepEqual(estadoAgregarIdea(columnasNegras, plan, { ideasDelPlan: [columnasNegras.id] }), { estado: "agregada" });
assert.deepEqual(estadoAgregarIdea(columnasNegras, plan, { agregandoId: columnasNegras.id }), { estado: "agregando" });
assert.equal(estadoAgregarIdea(columnasNegras, conPiezas(7, () => ["rosado"]))?.estado, "bloqueada", "el tope del plan se dice junto al botón");
assert.equal(estadoAgregarIdea(idea("deco-real-23-"), plan), null, "con figura no se ofrece");

// --- El widget del plan guarda las ideas y el aviso -------------------------------------------------------------------
assert.equal(WidgetGuiadoSchema.safeParse({ tipo: "plan", plan, ideas: [columnasNegras.id], agregada: { titulo: columnasNegras.titulo, total: 188 } }).success, true);
assert.equal(WidgetGuiadoSchema.safeParse({ tipo: "plan", plan, ideas: ["no es un id"] }).success, false);

console.log("test-agregar-idea: colores lisos, piezas individuales, unión de colores, topes antes del modelo e instrucción por pieza");
