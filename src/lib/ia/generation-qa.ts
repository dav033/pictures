import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { NivelCreatividad } from "./creatividad";
import { outsideRegionSimilarity, type SimilitudFondoMedida, evaluateSceneQa, observarImagenGenerada, qaPlanInputsFromPlan, type ImageQaReport, type QaPlanInputs } from "./image-qa";
import type { SceneSpec } from "./scene-spec";
import type { ContextoTelemetriaIA } from "./telemetria-llamadas";

/**
 * Plan inputs of an approved generation, shared by the LoRA prompt
 * (`compileProductPrompt` officialStructures) and the visual QA, so both pair
 * left/right structures the same way. Undefined without an approved plan: QA
 * then neither asks nor evaluates separate side pieces (see QaPlanInputs).
 */
export function approvedPlanQaInputs(plan: Pick<PlanResuelto, "plan"> | undefined): QaPlanInputs | undefined {
  return plan ? qaPlanInputsFromPlan(plan.plan.estructuras) : undefined;
}

export type QaObserver = typeof observarImagenGenerada;

/**
 * Observes a generated image and evaluates it against the approved scene. The
 * observer is injectable so the wiring is testable without the provider; the
 * default is the Gemini observer.
 */
export async function buildGenerationQa(input: {
  sceneSpec: SceneSpec;
  image: { base64: string; mime: string };
  hashes: { planHash?: string; sceneSpecHash: string };
  materialEstimate?: DesignMaterialEstimate;
  telemetria?: ContextoTelemetriaIA;
  signal?: AbortSignal;
  force: boolean;
  plan: QaPlanInputs | undefined;
  /** Creativity level the image was generated with: its allowed styling is not an unexpected element. */
  creatividad?: NivelCreatividad;
  /**
   * Foto del espacio, para medir la similitud del fondo sobre píxeles en vez de
   * creerle al modelo (fase 0.4). Sin ella el motivo de reintento por fondo no
   * se dispara, que es lo correcto: un reintento es una llamada pagada.
   */
  venue?: { base64: string };
  observe?: QaObserver;
}): Promise<ImageQaReport> {
  const observe = input.observe ?? observarImagenGenerada;
  const observation = await observe(input.sceneSpec, input.image, input.materialEstimate, input.telemetria, input.signal, input.force, input.plan, input.creatividad);
  const hashes = { plan_hash: input.hashes.planHash, scene_spec_hash: input.hashes.sceneSpecHash };
  const similitudFondo = similitudFondoDe(input.venue, input.image);
  if (!observation) {
    return { ...evaluateSceneQa(input.sceneSpec, {}, input.materialEstimate, input.plan, input.creatividad, similitudFondo), pass: null, confidence: "unknown", observation_confidence: null, ...hashes, observed_instances: null };
  }
  return { ...evaluateSceneQa(input.sceneSpec, observation, input.materialEstimate, input.plan, input.creatividad, similitudFondo), confidence: "vision_assisted", ...hashes, observed_instances: observation.presentElementIds ?? [] };
}

/**
 * Similitud del fondo medida byte a byte (fase 0.4). `outsideRegionSimilarity`
 * compara arreglos del MISMO tamaño; con tamaños distintos devuelve 0, y ese 0
 * significa "incomparable", no "cambió todo". Confundir las dos cosas dispararía
 * un reintento pagado en cada generación cuyo tamaño no coincida, así que aquí
 * se traduce a `null` y el motivo no se dispara.
 */
function similitudFondoDe(venue: { base64: string } | undefined, imagen: { base64: string }): SimilitudFondoMedida {
  if (!venue) return null;
  try {
    const original = new Uint8Array(Buffer.from(venue.base64, "base64"));
    const generada = new Uint8Array(Buffer.from(imagen.base64, "base64"));
    return original.length === generada.length && original.length > 0 ? outsideRegionSimilarity(original, generada) : null;
  } catch {
    return null;
  }
}
