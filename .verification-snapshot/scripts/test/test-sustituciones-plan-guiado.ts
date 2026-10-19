import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { planBlueprint } from "../../src/lib/plan/blueprint";
import { materialesDeLineas } from "../../src/lib/plan/material-de-linea";
import type { PlanResuelto } from "../../src/lib/plan/resuelto";
import { colorSempertex } from "../../src/components/guiado/color-sempertex";
import { leyendaDePieza } from "../../src/components/guiado/motor-pieza";
import { edicionCantidad, motivoSinCantidad, piezasAjustables, type PlanGuiado } from "../../src/components/guiado/ajuste/ajuste-plan-guiado";
import { ejecutarCambio, type DependenciasAjuste } from "../../src/components/guiado/ajuste/ejecutar-ajuste";

/**
 * Verificador 127 (2026-10-07, bloqueante de la demo): en producción, 3 de 3 «cantidad» en la idea deco-real-07 («Dos
 * columnas rosa, lila y dorado») fallaron con el texto FALSO «Esa cifra no se puede: deja al menos un globo de cada
 * color». La idea compra el lila como otro producto (`variant_overrides`: lila → Pastel Dusk Lavanda) y el editor, la
 * leyenda y el blueprint emparejaban línea y material solo por `product_id`: el lila contaba 0 globos.
 *
 * Con el plan GUARDADO de las dos ideas con sustituciones (`planes-ideas.json`: deco-real-07 y deco-real-25) y las
 * líneas que Python resolvió para ellas (`data/biblioteca-real/analisis/*.plan.json`). Sin red ni modelo:
 *
 *   npx tsx scripts/test/test-sustituciones-plan-guiado.ts
 */

type Idea = { archivo: string; plan: unknown };
const IDEAS = (JSON.parse(readFileSync(path.join(process.cwd(), "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")) as { ideas: Record<string, Idea> }).ideas;
const ARCHIVO_RESUELTO: Readonly<Record<string, string>> = {
  "deco-real-07-eb12910e210c94b6184d025127acce95": "real-07-eb12910e210c94b6184d025127acce95.plan.json",
  "deco-real-25-guirnalda-dia-de-la-madre": "nueva-sempertex-05.plan.json",
};

/** El plan guardado de la idea con las líneas que Python resolvió para él. */
function planDeIdea(id: string): { guiado: PlanGuiado; resuelto: PlanResuelto } {
  const idea = IDEAS[id];
  assert.ok(idea, `la idea ${id} está en planes-ideas.json`);
  const crudo = JSON.parse(readFileSync(path.join(process.cwd(), "data", "biblioteca-real", "analisis", ARCHIVO_RESUELTO[id]!), "utf8")) as { plan_resuelto: Record<string, unknown> };
  const resuelto = { ...crudo.plan_resuelto, plan: idea.plan } as unknown as PlanResuelto;
  return { guiado: PlanGuiadoSchema.parse({ ...resuelto, approval_token: "prueba" }), resuelto };
}

/** El emparejamiento de antes (solo producto y color): así se reproduce el fallo. */
function globosComoAntes(plan: PlanGuiado, estructuraId: string, indice: number): number {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId)!;
  const material = estructura.materiales[indice]!;
  const lineas = (plan.estructuras.find((item) => item.estructura_id === estructuraId)?.lineas ?? []) as unknown as Array<{ product_id: string; variant_id: string; color: string | null; unidades: number }>;
  return lineas.filter((linea) => linea.product_id === material.product_id && ((material.variant_id && material.variant_id === linea.variant_id) || !material.color || material.color === linea.color)).reduce((suma, linea) => suma + linea.unidades, 0);
}

// --- deco-real-07: dos columnas rosa, lila (sustituido) y dorado -------------------------------------------------

const ID07 = "deco-real-07-eb12910e210c94b6184d025127acce95";
const { guiado: plan07, resuelto: resuelto07 } = planDeIdea(ID07);
const LILA = 1;
const ROSADO = 0;
for (const estructura of plan07.plan.estructuras) {
  assert.ok(estructura.variant_overrides?.length, "la idea sustituye el lila");
  assert.equal(globosComoAntes(plan07, estructura.estructura_id, LILA), 0, "reproducción: antes el lila contaba 0 globos");
}

const piezas07 = piezasAjustables(plan07);
for (const pieza of piezas07) {
  const resuelta = resuelto07.estructuras.find((item) => item.estructura_id === pieza.estructuraId)!;
  const lila = pieza.colores[LILA]!;
  assert.equal(lila.color, "lila");
  assert.ok(lila.globos > 0, `${pieza.estructuraId}: el lila cuenta sus globos (${lila.globos})`);
  assert.equal(pieza.globos, resuelta.total_unidades, `${pieza.estructuraId}: cada línea de Python va a un color y la suma es la de la pieza`);
  assert.ok(lila.tamanos.length >= 3, "el lila tiene sus tamaños");
  assert.match(lila.producto ?? "", /lavanda/i, "el lila dice el globo que se compra (Pastel Dusk Lavanda)");
  assert.ok(lila.cantidad, "el lila admite escribir su cifra");
  assert.equal(lila.puedeQuitar, false, "«Quitar» no se ofrece en un color sustituido: Python no encuentra su línea (material_no_editable)");
  console.log(`  ${pieza.estructuraId}: ${pieza.colores.map((color) => `${color.color} ${color.globos}`).join(", ")} = ${pieza.globos}`);
}

// El caso de producción: «Que lleve 12 rosados» ya no devuelve null.
const EST01 = "EST_01_COLUMNA_ASIMETRICA";
const rosado01 = piezas07[0]!.colores[ROSADO]!;
const edicion12 = edicionCantidad(plan07, EST01, ROSADO, 12);
assert.ok(edicion12, "12 rosados en la columna izquierda pide una edición (antes: null y el error falso)");
assert.equal(edicion12.accion, "repartir");
if (edicion12.accion === "repartir") {
  assert.equal(edicion12.participaciones.length, 3);
  assert.ok(edicion12.participaciones.every((parte) => parte >= 0.05), "ningún color por debajo del 5 %");
  assert.ok(edicion12.participaciones[LILA]! > 0.2, "el lila conserva su parte");
}
for (const objetivo of [rosado01.globos - 3, rosado01.globos + 3, rosado01.cantidad!.minimo, rosado01.cantidad!.maximo]) {
  if (objetivo === rosado01.globos) continue;
  assert.ok(edicionCantidad(plan07, EST01, ROSADO, objetivo), `rosado ${objetivo} en la columna izquierda`);
}
for (const pieza of piezas07) {
  for (const color of pieza.colores) {
    const otra = color.globos + (color.globos > (color.cantidad?.minimo ?? 1) ? -1 : 1);
    assert.ok(edicionCantidad(plan07, pieza.estructuraId, color.indice, otra), `${pieza.estructuraId}: ${color.color} → ${otra}`);
  }
}

// La ejecución completa (con un doble de Python): ya no lanza el error falso.
const pedidas: string[] = [];
const dependencias: DependenciasAjuste = {
  aplicar: async (base, edicion) => { pedidas.push(edicion.accion); return { plan: base, cotizacion: null }; },
  quitarPieza: async () => { throw new Error("no se usa"); },
  agregarColor: async () => { throw new Error("no se usa"); },
  buscar: async () => [],
};
const asincronas: Array<() => Promise<void>> = [];
asincronas.push(async () => {
  await ejecutarCambio({ tipo: "cantidad", estructuraId: EST01, indice: ROSADO, objetivo: 12, desde: rosado01.globos, pareja: true }, plan07, dependencias);
  assert.deepEqual(pedidas.slice(0, 1), ["repartir"], "la cifra va a Python como reparto");
});

// El motivo, cuando de verdad no se puede, dice la causa real (nunca el texto de antes).
const total01 = piezas07[0]!.globos;
const sinNada = motivoSinCantidad(plan07, EST01, ROSADO, 0);
assert.match(sinNada, /Quitar/);
const demasiados = motivoSinCantidad(plan07, EST01, ROSADO, total01);
assert.match(demasiados, new RegExp(`lleva ${total01} globos: este color puede llevar hasta ${rosado01.cantidad!.maximo}`));
assert.match(motivoSinCantidad(plan07, EST01, ROSADO, rosado01.globos), /ya lleva/);
for (const texto of [sinNada, demasiados]) assert.doesNotMatch(texto, /deja al menos un globo de cada color/);
asincronas.push(() => assert.rejects(
  ejecutarCambio({ tipo: "cantidad", estructuraId: EST01, indice: ROSADO, objetivo: total01, desde: rosado01.globos }, plan07, dependencias),
  (error: unknown) => error instanceof Error && error.message === demasiados,
  "el fallo de verdad dice su causa",
));
// Un plan cuyas líneas no explican un color (lo que pasaba antes): lo dice, no inventa «deja al menos un globo».
const sinLila = PlanGuiadoSchema.parse({ ...plan07, estructuras: plan07.estructuras.map((estructura) => ({ ...estructura, lineas: (estructura.lineas as Array<{ product_id: string }>).filter((linea) => linea.product_id !== "8634309804327") })) });
assert.equal(edicionCantidad(sinLila, EST01, ROSADO, 12), null);
assert.match(motivoSinCantidad(sinLila, EST01, ROSADO, 12), /No pude leer cuántos globos lila lleva esta pieza/);

// La leyenda de la pieza (editor y dibujo del motor): el lila con su nombre y tono Sempertex.
for (const pieza of piezas07) {
  const leyenda = leyendaDePieza(plan07, pieza.estructuraId);
  const lavanda = colorSempertex("lila", { titulo: "B2b Globo Latex Redondo Pastel Dusk Lavanda — R-12 / PAQUETE X 50", acabado: null });
  assert.equal(leyenda[LILA]!.etiqueta, lavanda.nombre, "la leyenda nombra el lila como el chip");
  assert.equal(leyenda[LILA]!.hex.toLowerCase(), lavanda.hex.toLowerCase(), "y lo pinta con el tono del globo que se compra");
}

// El blueprint de la imagen: el lila es «secundario», no «principal», y desempata en su lugar declarado.
const blueprint07 = planBlueprint(resuelto07);
for (const elemento of blueprint07.elements) {
  const lilas = elemento.model_decision?.bill_of_materials?.filter((material) => resuelto07.estructuras.some((estructura) => estructura.lineas.some((linea) => linea.variant_id === material.catalog_product_id && linea.product_id === "8634309804327"))) ?? [];
  assert.ok(lilas.length > 0, `${elemento.element_id}: el lila está en la lista de materiales`);
  assert.ok(lilas.every((material) => material.role === "secundario"), `${elemento.element_id}: el lila es secundario`);
  assert.match(elemento.appearance.composition ?? "", /secundario \(lila\)/);
  assert.doesNotMatch(elemento.appearance.composition ?? "", /principal \(lila\)/);
}

// --- deco-real-25: guirnalda del Día de la Madre (el burdeos se compra como un Infinity multicolor) ---------------

const ID25 = "deco-real-25-guirnalda-dia-de-la-madre";
const { guiado: plan25, resuelto: resuelto25 } = planDeIdea(ID25);
const GUIRNALDA = "EST_01_GUIRNALDA";
const BURDEOS = 1;
assert.equal(globosComoAntes(plan25, GUIRNALDA, BURDEOS), 0, "reproducción: antes el burdeos contaba 0 globos");
const pieza25 = piezasAjustables(plan25)[0]!;
assert.ok(pieza25.colores[BURDEOS]!.globos > 0, `el burdeos sustituido cuenta sus globos (${pieza25.colores[BURDEOS]!.globos})`);
assert.equal(pieza25.globos, resuelto25.estructuras[0]!.total_unidades);
console.log(`  ${GUIRNALDA}: ${pieza25.colores.map((color) => `${color.color} ${color.globos}`).join(", ")} = ${pieza25.globos}`);
for (const color of pieza25.colores) {
  assert.ok(edicionCantidad(plan25, GUIRNALDA, color.indice, color.globos + 2), `guirnalda: ${color.color} → ${color.globos + 2}`);
}
// Lo que se compra manda en la leyenda (como `_named_by_purchase` de Python): el burdeos se compra multicolor.
assert.equal(leyendaDePieza(plan25, GUIRNALDA)[BURDEOS]!.etiqueta, colorSempertex("multicolor", { titulo: "B2b Globo Latex Redondo Infinity® Feliz Dia Mama Floral Fashion Surtido — R-12 / PAQUETE X 50", acabado: null }).nombre);
const guirnalda = planBlueprint(resuelto25).elements[0]!;
assert.ok(guirnalda.model_decision?.bill_of_materials?.some((material) => material.role === "secundario"), "el Infinity hereda el papel del burdeos (secundario)");

// --- El emparejamiento, sin sustituciones, no cambia -------------------------------------------------------------

const sencilla = { materiales: [{ product_id: "A", variant_id: "a12", color: "rosado" }, { product_id: "B", color: "blanco" }] };
assert.deepEqual(materialesDeLineas(sencilla, [
  { product_id: "A", variant_id: "a12", color: "rosado" },
  { product_id: "A", variant_id: "a5", color: "rosado" },
  { product_id: "B", variant_id: "b9", color: "blanco" },
  { product_id: "A", variant_id: "a18", color: "rosa claro" },
  { product_id: "Z", variant_id: "z1", color: "negro" },
]), [0, 0, 1, 0, -1], "variante, producto y color, producto (color renombrado por Python) y ninguno");
// Una sustitución hecha en la clásica (otro color): va al material cuya variante reemplaza.
assert.deepEqual(materialesDeLineas({ ...sencilla, variant_overrides: [{ objetivo_variant_id: "a12", product_id: "C", variant_id: "c12", color: "fucsia" }] }, [
  { product_id: "C", variant_id: "c12", color: "fucsia" },
  { product_id: "A", variant_id: "a5", color: "rosado" },
]), [0, 0]);

void (async () => {
  for (const prueba of asincronas) await prueba();
  console.log("OK test-sustituciones-plan-guiado: el color sustituido cuenta en el editor, la leyenda y el blueprint (deco-real-07 y deco-real-25)");
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
