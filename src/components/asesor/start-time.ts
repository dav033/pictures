import type { AdvisorProgress } from "./conversation-contract";

/** The start time is asked with the picker on the server's start-time step: after event facts and preferences, before the contact. */
export function asksOnlyForStartTime(progress: AdvisorProgress | null): boolean {
  return progress?.step === "start_time";
}
