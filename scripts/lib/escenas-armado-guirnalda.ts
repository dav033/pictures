/**
 * Escenas con guirnaldas para las pruebas del armado en los prompts de imagen
 * (ADR-0032, entrega E5; `scripts/test/test-armado-guirnalda-prompt.ts`),
 * armadas con la MISMA cadena que `/api/generate`.
 *
 * Dos fuentes:
 * - `planGuirnalda(nombre)`: planes resueltos por Python de verdad
 *   (`scripts/fixtures/armado-guirnalda-prompt/planes.json`, escrita por
 *   `services/ai-api/scripts/fixture_armado_guirnalda_prompt.py --escribir`),
 *   con y sin armado, con el catálogo de prueba de
 *   `services/ai-api/tests/guirnalda_datos.py`. Sirven para Gemini con
 *   coherencia y para el caption legacy.
 * - `escenaGuirnalda()`: un arco y una guirnalda con productos reales del
 *   vocabulario LoRA v007 (látex rosado y blanco Fashion, dorado Reflex), para
 *   el caption canónico en los dos dialectos.
 *
 * `casosSinArmado()` son los prompts sin armado que se comparan byte a byte
 * con `scripts/fixtures/armado-guirnalda-prompt/prompts-sin-armado.json`,
 * capturada una sola vez con los constructores ANTERIORES a E5 (base
 * `27528f2`). No se regenera desde el código bajo prueba.
 *
 * Módulo importable (AGENTS.md, "Keep scripts import-safe"): sin CLI ni efectos
 * al cargar. Determinista y sin red.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PlanResueltoV1Schema } from "@/lib/ia/contracts/domain-v1";
import type { SceneSpec } from "@/lib/ia/escena/scene-spec";
import { compileProductPrompt, type ElementSizeConfirmation } from "@/lib/ia/kagutsuchi/lora-product-runtime";
import { buildImagePrompt } from "@/lib/ia/uzume/build-image-prompt";
import type { FraseDeEstructura } from "@/lib/ia/uzume/mezcla-color-escena";
import { MaterialEstimateSchema } from "@/lib/materiales/estimacion";
import { planResueltoDesdePython } from "@/lib/plan/python-mapper";
import { CONTEXTO_CUMPLE, promptGeminiDePlan } from "./escenas-armado-bouquet";
import type { PlanFijadoDeFixture } from "./planes-fijados";

export const GUIRNALDA_PLAN = "EST_01_GUIRNALDA";
export const ARCO_PLAN = "EST_02_ARCO";
export const GUIRNALDA_SINTETICA = "EST_02_GUIRNALDA";

const DIRECTORIO_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "armado-guirnalda-prompt");

const PlanesSchema = z.object({
  _comentario: z.string(),
  planes: z.record(z.string(), z.object({
    plan_resuelto: z.record(z.string(), z.unknown()),
    material_estimate: z.record(z.string(), z.unknown()),
  }).strict()),
}).strict();

let planesLeidos: z.infer<typeof PlanesSchema>["planes"] | undefined;

function planes(): z.infer<typeof PlanesSchema>["planes"] {
  planesLeidos ??= PlanesSchema.parse(JSON.parse(readFileSync(join(DIRECTORIO_FIXTURES, "planes.json"), "utf8")) as unknown).planes;
  return planesLeidos;
}

/** El plan de Python `nombre`, por el mismo mapeador que usa producción. */
export function planGuirnalda(nombre: string): PlanFijadoDeFixture {
  const fijado = planes()[nombre];
  if (!fijado) throw new Error(`plan de guirnalda desconocido: ${nombre} (hay ${Object.keys(planes()).join(", ")})`);
  return {
    plan: planResueltoDesdePython(PlanResueltoV1Schema.parse(fijado.plan_resuelto)),
    materialEstimate: MaterialEstimateSchema.parse(fijado.material_estimate),
  };
}

type Elemento = SceneSpec["elements"][number];

/** Productos reales del vocabulario v007. */
export const PRODUCTOS_GUIRNALDA = {
  rosadoFashion: "20000438",
  blancoFashion: "20000435",
  doradoReflex: "7109611258049",
} as const;

export type GuirnaldaSintetica = {
  placement?: "fondo_pared" | "piso_frontal" | "sobre_mesa_principal";
  repeticiones?: number;
};

function arco(): Elemento {
  return {
    element_id: "EST_01_ARCO",
    name: "Arco orgánico",
    category: "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: PRODUCTOS_GUIRNALDA.doradoReflex,
    catalog_product_ids: [PRODUCTOS_GUIRNALDA.doradoReflex],
    required: true,
    quantity: { mode: "exact", min: 119, max: 119 },
    target_bbox: { x: 0.2, y: 0.05, width: 0.6, height: 0.75 },
    depth_layer: 10,
    resolved_colors: ["dorado"],
    visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "EST_01_ARCO", density: "media" },
    identity_constraints: [],
    relationships: [],
  };
}

/** La guirnalda como la deja `planBlueprint`: una instancia por repetición (`EST_02_GUIRNALDA#n`). */
function guirnalda(datos: GuirnaldaSintetica): Elemento[] {
  const repeticiones = datos.repeticiones ?? 1;
  const placement = datos.placement ?? "fondo_pared";
  const y = placement === "piso_frontal" ? 0.8 : placement === "sobre_mesa_principal" ? 0.6 : 0.1;
  return Array.from({ length: repeticiones }, (_, indice) => ({
    element_id: repeticiones === 1 ? GUIRNALDA_SINTETICA : `${GUIRNALDA_SINTETICA}#${indice + 1}`,
    name: repeticiones === 1 ? "Guirnalda orgánica" : `Guirnalda orgánica #${indice + 1} de ${repeticiones}`,
    category: "balloon_structure",
    source_type: "catalog_backed" as const,
    catalog_product_id: PRODUCTOS_GUIRNALDA.rosadoFashion,
    catalog_product_ids: [PRODUCTOS_GUIRNALDA.rosadoFashion, PRODUCTOS_GUIRNALDA.blancoFashion],
    required: true,
    quantity: { mode: "exact" as const, min: 48, max: 48 },
    target_bbox: { x: 0.1 + indice * 0.4, y, width: 0.8 - indice * 0.4, height: 0.15 },
    depth_layer: 20,
    resolved_colors: ["rosado", "blanco"],
    visual_semantics: { structure_type: "guirnalda" as const, placement, design_role: "soporte" as const, repetition_group: GUIRNALDA_SINTETICA, density: "media" as const },
    identity_constraints: [],
    relationships: [],
  }));
}

export function escenaGuirnalda(datos: GuirnaldaSintetica = {}): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: [arco(), ...guirnalda(datos)],
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-armado-guirnalda" },
  };
}

export const ESTRUCTURAS_OFICIALES_GUIRNALDA: ReadonlyMap<string, string> = new Map([["EST_01_ARCO", "arco"], [GUIRNALDA_SINTETICA, "guirnalda"]]);

const TALLAS: Readonly<Record<string, readonly number[]>> = {
  [PRODUCTOS_GUIRNALDA.rosadoFashion]: [5, 9, 12, 18, 24],
  [PRODUCTOS_GUIRNALDA.blancoFashion]: [5, 9, 12, 18],
  [PRODUCTOS_GUIRNALDA.doradoReflex]: [5, 9, 12, 18],
};

/** Tallas confirmadas por estructura, como las da `sizeConfirmationsFromMaterialLines`. */
export function tallasGuirnalda(escena: SceneSpec): ElementSizeConfirmation[] {
  const porEstructura = new Map<string, Set<string>>();
  for (const element of escena.elements) {
    const estructura = element.element_id.split("#")[0]!;
    const productos = porEstructura.get(estructura) ?? new Set<string>();
    for (const id of element.catalog_product_ids ?? []) productos.add(id);
    porEstructura.set(estructura, productos);
  }
  return [...porEstructura].flatMap(([elementId, productos]) => [...productos].flatMap((productId) =>
    (TALLAS[productId] ?? []).map((diametro) => ({ elementId, productId, sizeCode: `R-${diametro}`, diameterInches: diametro }))));
}

/** Caption canónico con el vocabulario v007, como en route.ts. Sin trigger el runtime compila el dialecto `base` (modelo sin LoRA); estos casos fijan el v007, que es el que el trigger v3 selecciona con la misma longitud que el v2. */
export function captionCanonicoGuirnalda(escena: SceneSpec, frases?: readonly FraseDeEstructura[], maxLength?: number) {
  const productCatalogTitles = new Map<string, string>();
  for (const productId of escena.elements.flatMap((element) => element.catalog_product_ids ?? [])) {
    const color = escena.elements.find((element) => element.catalog_product_ids?.includes(productId))?.resolved_colors[0] ?? "globos";
    productCatalogTitles.set(productId, `B2b Globo Latex Redondo ${color}`);
  }
  return compileProductPrompt({
    sceneSpec: escena,
    visualContext: CONTEXTO_CUMPLE,
    sizeConfirmations: tallasGuirnalda(escena),
    productCatalogTitles,
    maxLength,
    officialStructures: ESTRUCTURAS_OFICIALES_GUIRNALDA,
    colorPatterns: frases
});
}

/** Gemini para la escena sintética (sin estimado de materiales ni bloque de tamaños). */
export function promptGeminiGuirnalda(escena: SceneSpec, frases?: readonly FraseDeEstructura[]): string {
  return buildImagePrompt({ sceneSpec: escena, visualContext: CONTEXTO_CUMPLE, officialStructures: ESTRUCTURAS_OFICIALES_GUIRNALDA, colorPatterns: frases });
}

/**
 * Prompts sin armado de escenas con guirnaldas: la instantánea los fija byte a
 * byte. Las frases van como en la ruta: `frases(plan)` es
 * `frasesDeEstructuras` del plan (con el patrón de la guirnalda clásica).
 */
export function casosSinArmado(frases: (plan: PlanFijadoDeFixture["plan"]) => readonly FraseDeEstructura[] | undefined): Array<{ nombre: string; generar: () => string }> {
  const gemini = (nombre: string) => () => {
    const fijado = planGuirnalda(nombre);
    return promptGeminiDePlan(fijado, frases(fijado.plan));
  };
  return [
    { nombre: "gemini/pared", generar: gemini("pared-sin-armado") },
    { nombre: "gemini/piso", generar: gemini("piso-sin-armado") },
    { nombre: "gemini/mesa", generar: gemini("mesa-sin-armado") },
    { nombre: "gemini/clasica-patron", generar: gemini("clasica-patron-sin-armado") },
    { nombre: "gemini/repetida", generar: gemini("repetida-sin-armado") },
    { nombre: "gemini-sintetico/pared", generar: () => promptGeminiGuirnalda(escenaGuirnalda()) },
    { nombre: "gemini-sintetico/piso", generar: () => promptGeminiGuirnalda(escenaGuirnalda({ placement: "piso_frontal" })) },
  ];
}
