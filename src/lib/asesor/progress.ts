import type { EventBrief, EventBriefState } from "./contracts";

/** Where the conversation is: event facts, preferences, the start-time picker, the Happia proposal, and the contact last. */
export type ConversationStep = "event" | "preferences" | "start_time" | "proposal" | "contact" | "summary";
/** Inside the preferences step, after the taste: what the organiser cares most about, then the budget (quick-pick chips). */
export type PreferenceAsk = "priority" | "budget";
export type BriefProgress = { complete: boolean; completed: number; required: number; missing: string[]; step: ConversationStep; ask?: PreferenceAsk };

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
  const step = conversationStep(brief, missing, proposalPresented);
  const ask = step === "preferences" ? preferenceAsk(brief) : null;
  return { complete: missing.length === 0, completed: count - missing.length, required: count, missing, step, ...(ask ? { ask } : {}) };
}

const hasTaste = (brief: EventBrief) => Boolean(brief.theme || brief.style || brief.likes || brief.dislikes || brief.colors.length > 0);
const budgetAnswered = (brief: EventBrief) => brief.budget !== null || brief.budgetRange !== null || brief.budgetUndisclosed;

function preferenceAsk(brief: EventBrief): PreferenceAsk | null {
  if (!hasTaste(brief) || budgetAnswered(brief)) return null;
  return brief.organiserPriority === null ? "priority" : "budget";
}

function conversationStep(brief: EventBrief, missing: string[], proposalPresented: boolean): ConversationStep {
  if (missing.some((field) => !LATE_FIELDS.has(field))) return "event";
  // The budget is optional for the brief but always asked: an amount, a band or an explicit "prefiero no decir".
  if ((!hasTaste(brief) || !budgetAnswered(brief)) && missing.length > 0) return "preferences";
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
