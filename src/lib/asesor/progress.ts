import type { EventBrief } from "./contracts";

export type BriefProgress = { complete: boolean; completed: number; required: number; missing: string[] };

/** Required fields and progress are domain-owned; model prose has no influence on this result. */
export function calculateBriefProgress(brief: EventBrief): BriefProgress {
  // An undecided venue becomes a venue search: the city stays required, the venue type and address do not.
  const required = (["eventKind", "date", "startTime", "guestCount", "venueType", "city", "address", "contactName"] as (keyof EventBrief)[])
    .filter((key) => !brief.venueUndecided || (key !== "venueType" && key !== "address"));
  if (brief.eventKind === "birthday") required.push("honoreeName");
  if (brief.eventKind === "corporate") required.push("companyName");
  if (brief.eventKind === "school") required.push("schoolName");
  const missing = required.filter((key) => brief[key] === null || brief[key] === "") as string[];
  if (!brief.contactPhone && !brief.contactEmail) missing.push("contactPhoneOrEmail");
  const count = required.length + 1;
  return { complete: missing.length === 0, completed: count - missing.length, required: count, missing };
}
