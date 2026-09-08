export type FeatureFlag =
  | "REFERENCE_BLUEPRINT_V2"
  | "IMAGE_QA_ENABLED"
  | "LOCALIZED_EDIT_ENABLED"
  | "SCENE_PLAN_V2_SHADOW"
  | "SCENE_PLAN_V2_ENABLED"
  | "SCENE_PLAN_V2_REQUIRE_VERIFIED_SOURCES"
  | "SCENE_PLAN_V2_VISUAL_QA"
  | "SCENE_PLAN_V2_KILL_SWITCH"
  | "PLAN_COST_OPTIMIZER_V2"
  | "PLAN_BUDGET_GATE_V2"
  | "IMAGE_INSTANCE_QA";

export function featureEnabled(name: FeatureFlag): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    // Scene and image flags default OFF. The cost optimizer and budget gate
    // preserve the already validated V1 safety behavior unless explicitly
    // disabled for rollback.
    if (name.startsWith("SCENE_PLAN_V2_")) return false;
    if (name === "PLAN_COST_OPTIMIZER_V2" || name === "PLAN_BUDGET_GATE_V2") return true;
    if (name === "IMAGE_INSTANCE_QA") {
      // IMAGE_QA_VISION predates IMAGE_INSTANCE_QA. This must be the ONLY
      // place that decides this flag: `src/lib/ia/image-qa.ts` calls
      // `featureEnabled("IMAGE_INSTANCE_QA")` instead of reimplementing this
      // fallback, so the gate that requires QA for an approved plan
      // (`src/app/api/generate/route.ts`) and the QA call itself never
      // disagree about whether QA is actually going to run.
      const legacy = process.env.IMAGE_QA_VISION;
      if (legacy != null) return ["1", "true", "on"].includes(legacy.toLowerCase());
      return Boolean(process.env.GEMINI_API_KEY);
    }
    return true;
  }
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}
