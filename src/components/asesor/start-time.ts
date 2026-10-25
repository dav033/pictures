import type { AdvisorProgress } from "./conversation-contract";

/** The start time is asked last, with the picker, once every other required field is in the brief. */
export function asksOnlyForStartTime(progress: AdvisorProgress | null): boolean {
  return !!progress && progress.missing.length === 1 && progress.missing[0] === "startTime";
}
