/** The last moments of the microphone's loudness as bars that slide left, like WhatsApp while you speak. */
export const LIVE_BARS = 40;

export function LiveWaveform({ levels, quiet }: { levels: readonly number[]; quiet: boolean }) {
  const padded = [...Array(Math.max(0, LIVE_BARS - levels.length)).fill(0), ...levels.slice(-LIVE_BARS)] as number[];
  return (
    <div role="img" aria-label={quiet ? "No se detecta sonido" : "Nivel del micrófono"} className="flex h-9 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden">
      {padded.map((level, index) => (
        <span key={index} style={{ height: `${Math.round(Math.min(1, Math.max(0.08, level * 1.4)) * 100)}%` }}
          className={`w-[3px] shrink-0 rounded-full transition-[height] duration-100 ${index >= LIVE_BARS - levels.length ? (quiet ? "bg-aviso" : "bg-red-500") : "bg-borde"}`} />
      ))}
    </div>
  );
}
