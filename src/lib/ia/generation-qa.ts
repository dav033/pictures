import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { NivelCreatividad } from "./creatividad";
import { evaluateSceneQa, observarImagenGenerada, qaPlanInputsFromPlan, type ImageQaReport, type QaPlanInputs } from "./image-qa";
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
  observe?: QaObserver;
}): Promise<ImageQaReport> {
  const observe = input.observe ?? observarImagenGenerada;
  const observation = await observe(input.sceneSpec, input.image, input.materialEstimate, input.telemetria, input.signal, input.force, input.plan, input.creatividad);
  const hashes = { plan_hash: input.hashes.planHash, scene_spec_hash: input.hashes.sceneSpecHash };
  if (!observation) {
    return { ...evaluateSceneQa(input.sceneSpec, {}, input.materialEstimate, input.plan, input.creatividad), pass: null, confidence: "unknown", observation_confidence: null, ...hashes, observed_instances: null };
  }
  return { ...evaluateSceneQa(input.sceneSpec, observation, input.materialEstimate, input.plan, input.creatividad), confidence: "vision_assisted", ...hashes, observed_instances: observation.presentElementIds ?? [] };
}
