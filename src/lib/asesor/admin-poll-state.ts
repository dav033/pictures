import type { AdminConversationSnapshot } from "./admin";

export const ADMIN_MONITOR_REFRESH_MS = 5_000;

export type AdminPollState = { snapshot: AdminConversationSnapshot[] | null; error: boolean };

export function adminPollSucceeded(_current: AdminPollState, snapshot: AdminConversationSnapshot[]): AdminPollState {
  return { snapshot, error: false };
}

export function adminPollFailed(current: AdminPollState): AdminPollState {
  return { snapshot: current.snapshot, error: true };
}
