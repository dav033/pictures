import type { EventBrief, EventBriefState } from "./contracts";

/** Where the conversation is: event facts, preferences, the start-time picker, the Happia proposal, and the contact last. */
export type ConversationStep = "event" | "preferences" | "start_time" | "proposal" | "contact" | "summary";
export type BriefProgress = { complete: boolean; completed: number; required: number; missing: string[]; step: ConversationStep };

const LATE_FIELDS = new Set(["startTime", "contactName", "contactPhoneOrEmail"]);

/** Required fields, progress and the conversation step are domain-owned; model prose has no influence on this result. */
export function calculateBriefProgress(brief: EventBrief, proposalPresented = true): BriefProgress {
  // An undecided venue becomes a venue search: the city stays required, the venue type and address do not.
  const required = (["eventKind", "date", "startTime", "guestCount", "venueType", "city", "address", "contactName"] as (keyof EventBrief)[])
    .filter((key) => !brief.venueUndecided || (key !== "venueType" && key !== "address"));
  if (brief.eventKind === "birthday") required.push("honoreeName");
  if (brief.eventKind === "corporate") required.push("companyName");
  if (brief.eventKind === "school") required.push("schoolName");
  const missing = required.filter((key) => brief[key] === null || brief[key] === "") as string[];
  if (!brief.contactPhone && !brief.contactEmail) missing.push("contactPhoneOrEmail");
  const count = required.length + 1;
  return { complete: missing.length === 0, completed: count - missing.length, required: count, missing, step: conversationStep(brief, missing, proposalPresented) };
}

function conversationStep(brief: EventBrief, missing: string[], proposalPresented: boolean): ConversationStep {
  if (missing.some((field) => !LATE_FIELDS.has(field))) return "event";
  const preferences = brief.theme || brief.style || brief.likes || brief.dislikes || brief.colors.length > 0;
  if (!preferences && missing.length > 0) return "preferences";
  if (missing.includes("startTime")) return "start_time";
  if (!proposalPresented && missing.length > 0) return "proposal";
  if (missing.length > 0) return "contact";
  return "summary";
}

/** Progress of a stored conversation: the proposal counts as presented once a Happia package search ran (match or not). */
export function calculateStateProgress(state: EventBriefState): BriefProgress {
  const searched = state.standardPackage !== null
    || Object.values(state.toolReceipts).some((receipt) => receipt.name === "propose_standard_package");
  return calculateBriefProgress(state.brief, searched);
}
