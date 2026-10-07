import type { SceneElement, SceneSpec } from "../escena/scene-spec";
import { buildFluxEnvironmentCues, type VisualContext } from "../escena/visual-context";
import { fraseEntorno, type DetalleEntorno, type EntornoEscena } from "../escena/entorno-escena";
import { clasificarColores, PALETA_COLORES_EN_V2 } from "@/lib/rag/taxonomy/v2";
import type { FluxDensity, FluxDesignRole, FluxPlacement, FluxStructureType, VisualSemantics } from "../escena/scene-semantics";
import type { PhysicalForm, PhysicalRelation, SceneElementKind, QuantitySemantics } from "../escena/scene-visual-contract";
import { identificarEstructuraOficial, type EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { SOPORTES_CON_CAIDA_GUIRNALDA, type SoporteGuirnalda } from "@/lib/plan/armado-guirnalda";
import { FUENTE_PLAN } from "@/lib/plan/blueprint";
import { armadoDeElemento, armadoGuirnaldaDeElemento, armadoGuirnaldaOrganicaDeElemento, fraseDeFormaDeElemento, frasePatronColor, type ArmadoBouquetEnPrompt, type ArmadoGuirnaldaEnPrompt, type FraseDeEstructura } from "../uzume/mezcla-color-escena";
import { findSeparateSidePieces, type SeparateSidePieces } from "../uzume/separate-side-pieces";
import { limpiarTextoBase } from "./texto-base";
import { acabadoVisible, CIERRE_FOTOGRAFICO_BASE, ENCUADRE_ESCENA_PEQUENA_BASE, fraseTallasBase, limpiarEtiqueta, medidaBase, rosaDelante, SUSTANTIVOS_ESTRUCTURA_BASE, topeTallaBase, UBICACIONES_BASE, type TerminosBase } from "./vocabulario-base";

export const FLUX_CAPTION_COMPILER_VERSION = "flux-caption-v2.14-encuadre-y-luz-en-capas" as const;

/** Límite común de texto que mantiene primero la decoración. */
export const FLUX_PROMPT_MAX_LENGTH = 1500;
export const BASE_PROMPT_MAX_LENGTH = 1500;
const UBICACIONES_SEMIARCO_BASE: Partial<Record<FluxPlacement, string>> = {
  fondo_pared: "at one side of the rear wall",
  arco_central: "off to one side of center",
  entrada: "at one side of the doorway",
};
const UBICACIONES_GUIRNALDA_BASE: Partial<Record<FluxPlacement, string>> = {
  fondo_pared: "running along the rear wall",
  arco_central: "running across the middle of the scene",
  entrada: "running along the entrance doorway",
};
/**
 * Una guirnalda corta en la pared (sin armado del motor) se cuelga sobre la mesa principal: la mesa es el objeto de
 * tamaño conocido que le dice al modelo cuánto mide la pieza. «running along the rear wall» la estiraba de pared a
 * pared y FLUX la cerraba en un marco (guiada-20261007-055050-xkkihw, 2,4 m y 37 globos).
 */
const GUIRNALDA_CORTA_EN_PARED = "hung horizontally on the rear wall above the main table";
/** Con la foto del espacio la escala la da la propia sala: la misma colocación, sin poner una mesa. */
const GUIRNALDA_CORTA_EN_PARED_DE_LA_FOTO = "hung horizontally on the rear wall";
/** Hasta aquí una guirnalda es «corta»: cabe sobre una mesa y no cubre la pared entera. */
const METROS_GUIRNALDA_CORTA = 3.5;
const GLOBOS_GUIRNALDA_CORTA = 80;
/** Ubicaciones de pared en las que la guirnalda es una tira horizontal con los extremos libres. */
const GUIRNALDAS_EN_PARED = new Set<FluxPlacement>(["fondo_pared", "pared_lateral"]);

/** Largo de la guirnalda del plan, si lo trae (una guirnalda declarada con `ancho_m` lo usa como largo). */
function largoGuirnalda(clause: Pick<FluxVisualClause, "medidasM">): number | undefined {
  return clause.medidasM?.length ?? clause.medidasM?.width;
}

/** Guirnalda corta según el plan: su largo y sus globos (los que traiga) dentro del tope, y al menos uno de los dos. */
function guirnaldaCorta(clause: Pick<FluxVisualClause, "medidasM" | "globosPorPieza">): boolean {
  const largo = largoGuirnalda(clause);
  if (largo === undefined && clause.globosPorPieza === undefined) return false;
  return (largo ?? 0) <= METROS_GUIRNALDA_CORTA && (clause.globosPorPieza ?? 0) <= GLOBOS_GUIRNALDA_CORTA;
}

/** Alias legacy que aún aparece en nombres de escenas antiguas. */
type CaptionStructureType = FluxStructureType | "bouquet";

/**
 * A single element's resolved canonical product concept, supplied by the
 * caller (see src/lib/ia/kagutsuchi/producto-flux.ts). This is the ONLY channel
 * through which product identity can override the legacy color/finish
 * translation for an element — the compiler never resolves concepts itself
 * and never receives or renders a `concept_id`, only the already-rendered
 * `canonicalLabel` text.
 */
export type ProductConceptClauseInput = {
  elementId: string;
  conceptId: string;
  canonicalLabel: string;
  sizeCodes?: string[];
  /**
   * Short observable color of the concept (e.g. "dusty rose"), used only to
   * refer back to a concept already described in full earlier in the same
   * prompt. Without it the full label is repeated.
   */
  colorName?: string;
  /**
   * Same product in the plain wording of the `base` dialect (see
   * src/lib/ia/kagutsuchi/vocabulario-base.ts). Without it the base dialect renders the
   * canonical label, cleaned of commercial names.
   */
  baseTerms?: TerminosBase;
  /**
   * Globos de este producto en la pieza según las líneas que resolvió Python (`design_quantity`). Ordenan los
   * colores de la frase de materiales y dicen su peso («mostly …, accents of …»). Sin ellas, el orden de siempre.
   */
  units?: number;
};


export type FluxVisualClause = {
  elementIds: string[];
  structureType: CaptionStructureType;
  noun: string;
  count: number;
  /**
   * Balloons of a centerpiece of 1 to `MAX_GLOBOS_CENTRO_NOMBRADOS`, from the plan's material units
   * (`quantity`). Without it "small balloon cluster centerpiece" drew a cluster where the plan buys one
   * balloon (CASE-006, UI-6; auditoría de propiedades huérfanas, 2026-10-05).
   */
  globosCentro?: number;
  /**
   * Globos de UNA pieza según el plan (`quantity` de unidades de material, `FUENTE_PLAN`), para la escala de la
   * cláusula («with about 37 balloons»). Sin él el caption no decía cuántos globos tenía la pieza y FLUX pintó una
   * guirnalda de 37 globos como un marco de pared a pared con cientos (guiada-20261007-055050-xkkihw).
   */
  globosPorPieza?: number;
  /** Medidas de UNA pieza del plan (`dimensions_m`), cuando todas las de la cláusula las comparten. */
  medidasM?: { width?: number; height?: number; length?: number };
  colors: string[];
  finishes: string[];
  scale?: string;
  density?: string;
  placement: FluxPlacement;
  relation?: string;
  anchorElementId?: string;
  bilateral?: boolean;
  salience: number;
  // True when at least one grouped element had no `visual_semantics` from
  // the plan AND its name didn't match any known structure keyword either,
  // so it degraded to the generic "kit"/"accesorio" bucket. A missing
  // `visual_semantics` alone is not enough to flag here — inferredStructureType
  // still resolves a specific type (e.g. "arco") from the element name in
  // that case, so nothing actually degraded.
  usedFallbackSemantics: boolean;
  /**
   * Rendered canonical product phrase (e.g. "round latex balloon in rose
   * gold with a Reflex high-shine finish (5-inch and 12-inch)"), present only when
   * every element in this clause resolved to a canonical product concept.
   * When set, it REPLACES the legacy `colorFinishPhrase` rendering for this
   * clause; structure noun/count/placement/relations are unaffected.
   */
  canonicalPhrase?: string;
  /** concept_id values rendered into this clause, for diagnostics only — never emitted into the prompt text itself. */
  canonicalConceptIds?: string[];
  /** Resolved concept entries behind `canonicalPhrase`, kept so the caption can be re-rendered compactly. */
  canonicalEntries?: ProductConceptClauseInput[];
  elementKind: SceneElementKind;
  quantitySemantics: QuantitySemantics;
  visibleCount?: number;
  physicalForm?: PhysicalForm;
  productDescriptors: string[];
  printedMotifs: string[];
  physicalRelations: PhysicalRelation[];
  /** Approved height in meters when every element of the clause shares it. */
  heightM?: number;
  /** Set while rendering when vertical structures differ clearly in height. */
  heightQualifier?: "shorter" | "taller";
  /** Set while rendering (`piezasDePieSueltas`): a lone half-arch among other standing pieces ends in a free tip. */
  standsApart?: boolean;
  /** Official structure (variant such as asymmetrical or airy) recognized from the plan; see estructuras-oficiales.ts. */
  officialStructure?: EstructuraOficial;
  /**
   * `prompt_lora` of the clause's structure, written by Python (ADR-0028 §12)
   * and rendered verbatim right after the material phrase. Part of the grouping
   * key, so every element of the clause shares it; never compacted or dropped.
   */
  colorPattern?: string;
  /**
   * Present when `colorPattern` is the `prompt_lora` of a bouquet assembly
   * (ADR-0030) rather than a color pattern: `grupos` bouquets per instance, as
   * Python decided. The route reads it to pick the hybrid stage-2 lock; the
   * clause renders one bouquet noun per group. Absent otherwise, so a caption
   * without an assembly keeps its clauses byte for byte.
   */
  armadoBouquet?: ArmadoBouquetEnPrompt;
  /**
   * Present when `colorPattern` is (or starts with) the `prompt_lora` of a
   * garland assembly (ADR-0032, E5): its support and shape, and whether the
   * phrase also carries a color pattern. The route reads it to pick the hybrid
   * stage-2 locks; the clause text is the phrase, verbatim. Absent otherwise.
   */
  armadoGuirnalda?: ArmadoGuirnaldaEnPrompt;
  /** Set when that `prompt_lora` is the organic engine's garland assembly (ADR-0034). */
  armadoGuirnaldaOrganica?: { enAlto: boolean };
  /**
   * `colorPattern` is the SHAPE phrase of an organic-engine piece (`FraseDeEstructura.forma`): the only Python
   * phrase the last compaction steps may shorten, by whole fragments from the end (`fragmentosForma`).
   */
  fraseDeForma?: true;
};

export type FluxCaptionCompilation = {
  prompt: string;
  clauses: FluxVisualClause[];
  compilerVersion: typeof FLUX_CAPTION_COMPILER_VERSION;
  /**
   * True when at least one clause used a canonical product concept supplied
   * via `productConcepts`. False (the "legacy" path) must never be silently
   * reported as canonical — callers that need product fidelity (see
   * producto-flux.ts) must check this flag explicitly.
   */
  usedCatalogProducts: boolean;
  /**
   * Index of the render step that produced `prompt` (0 = full rendering).
   * Higher steps are deterministic compactions applied only because the full
   * rendering exceeded `FLUX_PROMPT_MAX_LENGTH`; see `CAPTION_RENDER_STEPS`.
   */
  compactionStep: number;
  /** Palabras solo-LoRA que `limpiarTextoBase` quitó del texto base (vacío fuera de base o si no había). */
  palabrasQuitadas: string[];
};

type SemanticElement = {
  element: SceneElement;
  /** `estructura_oficial` declared by the approved plan for this element, when present. */
  declaredOfficial?: string;
  semantics: Omit<VisualSemantics, "structure_type"> & { structure_type: CaptionStructureType };
  fallback: boolean;
  index: number;
  /** Python's `prompt_lora` for this element's structure, when it has an applied pattern. */
  colorPattern?: string;
  /** Set when that `prompt_lora` is a bouquet assembly (ADR-0030). */
  armadoBouquet?: ArmadoBouquetEnPrompt;
  /** Set when that `prompt_lora` is a garland assembly (ADR-0032). */
  armadoGuirnalda?: ArmadoGuirnaldaEnPrompt;
  /** Set when that `prompt_lora` is the organic engine's garland assembly (ADR-0034). */
  armadoGuirnaldaOrganica?: { enAlto: boolean };
  /** Set when that `prompt_lora` is an organic-engine SHAPE phrase (`FraseDeEstructura.forma`). */
  fraseDeForma?: boolean;
};

const STRUCTURE_NOUNS: Record<CaptionStructureType, string> = {
  arco: "organic balloon arch",
  semiarco: "asymmetrical balloon half-arch",
  guirnalda: "organic balloon garland",
  columna: "balloon column",
  bouquet: "balloon bouquet",
  pared: "balloon wall",
  centro_mesa: "balloon centerpiece",
  backdrop: "decorated backdrop",
  kit: "balloon decoration kit",
  accesorio: "decorative accessory",
  escultura: "balloon sculpture",
};

const EVENT_WORDS: Record<string, string> = {
  navidad: "Christmas celebration",
  halloween: "Halloween celebration",
  boda: "wedding celebration",
  "cumpleanos": "birthday party",
  "quinceanos": "fifteenth-birthday celebration",
  quinceanera: "fifteenth-birthday celebration",
  "baby shower": "baby shower",
  graduacion: "graduation celebration",
};

const STYLE_WORDS: Record<string, string> = {
  romantico: "romantic",
  elegante: "elegant",
  moderno: "modern",
  clasico: "classic",
  boho: "bohemian",
  bohemio: "bohemian",
  glamour: "glamorous",
  glam: "glamorous",
  rustico: "rustic",
  minimalista: "minimalist",
  vintage: "vintage",
  tropical: "tropical",
  infantil: "playful",
};

const COLOR_ALIASES: Record<string, string> = {
  rosa: "pink",
  rosado: "pink",
  rosada: "pink",
  rosadofuerte: "pink",
  "rosado fuerte": "pink",
  fucsia: "fuchsia",
  dorado: "gold",
  "dorado rosa": "rose gold",
  rosagold: "rose gold",
  plateado: "silver",
  // `gris` is a real product color (colores-producto.ts) that the taxonomy v2
  // palette does not carry, so without this alias the Spanish word reached the
  // English-only LoRA caption untranslated.
  //
  // Con `grey` y no `gray`, que es la misma palabra y no la misma estadistica: en las 345 captions `grey`
  // sale 15 veces y **las de globos son esas** («12-inch matte Fashion grey round latex balloons»), mientras
  // `gray` sale 7 y describe paredes y pisos. La ortografia la eligio quien escribio el corpus, no nosotros.
  gris: "grey",
  grafito: "charcoal gray",
  cafe: "brown",
  marron: "brown",
  morado: "purple",
  lila: "lilac",
  violeta: "violet",
  menta: "mint",
  crema: "cream",
  nude: "nude",
  burdeos: "burgundy",
  // Nombres del catalogo que el corpus sabe decir con mas precision que la paleta de 26 palabras.
  // **Cada uno medido en las 345 captions de `data/staging/lora-v007`, y solo donde describe un GLOBO**: el
  // numero es cuantas veces aparece. Antes `azul rey` y `azul caribe` se aplastaban los dos a `blue`, y
  // `azul galaxy`, `blanco nacar` y `verde menta` no estaban y caian a la paleta (`blue`, `white`, `green`).
  // Tres tonos del corpus se quedan FUERA a proposito, por la misma regla: `teal` (3 veces, y es un mantel),
  // `dark green` (1, un piso) y `light pink` (1). Nombrar un globo con la palabra que el modelo aprendio
  // mirando un piso es el fallo que `FINISH_WORDS` acaba de corregir con `glossy`.
  "azul rey": "royal blue",
  "azul caribe": "turquoise",
  "azul naval": "navy blue",
  "azul galaxy": "navy blue",
  "blanco nacar": "pearl white",
  "verde esmeralda": "green",
  "verde lima": "lime green",
  "verde menta": "mint green",
};

/**
 * Spanish → English color names exactly as `translateFluxColor` looks them up:
 * the taxonomy palette wins, the aliases fill what it does not carry (`gris`,
 * `grafito`, `marron`…). Exported so the plan contract can hand Python this
 * same table (`x-colores-en`) for the color-pattern phrase it writes into the
 * caption (ADR-0028 §8): the palette alone left `gris` untranslated there.
 */
export const FLUX_COLOR_NAMES_EN: Readonly<Record<string, string>> = { ...COLOR_ALIASES, ...PALETA_COLORES_EN_V2 };

/**
 * El acabado con las palabras de lo que se VE, no con las del catalogo.
 *
 * Aqui habia `reflex: "glossy"`, y `glossy` aparece **una vez en las 345 captions de
 * `data/staging/lora-v007`, describiendo un piso de baldosa**, nunca un globo. Eso habia que cambiarlo. Lo
 * que no servia era cambiarlo por la palabra del dataset (`Reflex high-shine`, 213 apariciones): esta tabla
 * alimenta el camino de respaldo del caption, y `descriptor-perceptual.ts` declara `Reflex`, `Fashion`,
 * `Silk`, `Pastel` y `Crystal` en `TERMINOS_COMERCIALES` como **terminos que nunca deben llegar al modelo de
 * imagen**. Su razon pesa mas que la frecuencia: esta medida en imagenes, no en tokens
 * (`reports/lora-debug/color-fidelidad`), y con el mismo LoRA y el mismo seed el nombre de la linea comercial
 * daba el color equivocado mientras el descriptor perceptual daba el del producto. Contar cuantas veces sale
 * una palabra dice con que la entreno el LoRA; mirar la imagen dice que pinta. Manda la imagen.
 *
 * Asi que estas son las mismas palabras que el camino principal (`aDescriptorPerceptual` sobre la etiqueta
 * canonica del producto, exigidas por `test-producto-flux.ts`): los dos caminos describen el mismo
 * globo igual. `matte` (606 en el corpus), `satin` (106), `pearl` (46) y `metallic` (67) se quedan como
 * estaban: ya eran palabras de lo que se ve y ademas del corpus.
 *
 * Varias entradas traen el adjetivo y el material juntos, asi que repetirian el adjetivo si el mismo material
 * llega ademas con el acabado suelto; `sinAcabadoRepetido` es quien lo evita.
 */
const FINISH_WORDS: Record<string, string> = {
  reflex: "high-gloss chrome",
  metalizado: "metallic",
  metal: "metallic",
  satin: "satin",
  satinado: "satin",
  mate: "matte",
  perlado: "pearl",
  perlados: "pearl",
  perla: "pearl",
  reflectivo: "high-gloss chrome",
  reflectante: "high-gloss chrome",
  brillante: "high-gloss chrome",
  translucido: "translucent",
  transparentes: "translucent",
  transparente: "translucent",
  metalizados: "metallic",
  fashion: "solid matte",
  silk: "soft pearlescent",
  seda: "soft pearlescent",
  neon: "fluorescent",
  cristal: "translucent",
  "pastel mate": "soft matte",
  "pastel dusk": "muted dusty matte",
};

const NUMBER_WORDS: Record<number, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
};

function normalized(value: string | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function cleanGroupName(name: string): string {
  return normalized(name)
    .replace(/\s+#?\d+\s+de\s+\d+/g, "")
    .replace(/\s+#\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferredStructureType(element: SceneElement): CaptionStructureType {
  const name = normalized(element.name);
  if (/\bsemiarco(?:s)?\b/.test(name)) return "semiarco";
  if (/\barco(?:s)?\b/.test(name)) return "arco";
  if (/\bguirnalda(?:s)?\b/.test(name)) return "guirnalda";
  if (/\bcolumna(?:s)?\b/.test(name)) return "columna";
  if (/\bpared(?:es)?\b/.test(name)) return "pared";
  if (/\bcentro(?:s)?\s+de\s+mesa\b/.test(name)) return "centro_mesa";
  if (/\bbouquet\b|\bramillete\b/.test(name)) return "bouquet";
  if (/\bkit\b|\bpaquete\b/.test(name)) return "kit";
  if (element.category === "backdrop" || element.category === "curtain" || element.category === "drape" || element.category === "panel") return "backdrop";
  return element.category === "balloon_structure" ? "kit" : "accesorio";
}

function inferredPlacement(element: SceneElement): FluxPlacement {
  const centerX = element.target_bbox.x + element.target_bbox.width / 2;
  const centerY = element.target_bbox.y + element.target_bbox.height / 2;
  if (["backdrop", "curtain", "drape", "panel"].includes(element.category)) return "fondo_pared";
  if (centerX < 0.34) return "lateral_izquierdo";
  if (centerX > 0.66) return "lateral_derecho";
  if (centerY > 0.78) return "mesas_invitados";
  if (centerY > 0.62) return "piso_frontal";
  return "arco_central";
}

function inferredRole(element: SceneElement, index: number): FluxDesignRole {
  if (index === 0) return "focal";
  if (["backdrop", "curtain", "drape", "panel"].includes(element.category)) return "soporte";
  return "acento";
}

function inferredDensity(sceneSpec: SceneSpec): FluxDensity {
  const density = sceneSpec.material_estimate?.design.visual_density;
  if (density === "low") return "sencilla";
  if (density === "high") return "lujosa";
  return "media";
}

function semanticFor(element: SceneElement, index: number, sceneSpec: SceneSpec, declaredOfficial?: string): SemanticElement {
  if (element.visual_semantics) return { element, semantics: element.visual_semantics, fallback: false, index, declaredOfficial };
  return {
    element,
    declaredOfficial,
    fallback: true,
    index,
    semantics: {
      structure_type: inferredStructureType(element),
      placement: inferredPlacement(element),
      design_role: inferredRole(element, index),
      repetition_group: cleanGroupName(element.name) || `${inferredStructureType(element)}-${index}`,
      density: inferredDensity(sceneSpec),
    },
  };
}

function elementKindFor(element: SceneElement): SceneElementKind {
  return element.element_kind ?? (element.category === "backdrop" ? "backdrop" : "balloon_structure");
}

function quantitySemanticsFor(element: SceneElement): QuantitySemantics {
  return element.quantity_semantics ?? "material_units";
}

function physicalFormFor(element: SceneElement): PhysicalForm | undefined {
  return element.physical_form;
}

function physicalRelationsFor(element: SceneElement): PhysicalRelation[] {
  return element.physical_relations ?? [];
}

export function translateFluxColor(color: string): string {
  const key = normalized(color);
  const direct = FLUX_COLOR_NAMES_EN[key];
  if (direct) return direct;

  // Resolve Spanish aliases such as "azul rey" or "verde esmeralda" to the
  // canonical catalog color before translating. Preserve already-English
  // descriptors such as "light blue" when the taxonomy has no Spanish cue.
  const spanishColor = /\b(?:dorado|oro|platead[oa]|plata|gris|grafito|rojo|azul|rosad[oa]|rosa|verde|lima|esmeralda|blanc[oa]|negr[oa]|morado|lila|violeta|naranja|amarill[oa]|fucsia|transparente|surtido|arcoiris|turquesa|arena|cafe|marron|chocolate|champana|menta|crema|crudo|piel|burdeos|vino|borgona)\b/i.test(key);
  if (spanishColor) {
    const canonical = clasificarColores(color).values[0];
    return canonical ? PALETA_COLORES_EN_V2[canonical] : "catalog color";
  }
  return color.trim();
}

function englishFinish(finish: string): string {
  return FINISH_WORDS[normalized(finish)] ?? finish.trim();
}

function uniqueEnglish(values: string[], mapper: (value: string) => string): string[] {
  return [...new Set(values.map(mapper).map((value) => value.trim()).filter(Boolean))];
}

/**
 * Quita el acabado que ya esta dicho DENTRO de otro.
 *
 * Varias entradas de `FINISH_WORDS` traen el adjetivo y el material juntos (`solid matte`, `high-gloss
 * chrome`, `soft pearlescent`). Un material que llega con el acabado suelto y con su familia —el catalogo
 * da las dos cosas: `acabado: "mate"` y `acabado: "fashion"`— salia entonces con las dos, y la frase decia
 * «with matte and matte Fashion finishes»: el mismo globo nombrado dos veces. `uniqueEnglish` no lo veia
 * porque como cadenas no son iguales.
 *
 * Se compara por palabras y no por `includes` para no tragarse un acabado que solo comparte un trozo de
 * palabra con otro.
 */
function sinAcabadoRepetido(acabados: string[]): string[] {
  const palabras = acabados.map((acabado) => new Set(acabado.toLowerCase().split(/\s+/)));
  return acabados.filter((_, indice) =>
    !palabras.some((otras, otro) => {
      if (otro === indice || otras.size <= palabras[indice]!.size) return false;
      return [...palabras[indice]!].every((palabra) => otras.has(palabra));
    }),
  );
}

function joinNatural(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function pluralize(noun: string): string {
  if (noun.endsWith("arch")) return `${noun}es`;
  return `${noun}s`;
}

function numberWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/**
 * Lo que separa un par en espejo de semiarcos o columnas: el espacio abierto entre las dos piezas. El caption decía
 * «matching one another, one on the left and one on the right» y nada de lo que queda entre ellas, y FLUX las
 * cerraba en un solo arco (CASE-005 de images-judge, 2026-10-05; auditoría de propiedades huérfanas: la
 * separación se determinaba en la guía y no llegaba al texto). Un arco o una guirnalda no se parten, y un par que
 * flanquea un arco central ya tiene la pieza que los separa: en esos casos, sin cambio.
 */
function huecoEntrePar(clause: { structureType?: string; relation?: string }): string {
  if (clause.relation) return "";
  return clause.structureType === "semiarco" || clause.structureType === "columna" ? ", with open space between them" : "";
}

/** La relación de las piezas que flanquean un arco que SÍ está en el plan (`focusDescription` de un `arco`). */
const FLANQUEA_ARCO = "flanking the main arch";

/**
 * Varias columnas o semiarcos en una misma cláusula son N piezas sueltas, cada una con su base y su remate, y nada
 * las une por arriba. «With open space between them» no bastaba: un arco también deja hueco entre sus dos patas.
 * Caso real del dueño (2026-10-07, guiada-20261006-215048-bnrhtj): «2 × Columna orgánica» de 1,8 m sin guía de
 * escena (Python no dibuja una columna sin armado: `sin_dibujo`) → el caption decía «two organic balloon columns
 * …, one standing on the left and one on the right, with open space between them» y FLUX pintó UN arco orgánico
 * unido por arriba. Las columnas que flanquean un arco del plan no pueden decir que nada las une por arriba (el arco
 * pasa entre ellas): se dice que cada una es su propia torre, aparte del arco.
 *
 * Un semiarco solo, junto a otras piezas de pie (`standsApart`, de `piezasDePieSueltas`), dice que sube desde su
 * propia base y termina en una punta libre en el aire: con «curved garland … flanking» y dos columnas, FLUX tendía
 * la guirnalda de una columna a la otra y cerraba un arco completo (prueba real del 2026-10-07).
 *
 * Un semiarco SOLO en la escena (sin otras piezas de pie ni relación) también dice su forma: una sola pata que sube
 * del piso en un lado, se curva y termina en el aire, con piso libre bajo la punta. Caso del dueño
 * (guiada-20261007-071126-x7w4dx, «Semiarco» orgánico de 2,46 × 2,91 m): con solo «A one-sided curved organic
 * balloon garland … at one side of the rear wall», FLUX dibujó un arco completo de dos patas. Es el respaldo en texto
 * de la guía de escena (que dibuja la pieza del motor) y lo único que llega cuando no hay guía.
 *
 * `corta` (paso de compactación `compactSeparation`): lo mismo con la mitad de caracteres, antes de perder tallas o
 * entorno. Las formas largas son las verificadas con FLUX real.
 */
function piezasSueltas(clause: { structureType?: string; relation?: string; standsApart?: boolean }, piezas: number, corta = false): string {
  if (piezas < 2) {
    if (clause.structureType !== "semiarco") return "";
    if (!clause.standsApart) {
      if (clause.relation) return "";
      return corta ? ", one leg on the floor, sweeping across the full top, its tip in mid-air" : ", a single leg rising from the floor at one side, curving over and sweeping across the entire top of the backdrop to the far side, its tip ending in mid-air at the opposite upper corner with bare floor beneath it";
    }
    return corta ? ", its tip ending in mid-air" : ", rising from its own base on the floor and curving over to one side, its tip ending in mid-air";
  }
  if (clause.structureType === "columna") {
    if (clause.relation === FLANQUEA_ARCO) return corta ? ", each its own freestanding tower" : ", each a separate freestanding tower on its own base on the floor, standing apart from the arch";
    return corta
      ? ", each its own freestanding tower, nothing joining them overhead"
      : ", each a separate freestanding tower rising from its own base on the floor to its own rounded top, with nothing joining them overhead";
  }
  if (clause.structureType === "semiarco") {
    if (clause.relation === FLANQUEA_ARCO) return corta ? ", each its own piece" : ", each a separate piece on its own base on the floor, standing apart from the arch";
    return corta ? ", their tips never meeting" : ", each a separate piece whose curved tip never meets the other, with nothing joining them overhead";
  }
  return "";
}

/**
 * Escala de la pieza según el PLAN (2026-10-07, «GUIRNALDA SACA ESTA ABERRACIÓN», guiada-20261007-055050-xkkihw):
 * una guirnalda de 2,4 m y 37 globos salía «A grand organic balloon garland … running along the rear wall» —
 * «grand» porque medía ≥ 2,4 m y era focal— y FLUX pintó un marco orgánico de pared a pared con cientos de globos.
 * Con globos o medidas del plan el adjetivo sale de ellos: «grand» solo para una instalación de verdad grande,
 * «small» para una guirnalda o un bouquet corto, y nada en medio (las cifras de `fraseEscalaPieza` dicen el resto).
 */
const GLOBOS_PIEZA_GRANDIOSA = 300;
const METROS_PIEZA_GRANDIOSA = 6;
const GLOBOS_PIEZA_PEQUENA = 60;
const METROS_PIEZA_PEQUENA = 3;
/** Piezas que pueden decirse «small»: las de pie (arco, semiarco, columna) llevan su altura, no un diminutivo. */
const TIPOS_PIEZA_PEQUENA = new Set<CaptionStructureType>(["guirnalda", "bouquet", "kit"]);

function scaleFor(items: SemanticElement[], globosPorPieza?: number): string | undefined {
  if (items.length > 1) return undefined;
  if (items[0]?.semantics.structure_type === "centro_mesa") return undefined;
  // A bouquet's assembly already sizes it balloon by balloon: "a grand balloon
  // bouquet" (focal + lujosa) contradicted a five-balloon assembly.
  if (items[0]?.armadoBouquet) return undefined;
  const focal = items.some((item) => item.semantics.design_role === "focal");
  const dimensions = items.flatMap((item) => Object.values(item.semantics.dimensions_m ?? {})).filter((value): value is number => typeof value === "number");
  if (globosPorPieza !== undefined || dimensions.length) {
    const mayor = Math.max(0, ...dimensions);
    if ((globosPorPieza ?? 0) >= GLOBOS_PIEZA_GRANDIOSA || mayor >= METROS_PIEZA_GRANDIOSA) return "grand";
    // Un acento sigue siendo «compact» (el de siempre); una guirnalda o un bouquet corto, «small».
    if (items.some((item) => item.semantics.design_role === "acento")) return "compact";
    return TIPOS_PIEZA_PEQUENA.has(items[0]!.semantics.structure_type) && (globosPorPieza ?? 0) <= GLOBOS_PIEZA_PEQUENA && mayor <= METROS_PIEZA_PEQUENA ? "small" : undefined;
  }
  // Sin globos ni medidas del plan (una escena de referencia), la regla de siempre.
  if (focal && items.some((item) => item.semantics.density === "lujosa")) return "grand";
  if (items.some((item) => item.semantics.design_role === "acento")) return "compact";
  return undefined;
}

/**
 * Globos de UNA pieza de la cláusula según el plan: solo elementos del plan (`FUENTE_PLAN`), cuya `quantity` son los
 * globos que el plan compra para esa pieza. Las repeticiones reparten piso + resto (`planBlueprint`), así que dos
 * columnas de 45 y 46 son «about 46»; más diferencia que un 10 % y la cláusula no dice ninguna cifra.
 */
function globosPorPiezaDe(items: readonly SemanticElement[]): number | undefined {
  if (!items.every((item) => item.element.source_image_id === FUENTE_PLAN && quantitySemanticsFor(item.element) === "material_units")) return undefined;
  const cantidades = items.map((item) => item.element.quantity.max);
  const menor = Math.min(...cantidades);
  if (!(menor >= 2) || Math.max(...cantidades) > menor * 1.1) return undefined;
  return Math.round(cantidades.reduce((suma, cantidad) => suma + cantidad, 0) / cantidades.length);
}

/** Medidas de una pieza cuando todas las de la cláusula comparten las mismas (`dimensions_m` del plan). */
function medidasCompartidasDe(items: readonly SemanticElement[]): FluxVisualClause["medidasM"] {
  if (new Set(items.map((item) => JSON.stringify(item.semantics.dimensions_m ?? {}))).size !== 1) return undefined;
  const medidas = items[0]!.semantics.dimensions_m;
  return medidas && Object.keys(medidas).length ? { ...medidas } : undefined;
}

function salienceFor(items: SemanticElement[]): number {
  const role = items[0]?.semantics.design_role;
  if (role === "focal") return 100;
  if (role === "soporte") return 75;
  return 50;
}

// Outer fields join with U+0001, a control character that never appears in
// translated color/finish names (which can themselves contain spaces, e.g.
// "rose gold") and is distinct from the "|" used to join each inner
// color/finish list — so structuralKey can split off the trailing
// repetition group by field count without guessing an index into an
// ambiguous "|"-joined string.
const FIELD_SEP = "";

function compatibleKey(item: SemanticElement): string {
  const semantics = item.semantics;
  const colors = uniqueEnglish(item.element.resolved_colors, translateFluxColor).join("|");
  const finishes = sinAcabadoRepetido(uniqueEnglish(item.element.resolved_finishes ?? [], englishFinish)).join("|");
  const relationKey = physicalRelationsFor(item.element).map((relation) => JSON.stringify(relation)).sort().join("|");
  const motifKey = item.element.catalog_visual?.pattern.motif ?? "";
  const subjectKey = item.element.physical_form?.sujeto ?? "";
  // The official variant is part of the structure: an asymmetrical column never pairs with a plain one.
  // So is the color pattern: two different patterns (or one and none) never merge into one clause.
  return [semantics.structure_type, elementKindFor(item.element), colors, finishes, motifKey, subjectKey, relationKey, officialStructureOf(item)?.id ?? "", item.colorPattern ?? "", semantics.repetition_group].join(FIELD_SEP);
}

function officialStructureOf(item: SemanticElement): EstructuraOficial | undefined {
  return identificarEstructuraOficial({
    tipo: item.semantics.structure_type,
    densidad: item.semantics.density,
    ubicacion: item.semantics.placement,
    nombre: item.element.name,
    estructura_oficial: item.declaredOfficial,
  });
}

function structuralKey(item: SemanticElement): string {
  return compatibleKey(item).split(FIELD_SEP).slice(0, -1).join(FIELD_SEP);
}

/**
 * Renders the canonical product phrase for a clause's elements, deduplicating
 * by concept_id while preserving every distinct confirmed size code attached
 * to that concept. Only concept_id and sizeCodes drive dedupe/ordering (both
 * sorted for determinism); concept_id itself is never included in the
 * returned text, only the pre-rendered canonicalLabel.
 */
function buildCanonicalPhrase(entries: ProductConceptClauseInput[], render?: CaptionRenderState): { phrase: string; conceptIds: string[] } {
  const byConceptId = new Map<string, { canonicalLabel: string; colorName?: string; sizeCodes: Set<string> }>();
  for (const entry of entries) {
    const existing = byConceptId.get(entry.conceptId);
    const sizeCodes = existing?.sizeCodes ?? new Set<string>();
    for (const code of entry.sizeCodes ?? []) sizeCodes.add(code);
    byConceptId.set(entry.conceptId, { canonicalLabel: entry.canonicalLabel, colorName: existing?.colorName ?? entry.colorName, sizeCodes });
  }
  const conceptIds = [...byConceptId.keys()].sort();
  const sizeMode = render?.step.sizes ?? "all";
  const described: Array<{ label: string; sizes: string[] }> = [];
  const references: string[] = [];
  for (const conceptId of conceptIds) {
    const { canonicalLabel, colorName, sizeCodes } = byConceptId.get(conceptId)!;
    if (render?.step.referenceRepeatedConcepts && colorName && render.describedConceptIds.has(conceptId)) {
      references.push(colorName);
      continue;
    }
    render?.describedConceptIds.add(conceptId);
    described.push({ label: render?.step.shortLabels ? shortProductLabel(canonicalLabel) : canonicalLabel, sizes: sizeMode === "none" ? [] : [...sizeCodes] });
  }
  const fullParts = render?.step.factorLabels
    ? factorLabels(described, sizeMode)
    : described.map(({ label, sizes }) => withSizes(label, sizes, sizeMode));
  const uniqueReferences = [...new Set(references)];
  const referencePhrase = uniqueReferences.length ? `in matching ${joinNatural(uniqueReferences)}` : "";
  const phrase = fullParts.length && referencePhrase
    ? `${joinNatural(fullParts)}, with ${referencePhrase.replace(/^in /, "")}`
    : fullParts.length ? joinNatural(fullParts) : referencePhrase;
  return { phrase, conceptIds };
}

function withSizes(label: string, sizes: string[], mode: CaptionRenderStep["sizes"]): string {
  const rendered = mode === "none" ? "" : renderSizes(sizes, mode);
  return rendered ? `${label} (${rendered})` : label;
}

/**
 * Factors labels that share the object ("round latex balloon in ...") and the
 * finish ("... with a high-gloss chrome finish") into one phrase:
 * "round latex balloons in gold and silver with a high-gloss chrome finish".
 * Only the label text is regrouped; no color, finish or object is dropped.
 * Sizes of a factored group are merged into one list for that group.
 */
function factorLabels(parts: Array<{ label: string; sizes: string[] }>, mode: CaptionRenderStep["sizes"]): string[] {
  const byObject = new Map<string, Array<{ color: string; tail: string; sizes: string[] }>>();
  const standalone: string[] = [];
  const order: string[] = [];
  for (const { label, sizes } of parts) {
    const split = label.match(/^(.+?) in (.+)$/);
    const detail = split?.[2].match(/^(.+?)((?:,| with ).*)?$/);
    const color = detail?.[1];
    if (!split || !color || / and /.test(color)) {
      standalone.push(withSizes(label, sizes, mode));
      order.push(`standalone:${standalone.length - 1}`);
      continue;
    }
    const object = split[1]!;
    if (!byObject.has(object)) order.push(`object:${object}`);
    byObject.set(object, [...(byObject.get(object) ?? []), { color, tail: detail[2] ?? "", sizes }]);
  }
  return order.map((key) => {
    if (key.startsWith("standalone:")) return standalone[Number(key.slice("standalone:".length))]!;
    const object = key.slice("object:".length);
    const items = byObject.get(object)!;
    const byTail = new Map<string, string[]>();
    for (const item of items) byTail.set(item.tail, [...(byTail.get(item.tail) ?? []), item.color]);
    const colorGroups = [...byTail.entries()].map(([tail, colors]) => `${joinNatural(colors)}${tail}`);
    const noun = items.length > 1 ? pluralizeLabelObject(object) : object;
    return withSizes(`${noun} in ${colorGroups.join("; ")}`, [...new Set(items.flatMap((item) => item.sizes))], mode);
  });
}

function pluralizeLabelObject(object: string): string {
  return /balloon$/.test(object) ? `${object}s` : object;
}

function sizeValue(size: string): number {
  const match = size.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

/** Numeric order ("5-inch" before "12-inch"); a range keeps only the extremes. */
function renderSizes(sizes: string[], mode: "all" | "range"): string {
  const sorted = [...sizes].sort((a, b) => sizeValue(a) - sizeValue(b) || a.localeCompare(b));
  if (mode === "range" && sorted.length > 2) return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
  return joinNatural(sorted);
}

function createClause(
  items: SemanticElement[],
  placement = items[0]!.semantics.placement,
  productConceptsByElementId?: Map<string, ProductConceptClauseInput[]>,
): FluxVisualClause {
  const first = items[0]!;
  const elementIds = items.map((item) => item.element.element_id);
  const conceptEntries = productConceptsByElementId
    ? elementIds.flatMap((elementId) => productConceptsByElementId.get(elementId) ?? [])
    : [];
  // Only render a canonical phrase when EVERY element in the clause resolved
  // a concept — a partial match must fall back to legacy so we never mix a
  // precise label for one element with a generic color/finish guess for its
  // sibling in the same clause.
  const allElementsResolved = productConceptsByElementId
    ? elementIds.every((elementId) => (productConceptsByElementId.get(elementId)?.length ?? 0) > 0)
    : false;
  const canonical = allElementsResolved && conceptEntries.length ? buildCanonicalPhrase(conceptEntries) : undefined;
  const physicalRelations = items.flatMap((item) => physicalRelationsFor(item.element));
  const productDescriptors = [...new Set(items.map((item) => item.element.catalog_visual?.descriptor_perceptual_en).filter((value): value is string => Boolean(value)))];
  const printedMotifs = [...new Set(items.map((item) => item.element.catalog_visual?.pattern.motif).filter((value): value is string => Boolean(value)))];
  const physicalForm = items.length === 1 ? physicalFormFor(first.element) : undefined;
  const quantitySemantics = quantitySemanticsFor(first.element);
  // An assembly with a number on each side is two bouquets per plan instance
  // (Python's `grupos`): the noun counts bouquets, not plan instances.
  const gruposBouquet = first.armadoBouquet?.grupos ?? 1;
  const visibleCount = quantitySemantics === "physical_instances"
    ? Math.max(1, first.element.quantity.min)
    : gruposBouquet > 1 ? items.length * gruposBouquet : undefined;
  // Only a plan element: its `quantity` is the balloons the plan buys. A reference-only scene may carry pieces there.
  const globosCentro = first.semantics.structure_type === "centro_mesa" && quantitySemantics === "material_units"
    && items.every((item) => item.element.source_image_id === FUENTE_PLAN)
    && items.every((item) => item.element.quantity.max === first.element.quantity.max)
    && first.element.quantity.max >= 1 && first.element.quantity.max <= MAX_GLOBOS_CENTRO_NOMBRADOS
    ? first.element.quantity.max
    : undefined;
  // Un centro contado ya dice sus globos en el sustantivo, y el armado de un bouquet los cuenta globo a globo.
  const globosPorPieza = globosCentro === undefined && !first.armadoBouquet ? globosPorPiezaDe(items) : undefined;
  const medidasM = medidasCompartidasDe(items);
  return {
    elementIds,
    structureType: first.semantics.structure_type,
    noun: first.semantics.structure_type === "columna" && items.some((item) => /\borg[aá]nic[oa]/i.test(item.element.name))
      ? "organic balloon cluster arrangement"
      : STRUCTURE_NOUNS[first.semantics.structure_type],
    count: items.length,
    ...(globosCentro !== undefined ? { globosCentro } : {}),
    ...(globosPorPieza !== undefined ? { globosPorPieza } : {}),
    ...(medidasM ? { medidasM } : {}),
    colors: uniqueEnglish(items.flatMap((item) => item.element.resolved_colors), translateFluxColor),
    finishes: sinAcabadoRepetido(uniqueEnglish(items.flatMap((item) => item.element.resolved_finishes ?? []), englishFinish)),
    scale: scaleFor(items, globosPorPieza),
    density: first.semantics.density,
    placement,
    salience: salienceFor(items),
    usedFallbackSemantics: items.some((item) => item.fallback && (item.semantics.structure_type === "kit" || item.semantics.structure_type === "accesorio")),
    canonicalPhrase: canonical?.phrase,
    canonicalConceptIds: canonical?.conceptIds,
    canonicalEntries: canonical ? conceptEntries : undefined,
    elementKind: elementKindFor(first.element),
    quantitySemantics,
    visibleCount,
    physicalForm,
    productDescriptors,
    printedMotifs,
    physicalRelations,
    heightM: sharedHeight(items),
    officialStructure: officialStructureOf(first),
    // Shared by every item: the pattern is part of the grouping key.
    ...(first.colorPattern ? { colorPattern: first.colorPattern } : {}),
    ...(first.colorPattern && first.armadoBouquet ? { armadoBouquet: first.armadoBouquet } : {}),
    ...(first.colorPattern && first.armadoGuirnalda ? { armadoGuirnalda: first.armadoGuirnalda } : {}),
    ...(first.colorPattern && first.armadoGuirnaldaOrganica ? { armadoGuirnaldaOrganica: first.armadoGuirnaldaOrganica } : {}),
    ...(first.colorPattern && first.fraseDeForma ? { fraseDeForma: true as const } : {}),
  };
}

function heightOf(item: SemanticElement): number | undefined {
  return item.semantics.dimensions_m?.height;
}

function sharedHeight(items: SemanticElement[]): number | undefined {
  const heights = [...new Set(items.map(heightOf))];
  return heights.length === 1 ? heights[0] : undefined;
}

/** Heights within 15% read as the same height; beyond that the difference is part of the design. */
function similarHeights(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  return Math.max(a, b) / Math.min(a, b) < 1.15;
}

const VERTICAL_STRUCTURES = new Set<CaptionStructureType>(["arco", "semiarco", "columna"]);

/**
 * Two structures that the plan sized differently (a short half-arch and a
 * tall one) must not be drawn as a matching pair: the shortest and tallest
 * vertical structures get an explicit "shorter"/"taller".
 */
function assignHeightQualifiers(clauses: FluxVisualClause[]): void {
  for (const clause of clauses) clause.heightQualifier = undefined;
  // Compared within one structure type: a short column next to two
  // half-arches must not make the lower half-arch lose its "shorter".
  for (const type of VERTICAL_STRUCTURES) {
    const sameType = clauses.filter((clause) => clause.structureType === type && clause.heightM !== undefined);
    if (sameType.length < 2) continue;
    const heights = sameType.map((clause) => clause.heightM!);
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    if (similarHeights(min, max)) continue;
    for (const clause of sameType) {
      if (clause.heightM === min) clause.heightQualifier = "shorter";
      else if (clause.heightM === max) clause.heightQualifier = "taller";
    }
  }
  // A tall half-arch on one side and a short column on the other differ in
  // type, so the pass above never compared them and both rendered at the same
  // height (reference case of 2026-09-14).
  const laterals = separateLateralPieces(clauses).filter((clause) => clause.heightM !== undefined);
  if (laterals.length !== 2 || laterals.some((clause) => clause.heightQualifier)) return;
  const [a, b] = laterals as [FluxVisualClause, FluxVisualClause];
  if (a.placement === b.placement || similarHeights(a.heightM, b.heightM)) return;
  const [shorter, taller] = a.heightM! < b.heightM! ? [a, b] : [b, a];
  shorter.heightQualifier = "shorter";
  taller.heightQualifier = "taller";
}

/**
 * Non-mirrored half-arches and columns standing on the left or right.
 *
 * Solo para los calificadores de altura: **quién forma un par separado lo decide
 * `findSeparateSidePieces`**, y este filtro ya no responde esa pregunta.
 */
function separateLateralPieces(clauses: FluxVisualClause[]): FluxVisualClause[] {
  return clauses.filter((clause) => (clause.structureType === "semiarco" || clause.structureType === "columna")
    && !clause.bilateral
    && (clause.placement === "lateral_izquierdo" || clause.placement === "lateral_derecho"));
}

/**
 * Cómo se dice en el caption cada agrupación que encuentra el dueño de la regla.
 *
 * Es un `Record` de la unión completa a propósito: el día que `findSeparateSidePieces` gane un `kind`, esto
 * deja de compilar en vez de devolver `undefined` en silencio y perder la frase.
 */
const FRASE_PIEZAS_SEPARADAS: Record<SeparateSidePieces<FluxVisualClause>["kind"], string> = {
  half_arches: "the two curved garlands stand apart with an open gap between them",
  half_arch_and_column: "the garland and the column stand apart with an open gap between them",
  columns: "the two columns stand apart with an open gap between them",
};

/**
 * Piezas laterales que no son un par: el hueco que las separa se dice en voz alta.
 *
 * **La regla no se decide aquí.** Su dueño es `findSeparateSidePieces` (`separate-side-pieces.ts`), el mismo
 * que lee el prompt de Gemini; aquí solo se traduce su `kind` a la frase del caption. Esta función tenía su
 * propia copia del filtro, y eso es justo lo que se rompió: el 2026-10-04 se le añadió el caso de las dos
 * columnas a la copia y no al dueño, así que el caption pedía el hueco y el prompt de imagen no.
 * `test-image-qa-piezas-separadas.ts`, que compara los dos, es lo que lo detectó.
 */
function separatePiecesPhrase(clauses: FluxVisualClause[], corta = false): string | undefined {
  const pieces = findSeparateSidePieces(clauses);
  if (!pieces) return undefined;
  // Sin arco en el plan, nada pasa por encima del hueco (`piezasSueltas`); con arco, el arco sí pasa entre ellas.
  const sinArco = !clauses.some((clause) => clause.structureType === "arco");
  return `${FRASE_PIEZAS_SEPARADAS[pieces.kind]}${sinArco && !corta ? " and nothing joining them overhead" : ""}`;
}

/** Con cuántas piezas y cómo se nombran en la frase de piezas sueltas («the curved garland and the two columns»). */
function nombrePiezasDePie(tipo: "semiarco" | "columna", piezas: number): string {
  const sustantivo = tipo === "semiarco" ? "curved garland" : "column";
  return piezas === 1 ? `the ${sustantivo}` : `the ${numberWord(piezas)} ${pluralize(sustantivo)}`;
}

/**
 * N piezas de pie del plan (columnas y semiarcos) son N piezas en la imagen: una frase de escena las cuenta y pide el
 * hueco de pared entre cada una y la siguiente, y marca el semiarco suelto (`standsApart`) para que diga su punta
 * libre. Determinista: sale de las cláusulas, que salen del plan.
 *
 * Por qué. Prueba real del 2026-10-07 (FLUX base, semilla 20261007): «a … one-sided curved organic balloon garland …
 * at one side of the rear wall, two organic balloon columns …, flanking the curved garland, each a separate
 * freestanding tower …, with nothing joining them overhead» salió como UN arco completo: la guirnalda tendida de
 * una columna a la otra. FLUX.2 no admite negativos («no arch» no sirve), así que se dice en positivo cuántas piezas
 * hay y qué se ve entre ellas.
 *
 * Solo sin arco en el plan (con un arco, las piezas lo flanquean y el arco sí pasa entre ellas) y con al menos dos
 * piezas de pie. Un solo par de columnas en una cláusula ya lo dice `piezasSueltas` (verificado con la semilla del
 * caso del dueño): sin frase extra, su caption no cambia.
 */
function piezasDePieSueltas(clauses: FluxVisualClause[], corta = false, conEntorno = false): string | undefined {
  for (const clause of clauses) clause.standsApart = undefined;
  if (clauses.some((clause) => clause.structureType === "arco")) return undefined;
  const dePie = clauses.filter((clause) => clause.structureType === "semiarco" || clause.structureType === "columna");
  const cuantas = (tipo: "semiarco" | "columna") => dePie.filter((clause) => clause.structureType === tipo).reduce((suma, clause) => suma + (clause.visibleCount ?? clause.count), 0);
  const semiarcos = cuantas("semiarco");
  const columnas = cuantas("columna");
  const total = semiarcos + columnas;
  if (total < 2 || (dePie.length < 2 && semiarcos === 0)) return undefined;
  for (const clause of dePie) if (clause.structureType === "semiarco") clause.standsApart = true;
  const nombres = joinNatural([
    ...(semiarcos ? [nombrePiezasDePie("semiarco", semiarcos)] : []),
    ...(columnas ? [nombrePiezasDePie("columna", columnas)] : []),
  ]);
  // Con el entorno del evento el hueco no es «de pared lisa»: esas dos palabras pintaban la pared blanca vacía que el
  // dueño pidió quitar (2026-10-07). Sin entorno, la frase verificada de siempre.
  const deParedLisa = conEntorno ? "" : " of plain wall";
  if (corta) return `${capitalized(numberWord(total))} separate pieces with wide gaps${deParedLisa} between them`;
  return `${capitalized(nombres)} are ${numberWord(total)} separate pieces standing on the floor, with a wide empty gap${deParedLisa} between each piece and the next`;
}

function findFocalClause(clauses: FluxVisualClause[]): FluxVisualClause | undefined {
  return clauses.find((clause) => clause.salience === 100) ?? clauses[0];
}

/**
 * Cómo se nombra la pieza focal desde las que la flanquean. Solo un `arco` del plan es «the main arch»: un semiarco
 * se nombraba igual y el caption pedía un arco que el plan no tiene («semiarco + 2 columnas … flanking the main
 * arch», 2026-10-07); un aro circular (tipo `arco`) tampoco es un arco.
 */
function focusDescription(clause: FluxVisualClause | undefined): string {
  if (!clause) return "the main arrangement";
  if (clause.structureType === "arco") return clause.officialStructure?.id === "aro_circular" ? "the balloon hoop" : "the main arch";
  if (clause.structureType === "semiarco") return "the curved garland";
  return "the main arrangement";
}

const RELATION_PHRASES: Record<string, string> = {
  enmarcar: "framing",
  trepar_por: "climbing",
  envolver: "wrapping around",
  colgar_de: "suspended from",
  derramarse_sobre: "spilling onto",
  montar_sobre: "mounted on",
  apoyarse_en: "resting on",
  conectar_con: "leading toward",
  quedar_detras_de: "behind",
  quedar_debajo_de: "below",
};

const ANCHOR_PHRASES: Record<string, string> = {
  puerta: "the doorway",
  pared: "the wall",
  mesa: "the table",
  arbol: "the tree branches",
  techo: "the ceiling",
  piso: "the floor",
  fachada: "the venue facade",
  esquina: "the architectural corner",
  mobiliario_existente: "the existing furniture",
};

function targetPhrase(sceneSpec: SceneSpec, relation: PhysicalRelation): string {
  if (relation.target.kind === "ancla_espacio") {
    return ANCHOR_PHRASES[sceneSpec.venue.anchors?.find((anchor) => anchor.anchor_id === relation.target.id)?.tipo ?? ""] ?? "the approved physical anchor";
  }
  const target = sceneSpec.elements.find((element) => element.element_id === relation.target.id);
  return target?.physical_form?.sujeto ? `the balloon ${target.physical_form.sujeto} sculpture` : "the approved decoration";
}

function relationPhrase(sceneSpec: SceneSpec, relation: PhysicalRelation): string {
  const base = RELATION_PHRASES[relation.relacion] ?? relation.relacion;
  const target = targetPhrase(sceneSpec, relation);
  const distribution = relation.distribucion === "continua" ? " as one continuous installation"
    : relation.distribucion === "asimetrica" ? " asymmetrically"
      : relation.distribucion === "en_racimos" ? " in connected clusters"
        : relation.distribucion === "multipunto" ? " at multiple attachment points"
          : relation.distribucion === "alturas_escalonadas" ? " at staggered heights"
            : relation.distribucion === "recorrido" ? " forming a continuous trail" : "";
  return relation.relacion === "conectar_con" ? `${base} ${target}${distribution}` : `${base} ${target}${distribution}`;
}

function resolveRelations(sceneSpec: SceneSpec, clauses: FluxVisualClause[]): void {
  const focal = findFocalClause(clauses);
  const focalId = focal?.elementIds[0];
  const focus = focusDescription(focal);
  for (const clause of clauses) {
    if (sceneSpec.schema_version === "1.1") {
      const declared = clause.physicalRelations.find((relation) => relation.prioridad === "primaria") ?? clause.physicalRelations[0];
      if (declared) {
        clause.relation = relationPhrase(sceneSpec, declared);
        clause.anchorElementId = declared.target.id;
      }
      continue;
    }
    if (clause === focal) continue;
    if (clause.bilateral) {
      clause.relation = `flanking ${focus}`;
      clause.anchorElementId = focalId;
    } else if (clause.placement === "lateral_izquierdo" && clauses.some((other) => other !== clause && other !== focal && other.placement === "lateral_derecho" && other.structureType === clause.structureType && other.colors.join("|") === clause.colors.join("|") && other.salience === clause.salience && similarHeights(other.heightM, clause.heightM))) {
      clause.relation = `flanking ${focus}`;
      clause.anchorElementId = focalId;
    } else if (clause.structureType === "centro_mesa" && focal?.structureType === "arco") {
      clause.relation = "beneath the main arch";
      clause.anchorElementId = focalId;
    } else if (clause.structureType === "backdrop" && focalId) {
      clause.relation = "behind the main arrangement";
      clause.anchorElementId = focalId;
    }
  }
}

/**
 * One deterministic rendering of the caption. Steps are tried in order and the
 * first one that fits the budget wins, so a scene that already fits keeps the
 * full rendering. Every step keeps each structure, its placement phrase,
 * relations and every approved color; they only remove repetition and detail.
 */
type CaptionRenderStep = {
  /** Refer to a concept already described in full by its color ("in matching gold"). */
  referenceRepeatedConcepts: boolean;
  /** Merge labels sharing object and finish ("round latex balloons in gold and silver with ..."). */
  factorLabels: boolean;
  sizes: "all" | "range" | "none";
  /** Keep only the leading noun phrase of each environment cue. */
  compactEnvironment: boolean;
  /** Drop the optional style phrase and photographic qualifiers from the tail. */
  minimalTail: boolean;
  /** Drop venue environment cues from the tail; the approved decoration outranks the venue description. */
  dropEnvironment: boolean;
  /**
   * Last resort: render each product label as "object in color", dropping its
   * finish/pattern tail ("…, solid matte finish", "… with a chrome finish").
   * Object type and every approved color stay.
   */
  shortLabels: boolean;
  /**
   * Las frases de piezas sueltas (`piezasSueltas`, `piezasDePieSueltas`) en su forma corta. Va antes de perder
   * tallas o entorno: dicen lo mismo (cada pieza suelta, cuántas son, el hueco) con la mitad de caracteres.
   */
  compactSeparation: boolean;
  /*
   * Presupuesto (verificador 127, 2026-10-07): la foto 06 dejaba el caption en 1540 de 1000 AUN en el paso más
   * compacto (tres piezas del motor orgánico con sus frases de forma, el hex en cada mención y la escenografía), así
   * que se quedaba sin imagen. Estos pasos van DESPUÉS de todos los anteriores y por orden de lo menos importante:
   * nunca cortan a ciegas, nunca tocan un patrón de color ni un armado de bouquet o de guirnalda, y cada color
   * distinto conserva su hex pegado al nombre (pedido del dueño) en su primera mención.
   */
  /** Un hex por color distinto: lo lleva la primera mención («light pink (#F2B6C8)»); las siguientes, solo el nombre. */
  hexUnaVez?: boolean;
  /** «with matching …» solo con colores que la cláusula no nombra ya en su propia lista de globos. */
  referenciasNuevas?: boolean;
  /** Sin la escenografía no vendida de la foto («styled with …»): ni se compra ni se cotiza. */
  sinAmbiente?: boolean;
  /** Sin la frase de forma que el compilador añade a la columna orgánica (Python ya dice la suya). */
  sinFormaPropia?: boolean;
  /**
   * Con la frase de piezas de pie sueltas («Two separate pieces with wide gaps…»), sin la de piezas laterales
   * separadas («the garland and the column stand apart…»): las dos dicen que no se tocan.
   */
  separacionUnica?: boolean;
  /** Fragmentos (entre comas) que se conservan de cada frase de FORMA del motor orgánico, del principio al final. */
  fragmentosForma?: number;
  /** Lo último: sin el cierre fotográfico («Professional event photograph, …»). Piezas, colores y patrones quedan. */
  sinCierre?: boolean;
  /**
   * Sin el tope de talla de la escena («every balloon at most …», `fraseEscalaEscena`): es frase del compilador, como
   * la forma propia de la columna, y se va antes que la forma de Python. La escala de cada pieza (medida y globos)
   * y la tira de la guirnalda se quedan.
   */
  sinTope?: boolean;
  /**
   * La escala de cada pieza en corto («2.4 m long, about 37 balloons»: solo metros y la medida que define la pieza).
   * Va en el primer paso de compactación, antes que cualquier otra cosa: los pies son lo de menos y las frases de
   * piezas sueltas en su forma larga son las verificadas con FLUX real. `compactSeparation` también la acorta.
   */
  escalaCorta?: boolean;
  /**
   * Cuánto del ENTORNO del evento (`entorno-escena.ts`) va en este paso, si el paso lo fija: el completo en los
   * primeros (solo se quita redundancia de la decoración), el mínimo en el último. Si no lo fija, el medio mientras el
   * paso no compacta el entorno (`compactEnvironment`) y el compacto (≈180-250 caracteres, el hueco que el presupuesto
   * le reserva) desde ahí: sobrevive a toda la compactación de la decoración. Sin entorno en la entrada no cambia nada.
   */
  entorno?: Exclude<DetalleEntorno, "compacto" | "medio">;
  /** Paso que solo existe con entorno (con el mismo texto de la decoración que el anterior): sin él, se salta. */
  soloConEntorno?: boolean;
  /**
   * Red de seguridad, después del entorno mínimo: sin entorno. Con el límite de 1500 no se alcanza en ningún caso
   * probado (test-entorno-escena.ts); existe para que el entorno nunca deje sin imagen un caption que sin él cabía.
   */
  sinEntorno?: boolean;
};

/** El paso más compacto de los de siempre, base de los pasos de presupuesto. */
const PASO_MAS_COMPACTO: CaptionRenderStep = { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: true, dropEnvironment: true, shortLabels: true, compactSeparation: true };
const PASO_HEX_UNA_VEZ: CaptionRenderStep = { ...PASO_MAS_COMPACTO, hexUnaVez: true, referenciasNuevas: true };
const PASO_SIN_AMBIENTE: CaptionRenderStep = { ...PASO_HEX_UNA_VEZ, sinAmbiente: true };
const PASO_SIN_FORMA_PROPIA: CaptionRenderStep = { ...PASO_SIN_AMBIENTE, sinFormaPropia: true, separacionUnica: true };
/** De las frases de forma, primero se van los últimos fragmentos (detalles de remate y racimos), luego el resto. */
const PASO_SIN_TOPE: CaptionRenderStep = { ...PASO_SIN_FORMA_PROPIA, sinTope: true };
const PASOS_FRAGMENTOS_FORMA: readonly CaptionRenderStep[] = [8, 6, 5, 4, 3, 2, 1, 0].map((fragmentosForma) => ({ ...PASO_SIN_TOPE, fragmentosForma }));
const PASO_SIN_CIERRE: CaptionRenderStep = { ...PASO_SIN_TOPE, fragmentosForma: 0, sinCierre: true };
/** Lo último de todo, y solo con entorno: el escenario, la luz y la guarda de globos, sin utilería ni encuadre. */
const PASO_ENTORNO_MINIMO: CaptionRenderStep = { ...PASO_SIN_CIERRE, entorno: "minimo", soloConEntorno: true };
const PASO_SIN_ENTORNO: CaptionRenderStep = { ...PASO_SIN_CIERRE, sinEntorno: true, soloConEntorno: true };
const PASO_COMPLETO: CaptionRenderStep = { referenceRepeatedConcepts: false, factorLabels: false, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: false };

const CAPTION_RENDER_STEPS: readonly CaptionRenderStep[] = [
  { ...PASO_COMPLETO, entorno: "completo" },
  // Con entorno: primero se quita la pura REDUNDANCIA de la decoración (el mismo producto descrito dos veces, las
  // etiquetas que comparten objeto) con el entorno completo; después el entorno pasa a su forma media con la decoración
  // entera, y desde ahí sigue la compactación de siempre (con `compactEnvironment`, el entorno a la compacta). La escala
  // de cada pieza y su contra-forma (`escalaCorta`) no se acortan antes que el entorno de lujo. El compacto ya no se
  // quita hasta el último paso.
  { ...PASO_COMPLETO, referenceRepeatedConcepts: true, entorno: "completo", soloConEntorno: true },
  { ...PASO_COMPLETO, referenceRepeatedConcepts: true, factorLabels: true, entorno: "completo", soloConEntorno: true },
  { ...PASO_COMPLETO, soloConEntorno: true },
  { referenceRepeatedConcepts: false, factorLabels: false, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: false, escalaCorta: true },
  { referenceRepeatedConcepts: true, factorLabels: false, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: false, escalaCorta: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: false, escalaCorta: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "range", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "range", compactEnvironment: true, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: false, dropEnvironment: false, shortLabels: false, compactSeparation: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: true, dropEnvironment: false, shortLabels: false, compactSeparation: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: true, dropEnvironment: true, shortLabels: false, compactSeparation: true },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: true, dropEnvironment: true, shortLabels: true, compactSeparation: true },
  // Solo si nada de lo anterior cabe (los captions que hoy caben no cambian ni un byte).
  PASO_HEX_UNA_VEZ,
  PASO_SIN_AMBIENTE,
  PASO_SIN_FORMA_PROPIA,
  PASO_SIN_TOPE,
  ...PASOS_FRAGMENTOS_FORMA,
  PASO_SIN_CIERRE,
  PASO_ENTORNO_MINIMO,
  PASO_SIN_ENTORNO,
];

const HEX_DE_COLOR = / \(#([0-9A-Fa-f]{6})\)/g;

function sinHex(texto: string): string {
  return texto.replace(HEX_DE_COLOR, "");
}

/**
 * Con `hexUnaVez`, el hex de un color que ya salió en el caption (en una cláusula anterior o antes en esta) se quita;
 * el primero se queda pegado a su nombre. Las cláusulas se redactan en el orden en que se leen, así que «primero» es
 * la primera mención del texto. Solo el material de la cláusula: la frase de Python va tal cual.
 */
function hexSoloLaPrimeraVez(texto: string, render: CaptionRenderState): string {
  if (!render.step.hexUnaVez) return texto;
  return texto.replace(HEX_DE_COLOR, (pegado: string, hex: string) => {
    const clave = hex.toUpperCase();
    if (render.hexVistos.has(clave)) return "";
    render.hexVistos.add(clave);
    return pegado;
  });
}

/** La frase de Python de la cláusula como se escribe en este paso: entera, o la de forma con sus primeros fragmentos. */
function fraseDeLaClausula(clause: FluxVisualClause, step: CaptionRenderStep): string | undefined {
  if (!clause.colorPattern || !clause.fraseDeForma || step.fragmentosForma === undefined) return clause.colorPattern;
  const fragmentos = clause.colorPattern.split(/,\s+/);
  return fragmentos.slice(0, step.fragmentosForma).join(", ") || undefined;
}

/** "round foil balloon in fuchsia with a metallic sheen hearts pattern" -> "round foil balloon in fuchsia". */
function shortProductLabel(label: string): string {
  const match = label.match(/^(.+?) in (.+?)(?:,| with ).*$/);
  return match ? `${match[1]} in ${match[2]}` : label;
}

type CaptionRenderState = {
  step: CaptionRenderStep;
  /** Concepts already described in full earlier in the caption being rendered. */
  describedConceptIds: Set<string>;
  /** Hex codes already written next to their color (`hexUnaVez`), upper case. */
  hexVistos: Set<string>;
  /**
   * Imagen solo desde el texto (`text_to_image`): el caption elige el encuadre y puede poner la mesa que da la escala.
   * Con la foto del espacio o una imagen previa la cámara y los muebles ya están: ni plano medio ni mesa inventada.
   */
  textoAImagen: boolean;
};

/**
 * Diameters of the confirmed sizes ("12-inch") as the dataset words it: large,
 * small, or both. v004 judged size by eye and RELATIVE to the piece itself
 * (scripts/lora/recaption-v004.ts), so any mix of two diameters is "large and
 * small"; the absolute thresholds only describe a single-diameter piece.
 * Before this, a 5" + 12" mix read entirely "small" and 12" + 18" entirely
 * "large", because 10"-15" matched neither threshold.
 */
const SHADE_FAMILIES: Record<string, readonly string[]> = {
  pink: ["dusty rose", "blush cream", "blush", "mauve", "raspberry"],
  white: ["pearl", "ivory", "cream"],
  brown: ["latte", "mocha"],
  purple: ["purple orchid", "lavender", "lilac", "violet"],
  // El único tono beige del vocabulario es «sand». Sin esta línea, un plan de rosa, beige, dorado y oro rosa
  // dejaba el beige suelto y la cláusula terminaba en «... balloons (beige tones) against the rear wall»: es
  // exactamente el tinte global que el comentario de arriba describe, y la imagen salió con la pared, la
  // cortina y el piso beige (2026-10-03). «cream» se queda en `white` a propósito: ya tiene dueño, y ponerlo
  // en dos familias haría que el tono se pegara al color que viniera primero en la lista.
  beige: ["sand"],
};

/**
 * A canonical label names the product's own shade ("dusty rose"), which can
 * differ from the approved plan color it was chosen for ("rosado" -> pink).
 * The approved color must still reach the model. A trailing "in pink tones"
 * was read as a global tint (pink gradients, a pink rear wall when followed
 * by "installed against the rear wall"), so the color is attached to the
 * matching shade; only an unmatched color is kept as a parenthetical.
 */
function withApprovedColorTones(material: string, colors: string[]): string {
  let result = material;
  const unmatched: string[] = [];
  for (const color of colors) {
    if (result.toLowerCase().includes(color.toLowerCase())) continue;
    const shade = (SHADE_FAMILIES[color.toLowerCase()] ?? []).find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(result));
    if (shade) result = result.replace(new RegExp(`\\b${shade}\\b`, "i"), (match) => `${match} ${color}`);
    else unmatched.push(color);
  }
  return unmatched.length ? `${result}, accented in ${joinNatural(unmatched)}` : result;
}

/**
 * Cómo el corpus nombra la relación de tamaños dentro de una pieza (fase 3.4).
 *
 * El prompt llevaba esto como una frase suelta pegada al final —«asymmetry means
 * uneven staggered clusters and nonmatching tops, never straight matching
 * towers»—, que es una explicación en un registro que el modelo no vio nunca
 * durante el entrenamiento. El corpus lo dice de otra forma, y la dice 218 veces
 * en 180 de sus 345 captions: `mixed organically rather than graded` cuando la
 * pieza mezcla diámetros, y `all at a single N-inch size` cuando no.
 *
 * No hace falta ningún dato nuevo para decidir cuál va: los propios códigos de
 * talla confirmados de la cláusula ya lo dicen.
 */
function baseMaterialParts(entries: ProductConceptClauseInput[], render: CaptionRenderState): { balloons: string[]; pieces: string[]; references: string[]; conReparto: boolean } {
  const byConcept = new Map<string, { terms: TerminosBase; colorName?: string; sizes: string[]; units?: number }>();
  for (const entry of entries) {
    const existing = byConcept.get(entry.conceptId);
    const terms = entry.baseTerms ?? { kind: "piece" as const, label: limpiarEtiqueta(entry.canonicalLabel) };
    const units = entry.units === undefined ? existing?.units : (existing?.units ?? 0) + entry.units;
    byConcept.set(entry.conceptId, { terms, colorName: existing?.colorName ?? entry.colorName, sizes: [...(existing?.sizes ?? []), ...(entry.sizeCodes ?? [])], ...(units === undefined ? {} : { units }) });
  }
  const byNoun = new Map<string, { descriptors: Array<{ text: string; units?: number }>; sizes: string[] }>();
  const pieces: string[] = [];
  const references: string[] = [];
  // Orden del plan: el producto con más globos primero (las líneas de Python). Antes el orden era el del id de
  // producto, así que un azul del 10 % podía abrir la lista y FLUX lo pintaba dominante (2026-10-06). Sin unidades,
  // o a igualdad, el orden de siempre.
  const orden = [...byConcept.keys()].sort((a, b) => (byConcept.get(b)!.units ?? -1) - (byConcept.get(a)!.units ?? -1) || (a < b ? -1 : a > b ? 1 : 0));
  for (const conceptId of orden) {
    const { terms, colorName, sizes, units } = byConcept.get(conceptId)!;
    const reference = terms.kind === "balloon" ? terms.color : colorName;
    if (render.step.referenceRepeatedConcepts && reference && render.describedConceptIds.has(conceptId)) {
      if (!references.includes(reference)) references.push(reference);
      continue;
    }
    render.describedConceptIds.add(conceptId);
    if (terms.kind === "piece") {
      if (!pieces.includes(terms.label)) pieces.push(render.step.shortLabels ? shortProductLabel(terms.label) : terms.label);
      continue;
    }
    const descriptor = render.step.shortLabels ? terms.color : [terms.finish, terms.color].filter(Boolean).join(" ");
    const group = byNoun.get(terms.noun) ?? { descriptors: [], sizes: [] };
    const previo = group.descriptors.find((item) => item.text === descriptor);
    if (!previo) group.descriptors.push({ text: descriptor, ...(units === undefined ? {} : { units }) });
    else if (units !== undefined) previo.units = (previo.units ?? 0) + units;
    group.sizes.push(...sizes);
    byNoun.set(terms.noun, group);
  }
  // El peso de cada color se dice solo cuando la lista entera es de un mismo tipo de globo y ningún producto quedó
  // como referencia a uno ya descrito: así las partes son las de la pieza completa.
  const reparto = byNoun.size === 1 && references.length === 0 ? repartoConPeso([...byNoun.values()][0]!.descriptors) : undefined;
  const balloons = [...byNoun.entries()].map(([noun, group]) => (reparto
    ? `${[fraseTallasBase(group.sizes, render.step.sizes), noun].filter(Boolean).join(" ")}, ${reparto}`
    : [fraseTallasBase(group.sizes, render.step.sizes), joinNatural(group.descriptors.map((item) => item.text)), noun].filter(Boolean).join(" ")));
  // `referenciasNuevas`: «with matching light pink» sobra si la cláusula ya dice «light pink» en su lista de globos.
  const propios = [...byNoun.values()].flatMap((group) => group.descriptors.map((item) => sinHex(item.text)));
  const nuevas = render.step.referenciasNuevas
    ? references.filter((reference) => !propios.some((propio) => propio === sinHex(reference) || propio.endsWith(` ${sinHex(reference)}`)))
    : references;
  return { balloons, pieces, references: nuevas, conReparto: Boolean(reparto) };
}

/** Desde esta parte de los globos de la pieza un color manda («mostly»). */
const PARTE_MAYORIA = 0.5;
/** Por debajo de esta parte un color es acento («accents of»). */
const PARTE_ACENTO = 0.15;

/**
 * El peso de cada color en palabras, en el orden del plan: «mostly reflective chrome silver with satin pearlescent
 * white and accents of reflective chrome light pink». Solo con las unidades de todos y al menos un color que mande o
 * uno que sea acento; un reparto parejo sin acentos se queda en la lista ordenada (`undefined`).
 */
function repartoConPeso(descriptores: ReadonlyArray<{ text: string; units?: number }>): string | undefined {
  if (descriptores.length < 2 || descriptores.some((item) => !item.units || item.units <= 0)) return undefined;
  const total = descriptores.reduce((suma, item) => suma + item.units!, 0);
  const [primero, ...resto] = [...descriptores].sort((a, b) => b.units! - a.units!).map((item) => ({ text: item.text, parte: item.units! / total }));
  const medios = resto.filter((item) => item.parte >= PARTE_ACENTO).map((item) => item.text);
  const acentos = resto.filter((item) => item.parte < PARTE_ACENTO).map((item) => item.text);
  if (primero!.parte >= PARTE_MAYORIA) {
    const conMedios = medios.length ? ` with ${joinNatural(medios)}` : "";
    const conAcentos = acentos.length ? `${medios.length ? " and" : " with"} accents of ${joinNatural(acentos)}` : "";
    return `mostly ${primero!.text}${conMedios}${conAcentos}`;
  }
  if (!acentos.length) return undefined;
  return `${joinNatural([primero!.text, ...medios])} with accents of ${joinNatural(acentos)}`;
}

/** Structure types that are made of balloons; the others (a backdrop, an accent) are not "made of" them. */
const BASE_NON_BALLOON_TYPES = new Set<CaptionStructureType>(["backdrop", "accesorio"]);

/** Legacy path of the base dialect: the clause has no product terms, only plan colors and finishes. */
function baseLegacyMaterial(clause: FluxVisualClause): string {
  const finishes = [...new Set(clause.finishes.map(acabadoVisible).filter(Boolean))];
  const colors = clause.colors.length ? `in ${joinNatural(clause.colors)}` : "";
  if (BASE_NON_BALLOON_TYPES.has(clause.structureType)) {
    return [colors, finishes.length ? `with a ${joinNatural(finishes)} finish` : ""].filter(Boolean).join(" ");
  }
  if (!finishes.length && !colors) return "";
  return ["made of", joinNatural(finishes), "latex balloons", colors].filter(Boolean).join(" ");
}

/**
 * Clause of the `base` dialect: the same clause facts (count, structure,
 * height, placement, relations, mirrored pairs, Python's pattern phrase
 * verbatim) in plain English for a general text-to-image model. It never
 * emits a trigger, a commercial line name, a parenthetical list or a `;`.
 */
/** Up to this many balloons a centerpiece is named by its count (`globosCentro`); the same cap as Python's
 * `conteo_foto.MAX_GLOBOS_CENTRO_CONTADO`, below which the plan buys a centerpiece balloon by balloon. */
const MAX_GLOBOS_CENTRO_NOMBRADOS = 3;

/** «single-balloon centerpiece», «two-balloon centerpiece»: the noun of a counted centerpiece, or `undefined`. */
function sustantivoCentroContado(clause: FluxVisualClause): string | undefined {
  if (clause.globosCentro === undefined) return undefined;
  return clause.globosCentro === 1 ? "single-balloon centerpiece" : `${numberWord(clause.globosCentro)}-balloon centerpiece`;
}

/** The material of a one-balloon centerpiece names one balloon («made of a translucent clear latex balloon»). */
function materialCentroContado(material: string, clause: FluxVisualClause): string {
  return clause.globosCentro === 1 ? material.replace(/\bmade of (?!a |an |one )/, "made of one ").replace(/\bballoons\b/, "balloon") : material;
}

/** Qué medidas definen cada tipo de pieza y en qué orden: el largo de una guirnalda, el ancho y alto de un arco. */
function medidasDeLaPieza(clause: FluxVisualClause): Array<readonly [number, "long" | "wide" | "tall"]> {
  const medidas = clause.medidasM;
  if (!medidas) return [];
  const con = (valor: number | undefined, palabra: "long" | "wide" | "tall") => (valor === undefined ? [] : [[valor, palabra] as const]);
  switch (clause.structureType) {
    case "guirnalda":
      return con(largoGuirnalda(clause), "long");
    case "arco":
    case "pared":
    case "backdrop":
      return [...con(medidas.width, "wide"), ...con(medidas.height, "tall")];
    case "columna":
      return con(medidas.height, "tall");
    default:
      return [...con(medidas.height, "tall"), ...con(medidas.width, "wide"), ...con(medidas.length, "long")];
  }
}

/**
 * La escala de UNA pieza, del plan: sus medidas y sus globos («2.4 m / 8 ft long with about 37 balloons»; con varias
 * piezas, «each …»). Sin medidas ni globos del plan, nada. `corta` (`escalaCorta` o `compactSeparation`): la medida
 * principal en metros y la cifra.
 * `conGlobos`: falso cuando la pieza no es de globos (un fondo, un producto que es la pieza).
 */
function fraseEscalaPieza(clause: FluxVisualClause, piezas: number, corta: boolean, conGlobos: boolean): string {
  // En corto, la medida que define la pieza (la primera de `medidasDeLaPieza`) y la cifra de globos.
  const medidas = medidasDeLaPieza(clause).slice(0, corta ? 1 : undefined).map(([metros, palabra]) => `${medidaBase(metros, corta)} ${palabra}`);
  const globos = conGlobos && !BASE_NON_BALLOON_TYPES.has(clause.structureType) && clause.globosPorPieza !== undefined
    ? `about ${clause.globosPorPieza} balloons`
    : "";
  if (!medidas.length && !globos) return "";
  // Solo la cifra de una pieza va pegada al sustantivo, sin comas: «a small balloon bouquet of about 12 balloons».
  if (!medidas.length && piezas === 1) return `of ${globos}`;
  const texto = corta
    ? [...medidas, globos].filter(Boolean).join(", ")
    : [joinNatural(medidas), globos ? `with ${globos}` : ""].filter(Boolean).join(" ");
  return piezas > 1 ? `each ${texto}` : texto;
}

function renderBaseClauseText(clause: FluxVisualClause, render: CaptionRenderState): string {
  const entries = clause.canonicalEntries ?? [];
  const parts = clause.canonicalPhrase && entries.length ? baseMaterialParts(entries, render) : undefined;
  const official = clause.officialStructure?.sustantivoEn;
  const organicColumn = clause.structureType === "columna" && clause.officialStructure?.id === "columna_asimetrica";
  const baseNoun = sustantivoCentroContado(clause) ?? (organicColumn ? "organic balloon column" : official ?? SUSTANTIVOS_ESTRUCTURA_BASE[clause.structureType as keyof typeof SUSTANTIVOS_ESTRUCTURA_BASE] ?? clause.noun);
  // A product that is itself the piece (a foil banner, a printed mural) names the clause.
  const productIsThePiece = Boolean(parts && !parts.balloons.length && parts.pieces.length && !clause.officialStructure && ["kit", "accesorio"].includes(clause.structureType));
  const sizedNoun = clause.heightQualifier ? `${clause.heightQualifier} ${baseNoun}` : baseNoun;
  const noun = productIsThePiece ? joinNatural(parts!.pieces) : clause.scale ? `${clause.scale} ${sizedNoun}` : sizedNoun;
  let material = "";
  if (parts && !productIsThePiece) {
    const matching = parts.references.length ? `matching ${joinNatural(parts.references)}` : "";
    const segments = [
      parts.balloons.length ? `made of ${joinNatural(parts.balloons)}` : "",
      parts.pieces.length ? `with ${joinNatural(parts.pieces)}` : "",
    ].filter(Boolean);
    material = segments.length ? [segments.join(" "), matching].filter(Boolean).join(", with ") : matching ? `in ${matching}` : "";
  } else if (!parts && !clause.productDescriptors.length) {
    material = baseLegacyMaterial(clause);
  }
  material = material ? hexSoloLaPrimeraVez(materialCentroContado(withApprovedColorTones(material, clause.colors), clause), render) : material;
  const descriptorText = clause.physicalForm?.descripcion_perceptual_en ?? (!parts ? clause.productDescriptors[0] : undefined);
  const descriptor = descriptorText ? limpiarEtiqueta(descriptorText) : undefined;
  const renderedCount = clause.visibleCount ?? clause.count;
  const article = /^[aeiou]/i.test(noun) && !/^one\b/i.test(noun) ? "an" : "a";
  const core = descriptor
    ? renderedCount === 1 ? descriptor : `${numberWord(renderedCount)} ${descriptor}`
    : renderedCount === 1 ? `${article} ${noun}` : `${numberWord(renderedCount)} ${pluralize(noun)}`;
  // Python's pattern phrase follows the material, verbatim (ADR-0028 §12); only an organic-engine SHAPE phrase is
  // shortened, by whole fragments, in the last budget steps (`fragmentosForma`).
  const frase = fraseDeLaClausula(clause, render.step);
  const shapeCue = organicColumn && !render.step.sinFormaPropia ? "with an uneven, deep silhouette and large balloons interspersed among small cluster fillers" : "";
  // Tras el reparto («… and accents of pink») una coma: sin ella la frase de Python («with silver, pink and white
  // scattered…») se leía como parte del último acento.
  const trasMaterial = parts?.conReparto && material && (frase || shapeCue) ? `${material},` : material;
  // Sujeto y escala primero (FLUX.2 atiende más a lo que va antes): «a small organic balloon garland, 2.4 m / 8 ft
  // long with about 37 balloons, made of …».
  const escala = fraseEscalaPieza(clause, renderedCount, Boolean(render.step.escalaCorta) || render.step.compactSeparation, !productIsThePiece);
  const sujeto = !escala ? core : escala.startsWith("of ") ? `${core} ${escala}` : `${core}, ${escala},`;
  const colored = [sujeto, trasMaterial, frase, shapeCue].filter(Boolean).join(" ");
  // Con la escala delante, el reparto de colores («… and matte white») cierra con coma antes de la ubicación: sin ella
  // «matte white hung horizontally on the rear wall» se leía como si colgara solo el blanco.
  const antesDeUbicacion = clause.structureType === "guirnalda" && escala && parts?.conReparto && material && !frase && !shapeCue ? "," : "";
  // The same shape fixes the scene dialect learned: a lone side piece stands
  // apart from the focal arch, a half-arch elsewhere keeps its one-sided
  // shape, a garland without an assembly runs along its surface instead of
  // standing on legs. Those phrases are already plain English.
  const conArmado = Boolean(clause.armadoGuirnalda ?? clause.armadoGuirnaldaOrganica);
  const guirnaldaCortaEnPared = clause.structureType === "guirnalda" && !conArmado && clause.placement === "fondo_pared" && guirnaldaCorta(clause);
  const colgadaEnPared = render.textoAImagen ? GUIRNALDA_CORTA_EN_PARED : GUIRNALDA_CORTA_EN_PARED_DE_LA_FOTO;
  const placementPhrase = clause.placement === "lateral_izquierdo" ? "standing apart on the left"
    : clause.placement === "lateral_derecho" ? "standing apart on the right"
      : (clause.structureType === "semiarco" ? UBICACIONES_SEMIARCO_BASE[clause.placement] : undefined)
        ?? (guirnaldaCortaEnPared ? colgadaEnPared : undefined)
        ?? (clause.structureType === "guirnalda" && !conArmado ? UBICACIONES_GUIRNALDA_BASE[clause.placement] : undefined)
        ?? UBICACIONES_BASE[clause.placement];
  if (clause.structureType === "backdrop") return `${colored} ${clause.relation ? `${placementPhrase}, ${clause.relation}` : placementPhrase}`;
  // N columnas o semiarcos son N piezas sueltas: cada una con su base y su remate (`piezasSueltas`).
  const sueltas = piezasSueltas(clause, renderedCount, render.step.compactSeparation);
  if (renderedCount > 1 && clause.placement === "lateral_izquierdo" && (clause.bilateral || clause.relation?.startsWith("flanking"))) {
    const reparto = renderedCount > 2 && renderedCount % 2 === 0
      ? `${numberWord(renderedCount / 2)} standing on each side`
      : "one standing on the left and one on the right";
    return `${colored}, matching one another, ${reparto}${huecoEntrePar(clause)}${clause.relation ? `, ${clause.relation}` : ""}${sueltas}`;
  }
  if (clause.relation && clause.structureType === "centro_mesa") return `${colored}${antesDeUbicacion} ${placementPhrase} ${clause.relation}`;
  if (clause.relation) return `${colored}${antesDeUbicacion} ${placementPhrase}, ${clause.relation}${sueltas}`;
  return `${colored}${antesDeUbicacion} ${placementPhrase}${sueltas}`;
}

function renderClauseText(clause: FluxVisualClause, render: CaptionRenderState): string {
  return renderBaseClauseText(clause, render);
}

function buildEventPhrase(context: VisualContext): string | undefined {
  const key = normalized(context.eventType);
  const phrase = EVENT_WORDS[key];
  if (!phrase) return undefined;
  const article = /^[aeiou]/i.test(phrase) ? "an" : "a";
  return `set up for ${article} ${phrase}`;
}

function buildStylePhrase(context: VisualContext): string | undefined {
  const style = STYLE_WORDS[normalized(context.style)];
  return style ? `${style} event decor` : undefined;
}

function dedupeEnvironment(context: VisualContext, eventPhrase?: string): string[] {
  const knownEvent = eventPhrase?.replace(/^set up for (?:a|an) /i, "").toLowerCase();
  return buildFluxEnvironmentCues(context).filter((cue) => {
    const normalizedCue = cue.toLowerCase();
    return !normalizedCue.startsWith("open event cue:") && (!knownEvent || !normalizedCue.includes(knownEvent));
  });
}

function groupClauses(sceneSpec: SceneSpec, productConceptsByElementId?: Map<string, ProductConceptClauseInput[]>, officialStructures?: ReadonlyMap<string, string>, colorPatterns?: readonly FraseDeEstructura[]): FluxVisualClause[] {
  // Repeated plan structures materialize as `<estructura_id>#<n>` elements.
  const items = sceneSpec.elements.map((element, index) => ({
    ...semanticFor(element, index, sceneSpec, officialStructures?.get(element.element_id) ?? officialStructures?.get(element.element_id.split("#")[0]!)),
    colorPattern: frasePatronColor(colorPatterns, element, "prompt_lora"),
    armadoBouquet: armadoDeElemento(colorPatterns, element),
    armadoGuirnalda: armadoGuirnaldaDeElemento(colorPatterns, element),
    armadoGuirnaldaOrganica: armadoGuirnaldaOrganicaDeElemento(colorPatterns, element),
    fraseDeForma: fraseDeFormaDeElemento(colorPatterns, element),
  }));
  const used = new Set<string>();
  const clauses: FluxVisualClause[] = [];

  // Matching lateral structures are one spatial instruction, even when the plan
  // materialized them as separate physical elements. Every mirrored pair of the
  // same structure goes into the SAME clause: two pairs used to render the
  // identical pair sentence twice ("two columns ... flanking the main arch, two
  // columns ... flanking the main arch") instead of naming the four pieces once.
  const bilateralGroups = new Map<string, SemanticElement[]>();
  const leftItems = items.filter((item) => item.semantics.placement === "lateral_izquierdo");
  for (const left of leftItems) {
    if (used.has(left.element.element_id)) continue;
    const right = items.find((candidate) =>
      candidate.semantics.placement === "lateral_derecho"
      && candidate.semantics.structure_type === left.semantics.structure_type
      && structuralKey(candidate) === structuralKey(left)
      && similarHeights(heightOf(candidate), heightOf(left))
      && candidate.semantics.design_role === left.semantics.design_role
      && !used.has(candidate.element.element_id),
    );
    if (!right) continue;
    used.add(left.element.element_id);
    used.add(right.element.element_id);
    const key = structuralKey(left);
    bilateralGroups.set(key, [...(bilateralGroups.get(key) ?? []), left, right]);
  }
  for (const group of bilateralGroups.values()) {
    const pair = createClause(group, "lateral_izquierdo", productConceptsByElementId);
    pair.bilateral = true;
    clauses.push(pair);
  }

  const groups = new Map<string, SemanticElement[]>();
  for (const item of items) {
    if (used.has(item.element.element_id)) continue;
    const key = `${compatibleKey(item)}|${item.semantics.placement}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) clauses.push(createClause(group, undefined, productConceptsByElementId));
  return clauses.sort((a, b) => b.salience - a.salience || a.elementIds[0]!.localeCompare(b.elementIds[0]!));
}

/** "recognizable indoor event hall with real walls, ..." -> "recognizable indoor event hall". */
function compactEnvironmentCue(cue: string): string {
  return cue.split(/,|\s+with\s+/)[0]!.trim() || cue;
}

/**
 * Every v004 caption ends in "set against <wall> and <floor>" (154/154). The
 * venue cue becomes that setting; event and lighting cues follow it.
 * `dropEnvironment` removes those other cues but keeps the setting; only the
 * la compactación conserva el entorno cuando el prompt aún cabe.
 */
type CaptionParts = {
  /** One rendered phrase per clause, focal first. */
  subjects: string[];
  /** Color pattern of the clause behind each subject (same order), when it has one. */
  subjectPatterns: Array<string | undefined>;
  structureSentence: string;
  /** How many separate standing pieces the scene has and the gap between them (`piezasDePieSueltas`), when it applies. */
  pieceCountSentence?: string;
  /** Lo que la escena NO es, dicho en positivo (`fraseEscalaEscena`): la tira de la guirnalda y el tope de talla. */
  scaleSentence?: string;
  /** El entorno del evento (`entorno-escena.ts`), después de la decoración y antes de la cola fotográfica. */
  entornoSentence?: string;
  /** El encuadre del entorno (`ENCUADRE_ESCENA`): la PRIMERA frase del caption, antes de la decoración. */
  encuadreSentence?: string;
  tail: string[];
  colors: string[];
  /** Every piece is a garland on the wall or hanging (`soloGuirnaldasEnAlto`): no "grounded supports". */
  enAlto: boolean;
};

/**
 * La talla mayor de toda la escena según el plan, o `undefined` si alguna pieza de globos no dice todas sus tallas
 * (entonces no se sabe y no se acota nada). Solo tallas «N-inch» (`producto-flux.ts`); cualquier otra la deja sin tope.
 */
function tallaMaximaDeLaEscena(clauses: readonly FluxVisualClause[]): number | undefined {
  let maxima = 0;
  for (const clause of clauses) {
    if (BASE_NON_BALLOON_TYPES.has(clause.structureType)) continue;
    const entradas = clause.canonicalEntries ?? [];
    if (!entradas.length) return undefined;
    for (const entrada of entradas) {
      if (!entrada.sizeCodes?.length) return undefined;
      for (const talla of entrada.sizeCodes) {
        const pulgadas = talla.match(/^(\d+(?:\.\d+)?)-inch$/);
        if (!pulgadas) return undefined;
        maxima = Math.max(maxima, Number(pulgadas[1]));
      }
    }
  }
  return maxima || undefined;
}

/**
 * Lo que la pieza NO es, en positivo (FLUX.2 no admite negativos: «Focus on describing what you want», guía de
 * prompts de BFL; nombrar «arch» o «giant balloons», aunque sea negado, se los pone en la cabeza, y las pruebas de
 * ADR-0032 ya prohíben «arch» en el texto de una guirnalda armada). Caso real (guiada-20261007-055050-xkkihw): una
 * guirnalda de 2,4 m y 37 globos salió como un marco orgánico de pared a pared con globos de 36″.
 *
 * - Guirnaldas de pared sin armado del motor, en una escena sin arcos: una sola tira horizontal con los extremos
 *   libres (no se cierra en un portal ni baja al piso) y, si es corta, que cubre solo parte de la pared.
 * - Tope de talla: si el plan no compra globos de 24″ o más, ninguno pasa de su talla mayor (con su objeto).
 */
function fraseEscalaEscena(clauses: readonly FluxVisualClause[], corta: boolean, sinTope = false): string | undefined {
  const conArcos = clauses.some((clause) => clause.structureType === "arco" || clause.structureType === "semiarco");
  const tiras = conArcos ? [] : clauses.filter((clause) => clause.structureType === "guirnalda"
    && !clause.armadoGuirnalda && !clause.armadoGuirnaldaOrganica && GUIRNALDAS_EN_PARED.has(clause.placement));
  const piezas = tiras.reduce((suma, clause) => suma + (clause.visibleCount ?? clause.count), 0);
  const parteDeLaPared = tiras.length > 0 && tiras.every(guirnaldaCorta) ? " spanning only part of the wall" : "";
  const tira = !piezas ? "" : corta
    ? `${piezas > 1 ? "each garland one" : "one"} horizontal strip${parteDeLaPared}, ends free`
    : `${piezas > 1 ? "each garland one" : "one single"} horizontal strip${parteDeLaPared}, both ends hanging free in mid-air`;
  const maxima = sinTope ? undefined : tallaMaximaDeLaEscena(clauses);
  const tope = maxima === undefined ? undefined : topeTallaBase(maxima, corta);
  const partes = [tira, tope].filter(Boolean);
  return partes.length ? partes.join(", ") : undefined;
}

/**
 * Escena pequeña (todas sus piezas con globos del plan, 80 o menos en total y ninguna medida de más de 3 m): un
 * plano medio. Sin él, FLUX base encuadra un salón entero y agranda la pieza hasta llenarlo.
 */
const GLOBOS_ESCENA_PEQUENA = 80;
function escenaPequena(clauses: readonly FluxVisualClause[]): boolean {
  if (!clauses.length || !clauses.every((clause) => clause.globosPorPieza !== undefined)) return false;
  const globos = clauses.reduce((suma, clause) => suma + clause.globosPorPieza! * (clause.visibleCount ?? clause.count), 0);
  const mayor = Math.max(0, ...clauses.flatMap((clause) => Object.values(clause.medidasM ?? {}).filter((valor): valor is number => typeof valor === "number")));
  return globos <= GLOBOS_ESCENA_PEQUENA && mayor <= METROS_PIEZA_PEQUENA;
}

/**
 * Every clause of the caption is a garland whose assembly (Python, ADR-0032)
 * puts it on the wall or hanging from anchor points. Then the closing
 * "grounded supports" has nothing to ground and gives the LoRA a reason to
 * stand the garland on legs: a wall garland came out as a rectangular arch on
 * metal stands (2026-09-28, decision 28). A scene with any other piece, or a
 * garland without an assembly, keeps its caption byte for byte.
 */
/** Ubicaciones en las que una guirnalda va sujeta a una superficie, no apoyada en el piso. */
const GUIRNALDAS_SIN_PISO = new Set<FluxPlacement>(["fondo_pared", "pared_lateral", "techo", "techo_multipunto", "fachada"]);

/**
 * Toda la escena son guirnaldas que no se apoyan en el piso, así que la cola no debe prometer apoyos en el
 * suelo. La decisión 28 de ADR-0032 anotó que «"against the wall" a secas, con la cola "grounded supports"»
 * sacaba un arco de pie con patas, y es el mismo fallo que arregla `SCENE_V004_GARLAND_PLACEMENTS`.
 *
 * Hasta el 2026-10-03 esto **no podía ser verdad nunca**: pedía un `armadoGuirnalda` de ADR-0032, que viaja
 * detrás de una bandera apagada por defecto, y además `createClause` solo lo pone en la cláusula cuando la
 * pieza trae también patrón de color. Las guirnaldas del motor orgánico (ADR-0034), que son las que se arman
 * hoy, no llevan ninguna de las dos cosas: todas salían con «grounded supports». La ubicación del plan dice
 * lo mismo y siempre está.
 */
function soloGuirnaldasEnAlto(clauses: readonly FluxVisualClause[]): boolean {
  const conCaida: readonly SoporteGuirnalda[] = SOPORTES_CON_CAIDA_GUIRNALDA;
  return clauses.length > 0 && clauses.every((clause) => {
    // Quien armó la pieza lo sabe mejor que su ubicación: el motor conoce a qué altura va su línea.
    if (clause.armadoGuirnalda) return conCaida.includes(clause.armadoGuirnalda.soporte);
    if (clause.armadoGuirnaldaOrganica) return clause.armadoGuirnaldaOrganica.enAlto;
    return clause.structureType === "guirnalda" && GUIRNALDAS_SIN_PISO.has(clause.placement);
  });
}

/**
 * Piezas que se cuentan solas en la imagen: las de pie (arco, semiarco, columna). Una guirnalda en el piso o en la
 * pared ya no es «de pie», y la frase de piezas sueltas la deja fuera de su cuenta («Two separate pieces…» con un
 * semiarco, una columna y una guirnalda al frente, ej06): contarla daría dos números distintos en el mismo caption.
 */
const PIEZAS_CONTABLES: ReadonlySet<CaptionStructureType> = new Set<CaptionStructureType>(["arco", "semiarco", "columna"]);

/**
 * Cuántas piezas sueltas tiene la decoración, para la guarda del entorno («the only balloons are the three pieces
 * described»): ronda 2 del caso del dueño (arco + 2 columnas, guiada-20261007-070255-dzwwhq), dos de tres imágenes
 * dibujaron una columna de más, y con un arco la frase de piezas de pie sueltas (`piezasDePieSueltas`) no aplica. Solo
 * si todas son estructuras de globo de pie, ninguna montada sobre otra (sin relación, o flanqueando o enmarcando), y
 * son de 2 a 6; si no, `undefined` y la guarda va sin número.
 */
function piezasContadas(clauses: readonly FluxVisualClause[]): number | undefined {
  const contables = clauses.every((clause) => clause.elementKind === "balloon_structure"
    && PIEZAS_CONTABLES.has(clause.structureType)
    && (!clause.relation || /^(?:flanking|framing)\b/.test(clause.relation)));
  if (!contables) return undefined;
  const total = clauses.reduce((suma, clause) => suma + (clause.visibleCount ?? clause.count), 0);
  return total >= 2 && total <= 6 ? total : undefined;
}

function buildCaption(sceneSpec: SceneSpec, context: VisualContext, clauses: FluxVisualClause[], step: CaptionRenderStep = CAPTION_RENDER_STEPS[0]!, ambientDecor: readonly string[] = [], creativeCues: readonly string[] = [], entorno?: EntornoEscena): string {
  const parts = buildCaptionParts(sceneSpec, context, clauses, step, ambientDecor, creativeCues, entorno);
  const piezas = parts.pieceCountSentence ? `${parts.pieceCountSentence}. ` : "";
  const escala = parts.scaleSentence ? `${capitalized(parts.scaleSentence)}. ` : "";
  // El encuadre del entorno abre el caption (FLUX.2 lee primero lo primero: al final se ignoraba); después la decoración
  // (sujeto y escala), el entorno del evento y la cola fotográfica al final.
  const encuadre = parts.encuadreSentence ? `${parts.encuadreSentence}. ` : "";
  const escena = parts.entornoSentence ? `${capitalized(parts.entornoSentence)}. ` : "";
  // Sin cola (`sinCierre` sin evento): la frase acaba en las piezas, sin un «.» suelto.
  const cola = parts.tail.length ? `${capitalized(parts.tail.join(", "))}.` : "";
  return `${encuadre}${capitalized(parts.structureSentence)}. ${piezas}${escala}${escena}${cola}`.trimEnd();
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function buildCaptionParts(sceneSpec: SceneSpec, context: VisualContext, clauses: FluxVisualClause[], step: CaptionRenderStep, ambientDecor: readonly string[], creativeCues: readonly string[] = [], entorno?: EntornoEscena): CaptionParts {
  resolveRelations(sceneSpec, clauses);
  assignHeightQualifiers(clauses);
  // Antes de redactar: marca el semiarco suelto (`standsApart`), que su cláusula lee.
  const pieceCountSentence = piezasDePieSueltas(clauses, step.compactSeparation, Boolean(entorno && !step.sinEntorno));
  const textoAImagen = sceneSpec.generation_mode === "text_to_image";
  const render: CaptionRenderState = { step, describedConceptIds: new Set<string>(), hexVistos: new Set<string>(), textoAImagen };
  const clauseText = (clause: FluxVisualClause) => renderClauseText(clause, render);
  const focal = clauses[0];
  const hasCanonicalSemantics = sceneSpec.elements.every((element) => Boolean(element.visual_semantics));
  const conciseClause = (clause: FluxVisualClause): FluxVisualClause => {
    // A patterned clause keeps its own colors: the pattern is laid out in them.
    if (!hasCanonicalSemantics || !focal || clause === focal || !clause.colors.length || clause.colorPattern) return clause;
    const focalColors = new Set(focal.colors);
    return clause.colors.every((color) => focalColors.has(color)) ? { ...clause, colors: [] } : clause;
  };
  const supports = clauses.filter((clause) => clause !== focal && clause.salience >= 70);
  const accents = clauses.filter((clause) => clause !== focal && clause.salience < 70);
  const firstClause = focal ? clauseText(focal) : "a cohesive balloon decoration";
  const supportText = supports.map((clause) => clauseText(conciseClause(clause)));
  const accentText = accents.map((clause) => clauseText(conciseClause(clause)));
  const structureParts = [firstClause, ...supportText];
  let structureSentence = structureParts.join(", ");
  if (accentText.length) structureSentence += `, with ${accentText.join(", ")}`;
  const separation = step.separacionUnica && pieceCountSentence ? undefined : separatePiecesPhrase(clauses, step.compactSeparation);
  if (separation) structureSentence += `, ${separation}`;
  // Styling from the reference that is not sold (lights, foliage): rendered, never quoted.
  if (ambientDecor.length && !step.sinAmbiente) structureSentence += `, styled with ${joinNatural([...ambientDecor])}`;

  const hasLocalColors = clauses.some((clause) => clause.colors.length > 0);
  const globalPalette = !hasLocalColors && context.palette.length
    ? `in ${joinNatural(uniqueEnglish(context.palette, translateFluxColor))}`
    : undefined;
  // El entorno del evento (si lo hay) sustituye las pistas sueltas de lugar, luz y evento: las dice todas juntas, con su
  // utilería y su encuadre. Su mesa es la «main table» que ya nombre la decoración, no una segunda.
  // Dice qué hay DETRÁS de las piezas (el salón con invitados); con todas colgadas (`enAlto`), a sus lados. Su guarda
  // de globos dice cuántas piezas son, si se pueden contar (`piezasContadas`).
  const enAlto = soloGuirnaldasEnAlto(clauses);
  const frasesEntorno = entorno && !step.sinEntorno ? fraseEntorno(entorno, step.entorno ?? (step.compactEnvironment ? "compacto" : "medio"), { mesaPrincipal: /\bmain table\b/i.test(structureSentence), enAlto, piezas: piezasContadas(clauses) }) : undefined;
  const eventPhrase = frasesEntorno || context.eventCue ? undefined : buildEventPhrase(context);
  const hasCanonicalProducts = clauses.some((clause) => Boolean(clause.canonicalPhrase));
  const tail = [
    eventPhrase,
    step.minimalTail ? undefined : buildStylePhrase(context),
    ...(step.minimalTail ? [] : creativeCues),
    globalPalette,
    ...(frasesEntorno || step.dropEnvironment ? [] : dedupeEnvironment(context, eventPhrase).map((cue) => step.compactEnvironment ? compactEnvironmentCue(cue) : cue)),
    // Una escena pequeña se encuadra en plano medio: la pieza se ve de su tamaño junto a la mesa o la pared.
    step.sinCierre || !textoAImagen || !escenaPequena(clauses) ? undefined : ENCUADRE_ESCENA_PEQUENA_BASE,
    step.sinCierre ? undefined : CIERRE_FOTOGRAFICO_BASE,
    step.minimalTail ? undefined : enAlto ? "natural depth" : hasCanonicalProducts ? "natural depth, grounded supports" : "natural depth, believable floor contact and supports",
  ].filter((part): part is string => Boolean(part));
  const scaleSentence = fraseEscalaEscena(clauses, Boolean(step.escalaCorta) || step.compactSeparation, step.sinTope);
  return {
    subjects: [firstClause, ...supportText, ...accentText],
    subjectPatterns: [focal, ...supports, ...accents].map((clause) => clause?.colorPattern),
    structureSentence,
    ...(pieceCountSentence ? { pieceCountSentence } : {}),
    ...(scaleSentence ? { scaleSentence } : {}),
    ...(frasesEntorno ? { entornoSentence: frasesEntorno.escena } : {}),
    ...(frasesEntorno?.encuadre ? { encuadreSentence: frasesEntorno.encuadre } : {}),
    tail,
    colors: [...new Set(clauses.flatMap((clause) => clause.colors))],
    enAlto,
  };
}

/**
 * Contexto visual neutro para los consumidores que solo necesitan la
 * AGRUPACIÓN del compilador (qué elementos forman un par reflejado, qué
 * estructura oficial es cada uno) y descartan la redacción: la cláusula de
 * piezas laterales del prompt de imagen y otros lectores de agrupación. Vive
 * aquí para que todos lean exactamente la misma agrupación.
 */
export const GROUPING_ONLY_CONTEXT: VisualContext = { venueKind: "unknown", lightingKind: "unspecified", palette: [] };

export function compileFluxCaption(input: {
  sceneSpec: SceneSpec;
  visualContext: VisualContext;
  /**
   * Optional per-element canonical product concepts (see
   * producto-flux.ts). Purely additive: omitting this field preserves
   * the exact legacy color/finish rendering used by every existing caller.
   */
  productConcepts?: ProductConceptClauseInput[];
  /** Límite de caracteres del caption base. */
  maxLength?: number;
  /** `estructura_oficial` per plan `estructura_id`, from the approved plan. */
  officialStructures?: ReadonlyMap<string, string>;
  /**
   * Non-catalog styling relevant to the composition (see
   * `ambientDecorFromReference`). Plain English names; never structures,
   * never products, never quoted.
   */
  ambientDecor?: readonly string[];
  /** Plain English styling cues of the creativity level (creatividad.ts); dropped first when compacting. */
  creativeCues?: readonly string[];
  /**
   * `plan_resuelto.patrones_color`, `armados_bouquet` and `armados_guirnalda`
   * as Python wrote them (ADR-0028 §12, ADR-0030, ADR-0032;
   * `frasesDeEstructuras`). Only the `prompt_lora` of an applied phrase is
   * inserted, verbatim; the compiler never words, expands or counts a pattern
   * or an assembly. Absent: the legacy caption.
   */
  colorPatterns?: readonly FraseDeEstructura[];
  /**
   * El entorno del evento (`entornoDeEscena`, entorno-escena.ts): escenario, utilería, luz y encuadre, después de la
   * decoración. Su forma compacta tiene hueco reservado en todos los pasos de presupuesto. Sin él, la cola de siempre.
   */
  entorno?: EntornoEscena;
}): FluxCaptionCompilation {
  const productConceptsByElementId = input.productConcepts?.length
    ? input.productConcepts.reduce((map, entry) => {
        const existing = map.get(entry.elementId) ?? [];
        existing.push(entry);
        map.set(entry.elementId, existing);
        return map;
      }, new Map<string, ProductConceptClauseInput[]>())
    : undefined;
  const clauses = groupClauses(input.sceneSpec, productConceptsByElementId, input.officialStructures, input.colorPatterns);
  const budget = input.maxLength ?? BASE_PROMPT_MAX_LENGTH;
  // El compilador elimina líneas comerciales antes de validar el texto.
  const palabrasQuitadas = new Set<string>();
  const limpiar = (texto: string): string => {
    const limpio = limpiarTextoBase(texto);
    for (const palabra of limpio.quitadas) palabrasQuitadas.add(palabra);
    // El oro rosa con el rosa delante en TODO el texto, también en las frases que escribe Python (patrones,
    // armados): «rose gold» a secas FLUX lo pinta dorado (banco de fotos 07, 2026-10-06; `rosaDelante`).
    return rosaDelante(limpio.texto);
  };
  let prompt = "";
  let compactionStep = 0;
  // If no step fits, the most compact rendering is returned unchanged and the
  // preflight rejects it: the compiler never truncates structures, colors or a
  // color pattern (no step touches the pattern; the tail and setting go first).
  // The last budget steps (verificador 127) write each color's hex once, drop
  // the unsold scenery and the compiler's own column shape cue, and only then
  // shorten an organic-engine SHAPE phrase by whole fragments from its end.
  // Sin entorno, los pasos que solo existen para él se saltan y la numeración es la de siempre.
  const pasos = CAPTION_RENDER_STEPS.filter((step) => input.entorno || !step.soloConEntorno);
  for (const [index, step] of pasos.entries()) {
    prompt = limpiar(buildCaption(input.sceneSpec, input.visualContext, clauses, step, input.ambientDecor, input.creativeCues, input.entorno));
    compactionStep = index;
    if (prompt.length <= budget) break;
  }
  return {
    prompt,
    clauses,
    compilerVersion: FLUX_CAPTION_COMPILER_VERSION,
    usedCatalogProducts: clauses.some((clause) => Boolean(clause.canonicalPhrase)),
    compactionStep,
    palabrasQuitadas: [...palabrasQuitadas],
  };
}

export function buildFluxImagePromptV2(input: { sceneSpec: SceneSpec; visualContext: VisualContext }): string {
  return compileFluxCaption(input).prompt;
}
