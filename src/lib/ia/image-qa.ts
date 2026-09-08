import { ThinkingLevel } from "@google/genai";
import type { SceneSpec } from "./scene-spec";
import { z } from "zod";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { bytesBase64, registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "./telemetria-llamadas";

export type ImageQaReport = {
  required_elements: Array<{ element_id: string; present: boolean; placement_ok: boolean; appearance_ok: boolean; confidence: number | null }>;
  unexpected_elements: string[];
  text_artifacts: string[];
  annotation_artifacts: string[];
  venue_preservation: { camera_ok: boolean; architecture_ok: boolean; outside_region_similarity: number | null };
  composition: { layering_ok: boolean; reference_relationships_ok: boolean };
  integration: { lighting_ok: boolean; perspective_ok: boolean; contact_shadows_ok: boolean; pasted_artifacts: string[] };
  pass: boolean | null;
  retry_reasons: string[];
  confidence?: "deterministic" | "vision_assisted" | "unknown";
  plan_hash?: string;
  scene_spec_hash?: string;
  observed_instances?: string[] | null;
  observation_confidence?: number | null;
  material_consistency?: {
    estimated_design_quantity: number;
    expected_visual_scale: DesignMaterialEstimate["design"]["visual_scale"];
    rendered_visual_scale: DesignMaterialEstimate["design"]["visual_scale"] | null;
    observed_balloon_count_range: { min: number; max: number } | null;
    consistent: boolean | null;
    reason?: string;
  };
};

export type SceneQaObservation = {
  presentElementIds?: string[];
  unexpectedElements?: string[];
  textArtifacts?: string[];
  annotationArtifacts?: string[];
  placementFailures?: string[];
  appearanceFailures?: string[];
  cameraOk?: boolean;
  architectureOk?: boolean;
  layeringOk?: boolean;
  relationshipsOk?: boolean;
  lightingOk?: boolean;
  perspectiveOk?: boolean;
  contactShadowsOk?: boolean;
  pastedArtifacts?: string[];
  outsideRegionSimilarity?: number | null;
  confidence?: number | null;
  renderedVisualScale?: DesignMaterialEstimate["design"]["visual_scale"] | null;
  observedBalloonCountRange?: { min: number; max: number } | null;
  materialScaleConsistent?: boolean | null;
  materialScaleReason?: string;
};

const VisionObservationSchema = z.object({
  present_element_ids: z.array(z.string()).default([]),
  unexpected_elements: z.array(z.string()).default([]),
  text_artifacts: z.array(z.string()).default([]),
  annotation_artifacts: z.array(z.string()).default([]),
  placement_failures: z.array(z.string()).default([]),
  appearance_failures: z.array(z.string()).default([]),
  camera_ok: z.boolean().default(true),
  architecture_ok: z.boolean().default(true),
  layering_ok: z.boolean().default(true),
  relationships_ok: z.boolean().default(true),
  lighting_ok: z.boolean().default(true),
  perspective_ok: z.boolean().default(true),
  contact_shadows_ok: z.boolean().default(true),
  pasted_artifacts: z.array(z.string()).default([]),
  outside_region_similarity: z.number().min(0).max(1).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  rendered_visual_scale: z.enum(["small", "small_medium", "medium", "large", "very_large"]).nullable().default(null),
  observed_balloon_count_min: z.number().int().nonnegative().nullable().default(null),
  observed_balloon_count_max: z.number().int().nonnegative().nullable().default(null),
  material_scale_consistent: z.boolean().nullable().default(null),
  material_scale_reason: z.string().default(""),
}).strict();

export async function observarImagenGenerada(sceneSpec: SceneSpec, image: { base64: string; mime: string }, estimate?: DesignMaterialEstimate, telemetria?: ContextoTelemetriaIA): Promise<SceneQaObservation | null> {
  const flag = process.env.IMAGE_QA_VISION;
  const instanceFlag = process.env.IMAGE_INSTANCE_QA;
  const habilitado = instanceFlag != null
    ? ["1", "true", "on"].includes(instanceFlag.toLowerCase())
    : flag == null ? Boolean(process.env.GEMINI_API_KEY) : ["1", "true", "on"].includes(flag.toLowerCase());
  if (!habilitado) return null;
  const client = getGeminiClient();
  if (!client) return null;
  const expected = sceneSpec.elements.map((element) => {
    const semantics = element.visual_semantics;
    return `${element.element_id}: ONE distinct installed structure; canonical type=${semantics?.structure_type ?? element.category}; canonical placement=${semantics?.placement ?? "legacy bbox placement"}; design role=${semantics?.design_role ?? "legacy"}; repetition group=${semantics?.repetition_group ?? "none"}; colors=${element.resolved_colors.join(", ") || "not specified"}; bbox=${element.target_bbox.x},${element.target_bbox.y},${element.target_bbox.width},${element.target_bbox.height}; installed material quantity=${element.quantity.min}-${element.quantity.max} (material units, not structure count)`;
  }).join("\n");
  const materialExpectation = estimate
    ? `\nMaterial estimate: approximately ${estimate.totals.design_quantity} installed units; expected visual scale=${estimate.design.visual_scale}; density=${estimate.design.visual_density}; installed balloon sizes=${estimate.balloons.map((line) => `${line.design_quantity}x${line.size_inches ?? "special"}-inch`).join(", ") || "none"}. Purchased capacity=${estimate.totals.purchase_quantity} is not visual quantity. Assess physical scale, not exact object count.`
    : "";
  const inicio = Date.now();
  try {
    const response = await client.models.generateContent({
      model: MODELO_CHAT,
      contents: [{ role: "user", parts: [
         { text: `You are a strict visual QA observer. Inspect the generated image and return only JSON. Do not infer presence from this prompt: decide from visible pixels. Expected physical instances:\n${expected}${materialExpectation}\nEach expected element_id represents one distinct installed structure, even when its material quantity is large; list that id once when its structure is visibly present. Do not list one id per balloon, material unit, package, or repeated visual detail. Mark an instance missing when its distinct structure is not visibly present. Mark placement failure when its canonical placement or bbox region is wrong. Mark appearance failure when the visible palette, material, or size differs from the required catalog colors and material description above. List unexpected decorative objects not in the expected list. For the material estimate, use a broad perceptual range and visual scale: a result is inconsistent when it is clearly several times denser/larger than the installed estimate, not merely because an exact count is difficult. Treat any visible free-floating text, heading, number, measurement, element ID, caption, callout, arrow, watermark, invented logo, or label as a text_artifact or annotation_artifact. Only lettering physically printed on an explicitly approved signage product is allowed; all other visible writing is a failure.` },
        { inlineData: { mimeType: image.mime, data: image.base64 } },
      ] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(VisionObservationSchema, { target: "draft-7" }),
        // Fase 3.3: extracción estructurada a un schema cerrado, el mismo caso
        // donde MINIMAL ya se midió 12/12 estable en el parser de intención
        // (3,5x de mejora). Antes esta llamada no pasaba thinkingConfig y
        // corría en el default "medium" del modelo.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    registrarGemini({ flujo: "generador_imagen", capacidad: "qa_visual", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie: "/api/generate", ...telemetria }, usage: response.usageMetadata, bytesImagenEntrada: bytesBase64(image.base64), thinkingLevel: "minimal" });
    const observado = VisionObservationSchema.parse(JSON.parse(response.text ?? "{}"));
    return {
      presentElementIds: observado.present_element_ids,
      unexpectedElements: observado.unexpected_elements,
      textArtifacts: observado.text_artifacts,
      annotationArtifacts: observado.annotation_artifacts,
      placementFailures: observado.placement_failures,
      appearanceFailures: observado.appearance_failures,
      cameraOk: observado.camera_ok,
      architectureOk: observado.architecture_ok,
      layeringOk: observado.layering_ok,
      relationshipsOk: observado.relationships_ok,
      lightingOk: observado.lighting_ok,
      perspectiveOk: observado.perspective_ok,
      contactShadowsOk: observado.contact_shadows_ok,
      pastedArtifacts: observado.pasted_artifacts,
      outsideRegionSimilarity: observado.outside_region_similarity,
      confidence: observado.confidence,
      renderedVisualScale: observado.rendered_visual_scale,
      observedBalloonCountRange: observado.observed_balloon_count_min != null && observado.observed_balloon_count_max != null
        ? { min: observado.observed_balloon_count_min, max: observado.observed_balloon_count_max }
        : null,
      materialScaleConsistent: observado.material_scale_consistent,
      materialScaleReason: observado.material_scale_reason,
    };
  } catch (error) {
    registrarGemini({ flujo: "generador_imagen", capacidad: "qa_visual", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: "/api/generate", ...telemetria }, bytesImagenEntrada: bytesBase64(image.base64), thinkingLevel: "minimal" });
    return null;
  }
}

export function outsideRegionSimilarity(original: Uint8Array, generated: Uint8Array, ignoredByteRanges: Array<[number, number]> = []): number {
  if (original.length !== generated.length || original.length === 0) return 0;
  let compared = 0;
  let equal = 0;
  for (let index = 0; index < original.length; index += 1) {
    if (ignoredByteRanges.some(([start, end]) => index >= start && index < end)) continue;
    compared += 1;
    if (original[index] === generated[index]) equal += 1;
  }
  return compared ? Number((equal / compared).toFixed(4)) : 1;
}

export function evaluateSceneQa(sceneSpec: SceneSpec, observation: SceneQaObservation = {}, estimate?: DesignMaterialEstimate): ImageQaReport {
  const present = new Set(observation.presentElementIds ?? []);
  const observedIds = observation.presentElementIds ?? [];
  const expectedIds = new Set(sceneSpec.elements.map((element) => element.element_id));
  const unknownObserved = [...new Set(observedIds.filter((id) => !expectedIds.has(id)))];
  const duplicateObserved = [...new Set(observedIds.filter((id, index) => observedIds.indexOf(id) !== index))];
  const placementFailures = new Set(observation.placementFailures ?? []);
  const appearanceFailures = new Set(observation.appearanceFailures ?? []);
  const requiredElements = sceneSpec.elements.map((element) => ({
    element_id: element.element_id,
    present: present.has(element.element_id),
    placement_ok: !placementFailures.has(element.element_id),
    appearance_ok: !appearanceFailures.has(element.element_id),
    confidence: observation.confidence ?? null,
  }));
  const unexpected = observation.unexpectedElements ?? [];
  const textArtifacts = observation.textArtifacts ?? [];
  const annotationArtifacts = observation.annotationArtifacts ?? [];
  const pastedArtifacts = observation.pastedArtifacts ?? [];
  const materialConsistent = estimate ? observation.materialScaleConsistent ?? null : null;
  const retryReasons = [
    ...requiredElements.filter((element) => !element.present).map((element) => `missing required element ${element.element_id}`),
    ...requiredElements.filter((element) => !element.placement_ok).map((element) => `placement failure ${element.element_id}`),
    ...requiredElements.filter((element) => !element.appearance_ok).map((element) => `appearance failure ${element.element_id}`),
    ...unexpected.map((item) => `unexpected element: ${item}`),
    ...textArtifacts.map((item) => `unapproved text or logo: ${item}`),
    ...annotationArtifacts.map((item) => `annotation artifact: ${item}`),
    ...(observation.cameraOk === false ? ["venue camera changed"] : []),
    ...(observation.architectureOk === false ? ["venue architecture changed"] : []),
    ...(observation.layeringOk === false ? ["layer ordering failed"] : []),
    ...(observation.relationshipsOk === false ? ["reference relationships failed"] : []),
    ...(observation.lightingOk === false ? ["lighting integration failed"] : []),
    ...(observation.perspectiveOk === false ? ["perspective integration failed"] : []),
    ...(observation.contactShadowsOk === false ? ["contact shadows failed"] : []),
    ...pastedArtifacts.map((item) => `pasted artifact: ${item}`),
    ...(materialConsistent === false ? [`material scale mismatch: ${observation.materialScaleReason ?? "render is substantially larger or denser than the installed estimate"}`] : []),
    ...unknownObserved.map((item) => `unexpected observed instance: ${item}`),
    ...duplicateObserved.map((item) => `duplicate observed instance: ${item}`),
    ...(sceneSpec.generation_mode === "edit_venue" && observation.outsideRegionSimilarity !== null && observation.outsideRegionSimilarity !== undefined && observation.outsideRegionSimilarity < 0.9 ? ["outside edit region changed"] : []),
  ].slice(0, 12);
  return {
    required_elements: requiredElements,
    unexpected_elements: unexpected,
    text_artifacts: textArtifacts,
    annotation_artifacts: annotationArtifacts,
    venue_preservation: {
      camera_ok: observation.cameraOk ?? true,
      architecture_ok: observation.architectureOk ?? true,
      outside_region_similarity: observation.outsideRegionSimilarity ?? null,
    },
    composition: { layering_ok: observation.layeringOk ?? true, reference_relationships_ok: observation.relationshipsOk ?? true },
    integration: {
      lighting_ok: observation.lightingOk ?? true,
      perspective_ok: observation.perspectiveOk ?? true,
      contact_shadows_ok: observation.contactShadowsOk ?? true,
      pasted_artifacts: pastedArtifacts,
    },
    pass: retryReasons.length === 0,
    retry_reasons: retryReasons,
    confidence: "deterministic",
    observation_confidence: observation.confidence ?? null,
    material_consistency: estimate
      ? {
          estimated_design_quantity: estimate.totals.design_quantity,
          expected_visual_scale: estimate.design.visual_scale,
          rendered_visual_scale: observation.renderedVisualScale ?? null,
          observed_balloon_count_range: observation.observedBalloonCountRange ?? null,
          consistent: materialConsistent,
          ...(observation.materialScaleReason ? { reason: observation.materialScaleReason } : {}),
        }
      : undefined,
  };
}

export function buildCorrectiveRetryPrompt(report: ImageQaReport): string {
  if (report.pass === true) return "";
  return [
    "Correct only the following failed validation checks in the current generated image.",
    "Do not add design details or change venue geometry. Restore missing required instances and remove unexpected or duplicated instances; the final count must exactly match the approved scene.",
    "If text, logos, labels, measurements, IDs, or annotations failed, remove every visible character and return a clean photograph with no typography; these are machine instructions, not scene content.",
    ...report.retry_reasons.map((reason) => `- ${reason}`),
    "Preserve all approved scene elements, target boxes, layers, and protected venue regions. Keep the installed material quantity and visual scale consistent with the approved estimate; do not add package surplus.",
  ].join("\n");
}
