import { AMBIENTACION_IMAGEN, perfilCreatividad, type AmbientacionImagen, type NivelCreatividad } from "./creatividad";
import { identificarEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { describirMezclaDeColor, mezclaDeColorDeEstructura } from "./mezcla-color-escena";
import { tableSupportedElements, type SceneryElement, type SceneSpec } from "./scene-spec";
import { buildLoraImagePromptV2, compileLoraCaption, GROUPING_ONLY_CONTEXT, type LoraVisualClause } from "./lora-caption-compiler";
import { findSeparateSidePieces } from "./separate-side-pieces";
import {
  buildPositiveEnvironmentCues,
  buildVisualFailureConditions,
  buildVisualSceneLock,
  type VisualContext,
} from "./visual-context";

export type PromptImageInput = {
  image_id: string;
  role: "composition_reference" | "element_reference" | "palette_reference" | "style_reference" | "catalog_product_reference" | "venue_base" | "previous_generated_result";
  allowed_use: string;
};

export type ImagePromptInput = {
  sceneSpec: SceneSpec;
  inputs?: PromptImageInput[];
  revisionInstruction?: string;
  visualContext?: VisualContext;
  /**
   * Bloque "BALLOON SIZE MIX" (plan de tamaños F4) — las proporciones EXACTAS
   * de diámetro que se cotizaron, ya renderizadas como texto por
   * `bloqueMezclaTamanos()`. `undefined` cuando la propuesta no tiene
   * ninguna pieza con diámetro real (ej. solo backdrop/kits) — en ese caso
   * no hay nada que anclar y no se agrega la sección.
   */
  sizeMixBlock?: string;
  /** Number of catalog photos omitted because the provider input cap was reached. */
  droppedCatalogReferenceCount?: number;
  /** Number of client composition-reference photos omitted because the provider input cap was reached (R6). */
  droppedCompositionReferenceCount?: number;
  /**
   * Creativity level the plan was designed with (creatividad.ts). Absent keeps
   * the prompt of the default level, for callers without a level.
   */
  creatividad?: NivelCreatividad;
  /**
   * Declared official structure by plan structure id (QaPlanInputs of the
   * approved plan), so a declared circular hoop is not asked to be an arch.
   */
  officialStructures?: ReadonlyMap<string, string>;
  /**
   * Corrective instruction of a QA retry (`buildCorrectiveRetryPrompt`). Goes
   * right before FINAL_OUTPUT_REMINDER, which must stay the last thing the
   * model reads: concatenating the retry after it left the photograph-only
   * rule buried in the middle of the prompt.
   */
  correctiveInstruction?: string;
  /**
   * Escenografía conservada de la foto de referencia que el cliente dejó
   * encendida (frontera plan/escenografía, scene-spec.ts). Solo abre la
   * excepción a las prohibiciones generales de flores, muebles y luces: nunca
   * es un elemento del plan, no se cotiza y no entra en el contrato de
   * cardinalidad ni en el de color.
   */
  scenography?: readonly SceneryElement[];
};

/**
 * Element name for the image model without its measurement parenthetical. The
 * plan blueprint names carry "(2.4 m × 2.2 m)"; in the 2026-09-15 calibration
 * the model drew those values as dimension callouts (2 of 6 five-piece
 * images). Scale travels as words through physicalScale instead.
 */
export function promptElementName(name: string): string {
  return name.replace(/\s*\((?=[^)]*\d)[^)]*\)/g, "").replace(/\s{2,}/g, " ").trim() || name;
}

function heightWords(meters: number): string {
  if (meters <= 0.8) return "table-top height";
  if (meters <= 1.3) return "about waist-to-chest height of an adult";
  if (meters <= 2) return "about the height of an adult";
  if (meters <= 2.7) return "clearly taller than an adult, below a standard ceiling";
  return "close to ceiling height";
}

function widthWords(meters: number): string {
  if (meters <= 0.8) return "narrow, about one person wide";
  if (meters <= 1.5) return "about as wide as two people side by side";
  // Not "a doorway": arches were then drawn as closed rectangular door frames.
  if (meters <= 3) return "about two adult arm spans wide";
  return "more than two adult arm spans wide";
}

/** Physical size in words: numbers in the prompt were rendered as measurement labels. */
function physicalScale(element: SceneSpec["elements"][number]): string {
  const dimensions = element.visual_semantics?.dimensions_m;
  const parts = [
    dimensions?.height ? heightWords(dimensions.height) : undefined,
    dimensions?.width ? widthWords(dimensions.width) : undefined,
  ].filter(Boolean);
  return parts.length ? ` Physical scale: ${parts.join("; ")}.` : "";
}

/**
 * Form and support the image model got wrong in the 2026-09-15 calibration: an
 * approved arch drawn as a round hoop or a closed square frame (7 of 48 images
 * of the arch plan) and a wall garland floating mid-wall. A declared or named
 * circular hoop keeps its own form.
 */
function shapeClause(element: SceneSpec["elements"][number], officialStructures?: ReadonlyMap<string, string>): string {
  const semantics = element.visual_semantics;
  if (!semantics) return "";
  const official = identificarEstructuraOficial({
    tipo: semantics.structure_type,
    densidad: semantics.density,
    ubicacion: semantics.placement,
    nombre: element.name,
    estructura_oficial: officialStructures?.get(semantics.repetition_group) ?? officialStructures?.get(element.element_id),
  });
  if (semantics.structure_type === "arco" && official?.forma !== "circular") {
    return " Form: a free-standing inverted-U arch, both legs standing on the floor and joined by one continuous curve over the top; never a round hoop, a ring, or a closed square frame.";
  }
  // Un semiarco dibujado como arco completo (o cerrado contra la pieza del
  // otro lado) es el fallo que el QA marca como piezas unidas: su forma
  // abierta tiene que estar en el prompt, igual que la del arco.
  if (semantics.structure_type === "semiarco") {
    return " Form: a one-sided half-arch rising from the floor on one side and ending in open air; never closed into a full arch, a hoop, or a frame.";
  }
  if (semantics.structure_type === "guirnalda" && semantics.placement === "fondo_pared") {
    return " Support: mounted flat against the wall along its whole length with visible anchoring; it never floats away from the wall.";
  }
  return "";
}

function stylingOf(nivel: NivelCreatividad | undefined): readonly AmbientacionImagen[] {
  return perfilCreatividad(nivel).imagen.ambientacion;
}

/**
 * Creativity section of the standard image prompt. The quoted structures are
 * locked at every level; only art direction and the listed non-catalog
 * styling change. Empty at the default level (pre-calibration prompt).
 */
function creativityContract(nivel: NivelCreatividad | undefined): string {
  const perfil = perfilCreatividad(nivel);
  if (!perfil.imagen.direccion) return "";
  const styling = perfil.imagen.ambientacion.map((clave) => AMBIENTACION_IMAGEN[clave].cue);
  return [
    `CREATIVITY LEVEL ${perfil.nivel} OF 5 — ART DIRECTION`,
    `- ${perfil.imagen.direccion}`,
    "- Fidelity lock at every level: keep exactly the approved balloon structures, their type, colors, balloon sizes, count, and placement. Creativity never adds, removes, merges, recolors, or resizes a balloon structure and never adds loose balloons, signage, or text. The result stays a plain photograph: no captions, labels, dimension notes, or magazine-style text at any level.",
    styling.length
      ? `- Allowed non-catalog styling at this level: ${styling.join("; ")}. These are the ONLY exceptions to the bans on flowers, candles, furniture, props, or people elsewhere in this prompt. They are not quoted products: keep them secondary, physically separate from the balloon structures, and free of balloons, text, and signs.`
      : "- No styling beyond the approved balloon structures: the bans on flowers, plants, candles, furniture, props, and people elsewhere in this prompt apply fully.",
  ].join("\n");
}

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

/** Ubicación en palabras: el prompt y el reintento correctivo nunca muestran cajas ni ids. */
export function placementDescription(target: SceneSpec["elements"][number]["target_bbox"], category: string): string {
  if (["curtain", "drape", "backdrop", "panel"].includes(category)) return "rear background surface spanning the central decoration area";
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  const horizontal = centerX < 0.34 ? "left" : centerX > 0.66 ? "right" : "center";
  const vertical = centerY < 0.34 ? "upper" : centerY > 0.66 ? "lower" : "middle";
  return `${vertical} ${horizontal} area of the composition`;
}

function compactSceneSpec(scene: SceneSpec): string {
  return JSON.stringify({
    // This is a rendering brief, not the internal scene record. Never expose
    // plan/element/venue identifiers to the image model: they are useful for
    // server-side validation but are a strong prompt for visible callouts.
    rendering_context: {
      aspect_ratio: scene.canvas.aspect_ratio,
      generation_mode: scene.generation_mode,
      preserve_venue: scene.venue.preserve,
      protected_areas: "preserve all non-decoration venue areas",
      editable_areas: "use only the approved placement descriptions below",
    },
    elements: scene.elements.map((element) => ({
      name: promptElementName(element.name),
      category: element.category,
      source_type: element.source_type,
      required: element.required,
      quantity: element.quantity,
      resolved_colors: element.resolved_colors,
      identity_constraints: element.identity_constraints,
      placement: placementDescription(element.target_bbox, element.category),
      relationships: element.relationships.map((relationship) => `${relationship.type} the related approved decoration`),
    })),
    positive_prompt: scene.positive_prompt,
    negative_prompt: scene.negative_prompt,
  });
}

function balloonScaleInstruction(sizeMixBlock?: string): string {
  if (!sizeMixBlock) return "Vary scale, overlap, depth, and height naturally.";
  const diameters = [...sizeMixBlock.matchAll(/\b(\d+(?:\.\d+)?)\s*-inch\b/gi)]
    .map((match) => Number(match[1]))
    .filter((diameter, index, values) => values.indexOf(diameter) === index);
  if (diameters.length === 1) {
    return `SINGLE-DIAMETER HARD CONSTRAINT: every balloon must be exactly ${diameters[0]}-inch (${Math.round(diameters[0] * 2.54 * 10) / 10} cm). Do not vary balloon size for depth, overlap, hierarchy, or visual interest.`;
  }
  return "Vary balloon scale ONLY among the exact quoted diameters and quantities in BALLOON SIZE MIX. Every visible balloon must match one listed, quoted size; never invent a smaller, larger, or intermediate balloon.";
}

function materialEstimateContract(sceneSpec: SceneSpec): string {
  const estimate = sceneSpec.material_estimate;
  if (!estimate) return "No structured material estimate was supplied; do not invent extra balloons beyond the approved scene elements.";
  const balloonTotal = estimate.balloons.reduce((sum, line) => sum + line.design_quantity, 0);
  const sizeLines = new Map<string, number>();
  const colorLines = new Map<string, number>();
  for (const line of estimate.balloons) {
    const size = line.size_inches == null ? "unspecified size" : `${line.size_inches}-inch`;
    sizeLines.set(size, (sizeLines.get(size) ?? 0) + line.design_quantity);
    const color = line.color ?? "catalog color";
    colorLines.set(color, (colorLines.get(color) ?? 0) + line.design_quantity);
  }
  // "78 balloons of 12-inch", no "78 12-inch": el modelo leía el diámetro
  // pegado a la cantidad como una sola cifra.
  const sizes = [...sizeLines.entries()].map(([size, quantity]) => `${quantity} balloons of ${size}`).join(", ");
  const colors = [...colorLines.entries()].map(([color, quantity]) => `${quantity} ${color}`).join(", ");
  const specials = estimate.special_elements.reduce((sum, line) => sum + line.design_quantity, 0);
  return [
    "DESIGN MATERIAL ESTIMATE — SOURCE OF TRUTH",
    `Render approximately ${balloonTotal} installed balloons, not the purchased package capacity.`,
    sizes ? `Installed size distribution: ${sizes}.` : "No round balloon sizes are approved.",
    colors ? `Installed color distribution: ${colors}.` : "Use only the approved catalog colors.",
    specials ? `Also render ${specials} installed special element(s) from the approved list.` : "No special elements are approved.",
    `Physical design: ${estimate.design.type}; ${estimate.design.visual_density} density; ${estimate.design.visual_scale} visual scale; ${estimate.design.installation_length_m == null ? "length not specified" : `${estimate.design.installation_length_m} m installation extent`}.`,
    `Purchase capacity (${estimate.totals.purchase_quantity}) includes waste and closed-package surplus. Waste-adjusted quantity is ${estimate.totals.waste_adjusted_quantity}. Neither surplus nor unused package units may appear in the decoration.`,
    "Perceptual count rule: stay within the same physical scale as the installed estimate; exact object-by-object counting is not required, but do not turn a small/medium estimate into a very large dense installation.",
  ].join("\n");
}

/**
 * A short composition contract is deliberately kept near the beginning of the
 * prompt.  The old prompt had all the right constraints, but they were spread
 * across the scene spec and the creative section; image models consequently
 * tended to satisfy the easiest visual prior (a generic balloon arch plus a
 * banquet table) instead of building the selected products into one finished
 * decoration.  This contract describes the *scene architecture* without
 * inventing any catalog objects.
 */
function decorationCompositionContract(sceneSpec: SceneSpec, visualContext?: VisualContext, styling: readonly AmbientacionImagen[] = [], scenography: readonly SceneryElement[] = []): string[] {
  const categories = new Set(sceneSpec.elements.map((element) => element.category));
  const tableSupports = tableSupportedElements(sceneSpec);
  // Las prohibiciones generales de este contrato son lo primero y más fuerte
  // que lee el modelo. Sin nombrar aquí la escenografía conservada, el prompt
  // se contradice consigo mismo y el modelo borra justo lo que el cliente
  // decidió mantener de su propia foto.
  const exceptions = [
    ...(styling.length ? ["the non-catalog styling allowed in CREATIVITY LEVEL"] : []),
    ...(scenography.length ? ["the preserved scene context listed below"] : []),
  ];
  const stylingException = exceptions.length ? ` (except ${exceptions.join(" and ")})` : "";
  const hasBackdrop = [...categories].some((category) => ["backdrop", "curtain", "drape", "panel"].includes(category));
  const hasBalloonStructure = categories.has("balloon_structure");
  const hasTableProduct = categories.has("tableware") || categories.has("furniture");
  const hasVenuePhoto = Boolean(sceneSpec.venue.source_image_id);
  const hasExplicitOutdoorVenue = visualContext?.venueKind === "outdoor";
  const layers = [
    "NON-NEGOTIABLE SCENE TYPE: render a complete, installed event decoration in a real venue, with one focal zone and a clear rear-to-foreground composition; this is not a catalog sample, product board, showroom display, or collection of loose objects.",
    hasBackdrop
      ? "Use the approved backdrop/curtain/panel as the rear anchor, spanning behind the complete installation."
      : hasExplicitOutdoorVenue
        ? "Use the named outdoor venue's real architecture, terrain, and open-air depth as the rear anchor; do not invent a backdrop product."
      : "Use the real venue wall, doorway, or architectural feature as the rear anchor; do not invent a backdrop product.",
    hasBalloonStructure
      ? "Build the approved balloon materials into one intentional installation around a focal center (organic garland, arch, column, or clustered frame as appropriate to the named element), with visible attachment and floor contact."
      : "Arrange the approved products as one intentional focal installation with a clear center, rear-to-foreground depth, and visible physical support.",
    "The decoration itself must be the main subject and occupy a deliberate focal zone; it must read immediately as a finished event setup, not as separate samples placed in a venue.",
    "Use a real 3-layer read: rear backdrop or support, middle decorative structure, and grounded floor-level details only when supplied by the catalog or preserved in the venue photo. Make the floor, attachment/support, scale, lighting, depth, and element relationships visible.",
    "Do not turn a single catalog line into an isolated generic balloon arch, a loose garland, or unrelated furniture. Every selected line must contribute to the same coherent installation and be physically attached, hung, framed, or grounded.",
    !hasTableProduct && !hasVenuePhoto
      ? hasExplicitOutdoorVenue
        ? `No generic table, empty table, chairs, dining setup, food, gifts, flowers, or event props${stylingException}: natural vegetation and terrain may appear only as context for the explicitly named outdoor venue, never as added decoration.`
        : `No generic table, empty table, chairs, dining setup, food, gifts, flowers, plants, or landscape scenery${stylingException}: none is an approved catalog element.`
      : !hasTableProduct
        ? "Do not add a new table, empty table, chairs, or props; preserve only furniture already present in the supplied venue photo."
        : "Use the approved table/furniture only as a supporting layer for the decoration, never as the main subject or an empty event-table cliché.",
    !hasVenuePhoto
      ? hasExplicitOutdoorVenue
        ? "When an outdoor venue is explicitly requested, render that recognizable outdoor place with its real ground, open-air depth, architecture/terrain, and appropriate event lighting; do not substitute an indoor room or a generic unrelated landscape."
        : "When no venue photo or named outdoor venue is supplied, use a neutral real indoor celebration corner with a visible wall, floor, depth, and event lighting; never default to a generic garden, forest, park, or empty landscape background."
      : "Preserve the supplied venue camera and architecture; add the installation to the editable area without replacing the venue with a generic scene.",
    "Treat selected catalog products as installed decoration and raw materials for this one event, never as catalog samples, retail packaging, isolated product cutouts, or evenly spaced inventory.",
    "Only a selected catalog-backed signage product may contain a focal sign or legible printed message; if no signage product is selected, add no sign, banner, lettering, or invented event text.",
    `Never add commercial/event objects absent from the selected catalog allowlist${stylingException}: no generic tables, chairs, centerpieces, gifts, food, flowers, plants, props, signs, lights, or extra balloons.`,
    ...(tableSupports.length
      ? [`TABLE SUPPORT EXCEPTION: ${tableSupports.length} approved table-top structure(s) stand on plain event tables with simple tablecloths, one table per table-top structure. Those tables are their physical support, not added furniture; never replace them with boxes, crates, pedestals, or the floor, and add no chairs, food, or place settings.`]
      : []),
    ...(scenography.length ? [scenographyContract(scenography)] : []),
  ];
  return layers;
}

/**
 * Escenografía: lo que se conserva de la foto del cliente. Es contexto del
 * lugar, no decoración cotizada, así que se nombra con su sitio observado y se
 * excluye explícitamente del conteo de estructuras y del catálogo.
 */
function scenographyContract(scenography: readonly SceneryElement[]): string {
  const items = scenography.map((item) => `${item.name} (${placementDescription(item.target_bbox, item.category)})`).join("; ");
  return `PRESERVED SCENE CONTEXT — the customer chose to keep these objects from their own reference photo: ${items}. Render them as existing venue context in that place and at believable scale. They are NOT catalog products, NOT quoted decoration, and NOT part of the structure count: never attach balloons, lettering, logos, prices or packaging to them, never turn one into a decorative structure, and never let them take the focal zone from the approved installation.`;
}

/**
 * Sustantivo en inglés de cada estructura oficial para contarla. `sustantivoEn`
 * es la descripción larga que el caption necesita ("organic balloon garland
 * arch"); aquí hace falta el sustantivo corto, porque esta es la instrucción
 * numérica más prominente del prompt.
 */
const SUSTANTIVO_CARDINALIDAD: Readonly<Record<string, string>> = {
  arco: "arch",
  arco_asimetrico: "arch",
  arco_no_denso: "arch",
  semiarco: "half-arch",
  semiarco_asimetrico: "half-arch",
  columna: "column",
  columna_asimetrica: "column",
  columna_no_densa: "column",
  pared_densa: "balloon wall",
  pared_no_densa: "balloon wall",
  guirnalda: "garland",
  centro_mesa: "table centerpiece",
  bouquet: "balloon bouquet",
  figura: "balloon figure",
  aro_circular: "circular hoop",
  techo_globos: "ceiling balloon installation",
};

/** Por tipo del plan cuando la estructura oficial no se puede identificar (backdrop, kit, accesorio). */
const SUSTANTIVO_POR_TIPO: Readonly<Record<string, string>> = {
  arco: "arch",
  semiarco: "half-arch",
  columna: "column",
  guirnalda: "garland",
  pared: "balloon wall",
  centro_mesa: "table centerpiece",
  backdrop: "backdrop",
  kit: "balloon kit",
  accesorio: "balloon accent",
  escultura: "balloon figure",
};

function pluralizarEstructura(noun: string): string {
  return noun.endsWith("arch") ? `${noun}es` : `${noun}s`;
}

/**
 * Tipo contable de un elemento. Antes se decidía con `name.includes("arco")`,
 * así que "Semiarco…" y "Marco circular…" se contaban como arcos completos y
 * cualquier otro tipo salía como el token interno (`balloon_structure`). La
 * semántica declarada manda; el nombre solo sirve para escenas sin ella.
 */
function cardinalityKind(element: SceneSpec["elements"][number], officialStructures?: ReadonlyMap<string, string>): string {
  const semantics = element.visual_semantics;
  if (semantics) {
    const official = identificarEstructuraOficial({
      tipo: semantics.structure_type,
      densidad: semantics.density,
      ubicacion: semantics.placement,
      nombre: element.name,
      estructura_oficial: officialStructures?.get(semantics.repetition_group) ?? officialStructures?.get(element.element_id),
    });
    const noun = (official && SUSTANTIVO_CARDINALIDAD[official.id]) ?? SUSTANTIVO_POR_TIPO[semantics.structure_type];
    if (noun) return noun;
  }
  const normalized = element.name.toLowerCase();
  if (/\bsemiarcos?\b/.test(normalized)) return "half-arch";
  if (/\bmarcos?\b/.test(normalized)) return "frame";
  if (normalized.includes("arco")) return "arch";
  if (normalized.includes("columna")) return "column";
  return element.category;
}

/**
 * Piezas laterales separadas: misma regla y mismo dueño que el QA
 * (separate-side-pieces.ts sobre las cláusulas del compilador, con un contexto
 * visual neutro porque solo interesa la agrupación). El prompt tenía una
 * separación genérica, pero no el hueco abierto entre la pieza izquierda y la
 * derecha que el QA sí exige y por el que dispara un reintento pagado.
 */
function separateSidePiecesSentence(sceneSpec: SceneSpec, officialStructures?: ReadonlyMap<string, string>): string {
  const clauses = compileLoraCaption({ sceneSpec, visualContext: GROUPING_ONLY_CONTEXT, officialStructures }).clauses;
  const pieces = findSeparateSidePieces(clauses);
  if (!pieces) return "";
  const nombres = (grupo: readonly LoraVisualClause[]) => grupo
    .flatMap((clause) => clause.elementIds)
    .map((id) => promptElementName(sceneSpec.elements.find((element) => element.element_id === id)?.name ?? id))
    .join(" and ");
  return ` SEPARATE SIDE PIECES: ${nombres(pieces.left)} on the left and ${nombres(pieces.right)} on the right are separate installations with an open gap between them; never join them into one continuous arch, frame, or garland across that gap.`;
}

function cardinalityContract(sceneSpec: SceneSpec, officialStructures?: ReadonlyMap<string, string>): string {
  const counts = new Map<string, number>();
  for (const element of sceneSpec.elements) {
    const kind = cardinalityKind(element, officialStructures);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const partes = [...counts.entries()].map(([kind, count]) => `${count} ${count === 1 ? kind : pluralizarEstructura(kind)}`);
  const summary = partes.length > 2 ? `${partes.slice(0, -1).join(", ")} and ${partes[partes.length - 1]}` : partes.join(" and ");
  return `CARDINALITY CONTRACT: render exactly ${summary || "zero approved physical instances"}, meaning exactly ${sceneSpec.elements.length} distinct installed structure(s). Each listed element is one visible structure, not one balloon or one package. The quantity inside an element is its installed material quantity; never turn it into extra structures. Keep every listed structure separate, positioned separately, and neither merge, duplicate, nor omit any one.${separateSidePiecesSentence(sceneSpec, officialStructures)}`;
}

/**
 * Elementos para los que el prompt emite una línea de color propia. Único
 * dueño de esa condición: `verificarCoherenciaPrompt` comprueba justo esas
 * líneas y no puede tener su propia copia de la regla.
 */
export function tieneContratoDeColor(element: SceneSpec["elements"][number]): boolean {
  return element.category === "balloon_structure" || /\b(?:arco|columna|guirnalda|balloon)\b/i.test(element.name);
}

function colorVarietyContract(sceneSpec: SceneSpec): string[] {
  const balloonStructures = sceneSpec.elements.filter(tieneContratoDeColor);
  if (balloonStructures.length === 0) {
    return ["No balloon color mix is approved; do not add balloon structures or colors as atmosphere."];
  }
  return balloonStructures.map((element) => {
    const colors = [...new Set(element.resolved_colors.map((color) => color.trim()).filter(Boolean))];
    if (colors.length < 2) {
      return `${promptElementName(element.name)}: MONOCHROME LOCK — use only ${colors[0] ?? "the supplied catalog color"}; do not introduce color variety.`;
    }
    // La proporción sale del estimado de esta estructura. Sin líneas suyas
    // (camino de catálogo sin plan) se conserva el texto sin porcentajes: el
    // prompt prometía "preserve any material percentages in the scene spec",
    // que nunca existieron en ninguna parte del prompt.
    const mezcla = describirMezclaDeColor(mezclaDeColorDeEstructura(sceneSpec, element));
    return `${promptElementName(element.name)}: APPROVED COLOR VARIETY — use exactly these catalog colors: ${colors.join(", ")}.${mezcla ? ` Approximate share of this structure's own balloons: ${mezcla}. Keep that balance visible; the dominant color must read as dominant.` : ""} Distribute them through intentional organic clusters and transitions; avoid flat stripes, random speckles, or one color replacing another. Do not invent, recolor, or borrow any additional color.`;
  });
}

function eventAuthorityContract(context?: VisualContext, styling: readonly AmbientacionImagen[] = []): string[] {
  if (!context) return [];
  const lines: string[] = [];
  if (context.eventLabel) lines.push(`OPEN EVENT LABEL: ${context.eventLabel}. Convey it only through approved composition, palette, motifs, and lighting.`);
  if (context.userRequest) lines.push(`ORIGINAL CUSTOMER REQUEST (TRACEABILITY): ${context.userRequest}`);
  if (context.confirmedMotifs?.length) lines.push(`CONFIRMED MOTIFS ONLY: ${context.confirmedMotifs.join(", ")}. Do not add unconfirmed symbols or accessories.`);
  if (context.pieceMatchLevels?.length) {
    lines.push(`PIECE MATCH LEVELS (CATALOG FACT): ${context.pieceMatchLevels.map((item) => `${item.piece}=${item.match_level}`).join("; ")}. Never render adaptable as exact.`);
  }
  if (context.approvedPlan?.length) lines.push(`APPROVED PLAN / STRUCTURES: ${context.approvedPlan.join("; ")}. Render only these planned structures.`);
  if (context.approvedMaterials?.length) lines.push(`APPROVED PLAN MATERIALS: ${context.approvedMaterials.join("; ")}. These are the complete material allowlist.`);
  lines.push(`OPEN-EVENT HONESTY: express an unclassified event through spatial composition and approved color/style; invent no signage, readable text, props, flowers, furniture, or accessories without an approved catalog line or preserved venue element${styling.length ? ", except the non-catalog styling allowed in CREATIVITY LEVEL" : ""}.`);
  return lines;
}

/**
 * Last words of the prompt. It used to end on the scene JSON; in the 2026-09-15
 * calibration 5 of 48 images drew element names, sizes or counts from the
 * prompt as caption cards, so the photograph-only rule is restated last.
 */
export const FINAL_OUTPUT_REMINDER = "OUTPUT REMINDER: everything above is invisible control metadata. Return one clean photograph of the decorated venue with zero visible text: no captions, labels, name tags, size or count notes, dimension lines, or info cards.";

export function buildImagePrompt({ sceneSpec, inputs = [], revisionInstruction, visualContext, sizeMixBlock, droppedCatalogReferenceCount = 0, droppedCompositionReferenceCount = 0, creatividad, officialStructures, correctiveInstruction, scenography = [] }: ImagePromptInput): string {
  // Keep prompt construction useful for lightweight visual eval fixtures that
  // provide only approved elements. Production callers still pass the full
  // server-validated SceneSpec.
  sceneSpec = {
    ...sceneSpec,
    generation_mode: sceneSpec.generation_mode ?? "text_to_image",
    canvas: sceneSpec.canvas ?? { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: sceneSpec.venue ?? { preserve: [], protected_regions: [], editable_regions: [] },
    positive_prompt: sceneSpec.positive_prompt ?? { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: sceneSpec.negative_prompt ?? { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    elements: sceneSpec.elements ?? [],
  };
  const inputMap = inputs.map((input, index) => `Reference image ${index + 1}: role=${input.role}; allowed use=${input.allowed_use}. The reference label is invisible metadata and must never appear in the image.`).join("\n") || "None.";
  const sceneLock = visualContext ? buildVisualSceneLock(visualContext) : "No explicit scene context supplied.";
  const environmentCues = visualContext ? buildPositiveEnvironmentCues(visualContext) : [];
  const failureConditions = visualContext ? buildVisualFailureConditions(visualContext) : [];
  const styling = stylingOf(creatividad);
  const compositionContract = decorationCompositionContract(sceneSpec, visualContext, styling, scenography);
  const creativity = creativityContract(creatividad);
  const scaleInstruction = balloonScaleInstruction(sizeMixBlock);
  const materialContract = materialEstimateContract(sceneSpec);
  const instanceContract = sceneSpec.elements.length
    ? sceneSpec.elements.map((element, index) => `- EXACTLY ONE physical installed structure ${index + 1}: render the approved ${element.category} described by “${promptElementName(element.name)}”; use only its assigned placement and installed quantity.${physicalScale(element)}${shapeClause(element, officialStructures)} Quantity means material units inside this one structure, not additional structures. This description is invisible metadata; never print or turn it into a sign.`).join("\n")
    : "- No physical decoration instances are approved.";
  const physicalCardinality = cardinalityContract(sceneSpec, officialStructures);
  const colorVariety = colorVarietyContract(sceneSpec);
  const eventAuthority = eventAuthorityContract(visualContext, styling);
  const referenceCapacityNotice = droppedCatalogReferenceCount > 0
    ? `CATALOG REFERENCE CAPACITY: ${droppedCatalogReferenceCount} catalog photo(s) could not be attached because the provider input limit was reached. Use the complete catalog metadata and quantities in AUTOMATIC_SCENE_SPEC for those lines; do not invent a substitute product, omit the line, or treat the missing photo as permission to change its color/material.`
    : "CATALOG REFERENCE CAPACITY: all selected catalog product photos fit within the provider limit.";
  const compositionReferenceCapacityNotice = droppedCompositionReferenceCount > 0
    ? `COMPOSITION REFERENCE CAPACITY: ${droppedCompositionReferenceCount} client composition-reference photo(s) could not be attached because the provider input limit was reached. Composition (framing, proportion between structures, density, backdrop geometry, lighting placement) travels only through this text prompt for this generation — do not treat the missing photo as permission to invent a different composition.`
    : "";
  const noVenueInstruction = !sceneSpec.venue.source_image_id
    ? visualContext?.venueKind === "outdoor"
      ? "If no venue photo is supplied, first create the named outdoor venue with recognizable ground, open-air depth, architecture or terrain, and event lighting. Never substitute an indoor room or an unrelated generic landscape."
      : "If no venue photo is supplied, first create a believable neutral indoor party venue appropriate to the event: visible wall, floor, depth, ambient event light, and realistic installation context. Never output a generic garden/forest/park, white studio background, empty table, or isolated catalog product."
    : "If a venue photo is supplied, preserve its real venue and add the installation only in the editable area.";
  const revision = revisionInstruction?.trim()
    ? `\nREVISION DELTA\n- Apply only this user delta to the existing result: ${revisionInstruction.trim().slice(0, 500)}\n- Preserve automatic element count, scene geometry, and venue identity.`
    : "";
  const task = sceneSpec.generation_mode === "revise_current_result"
    ? "Revise the supplied previous generated result."
    : sceneSpec.generation_mode === "edit_venue"
      ? "Edit the supplied venue photo."
      : "Create a new photorealistic, creative, event-ready party installation following AUTOMATIC_SCENE_SPEC and using the supplied composition reference only as spatial inspiration.";

  return `ROLE
You are a photorealistic event-design image editor.

TASK
${task} Add only the automatically selected decorative elements in AUTOMATIC_SCENE_SPEC. This is one clean photographed scene, never a product board, catalog sheet, collage, or annotated mockup. Make thoughtful event-designer choices: build one convincing installation with a focal point, hierarchy, grouping, depth, atmosphere, and usable floor space. ${scaleInstruction}${revision}

${physicalCardinality}
${creativity ? `\n${creativity}\n` : ""}
${eventAuthority.join("\n")}

${materialContract}

VISUAL TEXT BAN — ABSOLUTE AND NON-NEGOTIABLE
This output is a photograph, not an infographic, presentation board, floor plan, catalog page, or annotated design brief. Render ZERO visible typography unless a selected catalog product is explicitly a signage product with approved printed text. Treat every word, number, unit, dimension, quotation, JSON token, identifier, code, and instruction in this prompt as invisible control metadata. Never transcribe, paraphrase, stylize, or place any of it in the scene. In particular, ignore and never render internal project IDs, source-image IDs, catalog codes, venue codes, edit-region codes, plan hashes, element names, quantities, measurements, coordinate values, captions, or headings. Do not invent lettering, logos, brand marks, watermarks, or phrases on balloons, fabric, walls, arches, or props. If any supplied image contains text, use only its physical material/color identity; do not copy the text.

SCENE LOCK — HIGHEST PRIORITY
${sceneLock}
The final image must visibly prove every populated SCENE LOCK field. Mentioning it in reasoning is not enough.

DECORATION COMPOSITION CONTRACT — HIGHEST PRIORITY AFTER SCENE LOCK
${list(compositionContract)}

VISIBLE ENVIRONMENT REQUIREMENTS
${list(environmentCues)}

AUTOMATIC FAILURE CONDITIONS
${list(failureConditions)}
If any failure condition appears, correct the scene before returning the image.

SOURCE-OF-TRUTH PRIORITY
1. SCENE LOCK controls requested event, venue, and time of day. If a venue photo exists, it controls the real venue architecture while SCENE LOCK still controls compatible event atmosphere and explicit revision requests.
2. AUTOMATIC_SCENE_SPEC controls which elements exist, their colors, quantity, placement, and layers.
3. The supplied venue photo controls camera position, crop, architecture, perspective, and ambient light when supplied.
4. Supplied catalog product images control product identity only.
5. The analyzed reference blueprint controls composition only: framing, backdrop geometry, lighting placement, density, and spatial relationships. The raw reference image is not a product source and must not add objects.
6. PREVIOUS_RESULT controls the current revision base when present.
If sources conflict, follow this order. Do not resolve conflicts by inventing content.

IMAGE MAP
${inputMap}

${referenceCapacityNotice}
${compositionReferenceCapacityNotice}

ENVIRONMENT AND LIGHTING CONSTRAINTS — NON-NEGOTIABLE
- Translate SCENE LOCK into visible reality, not just decoration: requested space and time are part of scene identity.
- Named space is a hard venue constraint. Render that exact environment faithfully. Do not substitute every request with a generic room or studio backdrop.
- If a venue photo is supplied, preserve its real architecture, camera, crop, and perspective. If no venue photo is supplied, construct the named environment with recognizable physical cues instead of inventing an unrelated venue.
- If the context requests night, nocturnal, evening, or atardecer, use the corresponding ambient exposure and artificial event lighting. If it requests day or morning, use daylight. Match the requested time instead of defaulting to bright daylight.
- Always adapt the decoration to the requested venue and time of day; never let a reference image silently override those user constraints.

MUST INCLUDE
${list(sceneSpec.positive_prompt.required_elements)}
COLOR VARIETY / MATERIAL MIX — ONLY WHEN APPROVED
${list(colorVariety)}
INSTANCE CONTRACT — NON-NEGOTIABLE
${instanceContract}
${sizeMixBlock ? `\n${sizeMixBlock}\n` : ""}
COMPOSITION AND LAYERS
${list(sceneSpec.positive_prompt.composition)}
${sceneSpec.elements.length ? sceneSpec.elements.map((element) => `- Place the approved ${element.category} described in the brief in the ${placementDescription(element.target_bbox, element.category)}; preserve physical depth and relationships with the other approved decorations. Do not render this instruction as text.`).join("\n") : "- No automatically selected decorative elements."}
- Placement instructions above are invisible metadata. Never draw them.

CREATIVE EVENT DESIGN
- Design one finished party setup, not a row of product objects, a generic arch, or a furniture vignette.
- Treat selected products as ingredients. Group compatible balloons into a cohesive arch, garland, columns, or organic clusters around the main focal point.
- Respect INSTALLED DESIGN quantities exactly as described in DESIGN MATERIAL ESTIMATE. Package contents, merma, and purchase surplus are procurement data only and must never be rendered as extra decorative units.
- Use backdrop and curtain products as the rear stage; use balloon structures and themed accents to frame it; use lighting behind or around the installation to create atmosphere.
- Integrate every mandatory product physically. A kit or package image describes its contents; never render the box or package as the decoration.
- Balance left and right without forcing perfect symmetry. ${scaleInstruction} Use overlap, depth, and height to create a convincing installation. Ground floor pieces and give hanging pieces real strings, hooks, frames, or supports.
- Do not make one isolated floating object per catalog line. Make the result look like a professional decorator made creative choices for a real celebration, with a focal zone, rear support, floor contact, lighting, hierarchy, scale, and visible relationships between elements.
- ${noVenueInstruction}

VENUE PRESERVATION
${list(sceneSpec.positive_prompt.venue_preservation)}
- Keep areas outside automatic editable regions unchanged and empty when no element is specified.

REFERENCE AND PRODUCT IDENTITY
- Reference images were analyzed upstream. Use only the resulting AUTOMATIC_SCENE_SPEC for framing, backdrop position, asymmetry, density, ambient/background palette, and lighting placement; do not recreate any object from the reference unless it is represented by a mandatory catalog item.
- Use each supplied catalog product image as the only visual source for product identity. Re-render that exact catalog product as a physical three-dimensional object from the venue camera angle.
- Every catalog-backed element in AUTOMATIC_SCENE_SPEC is a mandatory quoted line item. Make every one visibly recognizable in the result; never summarize the list into a generic decoration or omit a product.
- Catalog line items are raw materials for the installation, not a literal placement diagram. Preserve product identity and installed design quantity while adapting grouping, scale, orientation, and support to make a coherent party scene.
- If a catalog image shows packaging, use the product description and category to render the physical contents in the scene; never place the package, card, or catalog photo on the wall.
- The analyzed reference may describe function, approximate placement, density, palette, backdrop geometry, and lighting placement through AUTOMATIC_SCENE_SPEC. Never use it as a product catalog or copy its object designs.
- Catalog color lock: render every catalog product in its supplied catalog color/material. A black product must remain black, a silver product must remain silver, and a blue product must remain blue. Never recolor, blend, or borrow a product color from the composition reference.
- If a reference color differs from a catalog product, keep the catalog product color exactly; adapt only lighting and integration, never the product identity.
- Never copy a source-image border, crop frame, halo, rectangular pasted image, studio shadow, or collage artifact.

OUTPUT FORMAT
- Output one clean photorealistic scene only.
- Render no visible text at all unless an explicitly selected signage product has approved physical lettering. Never render catalog IDs, product names, prices, arrows, callouts, captions, legends, watermarks, UI, labels, annotations, dimensions, measurements, or explanatory text.
- Never draw placement guides: no colored rectangles, bounding boxes, green or yellow outlines, layer labels, coordinate text, measurement arrows, or callout lines.
- Never add free-floating headings, giant letters, logos, brand marks, or event wording. Do not add printed wording to balloons or decorative surfaces unless that exact printed product and wording are explicitly approved.
- Product color verification: before output, check each mandatory catalog item against its catalog image and correct any color drift.

PHOTOREALISTIC INTEGRATION
${list(sceneSpec.positive_prompt.photorealistic_integration)}

MUST NOT INCLUDE
- No decorative object absent from the automatic element allowlist${scenography.length ? ", other than the PRESERVED SCENE CONTEXT kept from the customer's own photo" : ""}.
${list(sceneSpec.negative_prompt.forbidden_elements)}

FORBIDDEN VENUE CHANGES
${list(sceneSpec.negative_prompt.forbidden_venue_changes)}

FORBIDDEN COMPOSITING ARTIFACTS
${list(sceneSpec.negative_prompt.forbidden_compositing_artifacts)}

FINAL CHECK BEFORE OUTPUT
First verify venue and time of day visibly match SCENE LOCK. Then verify every required element is present exactly once or within its automatic quantity range, every item belongs to one cohesive installation, no object floats without support, forbidden elements are absent, target placement is respected, rear layers remain behind foreground layers, protected venue regions are unchanged, there are zero unapproved visible characters/logos/labels, and the result looks photographed in the requested venue rather than composited.

<AUTOMATIC_SCENE_SPEC>
${compactSceneSpec(sceneSpec)}
</AUTOMATIC_SCENE_SPEC>
${correctiveInstruction?.trim() ? `\nCORRECTIVE RETRY — HIGHEST PRIORITY\n${correctiveInstruction.trim()}\n` : ""}
${FINAL_OUTPUT_REMINDER}`;
}

/** Caption LoRA V2. */
export function buildLoraImagePrompt(input: {
  sceneSpec: SceneSpec;
  visualContext: VisualContext;
  revisionInstruction?: string;
}): string {
  return buildLoraImagePromptV2(input);
}
