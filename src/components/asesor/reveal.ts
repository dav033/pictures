/**
 * Progressive reveal of the advisor's reply. The model delivers text in uneven bursts (often the whole reply at once);
 * the screen types it out at a steady, readable pace and speeds up only when it falls far behind.
 */
export const MIN_CHARS_PER_SECOND = 70;
export const MAX_CHARS_PER_SECOND = 420;
/** A backlog is worked off in about this long, so a long reply never keeps the customer waiting. */
export const CATCH_UP_SECONDS = 2.2;

export function revealSpeed(backlog: number): number {
  return Math.min(MAX_CHARS_PER_SECOND, Math.max(MIN_CHARS_PER_SECOND, backlog / CATCH_UP_SECONDS));
}

/** Position after `elapsedMs` of revealing, never past `total` and never moving backwards. */
export function advanceReveal(current: number, total: number, elapsedMs: number): number {
  if (current >= total) return total;
  return Math.min(total, current + (revealSpeed(total - current) * Math.max(0, elapsedMs)) / 1000);
}

/** The first `count` characters of `text`, without splitting a surrogate pair (an emoji). */
export function revealedSlice(text: string, count: number): string {
  if (count >= text.length) return text;
  const end = Math.max(0, count);
  const code = text.charCodeAt(end - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? end + 1 : end);
}

/** Replies already shown by id, so the streaming bubble and the committed message continue from the same point. */
const shown = new Map<string, number>();
export const revealedCount = (id: string): number => shown.get(id) ?? 0;
export const rememberRevealed = (id: string, count: number): void => { shown.set(id, count); };
