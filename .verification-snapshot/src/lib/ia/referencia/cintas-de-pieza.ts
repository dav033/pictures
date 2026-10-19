import type { ReferenceBlueprintV2 } from "./reference-blueprint";

/**
 * Las cintas, serpentinas y flecos que cuelgan de una pieza de globos, como escenografía propia de la lectura.
 *
 * La lectura de la foto no es estable entre corridas: la misma foto del techo de globos (banco de fotos 10,
 * 2026-10-06) salió en la vista clásica con un elemento «hanging ribbon streamers» y en la guiada con las cintas
 * dichas solo DENTRO de la evidencia del techo («featuring orange streamer ribbons hanging underneath»). Sin
 * elemento propio la escena no las nombra («styled with …», `ambientDecorSelection`) y FLUX dibujó un racimo
 * colgante tipo lámpara en vez de un techo con cintas.
 *
 * Regla, con lo que el modelo YA escribió (nombre, evidencia y composición de la pieza aprobada), sin inventar nada
 * que no haya dicho: si una pieza de globos dice que lleva cintas, serpentinas o flecos colgando y la lectura no trae
 * ya un elemento aprobado que las nombre, se añade uno, `other` y solo de referencia (nunca se cotiza), en la caja
 * de esa pieza. Un bouquet o un centro de mesa no cuentan: sus cintas son las del helio, parte del armado.
 *
 * Pura: sin proveedor, HTTP, base de datos ni entorno.
 */

const MENCIONA_CINTAS = /\b(?:ribbons?|streamers?|tassels?|fringes?|curling ribbons?|cintas?|serpentinas?|flecos?|borlas?)\b/i;
const MENCIONA_FLECOS = /\b(?:tassels?|fringes?|flecos?|borlas?)\b/i;
/** Lo que dice que cuelgan (y no que están pintadas, impresas o atadas a un peso). */
const CUELGAN = /\b(?:hang\w*|dangl\w*|trail\w*|drap\w*|draping|flow\w*|cuelg\w*|colg\w*|underneath|below)\b/i;
/** Piezas cuyas cintas son las del helio (un bouquet, un racimo o una figura se leen «kit»): el armado, no escenografía. */
const TIPOS_CON_CINTAS_PROPIAS = new Set(["kit", "centro_mesa"]);
/** El tope de elementos de `ReferenceBlueprintV2Schema`. */
const MAX_ELEMENTOS = 80;

type Elemento = ReferenceBlueprintV2["elements"][number];

function textoDe(elemento: Elemento): string {
  return [elemento.name, elemento.visible_evidence, elemento.appearance.composition].join(" ");
}

export function conCintasDeLasPiezas(blueprint: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  const aprobados = blueprint.elements.filter((elemento) => elemento.approved);
  const yaHay = aprobados.some((elemento) => elemento.category !== "balloon_structure" && MENCIONA_CINTAS.test(elemento.name));
  if (yaHay) return blueprint;
  const nuevos: Elemento[] = [];
  const ids = new Set(blueprint.elements.map((elemento) => elemento.element_id));
  for (const pieza of aprobados) {
    if (pieza.category !== "balloon_structure" || TIPOS_CON_CINTAS_PROPIAS.has(pieza.visual_semantics?.structure_type ?? "")) continue;
    const texto = textoDe(pieza);
    if (!MENCIONA_CINTAS.test(texto) || !CUELGAN.test(texto)) continue;
    const id = `${pieza.element_id}_CINTAS`.slice(0, 80);
    if (ids.has(id) || blueprint.elements.length + nuevos.length >= MAX_ELEMENTOS) continue;
    ids.add(id);
    const flecos = MENCIONA_FLECOS.test(texto);
    nuevos.push({
      element_id: id,
      source_image_id: pieza.source_image_id,
      name: flecos ? "hanging tassel fringe" : "hanging ribbon streamers",
      category: "other",
      scene_role: pieza.scene_role,
      detection_confidence: Number(Math.min(pieza.detection_confidence, 0.9).toFixed(2)),
      visible_evidence: `Named in the evidence of ${pieza.element_id}: ${pieza.visible_evidence}`.slice(0, 320),
      reference_bbox: { ...pieza.reference_bbox },
      depth_layer: pieza.depth_layer,
      include_policy: "include",
      approved: true,
      source_type: "reference_only",
      quantity: { mode: "exact", min: 1, max: 1 },
      appearance: {
        observed_colors: [],
        resolved_colors: [],
        color_policy: "adapt_to_event_palette",
        material: "material not determinable",
        shape: "shape not determinable",
        composition: flecos ? "Tassel fringe hanging from the balloon piece." : "Ribbon streamers hanging from the balloon piece.",
      },
      relationships: [{ type: "overlaps", target_element_id: pieza.element_id }],
      quantity_semantics: "physical_instances",
      uncertainties: [`Derived from ${pieza.element_id}: the reading folded it into that balloon piece.`],
      model_decision: {
        action: "include",
        match_type: "none",
        reason: "Decorative ribbons hanging from the balloon piece; scenery, never quoted.",
        adaptation: "Escenografía de la foto: no se cotiza.",
      },
    });
  }
  return nuevos.length ? { ...blueprint, elements: [...blueprint.elements, ...nuevos] } : blueprint;
}
