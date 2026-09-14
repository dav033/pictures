import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import {
  acabadoCliente,
  ambientacionCliente,
  cantidadCliente,
  coloresCliente,
  describirEstructuraCliente,
  medidasCliente,
  productoCliente,
  resumenPlanCliente,
  resumenReferenciaCliente,
  supuestoCliente,
  sustitucionesCliente,
  tamanosCliente,
} from "@/lib/plan/presentacion-cliente";
import type { LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";

/**
 * Tarjeta del plan para el cliente final (A2/A3 del loop de fidelidad): sin
 * ids EST_*, códigos R-*, slugs ni inglés; colores como muestras; resumen
 * derivado de las estructuras reales y no de la descripción libre del concepto.
 * Caso de verdad: captura 2026-09-14 152524 ("Montaje Orgánico Azul y Plata").
 */

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

// 1. Funciones puras.
assert.equal(medidasCliente("semiarco", { ancho_m: 1.2, alto_m: 2.2 }), "1,2 m de ancho × 2,2 m de alto");
assert.equal(medidasCliente("columna", { alto_m: 1.8 }), "1,8 m de alto");
assert.equal(medidasCliente("centro_mesa", { ancho_m: 0.4, alto_m: 0.5 }), "0,4 m de diámetro × 0,5 m de alto");
assert.equal(cantidadCliente(23, 1, "semiarco"), "unos 23 globos");
assert.equal(cantidadCliente(71, 2, "columna"), "2 iguales · unos 35 o 36 globos cada una");
assert.equal(cantidadCliente(1, 1, "backdrop"), "1 pieza");
assert.equal(tamanosCliente([{ diam_pulg: 12 }, { diam_pulg: 5 }, { diam_pulg: 9 }, { diam_pulg: 12 }]), "globos de 5, 9 y 12 pulgadas");
ok("medidas, cantidades y tamaños en palabras del cliente");

assert.equal(acabadoCliente("reflex"), "cromado");
assert.equal(acabadoCliente(null, "B2b Globo Latex Redondo Fashion Azul Rey — R-5 / PAQUETE X 12"), "mate");
assert.equal(acabadoCliente(null, "Globo sin acabado"), null);
assert.equal(productoCliente("B2b Globo Latex Redondo Fashion Azul Rey — R-5 / PAQUETE X 12"), "Globo Latex Redondo Fashion Azul Rey");
assert.equal(productoCliente("Globo Metal Plateado / PAQUETE X 50"), "Globo Metal Plateado");
assert.equal(productoCliente("Telón dorado"), "Telón dorado");
const colores = coloresCliente([
  { color: "azul", acabado: "reflex", titulo: "Globo Reflex Azul", unidades: 10 },
  { color: "blanco", acabado: null, titulo: "Globo Fashion Blanco", unidades: 14 },
  { color: "azul", acabado: "reflex", titulo: "Globo Reflex Azul", unidades: 6 },
  { color: "transparente", acabado: null, titulo: "Globo Cristal", unidades: 2 },
]);
assert.deepEqual(colores.map((muestra) => muestra.etiqueta), ["azul cromado", "blanco mate", "transparente"]);
assert.ok(colores.every((muestra) => muestra.fondo.length > 0));
assert.equal(colores.find((muestra) => muestra.color === "blanco")?.conBorde, true, "un blanco necesita borde para verse");
ok("colores agrupados por color y acabado, con muestra visual");

const semiarco = { oficialId: "semiarco_asimetrico" as const, nombre: "Semiarco Orgánico Derecho", ubicacion: "lateral_derecho", repeticiones: 1 };
const columna = { oficialId: "columna" as const, nombre: "Columna Orgánica Izquierda", ubicacion: "lateral_izquierdo", repeticiones: 1 };
assert.equal(describirEstructuraCliente(semiarco, "definido"), "el semiarco asimétrico a la derecha");
assert.equal(describirEstructuraCliente(columna, "indefinido"), "una columna a la izquierda");
assert.equal(describirEstructuraCliente({ ...columna, repeticiones: 2 }, "definido"), "las dos columnas a ambos lados");
assert.equal(describirEstructuraCliente({ nombre: "Telón dorado", ubicacion: "fondo_pared", repeticiones: 1 }, "indefinido"), "telón dorado contra la pared del fondo");
assert.equal(
  resumenPlanCliente([semiarco, columna], ["azul", "blanco", "dorado"]),
  "Un semiarco asimétrico a la derecha y una columna a la izquierda, en azul, blanco y dorado.",
);
ok("resumen derivado de las estructuras reales");

const descripciones = new Map([["EST_01_SEMIARCO", "el semiarco a la derecha"], ["EST_02_COLUMNA", "la columna a la izquierda"]]);
assert.deepEqual(
  sustitucionesCliente([
    { estructura_id: "EST_01_SEMIARCO", pedido: "R-18", entregado: "R-12" },
    { estructura_id: "EST_02_COLUMNA", pedido: "R-18", entregado: "R-12" },
    { estructura_id: "EST_02_COLUMNA", pedido: "R-18", entregado: "R-12" },
  ], descripciones),
  ["Para el semiarco a la derecha y la columna a la izquierda no hay globos de 18 pulgadas en ese color; usamos globos de 12 pulgadas."],
);
assert.equal(
  supuestoCliente("medidas asumidas para semiarco: 2.4 m × 2.2 m — no nos diste el tamaño del espacio"),
  "Usé medidas estándar para semiarco (2,4 m × 2,2 m) porque no me diste el tamaño del espacio.",
);
assert.equal(
  supuestoCliente("medidas asumidas para centro_mesa: 0.4 m × 0.5 m — no nos diste el tamaño del espacio"),
  "Usé medidas estándar para centro de mesa con globos (0,4 m × 0,5 m) porque no me diste el tamaño del espacio.",
);
ok("sustituciones agrupadas y supuestos sin ids, códigos ni slugs");

// 2. Referencia: estructuras vistas y ambientación en español.
function elemento(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    element_id: id,
    source_image_id: "REF_01",
    name: "element",
    category: "balloon_structure",
    scene_role: "midground",
    detection_confidence: 0.9,
    visible_evidence: "visible",
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.7 },
    depth_layer: 1,
    include_policy: "include",
    approved: true,
    source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: ["blue"], resolved_colors: ["blue"], color_policy: "match_reference", material: "latex", shape: "shape", composition: "composition" },
    relationships: [],
    uncertainties: [],
    ...overrides,
  };
}
const blueprintParseado = ReferenceBlueprintV2Schema.safeParse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [
    elemento("REF_01_E01", {
      name: "right balloon half arch",
      appearance: { observed_colors: ["blue"], resolved_colors: ["blue"], color_policy: "match_reference", material: "latex", shape: "tall asymmetrical half-arch on the right", composition: "c" },
      visual_semantics: { structure_type: "semiarco", placement: "lateral_derecho", design_role: "focal", repetition_group: "REF_01_E01", density: "lujosa" },
    }),
    elemento("REF_01_E02", { name: "left balloon column", visual_semantics: { structure_type: "columna", placement: "lateral_izquierdo", design_role: "soporte", repetition_group: "REF_01_E02", density: "media" } }),
    elemento("REF_01_E03", { name: "fairy lights", category: "lighting", scene_role: "lighting", detection_confidence: 0.8 }),
    elemento("REF_01_E04", { name: "tropical monstera leaves", category: "floral", scene_role: "accent", detection_confidence: 0.85 }),
    elemento("REF_01_E05", { name: "welcome sign", category: "other", scene_role: "accent", detection_confidence: 0.95 }),
  ],
  composition: { focal_point: "half arch", density: "dense", symmetry: "asymmetric", negative_space: [] },
  palette: { observed: ["blue", "white", "gold"], priority: [] },
  unresolved_decisions: [],
});
if (!blueprintParseado.success) {
  assert.fail(`fixture de blueprint inválido: ${blueprintParseado.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | ")}`);
}
const blueprint = blueprintParseado.data;
assert.equal(resumenReferenciaCliente(blueprint), "Veo un semiarco asimétrico a la derecha y una columna a la izquierda.");
assert.deepEqual(ambientacionCliente(blueprint, new Set(["REF_01_E01", "REF_01_E02"])), ["Luces", "Hojas y plantas"], "sin letreros y en español");
ok("referencia: estructuras vistas y ambientación en español");

// 3. Render de la tarjeta con el caso de la captura 152524.
const planParseado = PlanDecoracionSchema.safeParse({
  plan_version: "1.0",
  plan_id: "00000000-0000-4000-8000-000000000010",
  concepto: { titulo: "Montaje Orgánico Azul y Plata", descripcion: "Un semiarco, una columna, un conector de piso y un centro de mesa coordinado.", paleta: ["azul", "blanco"] },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [
    { estructura_id: "EST_01_SEMIARCO", nombre: "Semiarco Orgánico Derecho", tipo: "semiarco", rol_escena: "focal", ubicacion: "lateral_derecho", medidas: { ancho_m: 1.2, alto_m: 2.2 }, densidad: "media", mezcla: "organica_fina", estructura_oficial: "semiarco_asimetrico", referencia_element_id: "REF_01_E01", materiales: [{ product_id: "p-azul", color: "azul", participacion: 1, rol_material: "principal" }], porque: "Enmarca el lado derecho." },
    { estructura_id: "EST_02_COLUMNA", nombre: "Columna Orgánica Izquierda", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, densidad: "media", mezcla: "organica_fina", referencia_element_id: "REF_01_E02", materiales: [{ product_id: "p-blanco", color: "blanco", participacion: 1, rol_material: "principal" }], porque: "Equilibra el lado izquierdo." },
  ],
  supuestos: ["medidas asumidas para semiarco: 1.2 m × 2.2 m — no nos diste el tamaño del espacio"],
});
if (!planParseado.success) {
  assert.fail(`fixture de plan inválido: ${planParseado.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | ")}`);
}

function linea(estructuraId: string, variantId: string, titulo: string, color: string, acabado: string | null, pulgadas: number, unidades: number, sustituida = false): LineaMaterial {
  return {
    estructura_id: estructuraId,
    origen: { kind: "estructura", id: estructuraId },
    product_id: `p-${color}`,
    variant_id: variantId,
    sku: null,
    titulo,
    color,
    tamano_codigo: `R-${pulgadas}`,
    diam_pulg: pulgadas,
    diam_cm: pulgadas * 2.54,
    forma: "redondo",
    acabado,
    unidades,
    sustitucion: sustituida ? { pedido: "R-18", entregado: "R-12", motivo: "sin cobertura del tamaño" } : null,
  };
}
const sustitucion = (estructuraId: string) => ({ estructura_id: estructuraId, pedido: "R-18", entregado: "R-12", motivo: "sin cobertura del tamaño" });
const plan: PlanResuelto = {
  plan: planParseado.data,
  plan_hash: "sha256:fixture-plan",
  estructuras: [
    {
      estructura_id: "EST_01_SEMIARCO",
      nombre: "Semiarco Orgánico Derecho",
      tipo: "semiarco",
      ubicacion: "lateral_derecho",
      repeticiones: 1,
      eje_m: 1.2,
      total_unidades: 23,
      lineas: [
        linea("EST_01_SEMIARCO", "v-azul-5", "B2b Globo Latex Redondo Fashion Azul Rey — R-5 / PAQUETE X 12", "azul", null, 5, 2),
        linea("EST_01_SEMIARCO", "v-azul-5", "B2b Globo Latex Redondo Fashion Azul Rey — R-5 / PAQUETE X 12", "azul", null, 5, 3),
        linea("EST_01_SEMIARCO", "v-blanco-12", "B2b Globo Latex Redondo Fashion Blanco — R-12", "blanco", null, 12, 17, true),
        linea("EST_01_SEMIARCO", "v-plata-9", "Globo Metal Plateado — R-9", "plateado", "metal", 9, 1),
      ],
      mezcla_real: [{ diam_pulg: 5, forma: "redondo", unidades: 5, pct: 22 }, { diam_pulg: 9, forma: "redondo", unidades: 1, pct: 4 }, { diam_pulg: 12, forma: "redondo", unidades: 17, pct: 74 }],
      supuestos: [],
    },
    {
      estructura_id: "EST_02_COLUMNA",
      nombre: "Columna Orgánica Izquierda",
      tipo: "columna",
      ubicacion: "lateral_izquierdo",
      repeticiones: 1,
      eje_m: 1.8,
      total_unidades: 35,
      lineas: [linea("EST_02_COLUMNA", "v-blanco-12", "B2b Globo Latex Redondo Fashion Blanco — R-12", "blanco", null, 12, 35, true)],
      mezcla_real: [{ diam_pulg: 12, forma: "redondo", unidades: 35, pct: 100 }],
      supuestos: [],
    },
  ],
  compras: [],
  totales: {
    globos_por_tamano: { "R-5": 5, "R-9": 1, "R-12": 52 },
    total_unidades: 58,
    total_cop: 49169,
    design_quantity: 58,
    target_waste_reserve: 5,
    covered_waste_reserve: 5,
    uncovered_waste_reserve: 0,
    natural_package_surplus: 10,
    purchase_cost: 49169,
    consumption_cost: 40000,
    waste_only_savings_cop: 0,
    additional_waste_packages: 0,
    ahorro_paquetes_cop: 98562,
    incluye_iva: true,
    merma_porcentaje: 8,
  },
  comercial: { estado: "APROBACION_REQUERIDA", delta_cop: 0 },
  alternativas: [],
  merma_log: "fixture",
  sustituciones: [sustitucion("EST_01_SEMIARCO"), sustitucion("EST_02_COLUMNA")],
  sin_cobertura: [],
  advertencias: [],
};

function textoVisible(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ");
}

const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan, referenceBlueprint: blueprint }));
const texto = textoVisible(html);
assert.match(texto, /Un semiarco asimétrico a la derecha y una columna a la izquierda, en blanco, azul y plateado\./);
assert.match(texto, /1,2 m de ancho × 2,2 m de alto · unos 23 globos/);
assert.match(texto, /1,8 m de alto · unos 35 globos/);
assert.match(texto, /Globos de 5, 9 y 12 pulgadas/);
// The product is "Fashion Azul Rey": the card names the product shade, not only the palette color.
assert.match(texto, /azul rey mate/);
assert.match(texto, /plateado metalizado/);
assert.match(texto, /no hay globos de 18 pulgadas en ese color; usamos globos de 12 pulgadas/);
assert.match(texto, /Usé medidas estándar para semiarco \(1,2 m × 2,2 m\)/);
assert.match(texto, /Unos 58 globos en total/);
assert.match(texto, /Ambientación de tu foto/);
assert.match(texto, /Luces/);
assert.match(texto, /no se cotiza/);
assert.match(html, /style="background:/, "los colores se muestran como muestras visuales");
const prohibidos: ReadonlyArray<readonly [RegExp, string]> = [
  [/EST_\d/, "ids internos de estructura"],
  [/R-\d/, "códigos de tamaño"],
  [/→/, "flechas de sustitución"],
  [/\bB2b\b/i, "prefijo comercial interno"],
  [/\b1 unidades\b/, "plural incorrecto"],
  [/Ahorro por consolidar/, "ahorro contrafactual que puede superar el total"],
  [/centro de mesa coordinado|conector de piso/, "descripción libre con piezas inexistentes"],
  [/lateral_|semiarco_asimetrico|organica_fina|balloon_structure|fairy lights|monstera/, "slugs internos o inglés"],
  [/Distribución cotizada|unidades totales/, "jerga de cotización"],
];
for (const [patron, motivo] of prohibidos) {
  assert.doesNotMatch(texto, patron, `la tarjeta no debe mostrar ${motivo}`);
}
ok("tarjeta 152524: visual, en español y sin jerga");

const textoDev = textoVisible(renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan, modoDev: true })));
assert.match(textoDev, /Ahorro por consolidar paquetes/, "el modo dev conserva el dato crudo del ahorro");
assert.match(textoDev, /EST_01_SEMIARCO: R-18 → R-12/, "el modo dev conserva la sustitución cruda");
ok("modo dev conserva los datos crudos");

// Regresión (plan tropical, 2026-09-14): dos verdes distintos salían como
// "verde mate", y una guirnalda de mesa mostraba "1,5 m de ancho × 3,5 m de
// largo × 0,4 m de alto".
{
  const tonos = coloresCliente([
    { color: "verde", acabado: "fashion", titulo: "B2b Globo Latex Redondo Fashion Verde Selva — R-12 / PAQUETE X 50", unidades: 23 },
    { color: "verde", acabado: "fashion", titulo: "B2b Globo Latex Redondo Fashion Verde Lima — R-12 / PAQUETE X 50", unidades: 15 },
    { color: "fucsia", acabado: "fashion", titulo: "B2b Globo Latex Redondo Fashion Fucsia — R-12 / PAQUETE X 50", unidades: 35 },
    { color: "azul", acabado: "reflex", titulo: "B2b Globo Latex Redondo Reflex Azul", unidades: 5 },
    { color: "blanco", acabado: "fashion", titulo: "B2b Globo Latex Redondo Infinity® Polka Blanco Fashion Fucsia", unidades: 5 },
  ]).map((muestra) => muestra.etiqueta);
  assert.deepEqual(tonos, ["fucsia mate", "verde selva mate", "verde lima mate", "azul cromado", "blanco mate"]);
  assert.equal(medidasCliente("guirnalda", { ancho_m: 1.5, largo_m: 3.5, alto_m: 0.4 }), "3,5 m de largo");
  assert.equal(medidasCliente("guirnalda", { ancho_m: 2 }), "2 m de largo");
  ok("la tarjeta distingue tonos del mismo color y describe la guirnalda por su largo");
}

console.log(`\n${casos} casos OK (presentación de la tarjeta del plan)`);
