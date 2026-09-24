import type { ImageInput, Imagen, ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";

/**
 * Cierre del caption de la etapa 1. Cuenta contra el presupuesto antes de
 * compilarlo: LoRA no recibe el venue, así que cualquier prop que se cuele aquí
 * acaba contaminando la composición posterior de Gemini.
 *
 * ESTO ERA UN BLOQUE DE 290 CARACTERES DE PROHIBICIONES. La sección 5b del plan
 * lo midió contra esta cláusula declarativa sobre el slot v004 aprobado: la
 * cláusula puntuó 7 en aislamiento donde el bloque puntuó 4, y se llevó la
 * usabilidad con ella. La misma medición descarta la explicación fácil: quitar
 * el bloque sin reemplazarlo no cambia nada (la celda B salió idéntica a la A en
 * todos los ejes). Lo que importa no es el presupuesto que libera sino que el
 * corpus habla así — 43 de sus 345 captions mencionan un estudio blanco — y una
 * prohibición en un registro que el modelo nunca vio entrenando no es una
 * instrucción, es ruido.
 *
 * Las otras tres frases del bloque viejo no se perdieron, se mudaron a donde
 * pueden actuar: la asimetría la emite ahora el compilador por cláusula en la
 * gramática del corpus (`fraseRelacionTamanos`, fase 3.4) y el rosa pastel y la
 * lista de props siguen en `GEMINI_COMPOSITION_HARD_LOCK`, que es la etapa que
 * de verdad puede añadir un objeto.
 */
export const LORA_PRESENTATION_INSTRUCTION = ", set against a plain white studio backdrop, no floor visible.";

export const GEMINI_COMPOSITION_HARD_LOCK = "COMPOSITING HARD LOCK: use the venue image as the immutable base. From the LoRA image transfer only the approved quoted structures described in AUTOMATIC SCENE SPEC. Install each structure into its assigned venue target: frame the visible opening when one is indicated, set columns and floor pieces on the real floor, and place backdrops against the real flat wall. Re-pose, re-scale and re-light the approved structures to match the venue perspective, eye level and light direction; add contact shadows and physical supports so they do not look pasted on. Keep every approved asymmetric structure visibly uneven, with staggered cluster sizes and a non-mirrored top profile; never turn them into matching straight towers. Render approved pink as soft pastel pink, never saturated hot pink. Ignore its white studio background and every unapproved object in it, including backdrop, drapes, tables, chairs, flowers, plants, pedestals and props. Do not invent, retain or add any of those objects. Keep the venue's existing architecture, plants, ground, camera and crop unchanged.";

/**
 * LoRA diseña la decoración sola; Gemini recibe luego su render y el venue.
 *
 * La cláusula de cierre es una subordinada, no una frase aparte: el corpus la
 * escribe dentro de la misma oración. Pegarla tal cual detrás de un caption que
 * ya termina en punto produce «grounded supports., set against…», que es un
 * registro que el modelo no vio nunca. Se quita el punto final antes de unir y
 * se cierra una sola vez.
 */
export function promptPresentacionLora(prompt: string): string {
  const cuerpo = prompt.trimEnd().replace(/[.\s]+$/, "");
  return `${cuerpo}${LORA_PRESENTATION_INSTRUCTION}`;
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
