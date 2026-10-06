import type { ReferenceBBox, ReferenceBlueprintV2 } from "./reference-blueprint";
import type { LoraDensity, LoraDesignRole, LoraPlacement, LoraStructureType, VisualSemantics } from "../escena/lora-semantics";

/**
 * Typed structure detection for reference images.
 *
 * The reference analysis used to return a balloon structure only as
 * `balloon_structure` plus free-text shape, so the chat guessed the plan
 * structure types (two asymmetrical half-arches became "column + half-arch +
 * garland"). Gemini now returns these fields per balloon structure; this
 * module validates them and maps them deterministically to the existing
 * `visual_semantics` contract, which the chat and the LoRA compiler already
 * understand. Pure: no provider, HTTP or environment access.
 */

export const DETECTED_STRUCTURE_TYPES = [
  "arch", "half_arch", "column", "garland", "balloon_wall", "centerpiece",
  "ceiling_installation", "cluster", "sculpture", "bouquet", "hoop",
] as const;
export const DETECTED_OUTLINES = ["symmetric", "asymmetric"] as const;
export const DETECTED_DENSITIES = ["dense", "medium", "airy"] as const;
export const DETECTED_POSITIONS = ["left", "center", "right", "full_width"] as const;
export const DETECTED_HEIGHTS = ["short", "medium", "tall"] as const;
export const DETECTED_CURVES = ["left", "right", "none"] as const;
/** How far the top of a vertical piece reaches sideways past its base, relative to its height. */
export const DETECTED_OVERHANGS = ["none", "slight", "strong"] as const;
export const COMPOSITION_RELEVANCE = ["essential", "supporting", "minor"] as const;

export type DetectedStructure = {
  type: (typeof DETECTED_STRUCTURE_TYPES)[number];
  position: (typeof DETECTED_POSITIONS)[number];
  relativeHeight: (typeof DETECTED_HEIGHTS)[number];
  curvesToward: (typeof DETECTED_CURVES)[number];
  grounded: boolean;
  /** Irregular outline or one side heavier (official "asimétrico" variants). */
  outline: (typeof DETECTED_OUTLINES)[number];
  /**
   * Hacia dónde se va la pieza y cuánto, como **fracción de su altura**: negativo
   * a la izquierda, positivo a la derecha, 0 derecha y recta.
   *
   * Sale de lo que el modelo ya contesta —`curves_toward` da el lado y
   * `top_overhang` la cantidad— con las cifras del propio prompt: *slight* es
   * «10-35 %» y *strong* «over 35 %», así que se toma el medio de la banda y el
   * borde de la abierta. No se inventa ninguna escala nueva.
   *
   * Se calcula aparte de `curvesToward` a propósito: ese se anula en una columna
   * porque allí es evidencia de semiarco, y aquí hace falta justamente el lado
   * que allí se descarta.
   */
  inclina: number;
  /** Balloon packing: dense (no gaps) or airy (visible gaps). */
  density: (typeof DETECTED_DENSITIES)[number];
  /** Name of the element this one mirrors symmetrically, when there is one. */
  mirrors?: string;
  /** Sideways reach of the top of a vertical piece, as the model reported it. */
  topOverhang?: (typeof DETECTED_OVERHANGS)[number];
};

export type CompositionRelevance = (typeof COMPOSITION_RELEVANCE)[number];

/** JSON Schema fragment sent to the analysis model, kept next to its parser. */
export const DETECTED_STRUCTURE_TOOL_SCHEMA = {
  type: "object",
  description: "Only for balloon structures. Describe the built shape as seen, not the product.",
  properties: {
    structure_type: { type: "string", enum: [...DETECTED_STRUCTURE_TYPES] },
    horizontal_position: { type: "string", enum: [...DETECTED_POSITIONS] },
    relative_height: { type: "string", enum: [...DETECTED_HEIGHTS], description: "Compared with the other balloon structures in the same image." },
    curves_toward: { type: "string", enum: [...DETECTED_CURVES], description: "Direction the top of a half-arch or arch bends toward; none for straight pieces." },
    top_overhang: { type: "string", enum: [...DETECTED_OVERHANGS], description: "Vertical pieces only: how far the top reaches sideways past the base, compared with the piece height. none = under 10%, slight = 10-35% (a leaning or lumpy column), strong = over 35% (a real bend)." },
    grounded: { type: "boolean", description: "True when it stands on the floor." },
    outline: { type: "string", enum: [...DETECTED_OUTLINES], description: "asymmetric when the outline is irregular or one side is clearly heavier or taller." },
    density: { type: "string", enum: [...DETECTED_DENSITIES], description: "dense = no gaps between balloons; airy = visible gaps." },
    mirrors_element: { type: "string", description: "Name of the element it mirrors symmetrically, or none." },
  },
} as const;

export const STRUCTURE_DETECTION_RULES = `For every balloon structure also return \`structure\`: structure_type (arch = one continuous curve with two feet on the floor; half_arch = a single rising side whose top clearly bends sideways, open at the top or with only one foot; column = vertical stack whose top stays roughly above its base, even if the outline is lumpy or leans slightly; always return top_overhang for vertical pieces, it decides between half_arch and column); garland = loose organic run along a surface or the floor; balloon_wall; centerpiece; ceiling_installation; cluster; sculpture = a figure built from balloons such as an animal, number or character; bouquet = balloons tied together floating or on a weight; hoop = circular frame covered in balloons), outline (symmetric or asymmetric), density (dense, medium or airy), horizontal_position, relative_height compared with the other balloon structures, curves_toward, top_overhang, grounded, and mirrors_element. Two separate pieces that leave a visible gap between them are two elements, never one arch: for example a short leaning column on the left and a tall half-arch on the right curving toward it. horizontal_position full_width is only for one continuous piece (a balloon wall, an arch, a garland that runs unbroken across the scene); two columns, half-arches, garlands or bouquets on opposite sides are two elements, one left and one right. Balloons lying loose or scattered on the floor are not a garland or any other structure: name them "loose balloons" and omit structure. Foil balloons, figures, numbers or letters fixed onto a balloon wall or another balloon structure belong to that structure: mention them in its composition instead of returning a separate structure. Only real event balloon decoration is a balloon structure; a hot air balloon, a kite or a soap bubble is not. When one element groups several identical separate pieces (for example two columns side by side), set quantity to that count.
For every element return composition_relevance: essential (defines the composition), supporting (clearly visible styling such as string lights, foliage or props next to the decoration), or minor (negligible). Minor elements must use model_decision.action "omit".`;

/**
 * Recognizer prompt variants. `VARIANTE_PRODUCCION` is the one every route
 * uses; the others stay selectable for evaluation only. "v13" is the base text
 * alone (production until ADR-0029); the rest append their rules to it.
 */
export const VARIANTES_RECONOCEDOR = ["v13", "v14-candidato", "v15-candidato", "v16", "v17-lectura-unica", "v18-candidato", "v19-candidato", "v19b-candidato"] as const;
/**
 * `v17-lectura-unica` (candidata): v16 tal cual **más** las cuatro lecturas de
 * la foto dentro del mismo análisis (`lectura-unica.ts`). Es la única variante
 * que cambia también el esquema de la herramienta, así que `analysisConfigHash`
 * lo recibe; su texto incluye el de v16 sin tocarlo, de modo que la frontera
 * bouquet/centro de mesa que midió ADR-0029 es la misma.
 */
export const VARIANTE_LECTURA_UNICA: VarianteReconocedor = "v17-lectura-unica";
export type VarianteReconocedor = (typeof VARIANTES_RECONOCEDOR)[number];
/**
 * `v18-candidato` (UI-3, 2026-10-05; solo evaluación): v17 tal cual —texto de v16 y lecturas— **más**
 * `STRUCTURE_RULES_V18_CANDIDATE`. Nace de la línea base de images-judge: dos semiarcos en espejo leídos como
 * una sola pieza (CASE-002, 8 de 8), una columna leída como guirnalda (CASE-005, 5 de 5 en v17), una pieza
 * colgante leída como columna (CASE-003) y un aro ralo leído `medium`/`dense` (CASE-007, 8 de 8). Promoverla
 * es decisión de una persona tras medirla contra la línea base (AGENTS.md).
 */
export const VARIANTE_V18_CANDIDATA: VarianteReconocedor = "v18-candidato";
/**
 * `v19-candidato` (2026-10-06; evaluación aprobada por el dueño, que también aprobó promoverla si cumple el
 * criterio del anexo E): v18 tal cual **más** `STRUCTURE_RULES_V19_CANDIDATE`. Nace de la validación final: el
 * orden de los bloques de color de un semiarco salía desde la punta o desde el pie según la corrida (CASE-002) y
 * el motor pone el primer color en el pie; una pared de globos se leía guirnalda (CASE-007) y un racimo de pared,
 * bouquet de helio (foto 3 de la Fase 7). El aro colgado no necesitó regla: la lectura ya decía `grounded` false.
 */
export const VARIANTE_V19_CANDIDATA: VarianteReconocedor = "v19-candidato";
/**
 * `v19b-candidato` (2026-10-06): v18 **más solo** la regla del orden de color (`STRUCTURE_RULE_V19B_ORDEN_COLOR`).
 * v19 entera no cumplió el criterio (anexo E): el orden mejoró en CASE-002 (pie primero 4/6 frente a 1/6) pero sus
 * reglas de pared y racimo bajaron el tipo de 33/48 a 29/48 (CASE-007 de 3/6 a 1/6).
 */
export const VARIANTE_V19B_CANDIDATA: VarianteReconocedor = "v19b-candidato";
/**
 * La variante que usa la ruta `/api/references/analyze` con `LECTURA_UNICA_REFERENCIA_ENABLED`. Promovida a v18
 * el 2026-10-05 por decisión del dueño, sobre la línea base sin etiquetas de images-judge (tipo 33/48 frente a
 * 29/48 de v17, n = 6; riesgo conocido: CASE-004 1/6 frente a 3/6). Volver atrás es poner aquí
 * `VARIANTE_LECTURA_UNICA`: el esquema de la herramienta y el validador de Python son los mismos.
 */
export const VARIANTE_RUTA_ANALISIS: VarianteReconocedor = VARIANTE_V18_CANDIDATA;
/** Las variantes que piden las cuatro lecturas de la foto (esquema de herramienta con `lecturas`). */
export function varianteConLecturas(variante: VarianteReconocedor): boolean {
  return variante === VARIANTE_LECTURA_UNICA || variante === VARIANTE_V18_CANDIDATA || variante === VARIANTE_V19_CANDIDATA || variante === VARIANTE_V19B_CANDIDATA;
}
/** ADR-0029: v16 separates bouquet from centerpiece (89 % vs 80 % on 105 photos). */
export const VARIANTE_PRODUCCION: VarianteReconocedor = "v16";

/**
 * Candidate rules appended to the detection rules only when a caller asks for
 * "v14-candidato" (Plan A validation, 2026-09-15). They address the confusions
 * measured on 155 photos: gift-style bouquets read as centerpieces or sculptures,
 * half-arches wrapped over a backdrop read as columns, and accent clusters or
 * foil pieces returned as separate structures. Production stays on v13 until an
 * evaluation promotes this text.
 */
export const STRUCTURE_RULES_V14_CANDIDATE = `Clarifications that override the definitions above when they conflict:
- bouquet = one compact, freestanding balloon arrangement built as a single gift or accent piece: usually a stacked base of round balloons with a foil, bubble or number balloon on top and optional twisted or spiral long balloons; it can stand on the floor or on any table. Return bouquet for that whole piece, including any foil numbers, letters or bubble balloons on it. Floating helium balloons tied together are also a bouquet.
- centerpiece = a small, low arrangement that decorates a dining or guest table as part of the table setting, usually repeated on several tables or surrounded by plates, glasses or table linen. A single standalone gift-style arrangement is a bouquet, not a centerpiece, even when it sits on a table.
- sculpture = a recognizable figure whose shape is built from the balloons themselves (an animal, a character, a car, a flower, a number made of latex balloons). Foil number or letter balloons placed on top of a balloon base do not make a sculpture: that piece is a bouquet.
- arch requires both ends to reach the floor or a base. A garland that rises on one side of a backdrop, panel or frame and wraps over its top edge, ending in the air or on top of the backdrop, is a half_arch even when the sideways reach looks short; use column only when the top ends without bending over anything.
- small balloon clusters touching or right next to a larger balloon structure (at its base, its ends or along it) and balloons hanging inside a ceiling installation are part of that structure: describe them in its composition and never return them as separate cluster or bouquet elements.`;

/**
 * v15 candidate: only the bouquet / centerpiece boundary, with the business rule
 * given by the user (2026-09-15) — a centerpiece is more compact and holds
 * fewer balloons; a bouquet is a larger, balloon-heavy arrangement. v14 showed
 * that placement-based wording and "foil on a base" rules turned centerpieces
 * and topped columns into bouquets, so this text keeps columns explicitly out.
 */
export const STRUCTURE_RULES_V15_CANDIDATE = `Clarification for compact balloon arrangements (it overrides the bouquet and centerpiece definitions above):
- Decide between centerpiece and bouquet by size and balloon load, not by where the piece stands.
- centerpiece = a compact arrangement with a low balloon load: few balloons in total (roughly up to a dozen), for example a single bubble or foil balloon on a small base, or a handful of helium balloons tied to a weight. It stays small relative to the table or furniture it sits on.
- bouquet = a larger, balloon-heavy arrangement: many balloons packed together (a full stacked base of several round balloons, several toppers or twisted accents, or a big cloud of helium balloons). It reads as a statement piece on its own.
- When unsure between the two, prefer centerpiece for a small piece with visible gaps or few balloons, and bouquet for a large dense piece.
- A tall vertical stack of balloons whose top stays above its base is a column, even with a foil balloon on top; never call it a bouquet or centerpiece.`;

/**
 * v16: v15's bouquet / centerpiece rule, with the column guard narrowed. In
 * v15 "tall vertical stack = column" also caught tall centerpieces and
 * bouquets (5 + 5 analyses turned into columns). Production since ADR-0029:
 * the text is byte-frozen, its hash is the one the evaluation measured.
 */
export const STRUCTURE_RULES_V16 = `Clarification for compact balloon arrangements (it overrides the bouquet and centerpiece definitions above):
- Decide between centerpiece and bouquet by size and balloon load, not by where the piece stands.
- centerpiece = a compact arrangement with a low balloon load: few balloons in total (roughly up to a dozen), for example a single bubble or foil balloon on a small base, or a handful of helium balloons tied to a weight. It stays small relative to the table or furniture it sits on.
- bouquet = a larger, balloon-heavy arrangement: many balloons packed together (a full stacked base of several round balloons, several toppers or twisted accents, or a big cloud of helium balloons). It reads as a statement piece on its own.
- When unsure between the two, prefer centerpiece for a small piece with visible gaps or few balloons, and bouquet for a large dense piece.
- column = a slim freestanding pillar of stacked balloons that stands directly on the floor and reaches roughly the height of a standing adult or more; it may carry a foil balloon on top. A piece that sits on a table or furniture, or a short, wide piece built around a base with toppers, is a centerpiece or bouquet, not a column, even if it is taller than it is wide.`;

/**
 * v18 candidate (solo evaluación, ver `VARIANTE_V18_CANDIDATA`). Cada regla es una frontera entre dos tipos que
 * la línea base confundió, escrita para cualquier foto y no para un caso: no nombra colores, lugares ni
 * cantidades de un caso concreto.
 */
export const STRUCTURE_RULES_V18_CANDIDATE = `Clarifications for vertical and framing pieces (they override the definitions above when they conflict):
- Before returning one arch, follow the balloons over the top. Return arch only when they run unbroken from one foot, over the top, down to the other foot. Two pieces that rise from the floor on both sides of an opening, a niche, a doorway, a backdrop or a table and bend toward each other are two half_arch elements, one left and one right, with mirrors_element naming each other, whenever their tops do not join into one continuous run, even when the gap between the tops is small or the photo frames both together. Never draw one bounding box around two such pieces.
- Decide garland against column and half_arch by the axis the piece runs along. A garland runs along a surface horizontally or diagonally, or drapes in a swag. A piece standing on the floor that runs mostly upward, clearly taller than it is wide, is a column (top above its base) or a half_arch (top bending sideways), even when it is organic, lumpy, irregular or leans against a wall or backdrop; never call it a garland.
- A run of balloons that hangs down from above or climbs the edge of a backdrop, frame or wall without standing on the floor or on its own base is not a column: it is a half_arch when it bends over the top edge, otherwise a garland. Return grounded false for it and keep its real direction: a piece that runs mostly up and down stays vertical.
- density of a hoop or any frame covered with balloons: airy when the bare ring or frame shows between the balloons or the balloons cover less than about half of it; medium when the balloons cover most of it with small gaps; dense only when the frame is completely hidden.`;

/**
 * v19 candidate (ver `VARIANTE_V19_CANDIDATA`). Mismas reglas de escritura que v18: fronteras generales, sin
 * colores, lugares ni cantidades de un caso.
 */
export const STRUCTURE_RULES_V19_CANDIDATE = `Clarifications for color order and wall pieces (they override the definitions above when they conflict):
- For a half_arch or a column, the start of the piece is its foot on the floor: list the colors, weights and stops of lecturas.patron_color from the foot upward to the top, never from the top down.
- Balloons that cover a wall as a flat or lumpy surface, much wider than a single run of clusters, are a balloon_wall, not a garland, even when the surface is organic or irregular.
- A loose group of balloons fixed against a wall, with no base, no weight and no ribbons, is a cluster, not a bouquet.`;

/** v19b candidate: solo la regla de orden de color de v19, con el mismo texto. */
export const STRUCTURE_RULE_V19B_ORDEN_COLOR = `Clarification for color order (it overrides the definitions above when they conflict):
- For a half_arch or a column, the start of the piece is its foot on the floor: list the colors, weights and stops of lecturas.patron_color from the foot upward to the top, never from the top down.`;

function oneOf<T extends readonly string[]>(values: T, value: unknown): T[number] | undefined {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return (values as readonly string[]).includes(text) ? text as T[number] : undefined;
}

/**
 * Cuánto se va la pieza hacia un lado, en fracción de su altura y con signo.
 *
 * Las dos cifras son las del prompt (`top_overhang`): *slight* = 10-35 % → se
 * toma 22 %, el medio de la banda; *strong* = más del 35 % → se toma 45 %, un
 * poco dentro de la banda abierta. Sin lado o sin cantidad, 0: una pieza recta.
 */
const INCLINACION_POR_VUELO: Record<(typeof DETECTED_OVERHANGS)[number], number> = { none: 0, slight: 0.22, strong: 0.45 };

function inclinacionDe(
  hacia: (typeof DETECTED_CURVES)[number],
  vuelo: (typeof DETECTED_OVERHANGS)[number] | undefined,
): number {
  if (hacia === "none" || !vuelo) return 0;
  return (hacia === "left" ? -1 : 1) * INCLINACION_POR_VUELO[vuelo];
}

/**
 * Lo que la foto DIJO de la inclinación de la pieza, o `undefined` si no dijo nada.
 *
 * `inclina` vale 0 por dos motivos distintos: la foto muestra la pieza recta, o
 * el modelo no dio dirección (vuelo leve sin lado, pieza que no es vertical).
 * Solo lo primero es un dato: el modelo contestó `top_overhang: none` (menos del
 * 10 % de la altura). El motor de la columna asimétrica arranca inclinado si no
 * recibe nada, así que "recta observada" tiene que viajar como 0 y "sin dato"
 * como ausencia.
 */
export function inclinacionObservada(estructura: Pick<DetectedStructure, "inclina" | "topOverhang"> | undefined): number | undefined {
  if (!estructura) return undefined;
  if (estructura.inclina !== 0) return estructura.inclina;
  return estructura.topOverhang === "none" ? 0 : undefined;
}

/** Validates the model's `structure` object; anything malformed is discarded, never guessed. */
export function parseDetectedStructure(raw: unknown): DetectedStructure | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const type = oneOf(DETECTED_STRUCTURE_TYPES, value.structure_type ?? value.type);
  if (!type) return undefined;
  const mirrors = typeof value.mirrors_element === "string" ? value.mirrors_element.trim().slice(0, 160) : "";
  // half_arch vs column flipped between runs of the same photo. The ordinal
  // overhang decides it deterministically: only a strong sideways reach is a
  // half-arch; a slight lean is an irregular (asymmetrical) column.
  const overhang = oneOf(DETECTED_OVERHANGS, value.top_overhang);
  const vertical = type === "half_arch" || type === "column";
  const resolvedType = vertical && overhang ? (overhang === "strong" ? "half_arch" : "column") : type;
  const leaningColumn = resolvedType === "column" && overhang === "slight";
  return {
    type: resolvedType,
    position: oneOf(DETECTED_POSITIONS, value.horizontal_position ?? value.position) ?? "center",
    relativeHeight: oneOf(DETECTED_HEIGHTS, value.relative_height) ?? "medium",
    curvesToward: resolvedType === "column" && overhang ? "none" : oneOf(DETECTED_CURVES, value.curves_toward) ?? "none",
    grounded: value.grounded !== false,
    outline: leaningColumn ? "asymmetric" : oneOf(DETECTED_OUTLINES, value.outline) ?? "symmetric",
    inclina: inclinacionDe(oneOf(DETECTED_CURVES, value.curves_toward) ?? "none", overhang),
    density: oneOf(DETECTED_DENSITIES, value.density) ?? "medium",
    mirrors: mirrors && !/^(?:none|null|n\/a|no)$/i.test(mirrors) ? mirrors : undefined,
    ...(vertical && overhang ? { topOverhang: overhang } : {}),
  };
}

export function parseCompositionRelevance(raw: unknown): CompositionRelevance | undefined {
  return oneOf(COMPOSITION_RELEVANCE, raw);
}

const STRUCTURE_TYPE_MAP: Record<DetectedStructure["type"], LoraStructureType> = {
  arch: "arco",
  half_arch: "semiarco",
  column: "columna",
  garland: "guirnalda",
  balloon_wall: "pared",
  centerpiece: "centro_mesa",
  ceiling_installation: "guirnalda",
  cluster: "kit",
  // Plan 1.0 has no bouquet or sculpture type: both are built as a declared kit
  // and recognized by their official name (see estructuras-oficiales.ts).
  sculpture: "kit",
  bouquet: "kit",
  hoop: "arco",
};

/** Horizontal side of a bbox by its center; the middle 20% counts as center. */
export function sideFromBBox(bbox: ReferenceBBox): "left" | "center" | "right" {
  const center = bbox.x + bbox.width / 2;
  return center < 0.4 ? "left" : center > 0.6 ? "right" : "center";
}

function placementFor(structure: DetectedStructure, bbox: ReferenceBBox): LoraPlacement {
  if (structure.type === "ceiling_installation") return "techo";
  if (structure.type === "centerpiece") return "sobre_mesa_principal";
  // A low, short run at the bottom of the frame lies on the floor even when it
  // spans the whole width; this rule used to run after `full_width` and sent
  // floor garlands to the back wall.
  const lowOnFloor = bbox.y + bbox.height >= 0.75 && bbox.height <= 0.35;
  if (structure.type === "garland" && lowOnFloor) return "piso_frontal";
  if (structure.type === "bouquet" || structure.type === "sculpture") return structure.position === "left" ? "lateral_izquierdo" : structure.position === "right" ? "lateral_derecho" : "piso_frontal";
  // A hoop the photo shows hanging (grounded false) is mounted on the wall, not standing on a stand: the
  // analysis read it right (CASE-007, 6 of 6 runs) and the placement dropped it, so the scene guide drew it
  // on a pole and raised the floor line to mid-canvas (2026-10-06). `reubicarAros` puts it back in the
  // center when the photo's wall is already taken by a backdrop or another piece.
  if (structure.type === "hoop" && !structure.grounded) return "fondo_pared";
  // A balloon arch (or hoop) is a freestanding piece: equivalent photos came
  // back as "against the back wall" or "in the center" depending on whether
  // the model called it full_width.
  if (structure.type === "arch" || structure.type === "hoop") return "arco_central";
  if (structure.type === "balloon_wall") return "fondo_pared";
  // A single vertical piece is never full-width or centered by itself when its
  // bbox sits clearly on one side (a left half-arch came back as "fondo").
  const vertical = structure.type === "half_arch" || structure.type === "column";
  const position = vertical && structure.position !== "left" && structure.position !== "right" && sideFromBBox(bbox) !== "center"
    ? sideFromBBox(bbox)
    : structure.position;
  if (position === "full_width") return "fondo_pared";
  if (position === "left") return "lateral_izquierdo";
  if (position === "right") return "lateral_derecho";
  return "arco_central";
}

/** Soporte de una guirnalda según su lectura en la foto (`LecturaGuirnaldaSchema.soporte`). */
export type SoporteGuirnaldaLeido = "pared" | "colgada" | "piso" | "mesa" | "sobre_estructura";

/** Mueble de la foto (una caja de `furniture` o `plinth`); `mesa` si su nombre lo dice. */
export type MuebleEnFoto = { bbox: ReferenceBBox; mesa: boolean };

const MESA = /\b(?:table|tables|mesa|mesas|desk|counter)\b/i;

function solapeHorizontal(a: ReferenceBBox, b: ReferenceBBox): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
}

/** La guirnalda descansa sobre la mesa: su borde de abajo cae en la mitad de arriba de la mesa y la cubre a lo ancho. */
function sobreLaMesa(guirnalda: ReferenceBBox, mesa: ReferenceBBox): boolean {
  const abajo = guirnalda.y + guirnalda.height;
  return abajo >= mesa.y - 0.05
    && abajo <= mesa.y + mesa.height * 0.5
    && guirnalda.width > 0
    && solapeHorizontal(guirnalda, mesa) / guirnalda.width >= 0.5;
}

/**
 * Ubicación de una guirnalda refinada después del análisis (ADR-0032, E4): la
 * extensión de `placementFor` para guirnaldas, que corre como posproceso cuando
 * la lectura de la guirnalda está encendida (`reubicarGuirnaldas`). El prompt
 * del reconocedor (v16) no cambia, ni `placementFor`: apagada la lectura, la
 * ubicación es byte a byte la de siempre.
 *
 * La salida se queda en el vocabulario de Plan 1.0 (`UBICACIONES` de
 * `src/lib/plan/tipos.ts`): el plan del chat y `plan-resolution.v1` solo
 * admiten ese, y el prompt del sistema manda copiar la ubicación tal cual
 * (hallazgo 12). Por eso no hay `recorrido_suelo` ni `alrededor_mobiliario`.
 *
 * - Con soporte leído: `mesa` es `sobre_mesa_principal`; `piso` es
 *   `piso_frontal`; `pared` saca a la guirnalda del piso o de la mesa
 *   (`fondo_pared`) salvo que otra pieza de su foto ya esté en `fondo_pared`
 *   (`fondoOcupado`: el plan admite una sola), y respeta un lado ya leído.
 * - Sin soporte (o colgada, o sobre otra pieza), por la geometría: sobre una
 *   mesa detectada es `sobre_mesa_principal`.
 */
export function refinarPlacementGuirnalda(
  actual: LoraPlacement,
  bbox: ReferenceBBox,
  muebles: readonly MuebleEnFoto[],
  soporte?: SoporteGuirnaldaLeido,
  fondoOcupado = false,
): LoraPlacement {
  if (actual === "techo" || actual === "techo_multipunto") return actual;
  if (soporte === "mesa") return "sobre_mesa_principal";
  if (soporte === "piso") return "piso_frontal";
  if (soporte === "pared") {
    return !fondoOcupado && (actual === "piso_frontal" || actual === "sobre_mesa_principal") ? "fondo_pared" : actual;
  }
  if (muebles.some((mueble) => mueble.mesa && sobreLaMesa(bbox, mueble.bbox))) return "sobre_mesa_principal";
  return actual;
}

/** Categorías que el plan pone siempre en `fondo_pared` (un backdrop, `tipos.ts`). */
const CATEGORIAS_DE_FONDO: ReadonlySet<string> = new Set(["backdrop", "curtain", "drape", "panel"]);

/**
 * El blueprint con la ubicación de cada guirnalda refinada por
 * `refinarPlacementGuirnalda`, con su lectura (`appearance.armado_guirnalda`,
 * si es confiable) y los muebles de su misma foto. Una foto con una pieza
 * aprobada en `fondo_pared` (o un backdrop) no recibe otra: el plan admite una
 * sola. Devuelve el mismo objeto si nada cambia; nunca modifica el recibido.
 */
export function reubicarGuirnaldas(entrada: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  // Primero los aros colgados: si se quedan en la pared, la guirnalda tiene que ver ese fondo ocupado.
  const blueprint = reubicarAros(entrada);
  const muebles = new Map<string, MuebleEnFoto[]>();
  const fondoOcupado = new Set<string>();
  for (const elemento of blueprint.elements) {
    if (elemento.approved && (elemento.visual_semantics?.placement === "fondo_pared" || CATEGORIAS_DE_FONDO.has(elemento.category))) {
      fondoOcupado.add(elemento.source_image_id);
    }
    if (elemento.category !== "furniture" && elemento.category !== "plinth") continue;
    const lista = muebles.get(elemento.source_image_id) ?? [];
    lista.push({ bbox: elemento.reference_bbox, mesa: MESA.test(elemento.name) });
    muebles.set(elemento.source_image_id, lista);
  }
  let cambio = false;
  const elements = blueprint.elements.map((elemento) => {
    const semantica = elemento.visual_semantics;
    if (!elemento.approved || elemento.category !== "balloon_structure" || semantica?.structure_type !== "guirnalda") return elemento;
    const lectura = elemento.appearance.armado_guirnalda;
    const soporte = lectura && lectura.confianza >= 0.5 ? lectura.soporte : undefined;
    const placement = refinarPlacementGuirnalda(semantica.placement, elemento.reference_bbox, muebles.get(elemento.source_image_id) ?? [], soporte, fondoOcupado.has(elemento.source_image_id));
    if (placement === "fondo_pared") fondoOcupado.add(elemento.source_image_id);
    if (placement === semantica.placement) return elemento;
    cambio = true;
    return { ...elemento, visual_semantics: { ...semantica, placement } };
  });
  return cambio ? { ...blueprint, elements } : blueprint;
}

/**
 * El aro colgado (`placementFor`: un `hoop` con `grounded` false va a `fondo_pared`) vuelve a `arco_central`
 * cuando su foto ya tiene el fondo ocupado: un backdrop, una cortina, un panel u otra pieza en `fondo_pared`.
 * El plan admite una sola estructura en `fondo_pared` (`tipos.ts`). Un `arco` en `fondo_pared` solo puede
 * venir de esa regla: el arco de pie siempre va a `arco_central`. Devuelve el mismo objeto si nada cambia.
 */
export function reubicarAros(blueprint: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  const esAroColgado = (elemento: ReferenceBlueprintV2["elements"][number]) =>
    elemento.approved && elemento.visual_semantics?.structure_type === "arco" && elemento.visual_semantics.placement === "fondo_pared";
  let cambio = false;
  const elements = blueprint.elements.map((elemento) => {
    if (!esAroColgado(elemento)) return elemento;
    const otroFondo = blueprint.elements.some((otro) => otro !== elemento && otro.approved && otro.source_image_id === elemento.source_image_id
      && (CATEGORIAS_DE_FONDO.has(otro.category) || otro.visual_semantics?.placement === "fondo_pared"));
    if (!otroFondo) return elemento;
    cambio = true;
    return { ...elemento, visual_semantics: { ...elemento.visual_semantics!, placement: "arco_central" as const } };
  });
  return cambio ? { ...blueprint, elements } : blueprint;
}

/** Soportes de una guirnalda que la apoyan en algo: una columna se sostiene sola en el piso o en una mesa. */
const SOPORTES_APOYADOS: ReadonlySet<string> = new Set(["pared", "colgada", "sobre_estructura"]);
/**
 * Las formas de la lectura que dicen que la pieza se DOBLA por encima de algo («u_invertida»: enmarca desde
 * arriba con los dos lados cayendo) o cuelga entre anclajes («arco_caido»). «curva» es «one gentle curve»
 * (`lectura-unica.ts`) y «ondulada» sube y baja: las dos describen también una columna orgánica que se inclina
 * o tiene el contorno irregular, que es justo lo que el análisis ya dijo con `top_overhang: slight` («a leaning or
 * lumpy column»). CASE-002 (2026-10-06): dos columnas orgánicas inclinadas ~12° junto a un nicho, leídas
 * «curva, sobre_estructura», salían semiarcos y la imagen pintaba dos ganchos.
 */
const FORMAS_QUE_SE_DOBLAN: ReadonlySet<string> = new Set(["u_invertida", "arco_caido"]);

/**
 * El blueprint con cada "columna" que en realidad es un semiarco: una pieza que la misma lectura de la foto
 * describe como guirnalda (`appearance.armado_guirnalda` confiable) apoyada en una pared o en otra pieza y que
 * se dobla por encima de algo (`FORMAS_QUE_SE_DOBLAN`). El análisis le pone el tipo por la silueta, y una guirnalda que trepa por un lado de un panel y
 * se curva por arriba se ve alta y estrecha: la foto 3 de las pruebas del 2026-10-05 salió "columna" con su
 * lectura de guirnalda en U invertida sobre el panel (0,92), y el plan la armó, compró y dibujó como una columna
 * inclinada. La misma pieza al otro lado (foto 4) salió "semiarco". La lectura de guirnalda solo se pide para
 * guirnaldas, arcos y semiarcos ("omit it for a column", `lectura-unica.ts`), así que su presencia es la
 * señal. La forma visible pasa a decir "half-arch" para que el plan no lea dos tipos. Nunca modifica el
 * recibido; devuelve el mismo objeto si nada cambia.
 */
export function reclasificarColumnasConGuirnalda(blueprint: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  let cambio = false;
  const elements = blueprint.elements.map((elemento) => {
    const semantica = elemento.visual_semantics;
    const lectura = elemento.appearance.armado_guirnalda;
    if (!elemento.approved || elemento.category !== "balloon_structure" || semantica?.structure_type !== "columna") return elemento;
    if (!lectura || lectura.confianza < 0.5 || !SOPORTES_APOYADOS.has(lectura.soporte)) return elemento;
    // Una curva suave es una columna inclinada si nace del suelo (CASE-002); si la pieza no toca el suelo y trepa
    // por un respaldo, es el semiarco que describe la regla v18 (CASE-004: con columna la imagen empeoró de 38 a 27
    // en el juez). El apoyo viaja en la forma visible, que escribe `shapeDescription` a partir de `grounded`.
    const separadaDelSuelo = /\braised off the floor\b/i.test(elemento.appearance.shape);
    if (!FORMAS_QUE_SE_DOBLAN.has(lectura.forma) && !(lectura.forma === "curva" && separadaDelSuelo)) return elemento;
    cambio = true;
    return {
      ...elemento,
      visual_semantics: { ...semantica, structure_type: "semiarco" as const },
      appearance: { ...elemento.appearance, shape: elemento.appearance.shape.replace(/\bcolumn\b/i, "half-arch") },
    };
  });
  return cambio ? { ...blueprint, elements } : blueprint;
}

export function shapeDescription(structure: DetectedStructure): string {
  const noun = structure.type === "half_arch" ? "half-arch" : structure.type === "hoop" ? "circular hoop" : structure.type.replace(/_/g, " ");
  const qualifiers = [structure.relativeHeight, structure.density === "dense" ? "dense" : structure.density === "airy" ? "airy" : "", structure.outline === "asymmetric" ? "asymmetrical" : ""].filter(Boolean).join(" ");
  const parts = [`${qualifiers} ${noun}`, structure.position === "full_width" ? "spanning the full width" : `on the ${structure.position}`];
  if (structure.curvesToward !== "none") parts.push(`curving toward the ${structure.curvesToward}`);
  if (structure.topOverhang) parts.push(structure.topOverhang === "none" ? "no top overhang" : `${structure.topOverhang} top overhang`);
  parts.push(structure.grounded ? "standing on the floor" : "raised off the floor");
  if (structure.mirrors) parts.push(`mirroring ${structure.mirrors}`);
  return parts.join(", ").slice(0, 160);
}

type ElementForSemantics = {
  elementId: string;
  bbox: ReferenceBBox;
  structure?: DetectedStructure;
};

/**
 * Maps detected structures to `visual_semantics`. The largest balloon
 * structure is focal; the rest support it. Elements without a detected
 * structure keep no semantics, so nothing is invented for them.
 */
export function referenceStructureSemantics(
  elements: ElementForSemantics[],
  density: ReferenceBlueprintV2["composition"]["density"],
): Map<string, VisualSemantics> {
  const structures = elements.filter((element): element is ElementForSemantics & { structure: DetectedStructure } => Boolean(element.structure));
  const focal = [...structures].sort((a, b) => b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height)[0];
  const loraDensity: LoraDensity = density === "dense" ? "lujosa" : density === "sparse" ? "sencilla" : "media";
  return new Map(structures.map((element) => {
    const role: LoraDesignRole = element === focal ? "focal" : element.structure.type === "centerpiece" ? "acento" : "soporte";
    return [element.elementId, {
      structure_type: STRUCTURE_TYPE_MAP[element.structure.type],
      placement: placementFor(element.structure, element.bbox),
      design_role: role,
      repetition_group: element.elementId,
      density: element.structure.density === "dense" ? "lujosa" : element.structure.density === "airy" ? "sencilla" : loraDensity,
    } satisfies VisualSemantics];
  }));
}

const AMBIENT_CATEGORIES = new Set(["lighting", "floral", "furniture", "plinth", "tableware", "other"]);
// Plurals count: "wooden signs" carries lettering just like "sign".
const NON_RENDERABLE_TEXT = /\b(?:signs?|signage|letters?|lettering|texts?|names?|logos?|words?|messages?|banners?|numbers?|prices?|printed|writing)\b/i;
/** The analysis answers in English; a Spanish name would leak untranslated text into the LoRA prompt. */
const SPANISH_WORDS = /\b(?:de|del|la|las|los|el|con|y|para|globos?|hojas?|luces|luz|flores?|velas?|mesa|cortina)\b/i;

/**
 * Renderable English name for a styling element, or undefined. Parenthetical
 * details ("tropical leaves (monstera)") and list punctuation are dropped
 * instead of discarding the whole element; anything that names text or
 * signage, or is not plain English, is still rejected.
 */
export function ambientDecorName(raw: string): string | undefined {
  const name = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    // The analysis sometimes names elements in snake_case ("navy_arched_backdrop_panel"): an identifier, not a
    // non-English name. Rejecting it dropped the photo's backdrop panel (Fase 7, 2026-10-06).
    .replace(/[,;/_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a|an|the|some) /, "");
  // Balloons are never ambient styling: they are quoted plan structures.
  // Signage is checked on the normalized name too: in "congrats_grad_neon_sign" `\bsign\b` has no word boundary.
  if (!/^[a-z][a-z -]{2,48}$/.test(name) || NON_RENDERABLE_TEXT.test(raw) || NON_RENDERABLE_TEXT.test(name) || SPANISH_WORDS.test(name) || /\bballoons?\b/.test(name)) return undefined;
  return name;
}

const MATERIAL_MADERA = /\b(?:wooden|wood)\b/;
const TONO_MADERA = /\b(?:wood|wooden|brown|oak|walnut|natural|tan|honey|teak|mahogany|chestnut|timber)\b/i;
const COLOR_LEGIBLE = /^[a-z][a-z -]{2,24}$/;

/**
 * El nombre de una pieza de escenografía con el color que se VE en vez del material (2026-10-06). El análisis
 * llama «arch wooden backdrop wall» a un panel de madera pintado de lavanda claro (CASE-002) y FLUX pintaba madera
 * natural: un portón que la foto no tiene. Si ningún color observado es un tono de madera, «wooden» se cambia por
 * el primer color observado. Con un tono de madera, o sin colores, el nombre se queda igual.
 */
export function nombreConSuColor(nombre: string, observados: readonly string[]): string {
  if (!MATERIAL_MADERA.test(nombre) || observados.some((color) => TONO_MADERA.test(color))) return nombre;
  const color = observados.map((c) => c.trim().toLowerCase()).find((c) => COLOR_LEGIBLE.test(c) && !NON_RENDERABLE_TEXT.test(c));
  if (!color) return nombre;
  return `${color} ${nombre.replace(MATERIAL_MADERA, " ").replace(/\s+/g, " ").trim()}`;
}

export type AmbientDecorItem = { elementId: string; name: string };

/* ---------------------------------------------------------------------------
 * FRONTERA PLAN / ESCENOGRAFÍA — regla de negocio (2026-09-16)
 *
 * El PLAN es el único dueño de lo que se construye y se cobra. La
 * ESCENOGRAFÍA es lo que se conserva de la foto de referencia: entra en el
 * prompt de imagen, lleva caja, el cliente la enciende o la apaga, y NUNCA
 * toca cotización, materiales, `plan_hash` ni el plan. No se vende, no se
 * cotiza, no se compra.
 *
 * Por eso la escenografía viaja por su propio canal (`SceneSpec.scenography`,
 * un campo aparte de `SceneSpec.elements`) y jamás como un elemento del
 * blueprint: la puerta `catalogOnly` de `buildApprovedSceneSpec` sigue
 * rechazando cualquier elemento del plan sin producto de catálogo, que es lo
 * que impide que el modelo se invente productos.
 * ------------------------------------------------------------------------- */

/**
 * Categorías de escenografía: lo que se ve en la foto y el plan no construye. El fondo (`backdrop`, `panel`) entra
 * también: el plan puede construir un backdrop, pero cuando no lo hace el de la foto se perdía por los dos lados
 * —ni se cotizaba ni se dibujaba— y FLUX ponía la decoración sobre un fondo de estudio (CASE-002, -003 y -005,
 * auditoría de propiedades huérfanas, 2026-10-05). Si el plan lleva su propio backdrop, `elementosMaterializados`
 * marca los fondos de la foto como construidos y no se duplican.
 */
const SCENERY_EXTRA_CATEGORIES = ["curtain", "drape", "backdrop", "panel"] as const;
export const SCENERY_CATEGORIES: ReadonlySet<string> = new Set([...AMBIENT_CATEGORIES, ...SCENERY_EXTRA_CATEGORIES]);

/** Categorías del fondo de la foto que un backdrop del plan sustituye. */
const CATEGORIAS_FONDO_CONSTRUIBLE: ReadonlySet<string> = new Set(["backdrop", "panel"]);

/**
 * Los elementos de la foto que el plan ya construye y que, por eso, no vuelven como escenografía: los que alguna
 * estructura materializa (`referencia_element_id`) y, si el plan lleva un backdrop, todos los fondos de la foto
 * (el plan admite uno solo en `fondo_pared`, `tipos.ts`). Única regla para `/api/generate` y para la tarjeta.
 */
export function elementosMaterializados(
  blueprint: ReferenceBlueprintV2,
  estructuras: ReadonlyArray<{ tipo: string; referencia_element_id?: string }>,
): Set<string> {
  const ids = new Set(estructuras.flatMap((estructura) => (estructura.referencia_element_id ? [estructura.referencia_element_id] : [])));
  if (estructuras.some((estructura) => estructura.tipo === "backdrop")) {
    for (const elemento of blueprint.elements) if (CATEGORIAS_FONDO_CONSTRUIBLE.has(elemento.category)) ids.add(elemento.element_id);
  }
  return ids;
}

/** Cuántas piezas de escenografía como máximo llegan al prompt y a la tarjeta. */
export const SCENERY_LIMIT = 6;

export type SceneryItem = {
  elementId: string;
  sourceImageId: string;
  /** Nombre renderizable en inglés (el mismo filtro que la ambientación LoRA). */
  name: string;
  category: ReferenceBlueprintV2["elements"][number]["category"];
  /** Caja en la foto de referencia, normalizada [0,1]. */
  bbox: ReferenceBBox;
  depthLayer: number;
  /** Valor por defecto del interruptor del cliente, antes de sus cambios. */
  visibleByDefault: boolean;
};

/** Confianza mínima de detección para dibujar escenografía (regla histórica de la ambientación LoRA). */
const SCENERY_MIN_CONFIDENCE = 0.6;

/**
 * Escenografía de la foto: elementos que el catálogo no vende (luces, flores,
 * mobiliario, bases, mesas, cortinas) y que ninguna estructura del plan
 * materializa. Solo entra lo que el análisis aprobó, con confianza suficiente
 * y con un nombre en inglés plano sin letreros ni texto (el modelo de imagen
 * inventaría tipografía). Nunca se cotiza.
 *
 * VALOR POR DEFECTO DEL INTERRUPTOR — `composition_relevance`. El análisis ya
 * pide ese juicio por elemento (`STRUCTURE_DETECTION_RULES`) y ya lo aplica en
 * la frontera: `candidatos-referencia.ts` convierte `minor` (despreciable) en
 * `model_decision.action = "omit"`, así que un elemento `minor` nunca llega
 * aprobado al blueprint. Lo que sobrevive es lo que el modelo llamó
 * `essential` (define la composición) o `supporting` (styling claramente
 * visible junto a la decoración): justo la escenografía que tiene sentido
 * dibujar, y por eso llega encendida. El orden y el recorte a `limit` los
 * decide después la confianza de detección y el área en la foto.
 *
 * El valor literal (`essential` vs `supporting`) NO viaja hoy en el blueprint:
 * añadirlo a `ReferenceElementSchema` obliga a re-exportar
 * `contracts/domain/v1/reference-blueprint.schema.json` y a regenerar
 * `services/ai-api/app/generated_models.py`. Cuando ese campo exista, este es
 * el único punto que hay que tocar para separar los dos niveles.
 */
export function sceneryFromReference(
  blueprint: ReferenceBlueprintV2,
  materializedElementIds: ReadonlySet<string>,
  limit = SCENERY_LIMIT,
): SceneryItem[] {
  const seen = new Set<string>();
  const items: SceneryItem[] = [];
  const candidates = blueprint.elements
    .filter((element) => element.approved
      && SCENERY_CATEGORIES.has(element.category)
      && element.detection_confidence >= SCENERY_MIN_CONFIDENCE
      && !materializedElementIds.has(element.element_id))
    .sort((a, b) => b.detection_confidence - a.detection_confidence || b.reference_bbox.width * b.reference_bbox.height - a.reference_bbox.width * a.reference_bbox.height);
  for (const element of candidates) {
    const leido = ambientDecorName(element.name);
    const name = leido ? nombreConSuColor(leido, element.appearance.observed_colors) : undefined;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({
      elementId: element.element_id,
      sourceImageId: element.source_image_id,
      name,
      category: element.category,
      bbox: element.reference_bbox,
      depthLayer: element.depth_layer,
      visibleByDefault: true,
    });
    if (items.length >= limit) break;
  }
  return items;
}


/**
 * Aplica el interruptor del cliente sobre los valores por defecto del
 * servidor. El cliente solo puede ENCENDER o APAGAR lo que el servidor ya
 * eligió: un id que no esté en la lista no añade nada a la escena.
 */
export function applySceneryVisibility(
  items: readonly SceneryItem[],
  overrides: ReadonlyMap<string, boolean> | undefined,
): Array<SceneryItem & { visible: boolean }> {
  return items.map((item) => ({ ...item, visible: overrides?.get(item.elementId) ?? item.visibleByDefault }));
}

/**
 * Styling seen in the reference that the catalog does not sell (string
 * lights, foliage, props). It is rendered only when the analysis kept it as
 * relevant (approved) with enough confidence, it is not already materialized
 * by an approved plan structure, and its name is plain English without text
 * or signage (the image model would invent lettering). Never quoted.
 *
 * Proyección de `sceneryFromReference` (dueña de la regla) sobre las
 * categorías históricas de ambientación del caption LoRA: una cortina es
 * escenografía, pero el caption LoRA nunca la nombró como styling.
 */
export function ambientDecorSelection(
  blueprint: ReferenceBlueprintV2,
  materializedElementIds: ReadonlySet<string>,
  limit = 3,
): AmbientDecorItem[] {
  return sceneryFromReference(blueprint, materializedElementIds, Number.POSITIVE_INFINITY)
    .filter((item) => AMBIENT_CATEGORIES.has(item.category))
    .slice(0, limit)
    .map((item) => ({ elementId: item.elementId, name: item.name }));
}

export function ambientDecorFromReference(
  blueprint: ReferenceBlueprintV2,
  materializedElementIds: ReadonlySet<string>,
  limit = 3,
): string[] {
  return ambientDecorSelection(blueprint, materializedElementIds, limit).map((item) => item.name);
}

/* ---------- Deterministic normalization of balloon detections ----------
 * The analysis model is not stable between runs of the same photo, and some
 * of its answers are wrong in ways plain text rules can catch without
 * inventing anything: a "hot air balloon" is not a balloon decoration, a
 * structure named "garland" is a garland even when the typed `structure` was
 * left out, "Left Balloon Columns" is more than one column. Each rule below
 * only uses what the model wrote (names, evidence, bbox). */

function plain(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Things called "balloon"/"bubble" that are not event balloon decoration. */
const NON_DECORATION_BALLOON = /\b(?:hot[- ]?air balloons?|air ?ships?|blimps?|zeppelins?|parachutes?|paragliders?|kites?|speech bubbles?|thought bubbles?|soap bubbles?|bubble machines?|globos? aerostaticos?|pompas? de jabon)\b|\bbubbles?\b(?!\s*balloons?)|\bburbujas?\b(?!\s*(?:de\s+)?globos?)/;

export function isNonDecorativeBalloon(text: string): boolean {
  return NON_DECORATION_BALLOON.test(plain(text));
}

/** Structural nouns in a name, most specific first. */
const STRUCTURE_NOUNS: ReadonlyArray<readonly [RegExp, DetectedStructure["type"]]> = [
  [/\b(?:half[- ]?arch(?:es)?|semi[- ]?arch(?:es)?|semiarcos?|medios? arcos?)\b/, "half_arch"],
  [/\b(?:balloon walls?|walls? of balloons|paredes? de globos|muros? de globos)\b/, "balloon_wall"],
  [/\b(?:ceiling (?:installations?|clouds?|canop(?:y|ies))|balloon clouds?|clouds? of balloons|techos? de globos)\b/, "ceiling_installation"],
  [/\b(?:centerpieces?|centros? de mesa)\b/, "centerpiece"],
  [/\b(?:arch(?:es|way|ways)?|arcos?)\b/, "arch"],
  [/\b(?:columns?|pillars?|towers?|columnas?|torres?)\b/, "column"],
  [/\b(?:garlands?|guirnaldas?)\b/, "garland"],
  [/\b(?:bouquets?|ramilletes?|ramos? de globos)\b/, "bouquet"],
  [/\b(?:clusters?|racimos?)\b/, "cluster"],
  [/\b(?:hoops?|aros?)\b/, "hoop"],
  [/\b(?:sculptures?|esculturas?)\b/, "sculpture"],
];

export function structureTypeFromName(name: string): DetectedStructure["type"] | undefined {
  const text = plain(name);
  return STRUCTURE_NOUNS.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * Typed structure for a balloon element the model named but did not type.
 * Only the name decides the type (evidence mentions neighbouring pieces);
 * side comes from the bbox. Undefined when the name has no structural noun.
 */
export function inferStructureFromName(name: string, bbox: ReferenceBBox): DetectedStructure | undefined {
  const type = structureTypeFromName(name);
  if (!type) return undefined;
  return {
    type,
    position: bbox.width >= 0.8 ? "full_width" : sideFromBBox(bbox),
    relativeHeight: "medium",
    curvesToward: "none",
    grounded: type !== "ceiling_installation",
    outline: "symmetric",
    // Una pieza que el modelo nombró sin describir no se inclina: el nombre no
    // dice hacia dónde, y suponerlo inventaría una forma que nadie vio.
    inclina: 0,
    density: "medium",
  };
}

/**
 * A single column or half-arch whose bbox sits clearly on one side takes that
 * side, so its shape text and its placement agree (F15: a left half-arch
 * reported as full_width came back "against the back wall").
 */
export function alignVerticalPosition(structure: DetectedStructure, bbox: ReferenceBBox): DetectedStructure {
  const vertical = structure.type === "half_arch" || structure.type === "column";
  if (!vertical || structure.position === "left" || structure.position === "right") return structure;
  const side = sideFromBBox(bbox);
  return side === "center" ? structure : { ...structure, position: side };
}

const LOOSE_BALLOONS = /\b(?:loose|scattered|strewn|sparse|individual)\s+(?:[a-z-]+\s+){0,2}balloons?\b|\bballoons?\s+(?:[a-z-]+\s+){0,2}(?:scattered|strewn|lying|rolling)\b|\bglobos?\s+(?:[a-z-]+\s+){0,2}(?:sueltos?|esparcidos?|regados?|tirados?)\b/;
const ON_FLOOR = /\b(?:on|across) the (?:floor|ground)\b|\ben el (?:piso|suelo)\b|\bfloor balloons?\b/;

/**
 * Balloons lying loose on the floor are not a built structure (a garland,
 * a cluster): a quote cannot build "scattered balloons". Applies only when
 * the name carries no structural noun, so "loose organic garland" stays a
 * garland.
 */
export function isLooseFloorBalloons(name: string, evidence: string): boolean {
  if (structureTypeFromName(name)) return false;
  const text = plain(`${name} ${evidence}`);
  return LOOSE_BALLOONS.test(text) || (ON_FLOOR.test(plain(name)) && /\b(?:balloons?|globos?)\b/.test(plain(name)));
}

const SPLITTABLE_TYPES = new Set<DetectedStructure["type"]>(["column", "half_arch", "garland", "bouquet", "cluster", "sculpture"]);
const BOTH_SIDES = /\b(?:left and right|right and left|on both sides|both sides|each side|either side|two separate|a pair of|izquierd[ao]s? y derech[ao]s?|derech[ao]s? y izquierd[ao]s?|ambos lados|cada lado)\b/;

/**
 * Two separate pieces reported as one `full_width` detection (two garlands
 * framing a stage came back as one). Split only with explicit left/right
 * evidence on a wide bbox: the model gives no gap geometry, so the halves
 * are the only honest boxes. Arches and walls legitimately span both sides.
 */
export function shouldSplitSidePieces(structure: DetectedStructure, bbox: ReferenceBBox, name: string, evidence: string): boolean {
  if (!SPLITTABLE_TYPES.has(structure.type)) return false;
  if (structure.position !== "full_width" && bbox.width < 0.6) return false;
  const text = plain(`${name} ${evidence}`);
  // The side words must be about this piece: "a garland with columns on both
  // sides" is one garland flanked by other pieces, not two garlands.
  return BOTH_SIDES.test(text) && OWN_PLURAL[structure.type].test(text);
}

export function splitSidePieces(structure: DetectedStructure, bbox: ReferenceBBox): Array<{ side: "left" | "right"; structure: DetectedStructure; bbox: ReferenceBBox }> {
  const half = bbox.width / 2;
  return (["left", "right"] as const).map((side) => ({
    side,
    structure: { ...structure, position: side, mirrors: `${side === "left" ? "right" : "left"} piece`, curvesToward: structure.type === "half_arch" ? (side === "left" ? "right" : "left") : structure.curvesToward },
    bbox: { x: side === "left" ? bbox.x : bbox.x + half, y: bbox.y, width: half, height: bbox.height },
  }));
}

const COUNT_WORDS: Readonly<Record<string, number>> = { two: 2, pair: 2, dos: 2, par: 2, three: 3, tres: 3, four: 4, cuatro: 4, five: 5, cinco: 5, six: 6, seis: 6 };
/** Plural nouns of each structure type (folded text). */
const OWN_PLURAL: Readonly<Record<DetectedStructure["type"], RegExp>> = {
  arch: /(?<!half[- ]?)(?<!semi[- ]?)\b(?:arches|archways|arcos)\b/,
  half_arch: /\b(?:half[- ]?arches|semi[- ]?arches|semiarcos|medios arcos)\b/,
  column: /\b(?:columns|pillars|towers|columnas|torres)\b/,
  garland: /\b(?:garlands|guirnaldas)\b/,
  balloon_wall: /\b(?:balloon walls|walls of balloons|paredes de globos|muros de globos)\b/,
  centerpiece: /\b(?:centerpieces|centros de mesa)\b/,
  ceiling_installation: /\b(?:ceiling installations|balloon clouds|clouds of balloons|techos de globos)\b/,
  cluster: /\b(?:clusters|racimos)\b/,
  sculpture: /\b(?:sculptures|esculturas)\b/,
  bouquet: /\b(?:bouquets|ramilletes|ramos de globos)\b/,
  hoop: /\b(?:hoops|aros)\b/,
};

/**
 * Number of identical pieces a structure name declares ("Left Balloon
 * Columns" → 2, "three bouquets" → 3). Only the plural of the element's own
 * type counts: "Balloon garland with columns" is one garland. Undefined for a
 * singular name.
 */
export function structureCountFromName(name: string, type: DetectedStructure["type"]): { count: number; exact: boolean } | undefined {
  const text = plain(name);
  if (!OWN_PLURAL[type].test(text)) return undefined;
  const word = /\b(two|pair|dos|par|three|tres|four|cuatro|five|cinco|six|seis|[2-9])\b/.exec(text)?.[1];
  if (word) return { count: COUNT_WORDS[word] ?? Number(word), exact: true };
  return { count: 2, exact: false };
}

const FINISH_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:pearl(?:escent|ized|ised|y)?|nacre(?:ous)?|iridescent|opalescent|satin(?:y)?|perla(?:d[oa]s?)?|perlad[oa]s?|nacarad[oa]s?|satinad[oa]s?)\b/, "pearl"],
  [/\b(?:chrome|chromed|mirror(?:ed)?|reflex|cromad[oa]s?|espejo)\b/, "chrome"],
  [/\b(?:metallic|metalizad[oa]s?|metalic[oa]s?)\b/, "metallic"],
  [/\b(?:matte|mate)\b/, "matte"],
];
const ANY_FINISH = new RegExp(FINISH_FAMILIES.map(([pattern]) => pattern.source).join("|"));
const NO_FINISH_COLOR = /\b(?:clear|transparent|transparente|confetti|not determinable)\b/;

/**
 * Balloon finish vocabulary. The chat maps pearl → satin and chrome → reflex,
 * but pearl balloons came back as plain "purple, white". Synonyms inside a
 * color collapse to the family word, and a single finish named in the
 * element's evidence/material is carried onto its plain colors. Two different
 * finishes in the text are ambiguous, so the colors stay untouched.
 */
export function normalizeFinishColors(colors: string[], text: string): string[] {
  const canonical = colors.map((color) => {
    const family = FINISH_FAMILIES.find(([pattern]) => pattern.test(plain(color)));
    if (!family) return color;
    const rest = plain(color).replace(new RegExp(family[0].source, "g"), " ").replace(/\s+/g, " ").trim();
    return rest ? `${family[1]} ${rest}` : color;
  });
  const families = FINISH_FAMILIES.filter(([pattern]) => pattern.test(plain(text)));
  if (families.length !== 1 || canonical.some((color) => ANY_FINISH.test(plain(color)))) return canonical;
  const finish = families[0]![1];
  return canonical.map((color) => NO_FINISH_COLOR.test(plain(color)) ? color : `${finish} ${color}`.slice(0, 80));
}

const ATTACHABLE_TYPES = new Set<DetectedStructure["type"]>(["sculpture", "bouquet", "cluster", "centerpiece"]);
const ATTACHED_PROP_NAME = /\b(?:foils?|mylar|figures?|characters?|numbers?|letters?|stars?|hearts?|metalizad[oa]s?|figuras?|numeros?|letras?|estrellas?|corazones?)\b/;
const WALL_LIKE_TYPES = new Set<DetectedStructure["type"]>(["balloon_wall", "garland", "ceiling_installation"]);

export type AttachmentCandidate = {
  sourceImageId: string;
  name: string;
  approved: boolean;
  bbox: ReferenceBBox;
  structure?: DetectedStructure;
};

// Local copy of `bboxContainment` (reference-blueprint.ts): this module stays
// free of runtime imports because client components reach it through
// presentacion-cliente.ts, and reference-blueprint pulls node:crypto.
function bboxContainment(inner: ReferenceBBox, outer: ReferenceBBox): number {
  const width = Math.max(0, Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x));
  const height = Math.max(0, Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y));
  const area = inner.width * inner.height;
  return area ? (width * height) / area : 0;
}

/**
 * Foil figures stuck on a balloon wall, or three "centerpieces" that are one
 * arrangement, used to be quoted as separate kits. An approved small piece
 * whose bbox lies inside a larger approved balloon structure is part of it
 * when the container is wall-like (wall, garland, ceiling), or the same kind
 * of arrangement, or — for foil/figure props raised off the floor — any
 * structure. Returns inner index → container index (smallest container).
 */
export function attachedStructureContainers(items: AttachmentCandidate[]): Map<number, number> {
  const result = new Map<number, number>();
  items.forEach((inner, i) => {
    if (!inner.approved || !inner.structure) return;
    const propName = ATTACHED_PROP_NAME.test(plain(inner.name));
    if (!ATTACHABLE_TYPES.has(inner.structure.type) && !propName) return;
    const innerArea = inner.bbox.width * inner.bbox.height;
    let best: { index: number; area: number } | undefined;
    items.forEach((outer, j) => {
      if (i === j || !outer.approved || !outer.structure || outer.sourceImageId !== inner.sourceImageId) return;
      const area = outer.bbox.width * outer.bbox.height;
      if (area < innerArea * 2 || bboxContainment(inner.bbox, outer.bbox) < 0.85) return;
      const fits = WALL_LIKE_TYPES.has(outer.structure.type)
        || (outer.structure.type === inner.structure!.type && ATTACHABLE_TYPES.has(inner.structure!.type))
        || (propName && !inner.structure!.grounded);
      if (fits && (!best || area < best.area)) best = { index: j, area };
    });
    if (best) result.set(i, best.index);
  });
  return result;
}

type BlueprintElements = { elements: ReadonlyArray<Pick<ReferenceBlueprintV2["elements"][number], "approved" | "category">> };

/**
 * UI/chat contract: the reference has at least one approved balloon
 * structure (the same rule `referenciaDefineComposicion` uses in the plan).
 * False for photos with no balloon decoration, or where every balloon-like
 * detection was rejected (hot air balloon, loose balloons, untyped foil).
 */
export function tieneEstructurasDeGlobos(blueprint: BlueprintElements | null | undefined): boolean {
  return Boolean(blueprint?.elements.some((element) => element.approved && element.category === "balloon_structure"));
}

/** UI contract: the analysis kept at least one element; false means "nothing usable was seen". */
export function tieneElementosAprobados(blueprint: BlueprintElements | null | undefined): boolean {
  return Boolean(blueprint?.elements.some((element) => element.approved));
}
