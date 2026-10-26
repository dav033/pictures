import { z } from "zod";

/** The advisor's structured first look at a photo, shown to the customer to confirm and carried to the brief. */
export const PhotoReadingSchema = z.object({
  style: z.string().trim().min(1).max(120),
  colors: z.array(z.string().trim().min(1).max(40)).max(6),
  elements: z.array(z.string().trim().min(1).max(60)).max(8),
}).strict();
export type PhotoReading = z.infer<typeof PhotoReadingSchema>;

/** "Estilo: …" / "Colores: …" / "Elementos: …" lines of a reading, for the chat, the brief and the admin. */
export function readingLines(reading: PhotoReading): Array<{ label: string; value: string }> {
  return [
    { label: "Estilo", value: reading.style },
    ...(reading.colors.length ? [{ label: "Colores", value: reading.colors.join(", ") }] : []),
    ...(reading.elements.length ? [{ label: "Elementos", value: reading.elements.join(", ") }] : []),
  ];
}

export const MAX_KEEP_ITEMS = 5;
export const KeepItemSchema = z.string().trim().min(2).max(80);

function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
}

const AFFIRM = /\b(si|sii+|confirmo|confirmada|lo confirmo|correcto|correcta|exacto|exacta|asi es|eso es|esa es|ese es|esa misma|claro|perfecto|de acuerdo|esta bien|ok|vale|listo|asi|justo eso|tal cual|efectivamente)\b/;
const DENY = /^(no\b|nop\b)|\b(no es|no exactamente|no del todo|incorrecto|incorrecta|equivocad[oa]|te equivocas|en realidad|mas bien|en verdad)\b/;
const LIKE = /\b(me gusta|me gustan|me encanta|me encantan|me fascina|amo|adoro|lindo|linda|hermoso|hermosa|bonito|bonita|precioso|preciosa|genial|perfecto|perfecta|quiero (esto|eso|esta|este|esa|ese|algo asi)|me late|me parece (bien|genial|lindo|linda|bonito|bonita))\b/;
const DISLIKE = /\bno me (gusta|gustan|encanta|convence|convencen|agrada|agradan|late)\b|\b(odio|detesto|feo|fea|horrible|evita\w*|evitar|nada de|sin (el|la|los|las)|prefiero (sin|que no)|no quiero)\b/;

/** What the customer's own latest message supports; the model's claim alone never counts. */
export function customerEvidence(text: string): { confirmed: boolean; corrected: boolean; likes: boolean; dislikes: boolean } {
  const normal = normalise(text);
  const dislikes = DISLIKE.test(normal);
  // "Me encanta el arco, el fondo rojo no me gusta": the negated clause must not cancel the liked one.
  const withoutNegated = normal.replace(/\bno me (gusta|gustan|encanta|encantan|convence|convencen|agrada|agradan|late)\b[^,.;]*/g, " ");
  return { confirmed: AFFIRM.test(normal) && !DENY.test(normal), corrected: DENY.test(normal), likes: LIKE.test(withoutNegated), dislikes };
}

const STOP = new Set(["para", "como", "pero", "esta", "este", "esto", "esos", "esas", "quiero", "tiene", "tener", "sobre", "entre", "desde", "hacia", "algo", "todo", "toda", "muy", "mas", "que", "con", "los", "las", "una", "uno", "del", "por", "sin"]);
const words = (text: string) => normalise(text).split(" ").filter((word) => word.length > 3 && !STOP.has(word));

/** The "keep" items the customer actually mentioned (each shares a meaningful word with their message). */
export function keepWithEvidence(items: readonly string[], customerText: string): { accepted: string[]; rejected: string[] } {
  const said = new Set(words(customerText));
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const item of items) (words(item).some((word) => said.has(word)) ? accepted : rejected).push(item);
  return { accepted, rejected };
}
