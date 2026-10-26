/** What a photo-only send says: the server needs some text in every turn, and the customer should see what they sent. */
export function photoOnlyMessage(kind: "inspiration" | "venue", count: number): string {
  if (kind === "venue") return count === 1 ? "Te comparto una foto del lugar." : "Te comparto fotos del lugar.";
  return count === 1 ? "Te comparto una foto de inspiración." : "Te comparto fotos de inspiración.";
}
