import { z } from "zod";

/**
 * Creativity calibration (0-5) chosen by hand in the UI. Creativity is how
 * much the design and the image fill in what the customer did NOT specify:
 * - the venue (indoor/outdoor, which kind) and the time of day;
 * - how many decorations and how complex the composition is;
 * - whether guests appear in the image;
 * - non-catalog styling around the decoration (flowers, candles, a dessert table).
 * Whatever the customer did specify always wins over the level.
 *
 * Single owner of the table read by the chat (design rule and scene
 * suggestion), the plan validation (structure range, extras over a reference
 * photo), the LoRA generation (prompt cues, fal.ai guidance scale), the
 * standard Gemini image prompt (art direction, allowed styling) and the visual
 * QA (that styling is not an unexpected element).
 * Level 2 reproduces the behavior before this calibration existed. Levels never
 * relax commercial invariants: real catalog products, backend prices and
 * quantities, mandatory colors, the budget and honest disclosure. The values
 * are design assumptions, not a calibrated scale.
 */

export const NIVELES_CREATIVIDAD = [0, 1, 2, 3, 4, 5] as const;
export type NivelCreatividad = (typeof NIVELES_CREATIVIDAD)[number];
export const CREATIVIDAD_POR_DEFECTO: NivelCreatividad = 2;

export const NivelCreatividadSchema = z.number().int().min(0).max(5).transform((nivel) => nivel as NivelCreatividad);

export type PerfilCreatividad = {
  nivel: NivelCreatividad;
  /** Customer-facing name of the level. */
  nombre: string;
  /** One-line customer-facing explanation. */
  descripcion: string;
  /** Extra design rule for the chat; empty at the default level. */
  instruccionDiseno: string;
  /** Balloon structures (instances) an open event plan should have without a reference photo. */
  rangoEstructuras: { min: number; max: number };
  /** Balloon structures a plan may add that the reference photo does not have. */
  estructurasExtraConReferencia: number;
  /** Server-picked venue/time suggestion for what the customer left unspecified. */
  sugiereEscena: boolean;
  /** Plain English cues for the LoRA prompt: styling, props, guests (no products, no text). */
  pistasPrompt: readonly string[];
  /** fal.ai flux-2 guidance scale. */
  guidanceScale: number;
  /**
   * Standard (Gemini) image prompt, build-image-prompt.ts. `direccion` is a
   * plain English art direction (camera, light, venue styling); empty at the
   * default level, which keeps the pre-calibration prompt. `ambientacion` is
   * the non-catalog styling the image may add around the approved balloon
   * structures; the visual QA does not count it as unexpected. Neither ever
   * adds, removes, merges or recolors a quoted structure.
   */
  imagen: { direccion: string; ambientacion: readonly AmbientacionImagen[] };
};

/**
 * Non-catalog styling a creative image may show. Each entry has the prompt cue
 * and the pattern that recognizes it in the visual QA observer's free-text
 * "unexpected element" list.
 */
export const AMBIENTACION_IMAGEN = {
  flores: { cue: "fresh flower arrangements on the floor or on surfaces already in the venue", patron: /\b(?:flowers?|floral|bouquets?|roses?|peon(?:y|ies)|greenery|foliage|plants?|vases?)\b/i },
  velas: { cue: "lit candles in simple holders", patron: /\b(?:candles?|candlesticks?|candelabras?|candle ?holders?|lanterns?|votives?)\b/i },
  mesa_postres: { cue: "one styled dessert table with a cake, set apart from the balloon structures", patron: /\b(?:dessert|cakes?|cupcakes?|sweets|pastr(?:y|ies)|tables?|tablecloths?|cake stands?)\b/i },
  invitados: { cue: "a few guests softly out of focus, never covering or touching the balloon structures", patron: /\b(?:guests?|people|persons?|crowd|wom[ae]n|m[ae]n|child(?:ren)?|girls?|boys?|couple|figures?)\b/i },
} as const satisfies Record<string, { cue: string; patron: RegExp }>;
export type AmbientacionImagen = keyof typeof AMBIENTACION_IMAGEN;

/**
 * Whether an observed "unexpected element" is styling allowed at this level.
 * Anything that names balloons, a balloon structure, signage, text or a
 * backdrop is never styling: those stay QA failures at every level.
 */
export function esAmbientacionPermitida(nivel: NivelCreatividad | undefined, observado: string): boolean {
  // The observer sometimes answers in snake_case ("tables_with_white_cloths").
  const descripcion = observado.replace(/_/g, " ");
  if (/\b(?:balloons?|arch(?:es)?|columns?|garlands?|hoops?|rings?|frames?|signs?|signage|banners?|letters?|lettering|text|words?|numbers?|logos?|backdrops?|curtains?|drapes?|panels?|neon)\b/i.test(descripcion)) return false;
  return perfilCreatividad(nivel).imagen.ambientacion.some((clave) => AMBIENTACION_IMAGEN[clave].patron.test(descripcion));
}

const INVARIANTES = "Lo que el cliente sí dijo (lugar, momento, colores, piezas, presupuesto) manda siempre sobre esta regla. Usa solo productos que devuelva buscar_catalogo_rag, no inventes precios ni cantidades y cuéntale en una frase lo que elegiste por tu cuenta (lugar, momento o piezas extra).";

const PERFILES: Record<NivelCreatividad, PerfilCreatividad> = {
  0: {
    nivel: 0,
    nombre: "Fiel",
    descripcion: "Solo lo que pediste: sin lugar ni hora inventados y decoración mínima.",
    instruccionDiseno: `No completes nada que el cliente no dijo: si no indicó lugar, usa espacio.tipo "interior" con fuente "supuesto"; si no indicó momento del día, no pongas concepto.momento_dia. Diseña solo las piezas pedidas o las de la foto (entre 1 y 3 estructuras), sin acentos ni ambientación extra. ${INVARIANTES}`,
    rangoEstructuras: { min: 1, max: 3 },
    estructurasExtraConReferencia: 0,
    sugiereEscena: false,
    pistasPrompt: [],
    guidanceScale: 4.5,
    imagen: { direccion: "Plain, true-to-life photograph of the installation: straight-on eye-level camera, even neutral light, a plain uncluttered venue corner; show only the approved balloon structures and nothing else around them.", ambientacion: [] },
  },
  1: {
    nivel: 1,
    nombre: "Sobrio",
    descripcion: "Completa lo mínimo con opciones neutras y decoración sencilla.",
    instruccionDiseno: `Si el cliente no indicó lugar, usa un salón interior; si no indicó momento, de día. Mantén la decoración sencilla: entre 2 y 4 estructuras, sin acentos extra sobre la foto. ${INVARIANTES}`,
    rangoEstructuras: { min: 2, max: 4 },
    estructurasExtraConReferencia: 0,
    sugiereEscena: false,
    pistasPrompt: [],
    guidanceScale: 4,
    imagen: { direccion: "Clean, understated event photo: eye-level camera, soft natural light, a tidy neutral venue with no added styling.", ambientacion: [] },
  },
  2: {
    nivel: 2,
    nombre: "Equilibrado",
    descripcion: "Fiel a lo pedido con criterio de diseño.",
    instruccionDiseno: "",
    rangoEstructuras: { min: 3, max: 5 },
    estructurasExtraConReferencia: 0,
    sugiereEscena: false,
    pistasPrompt: [],
    guidanceScale: 3.5,
    imagen: { direccion: "", ambientacion: [] },
  },
  3: {
    nivel: 3,
    nombre: "Creativo",
    descripcion: "Elige lugar y momento coherentes, suma un acento y flores.",
    instruccionDiseno: `Si el cliente no indicó lugar o momento del día, elige unos coherentes con el evento y regístralos en espacio.tipo y concepto.momento_dia. Diseña entre 3 y 6 estructuras con capas (fondo, laterales y mesa o piso) y, sobre una foto de referencia, suma como máximo 1 acento que la complemente. ${INVARIANTES}`,
    rangoEstructuras: { min: 3, max: 6 },
    estructurasExtraConReferencia: 1,
    sugiereEscena: false,
    pistasPrompt: ["fresh flower arrangements", "rich layered styling"],
    guidanceScale: 3,
    imagen: { direccion: "Styled event photograph: a flattering three-quarter camera angle and warm layered event lighting that make the approved structures look designed for the celebration.", ambientacion: ["flores"] },
  },
  4: {
    nivel: 4,
    nombre: "Muy creativo",
    descripcion: "Propone una escena distinta, más decoración, flores, velas e invitados.",
    instruccionDiseno: `Si el cliente no indicó lugar o momento, usa la SUGERENCIA DE ESCENA de abajo en espacio.tipo y concepto.momento_dia en vez de un salón genérico. Diseña una composición compleja de 4 a 7 estructuras repartidas en varias zonas (fondo, laterales, mesa, piso o entrada) y, sobre una foto de referencia, suma hasta 2 acentos. ${INVARIANTES}`,
    rangoEstructuras: { min: 4, max: 7 },
    estructurasExtraConReferencia: 2,
    sugiereEscena: true,
    pistasPrompt: ["fresh flower arrangements", "lit candles", "a few guests softly blurred in the background", "soft cinematic lighting"],
    guidanceScale: 2.5,
    imagen: { direccion: "Cinematic celebration photo: dramatic but natural event lighting with shallow depth of field, a lived-in party moment around the approved structures.", ambientacion: ["flores", "velas", "invitados"] },
  },
  5: {
    nivel: 5,
    nombre: "Libre",
    descripcion: "Sorprende: escena inesperada, decoración abundante y un ambiente con invitados.",
    instruccionDiseno: `Sorprende al cliente: si no indicó lugar o momento, usa la SUGERENCIA DE ESCENA de abajo, aunque sea poco típica para el evento. Diseña una decoración abundante y compleja de 5 a 8 estructuras en varias zonas, con variantes oficiales audaces (asimétricas o no densas) y, sobre una foto de referencia, hasta 3 acentos. ${INVARIANTES}`,
    rangoEstructuras: { min: 5, max: 8 },
    estructurasExtraConReferencia: 3,
    sugiereEscena: true,
    pistasPrompt: ["lush flower arrangements", "lit candles", "a styled dessert table", "guests celebrating around the decoration", "bold editorial composition"],
    guidanceScale: 2,
    imagen: { direccion: "Bold, dynamic celebration photograph: an unexpected camera angle, striking mood lighting and abundant styling around the approved structures, which stay the hero of the image.", ambientacion: ["flores", "velas", "mesa_postres", "invitados"] },
  },
};

export function perfilCreatividad(nivel: NivelCreatividad | undefined): PerfilCreatividad {
  return PERFILES[nivel ?? CREATIVIDAD_POR_DEFECTO];
}

/** Parses an untrusted value; anything invalid or absent is the default level. */
export function parseNivelCreatividad(valor: unknown): NivelCreatividad {
  const parsed = NivelCreatividadSchema.safeParse(valor);
  return parsed.success ? parsed.data : CREATIVIDAD_POR_DEFECTO;
}

/**
 * Level used to generate the image of an approved plan. The level recorded in
 * the signed plan token wins: the proposal (number of pieces, scene) was
 * designed with it, and the slider may have moved since. Plans signed before
 * the level was recorded fall back to the untrusted request value.
 */
export function nivelCreatividadParaGenerar(nivelPlan: number | null | undefined, valorSolicitud: unknown): NivelCreatividad {
  const firmado = NivelCreatividadSchema.safeParse(nivelPlan);
  return firmado.success ? firmado.data : parseNivelCreatividad(valorSolicitud);
}

/** Venue labels the visual context recognizes (visual-context.ts VENUE_PATTERNS). */
export const LUGARES_SUGERIBLES = ["jardín", "terraza", "playa", "hacienda", "parque", "salón", "hotel", "restaurante"] as const;
export const MOMENTOS_SUGERIBLES = ["día", "tarde", "atardecer", "noche"] as const;

export type SugerenciaEscena = { lugar?: (typeof LUGARES_SUGERIBLES)[number]; momento?: (typeof MOMENTOS_SUGERIBLES)[number] };

/**
 * Picks a venue and/or time of day for the dimensions the customer left open,
 * only at levels that suggest a scene. `aleatorio` returns [0, 1) and is
 * injected so tests are deterministic; each chat turn uses a fresh draw so high
 * creativity produces different scenes across proposals.
 */
export function sugerenciaEscena(
  nivel: NivelCreatividad,
  especificado: { lugar: boolean; momento: boolean },
  aleatorio: () => number = Math.random,
): SugerenciaEscena | undefined {
  if (!perfilCreatividad(nivel).sugiereEscena) return undefined;
  const elegir = <T>(opciones: readonly T[]): T => opciones[Math.min(opciones.length - 1, Math.floor(aleatorio() * opciones.length))]!;
  const sugerencia: SugerenciaEscena = {
    ...(especificado.lugar ? {} : { lugar: elegir(LUGARES_SUGERIBLES) }),
    ...(especificado.momento ? {} : { momento: elegir(MOMENTOS_SUGERIBLES) }),
  };
  return sugerencia.lugar || sugerencia.momento ? sugerencia : undefined;
}
