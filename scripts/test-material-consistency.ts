import assert from "node:assert/strict";
import type { Pool } from "pg";
import { cotizarProductos } from "../src/lib/cotizacion/motor";
import { buildImagePrompt } from "../src/lib/ia/build-image-prompt";
import { evaluateSceneQa } from "../src/lib/ia/image-qa";
import {
  blockingPhysicalWarnings,
  estimateFromMeasuredMaterials,
  estimateFromPlan,
  designQuantityForProduct,
  physicalWarningsForPlan,
  purchaseForProduct,
  validateMaterialEstimate,
  wasteOnlySavingsCop,
  type DesignMaterialEstimate,
} from "../src/lib/materiales/estimacion";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";
import type { Producto } from "../src/lib/types";
import type { SceneSpec } from "../src/lib/ia/scene-spec";

const products: Producto[] = [
  {
    id: "fashion-pink-r12",
    nombre: "Fashion rosado R-12",
    categoria: "Globo látex",
    estilos: [],
    colores: ["fashion rosado"],
    descripcion: "Globo redondo Fashion rosado.",
    precio: 17_100,
    unidadesPaquete: 50,
    paquetes: 1,
    tamanoCodigo: "R-12",
    forma: "redondo",
    diamPulg: 12,
  },
  {
    id: "rose-gold-r12",
    nombre: "Metal dorado rosa R-12",
    categoria: "Globo látex metalizado",
    estilos: [],
    colores: ["metal dorado rosa"],
    descripcion: "Globo redondo metalizado dorado rosa.",
    precio: 17_100,
    unidadesPaquete: 50,
    paquetes: 1,
    tamanoCodigo: "R-12",
    forma: "redondo",
    diamPulg: 12,
  },
  {
    id: "foil-heart",
    nombre: "Corazón foil",
    categoria: "Globo metalizado",
    estilos: [],
    colores: ["dorado rosa"],
    descripcion: "Corazón foil decorativo.",
    precio: 5_000,
    unidadesPaquete: 1,
    paquetes: 1,
    forma: "corazon",
  },
];

const estimate = estimateFromMeasuredMaterials({
  figura: "arco",
  anchoM: 4.5,
  altoM: 2.6,
  ejeM: 4.5,
  despiece: [
    { tamano: "R-12", pulgadas: 12, cantidad: 13, color: "fashion rosado" },
    { tamano: "R-12", pulgadas: 12, cantidad: 29, color: "metal dorado rosa" },
  ],
  totalGlobos: 42,
  supuestos: ["densidad lujosa (λ=4.5)"],
  confianza: "preliminar",
  aviso: "fixture",
}, products);

assert.equal(estimate.balloons.reduce((sum, line) => sum + line.design_quantity, 0), 42);
assert.equal(estimate.special_elements.reduce((sum, line) => sum + line.design_quantity, 0), 1);
assert.equal(designQuantityForProduct(estimate, "fashion-pink-r12"), 13);
assert.equal(designQuantityForProduct(estimate, "rose-gold-r12"), 29);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.purchase_quantity, 50);
assert.equal(estimate.totals.purchase_quantity, 101);
assert.equal(estimate.totals.target_waste_reserve, 4);
assert.equal(estimate.totals.covered_waste_reserve, 4);
assert.equal(estimate.totals.uncovered_waste_reserve, 0);
assert.equal(estimate.totals.required_quantity, 47);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.required_quantity, 17);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.leftover_inventory, 33);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.purchase_cost, 17_100);
assert.ok(estimate.warnings.some((warning) => /appears too low/i.test(warning)));
// The foil heart (1 unit, 1 per package, 5.000 COP) would need a second package
// if merma applied to it; merma only covers balloons, so it saves nothing.
assert.equal(estimate.totals.waste_only_savings_cop, 0);
assert.equal(validateMaterialEstimate(estimate).ok, true);

type Purchase = DesignMaterialEstimate["purchases"][number];
type EstimateLine = DesignMaterialEstimate["balloons"][number];
function purchase(overrides: Pick<Purchase, "product_id" | "variant_id" | "design_quantity" | "units_per_package" | "package_count" | "purchase_cost">): Purchase {
  const purchaseQuantity = overrides.package_count * overrides.units_per_package;
  return {
    ...overrides,
    waste_reserve: 0,
    required_quantity: overrides.design_quantity,
    waste_adjusted_quantity: overrides.design_quantity,
    purchase_quantity: purchaseQuantity,
    used: overrides.design_quantity,
    leftover_inventory: purchaseQuantity - overrides.design_quantity,
    consumption_cost: 0,
    additional_package_for_waste: false,
    operational_surplus: purchaseQuantity - overrides.design_quantity,
    potential_surplus: purchaseQuantity - overrides.design_quantity,
  };
}
function line(productId: string, variantId: string, designQuantity: number, sizeInches: number | null): EstimateLine {
  return {
    product_id: productId,
    variant_id: variantId,
    color: null,
    finish: null,
    size_inches: sizeInches,
    shape: null,
    design_quantity: designQuantity,
    waste_reserve: 0,
    required_quantity: designQuantity,
    waste_adjusted_quantity: designQuantity,
  };
}

// Golden vector 09: a non-geometric backdrop (design 1, 1 per package) never
// contributes, while a balloon line whose merma crosses a package boundary does.
const telon = purchase({ product_id: "P-TELON", variant_id: "V-TELON", design_quantity: 1, units_per_package: 1, package_count: 1, purchase_cost: 20_000 });
const balloonCrossing = purchase({ product_id: "P-BAL", variant_id: "V-BAL-R12", design_quantity: 60, units_per_package: 7, package_count: 9, purchase_cost: 13_500 });
assert.equal(wasteOnlySavingsCop([], [line("P-TELON", "V-TELON", 1, null)], [telon]), 0);
assert.equal(wasteOnlySavingsCop([line("P-BAL", "V-BAL-R12", 60, 12)], [line("P-TELON", "V-TELON", 1, null)], [balloonCrossing, telon]), 1_500);
// A purchase that no estimate line classifies as a balloon is not eligible either.
assert.equal(wasteOnlySavingsCop([], [], [telon]), 0);
// A special element is excluded even when it shares the balloon product.
assert.equal(
  wasteOnlySavingsCop([line("P-BAL", "V-BAL-R12", 60, 12)], [line("P-BAL", "V-TELON", 1, null)], [{ ...telon, product_id: "P-BAL" }]),
  0,
);

// Two balloon lines with a fractional package price (100 / 3) round once at the
// end: 33.33 + 33.33 = 66.67 -> 67, never 33 + 33 = 66. The comparison is
// against the packages actually bought (3 exact), so the design quantity fits
// the purchase: a line whose capacity was below its design was not a real
// purchase and hid how many packages the merma really added.
const fractionalA = purchase({ product_id: "P-BAL", variant_id: "V-BAL-A", design_quantity: 30, units_per_package: 10, package_count: 3, purchase_cost: 100 });
const fractionalB = purchase({ product_id: "P-BAL", variant_id: "V-BAL-B", design_quantity: 30, units_per_package: 10, package_count: 3, purchase_cost: 100 });
assert.equal(
  wasteOnlySavingsCop([line("P-BAL", "V-BAL-A", 30, 12), line("P-BAL", "V-BAL-B", 30, 12)], [], [fractionalA, fractionalB]),
  67,
);

// Measured path: the optimizer may buy another package presentation of the same
// balloon family than the variant that received the demand. It is still a
// balloon purchase and keeps its waste-only savings (47 -> 51 would need a
// second 50-unit package).
const familyEstimate = estimateFromMeasuredMaterials({
  figura: "arco",
  anchoM: 2,
  altoM: 2,
  ejeM: 2,
  despiece: [{ tamano: "R-12", pulgadas: 12, cantidad: 47, color: "blanco" }],
  totalGlobos: 47,
  supuestos: [],
  confianza: "preliminar",
  aviso: "fixture",
}, [
  { id: "fam-r12-x12", familiaId: "fam-r12", nombre: "Globo R-12 x12", categoria: "Globo látex", colores: ["rojo", "blanco"], descripcion: "Globo redondo", precio: 5_000, unidadesPaquete: 12, paquetes: 1, diamPulg: 12 },
  { id: "fam-r12-x50", familiaId: "fam-r12", nombre: "Globo R-12 x50", categoria: "Globo látex", colores: ["rojo"], descripcion: "Globo redondo", precio: 9_000, unidadesPaquete: 50, paquetes: 1, diamPulg: 12 },
]);
assert.deepEqual(familyEstimate.balloons.map((item) => item.variant_id), ["fam-r12-x12"]);
assert.deepEqual(familyEstimate.purchases.map((item) => [item.variant_id, item.design_quantity, item.package_count]), [["fam-r12-x50", 47, 1]]);
assert.equal(familyEstimate.totals.waste_only_savings_cop, 9_000);
assert.equal(validateMaterialEstimate(familyEstimate).ok, true);

// Ruta heredada sin plan: el color de la demanda casaba por subcadena en los
// dos sentidos, así que la demanda "dorado" se repartía 16/16 entre "dorado" y
// "dorado rosa", y "rosa" se repartía entre "rosado" y "dorado rosa".
const globo = (id: string, color: string): Parameters<typeof estimateFromMeasuredMaterials>[1][number] => ({
  id,
  nombre: `Globo ${color} R-12`,
  categoria: "Globo látex",
  colores: [color],
  descripcion: "Globo redondo.",
  precio: 10_000,
  unidadesPaquete: 50,
  paquetes: 1,
  tamanoCodigo: "R-12",
  forma: "redondo",
  diamPulg: 12,
});
const productosColores = [globo("p-rosado", "rosado"), globo("p-dorado-rosa", "dorado rosa"), globo("p-dorado", "dorado")];
const coloresAmbiguos = estimateFromMeasuredMaterials({
  figura: "arco",
  anchoM: 3,
  altoM: 2.4,
  ejeM: 6.21,
  despiece: [
    { tamano: "R-12", pulgadas: 12, cantidad: 32, color: "rosado" },
    { tamano: "R-12", pulgadas: 12, cantidad: 32, color: "dorado" },
    { tamano: "R-12", pulgadas: 12, cantidad: 10, color: "rosa dorado" },
    { tamano: "R-12", pulgadas: 12, cantidad: 8, color: "rosa" },
  ],
  totalGlobos: 82,
  supuestos: [],
  confianza: "preliminar",
  aviso: "fixture",
}, productosColores);
assert.equal(designQuantityForProduct(coloresAmbiguos, "p-rosado"), 32, "igualdad exacta antes que cualquier otra cosa");
assert.equal(designQuantityForProduct(coloresAmbiguos, "p-dorado"), 32, "antes 16: 'dorado rosa' contenía 'dorado'");
assert.equal(designQuantityForProduct(coloresAmbiguos, "p-dorado-rosa"), 10, "mismo color escrito al revés sí cuenta");
// "rosa" no es "rosado" ni "dorado rosa": con varios productos del tamaño se
// avisa y la demanda no se reasigna a un color que el cliente no pidió.
assert.ok(coloresAmbiguos.warnings.some((warning) => /color demand 'rosa' for R-12 matches no selected catalog color/.test(warning)));
assert.equal(coloresAmbiguos.balloons.reduce((sum, item) => sum + item.design_quantity, 0), 74);
// Con un solo producto del tamaño sí se reasigna, con el aviso de siempre.
const colorUnico = estimateFromMeasuredMaterials({
  figura: "arco",
  anchoM: 2,
  altoM: 2,
  ejeM: 2,
  despiece: [{ tamano: "R-12", pulgadas: 12, cantidad: 20, color: "blanco" }],
  totalGlobos: 20,
  supuestos: [],
  confianza: "preliminar",
  aviso: "fixture",
}, [globo("p-rosado", "rosado")]);
assert.equal(designQuantityForProduct(colorUnico, "p-rosado"), 20);
assert.ok(colorUnico.warnings.some((warning) => /was assigned to the available catalog color/.test(warning)));

const zeroDimensionEstimate = estimateFromMeasuredMaterials({
  figura: "pared",
  anchoM: 0,
  altoM: 0,
  largoM: 0,
  ejeM: 0,
  despiece: [{ tamano: "R-12", pulgadas: 12, cantidad: 1, color: "fashion rosado" }],
  totalGlobos: 1,
  supuestos: [],
  confianza: "preliminar",
  aviso: "fixture with missing dimensions",
}, products);
assert.equal(zeroDimensionEstimate.design.installation_length_m, null);
assert.deepEqual(zeroDimensionEstimate.design.dimensions_m, { width: null, height: null, length: null });

const quote = cotizarProductos(products, estimate);
assert.deepEqual(quote.lineas.map((line) => line.cantidadNecesaria), [13, 29, 1]);
assert.deepEqual(quote.lineas.map((line) => line.sobrante), [37, 21, 0]);
assert.equal(quote.mermaPorcentaje, 8);

const scene = {
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  material_estimate: estimate,
  elements: [{
    element_id: "EST_01_ARCO",
    name: "Arco orgánico rosado y dorado rosa",
    category: "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: "fashion-pink-r12",
    required: true,
    quantity: { mode: "exact", min: 43, max: 43 },
    target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    depth_layer: 10,
    resolved_colors: ["fashion rosado", "metal dorado rosa"],
    identity_constraints: ["Use the approved installed material estimate."],
    relationships: [],
  }],
  positive_prompt: { required_elements: ["one organic arch"], composition: ["one focal installation"], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default" },
} as unknown as SceneSpec;
const prompt = buildImagePrompt({ sceneSpec: scene });
assert.match(prompt, /approximately 42 installed balloons/i);
assert.match(prompt, /Purchase capacity \(101\) includes waste/i);
assert.match(prompt, /Neither surplus nor unused package units may appear/i);
assert.doesNotMatch(prompt, /use those 50 units/i);

const qa = evaluateSceneQa(scene, { materialScaleConsistent: false, materialScaleReason: "render is clearly several times denser" }, estimate);
assert.equal(qa.pass, false);
assert.ok(qa.retry_reasons.some((reason) => /material scale mismatch/i.test(reason)));

async function comprobarPuertaFisica(): Promise<void> {
  // --- Puerta física por estructura (ADR 0022) -------------------------------
  // Antes `estimateFromPlan` dividía TODOS los globos instalados (la pared, cuyo
  // eje es 0, incluida) entre el eje sumado de las piezas lineales: "pared +
  // guirnalda" daba 161 globos/m y `confirmar_plan_decoracion` devolvía
  // ESTIMACION_INCONSISTENTE en Next mientras Python aceptaba el mismo plan.
  const filasFisicas = [
    { product_id: "P-GLOBOS", variant_id: "V-BLANCO-12", sku: "SKU-BLANCO-12", producto_titulo: "Globo blanco", variante_titulo: "R-12", precio: 10_000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["blanco"], colores_variante: ["blanco"], descripcion: "Globo látex blanco R-12.", imagen: null },
  ];
  const poolFisico = { query: async () => ({ rows: filasFisicas }) } as unknown as Pool;
  const whitelistFisica = new Map<string, ReadonlySet<string>>([["P-GLOBOS", new Set(["V-BLANCO-12"])]]);
  const materialBlanco = [{ product_id: "P-GLOBOS", color: "blanco", participacion: 1, rol_material: "principal" as const }];
  const planFisico = await resolverPlan(poolFisico, PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "33333333-3333-4333-8333-333333333333",
    concepto: { titulo: "Pared con guirnalda", descripcion: "Pared de globos con una guirnalda encima.", paleta: ["blanco"] },
    espacio: { tipo: "salón", fuente: "cliente" },
    estructuras: [
      { estructura_id: "EST_01_GUIRNALDA", nombre: "Guirnalda superior", tipo: "guirnalda", rol_escena: "acento", ubicacion: "arco_central", medidas: { largo_m: 2.5 }, repeticiones: 1, densidad: "lujosa", mezcla: "clasica", materiales: materialBlanco, porque: "Remata la pared." },
      { estructura_id: "EST_02_PARED", nombre: "Pared de globos", tipo: "pared", rol_escena: "focal", ubicacion: "fondo_pared", medidas: { ancho_m: 2.4, alto_m: 2.4 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: materialBlanco, porque: "Fondo de fotos." },
    ],
    supuestos: [],
  }), whitelistFisica);
  const guirnalda = planFisico.estructuras.find((estructura) => estructura.tipo === "guirnalda")!;
  const pared = planFisico.estructuras.find((estructura) => estructura.tipo === "pared")!;
  assert.ok(pared.total_unidades > guirnalda.total_unidades * 4, `${pared.total_unidades} vs ${guirnalda.total_unidades}`);
  assert.deepEqual(physicalWarningsForPlan(planFisico), [], "pared + guirnalda es un plan válido y confirmable");
  const estimacionFisica = estimateFromPlan(planFisico);
  assert.deepEqual(blockingPhysicalWarnings(estimacionFisica), [], "la estimación ya no inyecta la puerta física del plan");
  // Una sola regla de densidad: la de la estructura con más globos de diseño
  // (antes TypeScript decía "lujosa si alguna lo es" y Python la primera).
  assert.equal(estimacionFisica.design.density, "media");
  assert.equal(estimacionFisica.design.visual_density, "medium");
  // La guirnalda sí se revisa contra su propio eje y su propia densidad.
  const guirnaldaEscasa = {
    ...planFisico,
    estructuras: planFisico.estructuras.map((estructura) => estructura.tipo !== "guirnalda" ? estructura : {
      ...estructura,
      lineas: estructura.lineas.map((linea, indice) => ({ ...linea, unidades: indice === 0 ? 5 : 0 })),
      total_unidades: 5,
    }),
  };
  const avisosEscasos = physicalWarningsForPlan(guirnaldaEscasa);
  assert.equal(avisosEscasos.length, 1, avisosEscasos.join(" | "));
  assert.match(avisosEscasos[0]!, /^EST_01_GUIRNALDA: estimated material quantity appears too low for high density over 2\.50 m \(5 installed balloons\)$/);
  const guirnaldaExcesiva = {
    ...planFisico,
    estructuras: planFisico.estructuras.map((estructura) => estructura.tipo !== "guirnalda" ? estructura : {
      ...estructura,
      lineas: estructura.lineas.map((linea, indice) => ({ ...linea, unidades: indice === 0 ? 900 : 0 })),
      total_unidades: 900,
    }),
  };
  assert.match(physicalWarningsForPlan(guirnaldaExcesiva)[0] ?? "", /EST_01_GUIRNALDA: estimated material quantity appears unusually high/);
}

async function comprobarTamanoObligatorioGrande(): Promise<void> {
  // --- Tamaño obligatorio grande + puerta física (W1.1 + W1.3) --------------
  // Los umbrales por metro están calibrados contra mezclas donde R-12 domina el
  // volumen. Desde que el total sale de la mezcla efectiva, un arco "solo R-24"
  // cuenta 52 globos (8,37/m) donde la mezcla completa contaba 119 (19,16/m) y
  // caía por debajo del mínimo de densidad media (8,4/m): el plan resolvía bien
  // pero `confirmar_plan_decoracion` devolvía ESTIMACION_INCONSISTENTE y
  // /api/generate lanzaba un error. La banda se escala ahora con el mismo
  // modelo que produjo el conteo.
  const filas = [5, 9, 12, 18, 24].map((pulgadas) => ({
    product_id: "P-GLOBOS", variant_id: `V-BLANCO-${pulgadas}`, sku: `SKU-BLANCO-${pulgadas}`, producto_titulo: "Globo blanco", variante_titulo: `R-${pulgadas}`, precio: 10_000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: `R-${pulgadas}`, forma: "redondo", diam_pulg: pulgadas, colores_producto: ["blanco"], colores_variante: ["blanco"], descripcion: `Globo látex blanco R-${pulgadas}.`, imagen: null,
  }));
  const pool = { query: async () => ({ rows: filas }) } as unknown as Pool;
  const whitelist = new Map<string, ReadonlySet<string>>([["P-GLOBOS", new Set(filas.map((fila) => fila.variant_id))]]);
  const arco = async (tamanos: string[]) => resolverPlan(pool, PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "55555555-5555-4555-8555-555555555555",
    concepto: { titulo: "Arco de 24 pulgadas", descripcion: "Arco orgánico con globos grandes.", paleta: ["blanco"] },
    espacio: { tipo: "salón", fuente: "cliente" },
    estructuras: [
      { estructura_id: "EST_01_ARCO", nombre: "Arco orgánico", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 3, alto_m: 2.4 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales: [{ product_id: "P-GLOBOS", color: "blanco", participacion: 1, rol_material: "principal" }], porque: "Es el foco." },
    ],
    supuestos: [],
    ...(tamanos.length ? { restricciones: { colores: [], acabados: [], estructuras: [], tamanos: tamanos.map((valor) => ({ valor, procedencia: "explicito", texto_original: `solo globos ${valor}`, polaridad: "obligatorio" })) } } : {}),
  }), whitelist);

  const completo = await arco([]);
  assert.equal(completo.estructuras[0]!.total_unidades, 119);
  assert.deepEqual(physicalWarningsForPlan(completo), []);
  const soloR24 = await arco(["R-24"]);
  assert.deepEqual(soloR24.sin_cobertura, [], "el plan resuelve: el catálogo tiene R-24");
  assert.equal(soloR24.estructuras[0]!.total_unidades, 52);
  assert.deepEqual(physicalWarningsForPlan(soloR24), [], "antes: 52 globos / 6,21 m = 8,37 < 8,4 bloqueaba un plan válido");
  // La puerta no se apaga: con la banda escalada (×0,435) el mínimo de la
  // estructura es 3,65 globos/m y un conteo absurdo sigue avisando.
  const soloR24Escaso = {
    ...soloR24,
    estructuras: soloR24.estructuras.map((estructura) => ({
      ...estructura,
      lineas: estructura.lineas.map((linea, indice) => ({ ...linea, unidades: indice === 0 ? 5 : 0 })),
      total_unidades: 5,
    })),
  };
  assert.match(physicalWarningsForPlan(soloR24Escaso)[0] ?? "", /^EST_01_ARCO: estimated material quantity appears too low for medium density over 6\.21 m \(5 installed balloons\)$/);
  const soloR24Excesivo = {
    ...soloR24,
    estructuras: soloR24.estructuras.map((estructura) => ({
      ...estructura,
      lineas: estructura.lineas.map((linea, indice) => ({ ...linea, unidades: indice === 0 ? 400 : 0 })),
      total_unidades: 400,
    })),
  };
  assert.match(physicalWarningsForPlan(soloR24Excesivo)[0] ?? "", /^EST_01_ARCO: estimated material quantity appears unusually high/);
  // El parseo estricto comparte dueño con Python: "R-12.5" no es un tamaño y la
  // restricción se ignora en los dos backends (antes TypeScript cotizaba 100
  // globos "R-12.5" y Python los 119 de la mezcla completa).
  const noNumerico = await arco(["R-12.5"]);
  assert.equal(noNumerico.estructuras[0]!.total_unidades, 119);
  assert.deepEqual(physicalWarningsForPlan(noNumerico), []);
}

comprobarPuertaFisica().then(comprobarTamanoObligatorioGrande).then(() => {
  console.log("[PASS] material consistency regression — installed 42 + 1 special, purchased capacity 101, visual prompt excludes package surplus, puerta física por estructura y con tamaño obligatorio grande");
}).catch((error: unknown) => {
  console.error("[FAIL] puerta física por estructura", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
