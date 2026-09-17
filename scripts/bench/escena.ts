import type { SceneSpec } from "../../src/lib/ia/scene-spec";
import { GROUPING_ONLY_CONTEXT, LORA_PROMPT_MAX_LENGTH } from "../../src/lib/ia/lora-caption-compiler";
import { LORA_PRESENTATION_INSTRUCTION } from "../../src/lib/ia/lora-gemini-composition";
import { compileProductPrompt, type ElementSizeConfirmation } from "../../src/lib/ia/lora-product-runtime";
import { preflightLoraPrompt } from "../../src/lib/ia/lora-prompt-preflight";
import { ensureLoraTriggers } from "../../src/lib/ia/sempertex-lora";
import { PRODUCT_VOCABULARY } from "../../src/lib/lora/product-vocabulary-data";
import { clasificarColores } from "../../src/lib/rag/taxonomy/v2";
import type { PistaCaption, PistaPreflight } from "./tipos";

/**
 * Escena del benchmark: una plantilla comercial fija coloreada con la paleta
 * que el analizador midió en cada foto.
 *
 * Por qué no se usan los planes congelados de `scripts/fixtures/planes-fijados/`:
 * sus ids de producto son sintéticos (`V-P-BLANCO-R-12`), no existen en
 * `PRODUCT_VOCABULARY`, y `compileProductPrompt` los devolvería como
 * `unresolved_products`, que `route.ts:1086` convierte en
 * LORA_PRODUCT_VOCABULARY_FAILED. Con productos reales la escena compila y
 * además el caption puede llevar los colores de la foto, que es lo que hace
 * comparable la imagen final con la referencia.
 *
 * La PLANTILLA es fija a propósito (un arco focal y dos columnas laterales):
 * entre fases solo deben moverse las cosas que las fases arreglan, no la forma
 * de la escena. Producción tampoco deriva la forma de la foto: la deriva del
 * plan aprobado (`route.ts:810`).
 */

/**
 * Color del catálogo -> un producto real que el vocabulario sepa nombrar.
 *
 * Se deriva del propio `PRODUCT_VOCABULARY` en vez de mantenerse a mano: una
 * lista escrita aquí mediría esta lista, no el sistema. Un color que ningún
 * concepto activo cubre queda fuera del mapa, y eso es un RESULTADO del
 * benchmark —la foto no puede representarse— no un fallo de configuración.
 *
 * Se prefiere el concepto de acabado liso (Fashion mate) cuando existe, para
 * que la escena no dependa de un globo impreso o de novedad.
 */
function construirMapaColores(): Readonly<Record<string, string>> {
  const mapa: Record<string, string> = {};
  const ordenados = [...PRODUCT_VOCABULARY]
    .filter((c) => c.status === "active" && (c.catalog_product_ids ?? []).length > 0 && c.visual?.pattern?.kind === "solid")
    .sort((a, b) => Number(b.concept_id.includes(".fashion.")) - Number(a.concept_id.includes(".fashion.")));
  for (const concepto of ordenados) {
    const color = concepto.visual?.color;
    if (!color) continue;
    const clasificacion = clasificarColores(color);
    const canonico = clasificacion.status === "unknown" ? undefined : clasificacion.values.find((v) => v !== "multicolor");
    if (canonico && !mapa[canonico]) mapa[canonico] = concepto.catalog_product_ids![0]!;
  }
  return mapa;
}

export const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = construirMapaColores();

export type ColoresEscena = { renderizables: string[]; sinConcepto: string[] };

/** Separa la paleta medida en lo que el vocabulario puede dibujar y lo que no. */
export function repartirColores(paleta: readonly string[]): ColoresEscena {
  const renderizables: string[] = [];
  const sinConcepto: string[] = [];
  for (const color of paleta) {
    if (PRODUCTO_POR_COLOR[color]) renderizables.push(color);
    else sinConcepto.push(color);
  }
  return { renderizables, sinConcepto };
}

type Elemento = SceneSpec["elements"][number];
type Ubicacion = "arco_central" | "lateral_izquierdo" | "lateral_derecho";

function elemento(id: string, nombre: string, tipo: "arco" | "columna", ubicacion: Ubicacion, rol: "focal" | "soporte", colores: string[]): Elemento {
  const productIds = colores.map((color) => PRODUCTO_POR_COLOR[color]!);
  return {
    element_id: id,
    name: nombre,
    category: "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: productIds[0],
    catalog_product_ids: productIds,
    required: true,
    quantity: { mode: "exact", min: 1, max: 1 },
    target_bbox: ubicacion === "arco_central"
      ? { x: 0.2, y: 0.08, width: 0.6, height: 0.62 }
      : { x: ubicacion === "lateral_izquierdo" ? 0.04 : 0.78, y: 0.2, width: 0.18, height: 0.7 },
    depth_layer: 10,
    resolved_colors: colores,
    visual_semantics: { structure_type: tipo, placement: ubicacion, design_role: rol, repetition_group: tipo === "columna" ? "cols" : id, density: "media" },
    identity_constraints: [],
    relationships: [],
  } as Elemento;
}

/**
 * `cajas` viene del colocador consciente del espacio (fase 6.A). Sin ellas la
 * plantilla usa sus posiciones fijas, que es el comportamiento de las fases
 * anteriores y lo que hace comparables las corridas.
 */
export function construirEscena(colores: string[], aspecto: SceneSpec["canvas"]["aspect_ratio"], cajas?: Record<string, { x: number; y: number; width: number; height: number }>): SceneSpec {
  const delArco = colores.slice(0, 3);
  const deColumnas = colores.slice(0, 2);
  const elementos = [
    elemento("EST_01_ARCO", "Arco organico", "arco", "arco_central", "focal", delArco),
    elemento("EST_02_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", deColumnas),
    elemento("EST_03_COL_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", deColumnas),
  ].map((el) => (cajas?.[el.element_id] ? { ...el, target_bbox: cajas[el.element_id]! } : el));
  return {
    schema_version: "1.0",
    generation_mode: "edit_venue",
    canvas: { aspect_ratio: aspecto, content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: elementos,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "bench-fidelidad" },
  } as SceneSpec;
}

const TAMANOS = ["R-5", "R-12", "R-18", "R-36"] as const;

export type CaptionCompilado = {
  caption: PistaCaption;
  preflight: PistaPreflight;
  /** El texto exacto que recibiría fal, con la instrucción de presentación. */
  promptFal: string;
};

/** Compila el caption con EXACTAMENTE los ajustes del modo híbrido (`route.ts:1066-1080`). */
export function compilarCaption(spec: SceneSpec, trigger: string): CaptionCompilado {
  const sizeConfirmations: ElementSizeConfirmation[] = spec.elements.flatMap((el) =>
    (el.catalog_product_ids ?? []).flatMap((productId) => TAMANOS.map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode }))),
  );
  const techo = LORA_PROMPT_MAX_LENGTH - LORA_PRESENTATION_INSTRUCTION.length;
  const compilacion = compileProductPrompt({
    sceneSpec: spec,
    visualContext: GROUPING_ONLY_CONTEXT,
    vocabulary: PRODUCT_VOCABULARY,
    sizeConfirmations,
    trigger,
    maxLength: techo,
    ambientDecor: [],
    officialStructures: new Map<string, string>(),
  });
  const texto = ensureLoraTriggers(compilacion.prompt, [{ path: "bench", trigger, scale: 0.8 }]);
  const reporte = preflightLoraPrompt({ sceneSpec: spec, clauses: compilacion.clauses, prompt: texto, triggers: [trigger], vocabulary: PRODUCT_VOCABULARY });

  const tallasOmitidas = [...new Set(
    compilacion.diagnostics
      .flatMap((linea) => /size\(s\) ([^ ]+(?:, [^ ]+)*) are not in allowed_codes/.exec(linea)?.[1]?.split(", ") ?? []),
  )];

  return {
    caption: { texto, longitud: texto.length, techo, tallasOmitidas, diagnosticos: compilacion.diagnostics },
    preflight: { ok: reporte.ok, errores: reporte.errors },
    promptFal: `${texto}${LORA_PRESENTATION_INSTRUCTION}`,
  };
}
