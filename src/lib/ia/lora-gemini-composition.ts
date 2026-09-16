import type { ImageInput, Imagen, ImagenEtiquetada } from "./tipos";

// Debe contar contra el presupuesto del caption antes de compilarlo. LoRA no
// recibe el venue, así que cualquier prop ajeno aquí acaba contaminando la
// composición posterior de Gemini.
export const LORA_PRESENTATION_INSTRUCTION = " Isolated white-studio presentation: only approved quoted structures. Asymmetry means uneven staggered clusters and nonmatching tops, never straight matching towers. Pink must be soft pastel, not hot pink. No backdrop, drapes, furniture, tables, chairs, flowers, plants, pedestals or props.";

export const GEMINI_COMPOSITION_HARD_LOCK = "COMPOSITING HARD LOCK: use the venue image as the immutable base. From the LoRA image transfer only the approved quoted structures described in AUTOMATIC SCENE SPEC. Keep every approved asymmetric structure visibly uneven, with staggered cluster sizes and a non-mirrored top profile; never turn them into matching straight towers. Render approved pink as soft pastel pink, never saturated hot pink. Ignore its white studio background and every unapproved object in it, including backdrop, drapes, tables, chairs, flowers, plants, pedestals and props. Do not invent, retain or add any of those objects. Keep the venue's existing architecture, plants, ground, camera and crop unchanged.";

/** LoRA diseña la decoración sola; Gemini recibe luego su render y el venue. */
export function promptPresentacionLora(prompt: string): string {
  return `${prompt}${LORA_PRESENTATION_INSTRUCTION}`;
}

/** Gemini compone dos fuentes: venue inalterable y decoración ya diseñada. */
export function inputsParaComposicionGemini(venue: ImagenEtiquetada, decoracion: Imagen): ImageInput[] {
  return [
    {
      ...venue,
      role: "venue_base",
      priority: 0,
      allowed_use: "Customer venue base. Preserve its architecture, camera, crop, perspective, ground and ambient light; add decoration only inside it.",
    },
    {
      ...decoracion,
      id: "LORA_DECORATION",
      descripcion: "LoRA render of the approved decoration on a white studio background.",
      role: "element_reference",
      priority: 1,
      allowed_use: "Approved quoted structures only. Transfer only their colors, proportions and arrangement into the venue. Never transfer white studio background, backdrop, drapes, furniture, tables, chairs, flowers, plants, pedestals or props.",
    },
  ];
}
