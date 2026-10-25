export const WAVEFORM_BARS = 32;

/** Heights (0.12-1) of `bars` columns from the loudness samples taken while recording; quiet recordings still show a readable shape. */
export function waveformFromLevels(levels: readonly number[], bars = WAVEFORM_BARS): number[] {
  if (levels.length === 0) return placeholderWaveform("empty", bars);
  const peak = Math.max(0.2, ...levels);
  return Array.from({ length: bars }, (_, bar) => {
    const from = Math.floor((bar * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / bars));
    const slice = levels.slice(from, to);
    const average = slice.reduce((sum, level) => sum + level, 0) / slice.length;
    return Math.round(Math.min(1, Math.max(0.12, average / peak)) * 100) / 100;
  });
}

/** A stable decorative shape for a voice note whose recording is gone (a restored conversation): the same id always draws the same bars. */
export function placeholderWaveform(seed: string, bars = WAVEFORM_BARS): number[] {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: bars }, (_, bar) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const wave = 0.5 + 0.35 * Math.sin(bar / 3.2);
    return Math.round(Math.min(1, Math.max(0.14, wave * 0.6 + (state / 0xffffffff) * 0.4)) * 100) / 100;
  });
}

/** 0:07, 1:05 */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
