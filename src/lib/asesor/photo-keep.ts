/** "¿Qué es lo más importante de conservar de esta referencia?": the options Diana listed, as quick-pick chips. */
export const KEEP_OPTIONS = ["colores", "personajes", "distribución", "estilo", "fondo", "todo el diseño"] as const;

export const keepReplyMessage = (photoNumber: number, picked: readonly string[]): string => `De la foto ${photoNumber} quiero conservar: ${picked.join(", ")}.`;
export const noKeepReplyMessage = (photoNumber: number): string => `De la foto ${photoNumber} no necesito conservar nada en particular.`;

/** A chip message back into the photo it is about and the options picked; any other text is left to the model. */
export function parseKeepReply(text: string): { photoNumber: number; items: string[] } | null {
  const match = /^De la foto (\d{1,2}) quiero conservar: (.+?)\.?$/.exec(text.trim());
  if (!match) return null;
  const items = match[2].split(/,\s*/);
  const allowed = new Set<string>(KEEP_OPTIONS);
  return items.length > 0 && items.every((item) => allowed.has(item)) ? { photoNumber: Number(match[1]), items } : null;
}

type PhotoRef = { id: string; keep?: string[] };

/** Saves a keep-chip reply onto the photo it names (photos numbered 1..n in conversation order); returns whether it did. */
export async function applyKeepReply(
  photos: readonly PhotoRef[],
  text: string,
  save: (attachmentId: string, confirmed: null, preference: null, keep: string[]) => Promise<boolean>,
): Promise<boolean> {
  const reply = parseKeepReply(text);
  const photo = reply ? photos[reply.photoNumber - 1] : undefined;
  if (!reply || !photo) return false;
  const merged = [...new Set([...(photo.keep ?? []), ...reply.items])].slice(0, 5);
  const saved = await save(photo.id, null, null, merged);
  if (saved) photo.keep = merged; // the model's context for this very turn already shows it
  return saved;
}
