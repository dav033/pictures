import type { SceneSpec } from "./scene-spec";

export type ImageQaReport = {
  required_elements: Array<{ element_id: string; present: boolean; placement_ok: boolean; appearance_ok: boolean }>;
  unexpected_elements: string[];
  venue_preservation: { camera_ok: boolean; architecture_ok: boolean; outside_region_similarity: number | null };
  composition: { layering_ok: boolean; reference_relationships_ok: boolean };
  integration: { lighting_ok: boolean; perspective_ok: boolean; contact_shadows_ok: boolean; pasted_artifacts: string[] };
  pass: boolean;
  retry_reasons: string[];
  confidence?: "deterministic" | "vision_assisted" | "unknown";
};

export type SceneQaObservation = {
  presentElementIds?: string[];
  unexpectedElements?: string[];
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
};

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

export function evaluateSceneQa(sceneSpec: SceneSpec, observation: SceneQaObservation = {}): ImageQaReport {
  const present = new Set(observation.presentElementIds ?? []);
  const placementFailures = new Set(observation.placementFailures ?? []);
  const appearanceFailures = new Set(observation.appearanceFailures ?? []);
  const requiredElements = sceneSpec.elements.map((element) => ({
    element_id: element.element_id,
    present: present.has(element.element_id),
    placement_ok: !placementFailures.has(element.element_id),
    appearance_ok: !appearanceFailures.has(element.element_id),
  }));
  const unexpected = observation.unexpectedElements ?? [];
  const pastedArtifacts = observation.pastedArtifacts ?? [];
  const retryReasons = [
    ...requiredElements.filter((element) => !element.present).map((element) => `missing required element ${element.element_id}`),
    ...requiredElements.filter((element) => !element.placement_ok).map((element) => `placement failure ${element.element_id}`),
    ...requiredElements.filter((element) => !element.appearance_ok).map((element) => `appearance failure ${element.element_id}`),
    ...unexpected.map((item) => `unexpected element: ${item}`),
    ...(observation.cameraOk === false ? ["venue camera changed"] : []),
    ...(observation.architectureOk === false ? ["venue architecture changed"] : []),
    ...(observation.layeringOk === false ? ["layer ordering failed"] : []),
    ...(observation.relationshipsOk === false ? ["reference relationships failed"] : []),
    ...(observation.lightingOk === false ? ["lighting integration failed"] : []),
    ...(observation.perspectiveOk === false ? ["perspective integration failed"] : []),
    ...(observation.contactShadowsOk === false ? ["contact shadows failed"] : []),
    ...pastedArtifacts.map((item) => `pasted artifact: ${item}`),
    ...(observation.outsideRegionSimilarity !== null && observation.outsideRegionSimilarity !== undefined && observation.outsideRegionSimilarity < 0.9 ? ["outside edit region changed"] : []),
  ].slice(0, 12);
  return {
    required_elements: requiredElements,
    unexpected_elements: unexpected,
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
  };
}

export function buildCorrectiveRetryPrompt(report: ImageQaReport): string {
  if (report.pass) return "";
  return [
    "Correct only the following failed validation checks in the current generated image.",
    "Do not add design details, change object count, change venue geometry, or restart from the original references.",
    ...report.retry_reasons.map((reason) => `- ${reason}`),
    "Preserve all approved scene elements, target boxes, layers, and protected venue regions.",
  ].join("\n");
}
