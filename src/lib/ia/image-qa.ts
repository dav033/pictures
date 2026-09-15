import { ThinkingLevel } from "@google/genai";
import { tableSupportedElements, type SceneSpec } from "./scene-spec";
import { z } from "zod";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { identificarEstructuraOficial, type EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { AMBIENTACION_IMAGEN, esAmbientacionPermitida, perfilCreatividad, type NivelCreatividad } from "./creatividad";
import { featureEnabled } from "./feature-flags";
import { compileLoraCaption, type LoraVisualClause } from "./lora-caption-compiler";
import { findSeparateSidePieces, type SeparateSidePieces } from "./separate-side-pieces";
import { bytesBase64, registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "./telemetria-llamadas";
import type { VisualContext } from "./visual-context";

export type ImageQaReport = {
  required_elements: Array<{ element_id: string; present: boolean; placement_ok: boolean; appearance_ok: boolean; confidence: number | null }>;
  unexpected_elements: string[];
  text_artifacts: string[];
  annotation_artifacts: string[];
  venue_preservation: { camera_ok: boolean; architecture_ok: boolean; outside_region_similarity: number | null };
  composition: {
    layering_ok: boolean;
    reference_relationships_ok: boolean;
    /**
     * Present only when the plan has separate side pieces (see
     * separate-side-pieces.ts) and the observer gave a verdict: false when it
     * saw them merged into one arch. Absent means not evaluated or not applicable.
     */
    separate_side_pieces_ok?: boolean;
  };
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
  /** Whether separate side pieces stayed apart; null or absent means not evaluated. */
  sidePiecesSeparation?: "separate" | "merged" | null;
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
  // Observations stored before this field existed parse as null: not evaluated, never a pass or a failure.
  separate_side_pieces: z.enum(["separate", "merged"]).nullable().default(null),
}).strict();

/**
 * Validates the observer's JSON at the provider boundary. Throws on malformed
 * fields; the caller treats that as an unavailable observation.
 */
export function parseVisionObservation(raw: unknown): SceneQaObservation {
  const observado = VisionObservationSchema.parse(raw);
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
    sidePiecesSeparation: observado.separate_side_pieces,
  };
}

/**
 * Approved-plan data the caption compiler reads besides the scene. Callers pass
 * the same values the prompt was compiled with (the `officialStructures` map
 * route.ts builds from the plan's `estructura_oficial` for compileProductPrompt),
 * so QA asks for and checks exactly what the prompt described: a declared
 * variant outranks the name and decides which left/right structures form a
 * mirrored pair. Build it with `qaPlanInputsFromPlan`.
 *
 * It is optional only so that callers without plan data keep compiling; when
 * it is omitted QA cannot know whether the prompt asked for separate side
 * pieces, so it neither asks the observer nor evaluates that criterion. Guessing
 * from names instead diverged from the prompt in both directions: a missed
 * separation, or an invented one whose false failure triggered a paid
 * corrective retry and NON_CONFORME.
 */
export type QaPlanInputs = {
  officialStructures: ReadonlyMap<string, string>;
  /**
   * The image was generated from a reference or venue photo: that photo's own
   * setting (backdrop, curtains, walls, furniture, flowers, lighting) is
   * expected context, not an unexpected element. Extra balloons, balloon
   * structures, signs and text still fail.
   */
  photoSetting?: boolean;
};

/**
 * The plan inputs for QA and for the caption compiler, built once from the
 * approved plan's structures: each declared `estructura_oficial` by
 * `estructura_id`. Without an approved plan the map is empty and names stand in.
 */
export function qaPlanInputsFromPlan(estructuras: ReadonlyArray<{ estructura_id: string; estructura_oficial?: string }> = []): QaPlanInputs {
  return { officialStructures: new Map(estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : [])) };
}

/**
 * The caption compiler owns which left/right structures form a mirrored pair
 * and which official structure each element is; its grouping reads only the
 * scene and the plan inputs, so the context here is neutral and the compiled
 * wording is discarded.
 */
const GROUPING_ONLY_CONTEXT: VisualContext = { venueKind: "unknown", lightingKind: "unspecified", palette: [] };

function compiledClauses(sceneSpec: SceneSpec, plan: QaPlanInputs | undefined): LoraVisualClause[] {
  return compileLoraCaption({ sceneSpec, visualContext: GROUPING_ONLY_CONTEXT, officialStructures: plan?.officialStructures }).clauses;
}

function sidePiecesList(pieces: readonly LoraVisualClause[], withNoun: boolean): string {
  return pieces.map((piece) => {
    const ids = piece.elementIds.join(" and ");
    return withNoun ? `${ids} (${piece.structureType === "semiarco" ? "one-sided half-arch" : "column"})` : ids;
  }).join(", ");
}

function separateSidePiecesInstruction(pieces: SeparateSidePieces<LoraVisualClause> | undefined): string {
  if (!pieces) return "";
  return `\nSeparate side pieces: the approved plan places ${sidePiecesList(pieces.left, true)} on the left and ${sidePiecesList(pieces.right, true)} on the right as separate installations with an open gap between them. Set separate_side_pieces to "merged" when they are visibly joined into one continuous arch, frame, or garland across that gap, even if each expected id is still recognizable; set it to "separate" when each piece stands on its own and the gap between them stays open.`;
}

/**
 * One expected instance for the QA observer. The name and the official
 * structure are included: with only "canonical type=kit" and an internal
 * placement enum the observer could not tell that a planned figure or
 * accessory was the object it saw, and reported it as unexpected.
 * `compiledOfficial` is the official structure the caption compiler resolved
 * for the element (declared variant first); without it, it is inferred.
 */
export function describeExpectedQaElement(element: SceneSpec["elements"][number], compiledOfficial?: EstructuraOficial): string {
  const semantics = element.visual_semantics;
  const official = semantics ? compiledOfficial ?? identificarEstructuraOficial({ tipo: semantics.structure_type, densidad: semantics.density, ubicacion: semantics.placement, nombre: element.name }) : undefined;
  const kind = official ? `official structure=${official.sustantivoEn}; ` : "";
  return `${element.element_id}: ONE distinct installed structure; name=${JSON.stringify(element.name)}; ${kind}canonical type=${semantics?.structure_type ?? element.category}; canonical placement=${semantics?.placement ?? "legacy bbox placement"}; design role=${semantics?.design_role ?? "legacy"}; repetition group=${semantics?.repetition_group ?? "none"}; colors=${element.resolved_colors.join(", ") || "not specified"}; bbox=${element.target_bbox.x},${element.target_bbox.y},${element.target_bbox.width},${element.target_bbox.height}; installed material quantity=${element.quantity.min}-${element.quantity.max} (material units, not structure count)`;
}

/**
 * Styling the generation level allowed (creatividad.ts): the observer reports
 * it apart from real extras so an allowed flower or guest does not trigger a
 * corrective retry. Without a level nothing is allowed.
 */
function allowedStylingInstruction(creatividad: NivelCreatividad | undefined): string {
  const styling = creatividad === undefined ? [] : perfilCreatividad(creatividad).imagen.ambientacion.map((clave) => AMBIENTACION_IMAGEN[clave].cue);
  return styling.length
    ? `\nAllowed non-catalog styling for this image: ${styling.join("; ")}. Do not list that styling as unexpected; still list any extra balloons, balloon structures, backdrops, signs, or text.`
    : "";
}

/** Tables under approved centerpieces are their requested support (build-image-prompt TABLE SUPPORT EXCEPTION). */
function tableSupportInstruction(sceneSpec: SceneSpec): string {
  return tableSupportedElements(sceneSpec).length
    ? "\nPlain tables that hold the expected table-top structures are their expected support: do not list those tables as unexpected."
    : "";
}

function photoSettingInstruction(plan: QaPlanInputs | undefined): string {
  return plan?.photoSetting
    ? "\nThis image recreates a customer photo: the setting from that photo (backdrop or panel walls, curtains, drapes, windows, walls, furniture, tables, chairs, flowers, plants, candles, lighting, people) is expected context. Do not list that setting as unexpected; still list any extra balloons, balloon structures, hoops made of balloons, signs, or text."
    : "";
}

/** Photo-setting items an observer may still list: anything that names no balloon, sign or writing. */
function isPhotoSettingItem(plan: QaPlanInputs | undefined, observed: string): boolean {
  return Boolean(plan?.photoSetting) && !/\b(?:balloons?|signs?|signage|text|letters?|lettering|numbers?|words?|logos?|labels?|neon)\b/i.test(observed.replace(/_/g, " "));
}

/** A plain supporting table, never one carrying balloons, signs or text of its own. */
function isSupportTable(sceneSpec: SceneSpec, observed: string): boolean {
  const item = observed.replace(/_/g, " ");
  return tableSupportedElements(sceneSpec).length > 0
    && /\b(?:tables?|tablecloths?)\b/i.test(item)
    && !/\b(?:balloons?|signs?|text|letters?|food|cakes?|chairs?|flowers?|candles?)\b/i.test(item);
}

export function buildQaObserverPrompt(sceneSpec: SceneSpec, estimate?: DesignMaterialEstimate, plan?: QaPlanInputs, creatividad?: NivelCreatividad): string {
  const clauses = compiledClauses(sceneSpec, plan);
  const officialByElementId = new Map(clauses.flatMap((clause) => clause.officialStructure ? clause.elementIds.map((id) => [id, clause.officialStructure] as const) : []));
  const expected = sceneSpec.elements.map((element) => describeExpectedQaElement(element, officialByElementId.get(element.element_id))).join("\n");
  const materialExpectation = estimate
    ? `\nMaterial estimate: approximately ${estimate.totals.design_quantity} installed units; expected visual scale=${estimate.design.visual_scale}; density=${estimate.design.visual_density}; installed balloon sizes=${estimate.balloons.map((line) => `${line.design_quantity}x${line.size_inches ?? "special"}-inch`).join(", ") || "none"}. Purchased capacity=${estimate.totals.purchase_quantity} is not visual quantity. Assess physical scale, not exact object count.`
    : "";
  const separation = plan ? separateSidePiecesInstruction(findSeparateSidePieces(clauses)) : "";
  return `You are a strict visual QA observer. Inspect the generated image and return only JSON. Do not infer presence from this prompt: decide from visible pixels. Expected physical instances:\n${expected}${materialExpectation}${separation}${tableSupportInstruction(sceneSpec)}${allowedStylingInstruction(creatividad)}${photoSettingInstruction(plan)}\nEach expected element_id represents one distinct installed structure, even when its material quantity is large; list that id once when its structure is visibly present. Do not list one id per balloon, material unit, package, or repeated visual detail. Mark an instance missing when its distinct structure is not visibly present. Mark placement failure when its canonical placement or bbox region is wrong. Mark appearance failure when the visible palette, material, or size differs from the required catalog colors and material description above. List unexpected decorative objects not in the expected list, including any backdrop, curtain, drape, fabric or panel wall, hoop or ring frame, pedestal, crate or stand used instead of the expected support, loose or floating balloons, sign, flowers, candles, furniture, props, or people. Mark appearance failure when a structure has a different form than its official structure (for example a round hoop instead of an arch), or when a hanging structure floats without visible support. For the material estimate, use a broad perceptual range and visual scale: a result is inconsistent when it is clearly several times denser/larger than the installed estimate, not merely because an exact count is difficult. Treat any visible free-floating text, heading, number, measurement, element ID, caption, callout, arrow, watermark, invented logo, or label as a text_artifact or annotation_artifact. Only lettering physically printed on an explicitly approved signage product is allowed; all other visible writing is a failure.`;
}

export async function observarImagenGenerada(
  sceneSpec: SceneSpec,
  image: { base64: string; mime: string },
  estimate?: DesignMaterialEstimate,
  telemetria?: ContextoTelemetriaIA,
  signal?: AbortSignal,
  force = false,
  plan?: QaPlanInputs,
  creatividad?: NivelCreatividad,
): Promise<SceneQaObservation | null> {
  // The UI can opt into one observation for a request without turning on the
  // global flag. The flag remains the server-side default/kill switch.
  if (!force && !featureEnabled("IMAGE_QA_ENABLED")) return null;
  const client = getGeminiClient();
  if (!client) return null;
  const instruction = buildQaObserverPrompt(sceneSpec, estimate, plan, creatividad);
  const inicio = Date.now();
  try {
    const response = await client.models.generateContent({
      model: MODELO_CHAT,
      contents: [{ role: "user", parts: [
        { text: instruction },
        { inlineData: { mimeType: image.mime, data: image.base64 } },
      ] }],
      config: {
        abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
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
    const raw: unknown = JSON.parse(response.text ?? "{}");
    return parseVisionObservation(raw);
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

/**
 * Only a verdict from the observer is checked against the plan: without one
 * the separation was not evaluated and the scene is not compiled (QA often runs
 * with an empty observation). Without plan inputs it is not evaluated either
 * (see QaPlanInputs). A verdict on a plan without separate side pieces adds no
 * criterion.
 */
function separateSidePiecesOutcome(sceneSpec: SceneSpec, separation: SceneQaObservation["sidePiecesSeparation"], plan: QaPlanInputs | undefined): { ok: boolean; pieces: SeparateSidePieces<LoraVisualClause> } | undefined {
  if (!plan || (separation !== "merged" && separation !== "separate")) return undefined;
  const pieces = findSeparateSidePieces(compiledClauses(sceneSpec, plan));
  return pieces ? { ok: separation === "separate", pieces } : undefined;
}

export function evaluateSceneQa(sceneSpec: SceneSpec, observation: SceneQaObservation = {}, estimate?: DesignMaterialEstimate, plan?: QaPlanInputs, creatividad?: NivelCreatividad): ImageQaReport {
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
  // Backstop for an observer that lists requested supports or allowed styling
  // anyway: only plain centerpiece tables and items the level allows that name
  // no balloon, structure, sign or text are dropped.
  const unexpected = (observation.unexpectedElements ?? []).filter((item) => !isSupportTable(sceneSpec, item) && !isPhotoSettingItem(plan, item) && (creatividad === undefined || !esAmbientacionPermitida(creatividad, item)));
  const textArtifacts = observation.textArtifacts ?? [];
  const annotationArtifacts = observation.annotationArtifacts ?? [];
  const pastedArtifacts = observation.pastedArtifacts ?? [];
  const materialConsistent = estimate ? observation.materialScaleConsistent ?? null : null;
  const sidePieces = separateSidePiecesOutcome(sceneSpec, observation.sidePiecesSeparation, plan);
  const retryReasons = [
    ...requiredElements.filter((element) => !element.present).map((element) => `missing required element ${element.element_id}`),
    ...requiredElements.filter((element) => !element.placement_ok).map((element) => `placement failure ${element.element_id}`),
    ...requiredElements.filter((element) => !element.appearance_ok).map((element) => `appearance failure ${element.element_id}`),
    ...(sidePieces && !sidePieces.ok ? [`separate side pieces merged into one arch: ${sidePiecesList(sidePieces.pieces.left, false)} on the left and ${sidePiecesList(sidePieces.pieces.right, false)} on the right must stand apart with an open gap`] : []),
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
    composition: {
      layering_ok: observation.layeringOk ?? true,
      reference_relationships_ok: observation.relationshipsOk ?? true,
      ...(sidePieces ? { separate_side_pieces_ok: sidePieces.ok } : {}),
    },
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
