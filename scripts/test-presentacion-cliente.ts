import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaCotizacion, filasBorrador } from "@/components/TarjetaCotizacion";
import { FilasCotizacion, gruposCotizacionPlan } from "@/components/plan/DialogoCotizacion";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import {
  acabadoCliente,
  ambientacionCliente,
  cantidadCliente,
  coloresCliente,
  coloresObservadosCliente,
  describirEstructuraCliente,
  medidasCliente,
  medidasCortasCliente,
  nombreConCantidadCliente,
  paquetesCliente,
  piezasVistasEnReferencia,
  sobranteCliente,
  ubicacionCortaCliente,
  productoCliente,
  productoConTamanoCliente,
  pulgadasConCentimetrosCliente,
  resumenPlanCliente,
  resumenReferenciaCliente,
  supuestoCliente,
  sustitucionesCliente,
  tamanosCliente,
} from "@/lib/plan/presentacion-cliente";
import type { CompraConsolidada, LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";
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
assert.equal(
  resumenPlanCliente([{ oficialId: "semiarco", nombre: "Semiarco izquierdo", ubicacion: "lateral_izquierdo", repeticiones: 1 }, { oficialId: "semiarco", nombre: "Semiarco derecho", ubicacion: "lateral_derecho", repeticiones: 1 }], ["rosado"]),
  "Dos semiarcos, uno a cada lado, en rosado.",
  "un par de piezas iguales a cada lado no se repite (#10)",
);
// D6 (E2E real, ejemplo-07): la misma pieza repetida en el mismo lugar se agrupa también fuera del par lateral.
assert.equal(
  resumenPlanCliente([
    { oficialId: "arco_asimetrico", nombre: "Arco", ubicacion: "arco_central", repeticiones: 1 },
    { oficialId: "bouquet", nombre: "Bouquet", ubicacion: "piso_frontal", repeticiones: 1 },
    { oficialId: "bouquet", nombre: "Bouquet 2", ubicacion: "piso_frontal", repeticiones: 1 },
  ], ["plateado"]),
  "Un arco asimétrico al centro y dos bouquets de globos en el piso, al frente, en plateado.",
  "dos bouquets iguales en el mismo lugar no se repiten",
);
assert.equal(
  resumenPlanCliente([
    { oficialId: "columna", nombre: "Columna", ubicacion: "lateral_izquierdo", repeticiones: 1 },
    { oficialId: "columna", nombre: "Columna", ubicacion: "lateral_izquierdo", repeticiones: 1 },
  ], []),
  "Dos columnas a la izquierda.",
  "dos piezas del mismo lado no se leen como \"a ambos lados\"",
);
assert.equal(
  resumenPlanCliente([
    { oficialId: "bouquet", nombre: "Bouquet", ubicacion: "piso_frontal", repeticiones: 2 },
    { oficialId: "bouquet", nombre: "Bouquet", ubicacion: "piso_frontal", repeticiones: 1 },
    { oficialId: "bouquet", nombre: "Bouquet", ubicacion: "sobre_mesa_principal", repeticiones: 1 },
  ], []),
  "Tres bouquets de globos en el piso, al frente y un bouquet de globos sobre la mesa principal.",
  "suma repeticiones y no mezcla lugares distintos",
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
// Auditoría #3: los colores de la foto que el plan no lleva llegan en `sustituciones`
// con su frase para el cliente; no se reescriben como si fueran un tamaño.
{
  const motivo = "La foto de referencia muestra burdeos y esta pieza no lo lleva: se armó con plateado y blanco.";
  const textos = sustitucionesCliente([
    { estructura_id: "EST_01_SEMIARCO", pedido: "R-18", entregado: "R-12", motivo: "sin cobertura del tamaño" },
    { estructura_id: "EST_01_SEMIARCO", pedido: "burdeos", entregado: "plateado, blanco", motivo },
    { estructura_id: "EST_02_COLUMNA", pedido: "burdeos", entregado: "plateado, blanco", motivo },
  ], descripciones);
  assert.deepEqual(textos, [
    "Para el semiarco a la derecha no hay globos de 18 pulgadas en ese color; usamos globos de 12 pulgadas.",
    motivo,
  ]);
  assert.ok(textos.every((texto) => !/globos de burdeos/.test(texto)), "un color no se describe como tamaño");
}
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

// Hallazgo #10 (auditoría 2026-09-14): el resumen de la foto omitía kits y
// racimos (F21 devolvía null), repetía "una columna a la izquierda, una columna
// a la izquierda…" (F05/F07) y decía "un techo de globos en el techo" (F09/F10).
{
  function blueprintCon(elementos: Record<string, unknown>[], paleta: string[] = []) {
    const resultado = ReferenceBlueprintV2Schema.safeParse({
      schema_version: "2.0",
      source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
      elements: elementos,
      composition: { focal_point: "x", density: "dense", symmetry: "symmetric", negative_space: [] },
      palette: { observed: paleta, priority: [] },
      unresolved_decisions: [],
    });
    if (!resultado.success) assert.fail(resultado.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | "));
    return resultado.data;
  }
  const semantica = (tipo: string, ubicacion: string, id: string) => ({ structure_type: tipo, placement: ubicacion, design_role: "soporte", repetition_group: id, density: "media" });
  const forma = (shape: string) => ({ observed_colors: ["white"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape, composition: "c" });

  const columnasPar = blueprintCon([
    elemento("REF_01_E01", { name: "left balloon column", appearance: forma("tall column, on the left"), visual_semantics: semantica("columna", "lateral_izquierdo", "REF_01_E01") }),
    elemento("REF_01_E02", { name: "right balloon column", appearance: forma("tall column, on the right"), visual_semantics: semantica("columna", "lateral_derecho", "REF_01_E02") }),
  ]);
  assert.equal(resumenReferenciaCliente(columnasPar), "Veo dos columnas, una a cada lado.");

  const columnasIzquierda = blueprintCon(["E01", "E02", "E03"].map((sufijo) => elemento(`REF_01_${sufijo}`, { appearance: forma("column, on the left"), visual_semantics: semantica("columna", "lateral_izquierdo", `REF_01_${sufijo}`) })));
  assert.equal(resumenReferenciaCliente(columnasIzquierda), "Veo tres columnas a la izquierda.", "sin repetir la misma pieza");

  const kits = blueprintCon([
    elemento("REF_01_E01", { name: "left foil kit", appearance: forma("medium kit, on the left"), visual_semantics: semantica("kit", "lateral_izquierdo", "REF_01_E01") }),
    elemento("REF_01_E02", { name: "right foil kit", appearance: forma("medium kit, on the right"), visual_semantics: semantica("kit", "lateral_derecho", "REF_01_E02") }),
  ]);
  assert.equal(resumenReferenciaCliente(kits), "Veo dos arreglos de globos, uno a cada lado.", "F21: dos kits nunca dejan el resumen vacío");

  const racimoYBouquet = blueprintCon([
    elemento("REF_01_E01", { name: "balloon cluster", appearance: forma("short dense cluster, on the left, standing on the floor"), visual_semantics: semantica("kit", "lateral_izquierdo", "REF_01_E01") }),
    elemento("REF_01_E02", { name: "helium bouquet", appearance: forma("medium bouquet, on the right"), visual_semantics: semantica("kit", "lateral_derecho", "REF_01_E02") }),
  ]);
  assert.equal(resumenReferenciaCliente(racimoYBouquet), "Veo un racimo de globos a la izquierda y un bouquet de globos a la derecha.");

  const techo = blueprintCon([
    elemento("REF_01_E01", { name: "ceiling balloon cloud", appearance: forma("dense ceiling installation, spanning the full width"), visual_semantics: semantica("guirnalda", "techo", "REF_01_E01") }),
  ]);
  assert.equal(resumenReferenciaCliente(techo), "Veo un techo de globos.");
  assert.doesNotMatch(describirEstructuraCliente({ oficialId: "techo_globos", nombre: "Techo de globos", ubicacion: "techo", repeticiones: 1 }, "indefinido"), /en el techo/);
  assert.deepEqual(piezasVistasEnReferencia(techo).map((pieza) => [pieza.nombre, pieza.ubicacionCorta]), [["Techo de globos", null]]);
  assert.deepEqual(
    piezasVistasEnReferencia(columnasPar).map((pieza) => [pieza.elementId, pieza.nombre, pieza.ubicacionCorta]),
    [["REF_01_E01", "Columna", "izquierda"], ["REF_01_E02", "Columna", "derecha"]],
  );

  const sinGlobos = blueprintCon([elemento("REF_01_E01", { name: "flowers", category: "floral", scene_role: "accent" })]);
  assert.equal(resumenReferenciaCliente(sinGlobos), null, "sin piezas de globos no hay resumen");
  assert.deepEqual(piezasVistasEnReferencia(sinGlobos), []);

  const colores = coloresObservadosCliente(blueprintCon([], ["pastel pink", "white", "chrome silver", "clear", "neon-ish mystery"]));
  assert.deepEqual(colores.map((muestra) => muestra.etiqueta), ["Rosado pastel", "Blanco", "Plateado cromado", "Transparente"], "en español y sin colores desconocidos");
  ok("referencia: repetidas agrupadas, racimos y kits nombrados, sin 'techo en el techo' (#10)");
}

// Textos cortos de la tarjeta de propuesta (maquetas Main y ChatNormal).
{
  assert.equal(medidasCortasCliente("semiarco", { ancho_m: 1.6, alto_m: 2.4, largo_m: 0.5 }), "1,6 × 2,4 m");
  assert.equal(medidasCortasCliente("columna", { alto_m: 2 }), "2 m de alto");
  assert.equal(medidasCortasCliente("guirnalda", { ancho_m: 1.5, largo_m: 3.5 }), "3,5 m de largo");
  assert.equal(medidasCortasCliente("pared", {}), null);
  assert.equal(nombreConCantidadCliente({ oficialId: "arco", nombre: "Arco Orgánico", ubicacion: "fondo_pared", repeticiones: 1 }), "Arco");
  assert.equal(nombreConCantidadCliente({ oficialId: "columna", nombre: "Columnas", ubicacion: "entrada", repeticiones: 2 }), "2 columnas");
  assert.equal(ubicacionCortaCliente("lateral_izquierdo"), "izquierda");
  assert.equal(ubicacionCortaCliente("lateral_izquierdo", 2), "ambos lados");
  assert.equal(ubicacionCortaCliente("fondo_pared"), "pared del fondo");
  assert.equal(ubicacionCortaCliente("recorrido_suelo"), "a lo largo del piso", "no recorta solo la \"a\" de \"a lo largo del\"");
  ok("medidas cortas, nombre con cantidad y ubicación corta");
}

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
// Rediseño iteración 4 (maqueta Main): la ambientación va en una línea "En la imagen también pondré … · no se cotizan".
assert.match(texto, /En la imagen también pondré Luces Hojas y plantas · no se cotizan/);
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

// Regresión (iteración 3b, 2026-09-14): en arcos, semiarcos y columnas
// `largo_m` es la profundidad ("0,5 m de largo" en un arco confundía), y los
// centímetros salían con punto decimal ("12.7 cm").
{
  assert.equal(medidasCliente("arco", { ancho_m: 3, largo_m: 0.5, alto_m: 2.5 }), "3 m de ancho × 0,5 m de fondo × 2,5 m de alto");
  assert.equal(medidasCliente("semiarco", { ancho_m: 1.2, largo_m: 0.4, alto_m: 2.2 }), "1,2 m de ancho × 0,4 m de fondo × 2,2 m de alto");
  assert.equal(medidasCliente("columna", { ancho_m: 0.6, largo_m: 0.6, alto_m: 2 }), "0,6 m de ancho × 0,6 m de fondo × 2 m de alto");
  assert.equal(medidasCliente("pared", { ancho_m: 2, largo_m: 0.3, alto_m: 2 }), "2 m de ancho × 0,3 m de largo × 2 m de alto", "otros tipos conservan 'de largo'");
  assert.equal(pulgadasConCentimetrosCliente("R-5", 12.7), "5 pulgadas (12,7 cm)");
  assert.equal(pulgadasConCentimetrosCliente("R-12", null), "12 pulgadas");
  ok("arcos y columnas miden el fondo; centímetros con coma decimal");
}

// Regresión (iteración 3b): los botones Modificar/Quitar, la foto del detalle y
// el diálogo "Cambiar" usaban el título crudo del catálogo ("B2b … — R-5 / PAQUETE X 20").
{
  assert.equal(productoConTamanoCliente("B2b Globo Latex Redondo Fashion Blanco — R-5 / PAQUETE X 20", "R-5"), "Globo Latex Redondo Fashion Blanco de 5 pulgadas");
  assert.equal(productoConTamanoCliente("Telón dorado", null), "Telón dorado");
  const htmlEditable = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan, onPlanActualizado: () => undefined }));
  const atributos = [...htmlEditable.matchAll(/\s(title|aria-label|alt)="([^"]*)"/g)].map((m) => `${m[1]}="${m[2]}"`);
  const botones = atributos.filter((atributo) => /^(title|aria-label)="(Modificar|Quitar) /.test(atributo));
  assert.ok(botones.length >= 8, `se esperaban botones Modificar/Quitar con nombre accesible, hay ${botones.length}`);
  assert.ok(botones.includes(`aria-label="Modificar Globo Latex Redondo Fashion Azul Rey de 5 pulgadas"`), botones.join(" | "));
  for (const atributo of atributos) {
    assert.doesNotMatch(atributo, /\bB2b\b|R-\d|PAQUETE/i, `atributo con código de catálogo: ${atributo}`);
  }
  ok("nombres accesibles de Modificar/Quitar sin códigos del catálogo");
}

// D3 (E2E real 2, «Muy creativo», rid 8983d75b): la mezcla más barata compra
// Fashion Azul Rey R-12 en ×20 y ×50 y Reflex Plata R-12 en ×12 y ×50. El
// cliente ve una fila por producto + tamaño + color con la necesidad total,
// los paquetes combinados, los sobrantes totales y el precio sumado; el total
// no cambia. Fixture: `PlanResuelto` real de esa corrida.
{
  const planReal = JSON.parse(readFileSync(new URL("./fixtures/plan-d3-paquetes-combinados.json", import.meta.url), "utf8")) as PlanResuelto;
  assert.equal(planReal.compras.length, 7);
  const grupos = gruposCotizacionPlan(planReal.compras);
  assert.equal(grupos.length, 5, grupos.map((grupo) => grupo.clave).join(" | "));
  const azulRey = grupos.find((grupo) => /Fashion Azul Rey/.test(grupo.items[0]!.titulo))!;
  assert.deepEqual(azulRey.items.map((compra) => compra.unidades_paquete), [20, 50]);
  assert.equal(azulRey.necesitas, 69);
  assert.equal(paquetesCliente(azulRey.paquetes), "1 paquete de 50 + 2 paquetes de 20");
  assert.equal(azulRey.sobrante, 21);
  assert.equal(azulRey.subtotal, 12922 + 13974);
  const plata = grupos.find((grupo) => /Reflex Plata/.test(grupo.items[0]!.titulo))!;
  assert.equal(plata.necesitas, 60);
  assert.equal(paquetesCliente(plata.paquetes), "1 paquete de 50 + 1 paquete de 12");
  assert.equal(plata.sobrante, 2);
  assert.equal(plata.subtotal, 8832 + 28977);
  assert.equal(grupos.reduce((suma, grupo) => suma + grupo.subtotal, 0), planReal.totales.total_cop, "el total general no cambia");
  assert.equal(sobranteCliente(-4), "faltan 4");
  assert.equal(productoCliente("B2b Globo Metalizado Numero 0 Plata — 32 IN / PAQUETE X 1"), "Globo Metalizado Numero 0 Plata", "sin «32 IN» del catálogo");
  assert.equal(sobranteCliente(0), "sin sobrantes");

  const filas = renderToStaticMarkup(React.createElement(FilasCotizacion, { compras: planReal.compras, imagenDe: (compra: CompraConsolidada) => compra.imagen ?? undefined }));
  assert.equal([...filas.matchAll(/role="row"/g)].length, 5, "diálogo: una fila por producto + tamaño + color");
  const textoFilas = textoVisible(filas);
  assert.equal([...textoFilas.matchAll(/Fashion Azul Rey/g)].length, 1, textoFilas);
  assert.equal([...textoFilas.matchAll(/Reflex Plata/g)].length, 1, textoFilas);
  assert.match(textoFilas, /Necesitas 69 1 paquete de 50 \+ 2 paquetes de 20 sobran 21/);
  assert.match(textoFilas, /\$ 26\.896/);
  assert.match(textoFilas, /Necesitas 60 1 paquete de 50 \+ 1 paquete de 12 sobran 2/);
  assert.match(textoFilas, /\$ 37\.809/);
  assert.doesNotMatch(textoFilas, /Necesitas 12\b|Necesitas 48\b|Necesitas 49\b/, "sin necesidad partida");

  // Tarjeta de cotización con las mismas líneas (como las entrega `cotizarPlan`).
  const cotizacion: Cotizacion = {
    lineas: planReal.compras.map((compra) => ({
      id: compra.variant_id, productId: compra.product_id, tamano: compra.tamano_codigo ?? "sin tamaño aplicable", tamanoCodigo: compra.tamano_codigo ?? undefined,
      diamPulg: compra.diam_pulg ?? undefined, color: compra.color ?? undefined, cantidadNecesaria: compra.unidades_necesarias, disponible: true, varianteId: compra.variant_id,
      nombre: compra.titulo, precioPaquete: compra.precio_paquete, unidadesPaquete: compra.unidades_paquete, paquetes: compra.paquetes, subtotal: compra.subtotal, sobrante: compra.sobrante, foto: compra.imagen ?? undefined,
    })),
    total: planReal.totales.total_cop, mermaPorcentaje: planReal.totales.merma_porcentaje, incluyeIva: true, complementosSoportados: false, plan_hash: planReal.plan_hash,
  };
  const tarjeta = renderToStaticMarkup(React.createElement(TarjetaCotizacion, { cotizacion }));
  const textoTarjeta = textoVisible(tarjeta);
  assert.equal([...tarjeta.matchAll(/<li\b/g)].length, 5, "tarjeta: una fila por producto + tamaño + color");
  assert.match(textoTarjeta, /Necesitas 69 1 paquete de 50 \+ 2 paquetes de 20 sobran 21/);
  assert.match(textoTarjeta, /Necesitas 60 1 paquete de 50 \+ 1 paquete de 12 sobran 2/);
  assert.match(textoTarjeta, /\$ 95\.309/);
  assert.doesNotMatch(textoTarjeta, /sin tamaño aplicable|\bIN\b/, "sin textos internos del catálogo");
  // Editando, cada tamaño de paquete conserva su fila para ajustar paquetes.
  const editable = { ...cotizacion, plan_hash: undefined };
  assert.equal(filasBorrador(editable.lineas.map((linea) => ({ ...linea, excluida: false })), true).length, 7);

  // Detalle de la pieza y modal: Reflex Plata aparece una vez con sus 24 globos.
  const detalle = textoVisible(renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: planReal })));
  const semiarco = detalle.slice(detalle.indexOf("Globos que lleva"), detalle.indexOf("Globos que lleva", detalle.indexOf("Globos que lleva") + 1));
  assert.equal([...semiarco.matchAll(/Reflex Plata/g)].length, 1, semiarco);
  assert.match(semiarco, /Reflex Plata 12 pulgadas · [^0-9]+ 24 unidades/);
  ok("D3: una fila por producto, tamaño y color con paquetes combinados (plan real)");
}

console.log(`\n${casos} casos OK (presentación de la tarjeta del plan)`);
