import type { EventBrief } from "./contracts";

export type BriefProgress = { complete: boolean; completed: number; required: number; missing: string[] };

/** Required fields and progress are domain-owned; model prose has no influence on this result. */
export function calculateBriefProgress(brief: EventBrief): BriefProgress {
  const required = ["eventKind", "date", "guestCount", "venueType", "budget"] as const;
  const missing: string[] = required.filter((key) => brief[key] === null || brief[key] === "");
  if (brief.eventKind === "corporate" && !brief.companyName) missing.push("companyName");
  if (brief.eventKind === "school" && !brief.schoolName) missing.push("schoolName");
  return { complete: missing.length === 0, completed: required.length + (brief.eventKind === "corporate" || brief.eventKind === "school" ? 1 : 0) - missing.length, required: required.length + (brief.eventKind === "corporate" || brief.eventKind === "school" ? 1 : 0), missing };
}
