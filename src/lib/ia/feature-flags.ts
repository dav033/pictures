export function featureEnabled(name: "REFERENCE_BLUEPRINT_V2" | "IMAGE_QA_ENABLED" | "LOCALIZED_EDIT_ENABLED"): boolean {
  const raw = process.env[name];
  if (raw === undefined) return true;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}

