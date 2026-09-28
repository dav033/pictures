/**
 * Escenas con bouquets para las pruebas del armado en los prompts de imagen
 * (ADR-0030; `scripts/test/test-armado-bouquet-prompt.ts`), armadas con la
 * MISMA cadena que `/api/generate`.
 *
 * Dos escenas:
 * - `vector15()`: el plan del vector dorado 15 (arco, columna y un bouquet de
 *   10 negros R-9 sobre la mesa principal), tal como lo resuelve Python
 *   (`expected_python`). Sirve para Gemini con coherencia y para el caption
 *   legacy.
 * - `escenaBouquet()`: un arco y un bouquet con productos reales del
 *   vocabulario LoRA v007 (látex dorado reflex y negro fashion, números
 *   metalizados de 32"), para el caption canónico en los dos dialectos. El
 *   bouquet es lo que produce `planBlueprint` para un `kit`: categoría
 *   "other", `structure_type: "kit"`, nombre en español.
 *
 * `casosSinArmado()` son los prompts sin armado que se comparan byte a byte
 * con `scripts/fixtures/armado-bouquet-prompt/prompts-sin-armado.json`,
 * capturada una sola vez con los constructores ANTERIORES a este cambio
 * (commit 4143b31). No se regenera desde el código bajo prueba.
 *
 * Módulo importable (AGENTS.md, "Keep scripts import-safe"): sin CLI ni efectos
 * al cargar. Determinista y sin red.
 */
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import { buildVisualContext } from "@/lib/ia/escena/visual-context";
import { compileLoraCaption } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { compileProductPrompt, type ElementSizeConfirmation } from "@/lib/ia/kagutsuchi/lora-product-runtime";
import { mezclaRealConArmado } from "@/lib/ia/uzume/armado-en-prompt";
import { buildImagePrompt, placementDescription, promptElementName, tieneContratoDeColor } from "@/lib/ia/uzume/build-image-prompt";
import type { FraseDeEstructura } from "@/lib/ia/uzume/mezcla-color-escena";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import type { ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import { planBlueprint } from "@/lib/plan/blueprint";
import type { EscenaParaCoherencia } from "@/lib/plan/coherencia";
import { planResueltoDesdePython } from "@/lib/plan/python-mapper";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { MaterialEstimateSchema } from "@/lib/materiales/estimacion";
import type { PlanFijadoDeFixture } from "./planes-fijados";
import { loadVector } from "./vectores-golden";

export const BOUQUET_VECTOR_15 = "EST_03_BOUQUET";
export const BOUQUET_SINTETICO = "EST_02_BOUQUET";

export const CONTEXTO_CUMPLE = buildVisualContext({
  brief: { tipo_evento: "cumpleaños", estilo: "elegante", colores: ["dorado", "negro"], espacio: "salón" },
  userRequest: "Cumpleaños 80 en un salón con un arco y un bouquet dorado y negro",
});

/** El plan del vector dorado 15 como lo devuelve Python, con sus armados encima si se pasan. */
export function vector15(armados?: readonly ArmadoBouquetResuelto[]): PlanFijadoDeFixture {
  const resultado = loadVector("15-colores-referencia").expected_python;
  if (!resultado) throw new Error("el vector dorado 15 perdió su expected_python");
  const plan = planResueltoDesdePython(resultado.plan_resuelto);
  return {
    plan: armados === undefined ? plan : { ...plan, armados_bouquet: [...armados] },
    materialEstimate: MaterialEstimateSchema.parse(resultado.material_estimate),
  };
}

/** `planBlueprint` -> `buildApprovedSceneSpec`, con los colores de cada línea del plan. */
export function escenaDePlan({ plan, materialEstimate }: PlanFijadoDeFixture): SceneSpec {
  const colorDeVariante = new Map(plan.estructuras.flatMap((estructura) => estructura.lineas.map((linea) => [linea.variant_id, linea.color] as const)));
  const blueprint = planBlueprint(plan);
  return buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((linea) => ({
      id: linea.catalog_product_id,
      name: linea.catalog_product_id,
      description: "",
      category: "balloon",
      colors: [colorDeVariante.get(linea.catalog_product_id)!],
      share: linea.share,
      role: linea.role,
    }))])),
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  });
}

/** Mirror of the route's private officialStructuresDePlan (src/app/api/generate/route.ts). */
export function officialStructuresDe(plan: PlanResuelto): ReadonlyMap<string, string> {
  return new Map(plan.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
}

/** El mismo bloque de tamaños que arma route.ts, con la leyenda del armado cuando lo hay. */
export function sizeMixDe(plan: PlanResuelto, escena: SceneSpec): string | undefined {
  const ubicaciones = new Map<string, string>();
  for (const element of escena.elements) {
    const grupo = element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!;
    if (!ubicaciones.has(grupo)) ubicaciones.set(grupo, placementDescription(element.target_bbox, element.category));
  }
  const armados = new Map((plan.armados_bouquet ?? []).map((armado) => [armado.estructura_id, armado] as const));
  return bloqueMezclaPorEstructura(plan.estructuras.map((estructura) => ({
    nombre: estructura.nombre,
    total_unidades: estructura.total_unidades,
    repeticiones: estructura.repeticiones,
    ubicacion_en_palabras: ubicaciones.get(estructura.estructura_id),
    mezcla_real: mezclaRealConArmado(estructura.mezcla_real, armados.get(estructura.estructura_id)),
  }))) ?? undefined;
}

/** Lo mismo que arma route.ts para la comprobación estructural de color, con las mismas frases. */
export function escenaParaCoherencia(escena: SceneSpec, frases?: readonly FraseDeEstructura[]): EscenaParaCoherencia {
  return {
    elementos: escena.elements.map((element) => ({
      element_id: element.element_id,
      nombre_en_prompt: promptElementName(element.name),
      estructura_id: element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!,
      resolved_colors: element.resolved_colors,
      espera_linea_de_color: tieneContratoDeColor(element, frases),
    })),
  };
}

/** Gemini: prompt completo del plan, como en route.ts. */
export function promptGeminiDePlan(fijado: PlanFijadoDeFixture, frases?: readonly FraseDeEstructura[]): string {
  const escena = escenaDePlan(fijado);
  return buildImagePrompt({ sceneSpec: escena, visualContext: CONTEXTO_CUMPLE, sizeMixBlock: sizeMixDe(fijado.plan, escena), officialStructures: officialStructuresDe(fijado.plan), colorPatterns: frases });
}

/** Caption LoRA sin vocabulario de producto (camino legacy de color/acabado). */
export function captionLegacyDePlan(fijado: PlanFijadoDeFixture, dialect: "product_v007" | "scene_v004", frases?: readonly FraseDeEstructura[]) {
  return compileLoraCaption({ sceneSpec: escenaDePlan(fijado), visualContext: CONTEXTO_CUMPLE, officialStructures: officialStructuresDe(fijado.plan), dialect, colorPatterns: frases });
}

type Elemento = SceneSpec["elements"][number];

/** Productos reales del vocabulario v007 por material del bouquet sintético. */
export const PRODUCTOS = {
  doradoReflex: "7109611258049",
  negroFashion: "8634239516967",
  blancoFashion: "20000435",
  numeroDoradoMate8: "30005493",
  numeroDoradoMate0: "30005473",
  numeroPlata1: "30005488",
  numeroPlata5: "30005508",
} as const;

export type BouquetSintetico = {
  productos: readonly string[];
  colores: readonly string[];
  unidades: number;
  repeticiones?: number;
};

export const BOUQUET_80: BouquetSintetico = {
  productos: [PRODUCTOS.doradoReflex, PRODUCTOS.negroFashion, PRODUCTOS.numeroDoradoMate8, PRODUCTOS.numeroDoradoMate0],
  colores: ["dorado", "negro"],
  unidades: 5,
};

export const BOUQUET_15_LADOS: BouquetSintetico = {
  productos: [PRODUCTOS.blancoFashion, PRODUCTOS.numeroPlata1, PRODUCTOS.numeroPlata5],
  colores: ["blanco", "plateado"],
  unidades: 6,
};

const TALLA_DE: Readonly<Record<string, { sizeCode: string; diameterInches: number }>> = {
  [PRODUCTOS.doradoReflex]: { sizeCode: "R-12", diameterInches: 12 },
  [PRODUCTOS.negroFashion]: { sizeCode: "R-12", diameterInches: 12 },
  [PRODUCTOS.blancoFashion]: { sizeCode: "R-12", diameterInches: 12 },
  [PRODUCTOS.numeroDoradoMate8]: { sizeCode: "32 IN", diameterInches: 32 },
  [PRODUCTOS.numeroDoradoMate0]: { sizeCode: "32 IN", diameterInches: 32 },
  [PRODUCTOS.numeroPlata1]: { sizeCode: "32 IN", diameterInches: 32 },
  [PRODUCTOS.numeroPlata5]: { sizeCode: "32 IN", diameterInches: 32 },
};

function arco(): Elemento {
  return {
    element_id: "EST_01_ARCO",
    name: "Arco orgánico",
    category: "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: PRODUCTOS.doradoReflex,
    catalog_product_ids: [PRODUCTOS.doradoReflex, PRODUCTOS.negroFashion],
    required: true,
    quantity: { mode: "exact", min: 80, max: 80 },
    target_bbox: { x: 0.15, y: 0.05, width: 0.6, height: 0.8 },
    depth_layer: 10,
    resolved_colors: ["dorado", "negro"],
    visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "EST_01_ARCO", density: "media" },
    identity_constraints: [],
    relationships: [],
  };
}

/** El bouquet como lo deja `planBlueprint` para un `kit`: una instancia por repetición (`EST_02_BOUQUET#n`). */
function bouquet(datos: BouquetSintetico): Elemento[] {
  const repeticiones = datos.repeticiones ?? 1;
  return Array.from({ length: repeticiones }, (_, indice) => ({
    element_id: repeticiones === 1 ? BOUQUET_SINTETICO : `${BOUQUET_SINTETICO}#${indice + 1}`,
    name: repeticiones === 1 ? "Bouquet de globos" : `Bouquet de globos #${indice + 1} de ${repeticiones}`,
    category: "other",
    source_type: "catalog_backed" as const,
    catalog_product_id: datos.productos[0],
    catalog_product_ids: [...datos.productos],
    required: true,
    quantity: { mode: "exact" as const, min: datos.unidades, max: datos.unidades },
    target_bbox: { x: 0.78, y: 0.45 + indice * 0.01, width: 0.18, height: 0.4 },
    depth_layer: 20,
    resolved_colors: [...datos.colores],
    visual_semantics: { structure_type: "kit" as const, placement: "sobre_mesa_principal" as const, design_role: "acento" as const, repetition_group: BOUQUET_SINTETICO, density: "media" as const },
    identity_constraints: [],
    relationships: [],
  }));
}

export function escenaBouquet(datos: BouquetSintetico): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: [arco(), ...bouquet(datos)],
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-armado-bouquet" },
  };
}

export const ESTRUCTURAS_OFICIALES_SINTETICAS: ReadonlyMap<string, string> = new Map([["EST_01_ARCO", "arco"], [BOUQUET_SINTETICO, "bouquet"]]);

/** Tallas confirmadas como las da `sizeConfirmationsFromMaterialLines`: por estructura, no por instancia. */
export function tallasDe(escena: SceneSpec): ElementSizeConfirmation[] {
  const porEstructura = new Map<string, Set<string>>();
  for (const element of escena.elements) {
    const estructura = element.element_id.split("#")[0]!;
    const productos = porEstructura.get(estructura) ?? new Set<string>();
    for (const id of element.catalog_product_ids ?? []) productos.add(id);
    porEstructura.set(estructura, productos);
  }
  return [...porEstructura].flatMap(([elementId, productos]) => [...productos].map((productId) => ({ elementId, productId, ...TALLA_DE[productId]! })));
}

/** Caption canónico con el vocabulario v007, como en route.ts. */
export function captionCanonico(escena: SceneSpec, frases?: readonly FraseDeEstructura[], trigger?: string) {
  return compileProductPrompt({
    sceneSpec: escena,
    visualContext: CONTEXTO_CUMPLE,
    vocabulary: PRODUCT_VOCABULARY,
    sizeConfirmations: tallasDe(escena),
    trigger,
    officialStructures: ESTRUCTURAS_OFICIALES_SINTETICAS,
    colorPatterns: frases,
  });
}

/** Gemini para la escena sintética (sin estimado de materiales ni bloque de tamaños). */
export function promptGeminiSintetico(escena: SceneSpec, frases?: readonly FraseDeEstructura[]): string {
  return buildImagePrompt({ sceneSpec: escena, visualContext: CONTEXTO_CUMPLE, officialStructures: ESTRUCTURAS_OFICIALES_SINTETICAS, colorPatterns: frases });
}

/** Todo lo que sale del compilador: texto, JSON, paso de compactación, diagnósticos y cláusulas. */
export function textoLora(resultado: { prompt: string; jsonPrompt: string; compactionStep?: number; diagnostics?: string[]; clauses: unknown[] }): string {
  return JSON.stringify({
    prompt: resultado.prompt,
    jsonPrompt: resultado.jsonPrompt,
    compactionStep: resultado.compactionStep ?? null,
    diagnostics: resultado.diagnostics ?? null,
    clauses: resultado.clauses,
  });
}

/** Prompts sin armado de escenas con bouquets: la instantánea los fija byte a byte. */
export function casosSinArmado(): Array<{ nombre: string; generar: () => string }> {
  const repetido = { ...BOUQUET_80, repeticiones: 2 };
  return [
    { nombre: "gemini/vector-15", generar: () => promptGeminiDePlan(vector15()) },
    { nombre: "lora-legacy-v007/vector-15", generar: () => textoLora(captionLegacyDePlan(vector15(), "product_v007")) },
    { nombre: "lora-legacy-v004/vector-15", generar: () => textoLora(captionLegacyDePlan(vector15(), "scene_v004")) },
    { nombre: "gemini/bouquet-80", generar: () => promptGeminiSintetico(escenaBouquet(BOUQUET_80)) },
    { nombre: "gemini/bouquet-80-repetido", generar: () => promptGeminiSintetico(escenaBouquet(repetido)) },
    { nombre: "lora-canonico-v007/bouquet-80", generar: () => textoLora(captionCanonico(escenaBouquet(BOUQUET_80))) },
    { nombre: "lora-canonico-v004/bouquet-80", generar: () => textoLora(captionCanonico(escenaBouquet(BOUQUET_80), undefined, "eventdecor_style_v2")) },
    { nombre: "lora-canonico-v007/bouquet-80-repetido", generar: () => textoLora(captionCanonico(escenaBouquet(repetido))) },
    { nombre: "lora-canonico-v007/bouquet-15-lados", generar: () => textoLora(captionCanonico(escenaBouquet(BOUQUET_15_LADOS))) },
    { nombre: "lora-canonico-v004/bouquet-15-lados", generar: () => textoLora(captionCanonico(escenaBouquet(BOUQUET_15_LADOS), undefined, "eventdecor_style_v2")) },
  ];
}
