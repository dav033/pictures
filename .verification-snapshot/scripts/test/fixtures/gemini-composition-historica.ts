/** Fixture histórico de pruebas; no forma parte del runtime ni genera imágenes. */
import type { ImageInput, Imagen, ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { SOPORTES_CON_CAIDA_GUIRNALDA, type SoporteGuirnalda } from "@/lib/plan/armado-guirnalda";

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
export const FLUX_PRESENTATION_INSTRUCTION = ", set against a plain white studio backdrop, no floor visible.";

export const GEMINI_COMPOSITION_HARD_LOCK = "COMPOSITING HARD LOCK: use the venue image as the immutable base. From the LoRA image transfer only the approved quoted structures described in AUTOMATIC SCENE SPEC. Install each structure into its assigned venue target: frame the visible opening when one is indicated, set columns and floor pieces on the real floor, and place backdrops against the real flat wall. Re-pose, re-scale and re-light the approved structures to match the venue perspective, eye level and light direction; add contact shadows and physical supports so they do not look pasted on. Keep every approved asymmetric structure visibly uneven, with staggered cluster sizes and a non-mirrored top profile; never turn them into matching straight towers. Render approved pink as soft pastel pink, never saturated hot pink. Ignore its white studio background and every unapproved object in it, including backdrop, drapes, tables, chairs, flowers, plants, pedestals and props. Do not invent, retain or add any of those objects. Keep the venue's existing architecture, plants, ground, camera and crop unchanged.";

/**
 * Lo que el hard lock añade cuando el caption de la etapa 1 llevó el patrón de
 * color de alguna estructura (ADR-0028 §12): Gemini re-posa y re-ilumina la
 * decoración de la imagen LoRA, y esta frase le pide que no toque su patrón.
 * Nombra la imagen LoRA igual que el resto del hard lock: la primera imagen de
 * entrada es el venue (`inputsParaComposicionGemini`), no la decoración.
 */
export const GEMINI_COMPOSITION_PATTERN_LOCK = "Keep each structure's color pattern exactly as in the LoRA image.";

/** Qué piezas llevan los armados del caption, para que los candados nombren solo esas (hallazgo 17). */
export type PiezasDeLosArmados = {
  bouquet: { remate: boolean; numeros: boolean };
  /** `enAlto`: alguna guirnalda con armado va en la pared o colgada (ADR-0032, decisión 28). */
  guirnalda: { relleno: boolean; remates: boolean; enAlto?: boolean };
};

function unirEnIngles(partes: readonly string[]): string {
  return partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join(", ")} and ${partes[partes.length - 1]}`;
}

/**
 * Lo que el hard lock añade cuando el caption de la etapa 1 llevó el armado de
 * un bouquet (ADR-0030): al re-posar la decoración, Gemini no puede rehacer el
 * bouquet ni mover sus números. Solo nombra lo que el armado fija (el remate y
 * los números, si los tiene); el armado mismo ya viaja en la línea de color
 * del prompt de la etapa 2.
 */
export function candadoArmadoBouquet(piezas: PiezasDeLosArmados["bouquet"]): string {
  const iguales = unirEnIngles([
    "the same levels from bottom to top",
    ...(piezas.remate ? ["the same topper"] : []),
    ...(piezas.numeros ? ["the number balloons in the same position"] : []),
    "the same number of bouquets",
  ]);
  return `Keep each balloon bouquet exactly as assembled in the LoRA image: ${iguales}; never add, drop or regroup its balloons.`;
}

/** El candado del bouquet con remate y números: el de siempre. */
export const GEMINI_COMPOSITION_ASSEMBLY_LOCK = candadoArmadoBouquet({ remate: true, numeros: true });

/**
 * Cierre del candado de la guirnalda: "exactly as assembled in the LoRA image"
 * también conservaba lo que la LoRA hubiera inventado. Con una espiral la LoRA
 * dibujó cintas retorcidas cruzando la guirnalda (2026-09-28); la etapa 2 no
 * las copia: la guirnalda es solo de globos.
 */
const GARLAND_BALLOONS_ONLY = "It is made only of round latex balloons: drop any ribbon, streamer, twisted band or fabric the LoRA image shows, and never add one.";

/**
 * Una guirnalda en la pared o colgada salió de la LoRA como un arco
 * rectangular con patas y soportes metálicos (2026-09-28, ADR-0032 decisión
 * 28); "exactly as assembled in the LoRA image" los conservaba, y el hard lock
 * pide "physical supports". La etapa 2 no los copia.
 */
const GARLAND_ENDS_FREE = "A garland on the wall or hanging from its anchor points keeps both ends free in the air: drop any stand, leg, pole, base or frame the LoRA image shows under it, and never add one.";

/**
 * Lo que el hard lock añade cuando el caption de la etapa 1 llevó el armado de
 * una guirnalda (ADR-0032, E5): la etapa 2 re-posa la decoración de un fondo
 * blanco sobre el venue, y sin esta frase podía enderezar una guirnalda en U,
 * bajarla al piso o separarla de la pieza que abraza. Solo nombra lo que el
 * armado fija; el armado mismo viaja en la línea de color del prompt.
 */
export function candadoArmadoGuirnalda(piezas: PiezasDeLosArmados["guirnalda"]): string {
  const racimos = piezas.relleno && piezas.remates ? "the same clusters, filler and accent balloons"
    : piezas.relleno ? "the same clusters and filler balloons"
      : piezas.remates ? "the same clusters and accent balloons"
        : "the same clusters";
  return `Keep each balloon garland exactly as assembled in the LoRA image: ${racimos} and the same shape, and install it on the support its assembly names in COLOR VARIETY (flat against the real wall, hanging from its anchor points, resting on the real floor, along the real table edge, or wrapped around its host structure); never straighten, re-hang, split or regroup it. ${GARLAND_BALLOONS_ONLY}${piezas.enAlto ? ` ${GARLAND_ENDS_FREE}` : ""}`;
}

/** El candado de la guirnalda con relleno y remates: el de E5. */
export const GEMINI_COMPOSITION_GARLAND_LOCK = candadoArmadoGuirnalda({ relleno: true, remates: true });

/**
 * Hard lock de la etapa 2; sin patrón de color ni armado es la constante de
 * siempre, byte a byte. `conArmadoBouquet` y `conArmadoGuirnalda` van aparte
 * del patrón: un plan puede traer cualquiera de ellos o todos. `piezas`
 * (`piezasDeLosArmados` del caption) hace que cada candado nombre solo el
 * remate, los números, el relleno y los remates que los armados tienen; sin
 * ella, los candados completos.
 */
export function hardLockComposicionGemini(conPatronDeColor: boolean, conArmadoBouquet = false, conArmadoGuirnalda = false, piezas?: PiezasDeLosArmados): string {
  return [
    GEMINI_COMPOSITION_HARD_LOCK,
    ...(conPatronDeColor ? [GEMINI_COMPOSITION_PATTERN_LOCK] : []),
    ...(conArmadoBouquet ? [piezas ? candadoArmadoBouquet(piezas.bouquet) : GEMINI_COMPOSITION_ASSEMBLY_LOCK] : []),
    ...(conArmadoGuirnalda ? [piezas ? candadoArmadoGuirnalda(piezas.guirnalda) : GEMINI_COMPOSITION_GARLAND_LOCK] : []),
  ].join(" ");
}

type ClausulaConFrase = {
  colorPattern?: string;
  armadoBouquet?: { conRemate: boolean; conNumeros: boolean };
  armadoGuirnalda?: { conPatron: boolean; conRelleno: boolean; conRemates: boolean; soporte?: SoporteGuirnalda };
};

/**
 * Qué candados pide el caption de la etapa 1, leído de sus cláusulas: una
 * cláusula con `colorPattern` lleva un patrón de color, salvo que esa frase sea
 * la de un armado de bouquet (`armadoBouquet`) o solo la de un armado de
 * guirnalda sin patrón (`armadoGuirnalda.conPatron` falso). Sin armados es la
 * condición de siempre (`some(colorPattern)`).
 */
export function candadosDeComposicion(clauses: ReadonlyArray<ClausulaConFrase>): [conPatronDeColor: boolean, conArmadoBouquet: boolean] {
  return [
    clauses.some((clause) => Boolean(clause.colorPattern) && !clause.armadoBouquet && (!clause.armadoGuirnalda || clause.armadoGuirnalda.conPatron)),
    clauses.some((clause) => Boolean(clause.colorPattern) && Boolean(clause.armadoBouquet)),
  ];
}

function enAlto(soporte: SoporteGuirnalda | undefined): boolean {
  return soporte !== undefined && (SOPORTES_CON_CAIDA_GUIRNALDA as readonly SoporteGuirnalda[]).includes(soporte);
}

/**
 * Qué piezas llevan los armados del caption de la etapa 1, juntando todas sus
 * cláusulas con armado: el cuarto argumento de `hardLockComposicionGemini`.
 */
export function piezasDeLosArmados(clauses: ReadonlyArray<ClausulaConFrase>): PiezasDeLosArmados {
  const conFrase = clauses.filter((clause) => Boolean(clause.colorPattern));
  return {
    bouquet: {
      remate: conFrase.some((clause) => clause.armadoBouquet?.conRemate === true),
      numeros: conFrase.some((clause) => clause.armadoBouquet?.conNumeros === true),
    },
    guirnalda: {
      relleno: conFrase.some((clause) => clause.armadoGuirnalda?.conRelleno === true),
      remates: conFrase.some((clause) => clause.armadoGuirnalda?.conRemates === true),
      // Solo cuando hay una: sin guirnaldas en alto, las piezas de siempre.
      ...(conFrase.some((clause) => enAlto(clause.armadoGuirnalda?.soporte)) ? { enAlto: true } : {}),
    },
  };
}

/** Si el caption de la etapa 1 llevó el armado de alguna guirnalda (tercer candado de `hardLockComposicionGemini`). */
export function conArmadoGuirnaldaEnCaption(clauses: ReadonlyArray<ClausulaConFrase>): boolean {
  return clauses.some((clause) => Boolean(clause.colorPattern) && Boolean(clause.armadoGuirnalda));
}

/**
 * LoRA diseña la decoración sola; Gemini recibe luego su render y el venue.
 *
 * La cláusula de cierre es una subordinada, no una frase aparte: el corpus la
 * escribe dentro de la misma oración. Pegarla tal cual detrás de un caption que
 * ya termina en punto produce «grounded supports., set against…», que es un
 * registro que el modelo no vio nunca. Se quita el punto final antes de unir y
 * se cierra una sola vez.
 */
export function promptPresentacionFlux(prompt: string): string {
  const cuerpo = prompt.trimEnd().replace(/[.\s]+$/, "");
  return `${cuerpo}${FLUX_PRESENTATION_INSTRUCTION}`;
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
      id: "FLUX_DECORATION",
      descripcion: "LoRA render of the approved decoration on a white studio background.",
      role: "element_reference",
      priority: 1,
      allowed_use: "Approved quoted structures only. Transfer only their colors, proportions and arrangement into the venue. Never transfer white studio background, backdrop, drapes, furniture, tables, chairs, flowers, plants, pedestals or props.",
    },
  ];
}
