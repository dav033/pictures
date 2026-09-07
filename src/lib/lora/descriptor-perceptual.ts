import type { ProductConcept } from "./product-vocabulary";

/**
 * Traduce los nombres comerciales del catálogo a descripciones de lo que se ve.
 *
 * El vocabulario se generó agrupando texto de catálogo, así que `visual.color`
 * quedó con el nombre de marketing traducido al inglés ("Rosa Primaveral" ->
 * "spring pink") y `visual.finish` con el nombre de la línea ("Silk satin").
 * Ese texto viaja literal al modelo de imagen, que no conoce el catálogo de
 * Sempertex: lee "spring pink" y pinta un rosa primaveral vivo, cuando el globo
 * real es un nacarado pálido casi malva.
 *
 * Medido en reports/lora-debug/color-fidelidad: con el mismo LoRA y el mismo
 * seed, "spring pink with a Silk satin finish" da rosa chicle y el descriptor
 * perceptual da el color del producto. El mismo descriptor sin LoRA da el mismo
 * color, así que la fidelidad cromática se gobierna acá y no en el entrenamiento.
 */

/** El acabado pesa tanto como el color: "satin" sugiere tela, no látex perlado. */
const ACABADOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bSilk satin\b/gi, "soft pearlescent"],
  [/\bReflex high-shine\b/gi, "high-gloss chrome"],
  [/\bPastel Dusk muted\b/gi, "muted dusty matte"],
  [/\bPastel Matte\b/gi, "soft matte"],
  [/\btranslucent Crystal\b/gi, "translucent"],
  [/\bsolid Fashion\b/gi, "solid matte"],
];

/**
 * Solo los colores cuyo nombre es de fantasía y no describe el tono real.
 * Los básicos ("white", "red", "gold") ya se interpretan bien y no se tocan.
 * `spring pink` es el único verificado contra la foto del producto; el resto
 * sale del nombre comercial y debe revisarse cuando el pipeline de visión
 * entregue descriptores medidos sobre las fotos reales.
 */
const COLORES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bspring pink\b/gi, "extremely pale desaturated silvery mauve-pink"],
  [/\barctic blue\b/gi, "very pale icy blue"],
  [/\bamethyst\b/gi, "soft muted violet"],
  [/\bcream pearl\b/gi, "warm ivory off-white"],
  [/\bpearl white\b/gi, "soft luminous white"],
  [/\bmint green\b/gi, "pale desaturated mint"],
  [/\baurora green\b/gi, "pale iridescent green"],
  [/\bchampagne\b/gi, "pale warm golden beige"],
  [/\bgreen tea\b/gi, "muted sage green"],
  [/\bpastel lilac\b/gi, "soft pale lilac"],
  [/\bpastel blue\b/gi, "soft pale blue"],
];

/** Términos que nunca deben llegar al modelo de imagen. Los usa la prueba de regresión. */
export const TERMINOS_COMERCIALES: readonly string[] = [
  ...ACABADOS.map(([patron]) => patron.source.replace(/\\b/g, "")),
  ...COLORES.map(([patron]) => patron.source.replace(/\\b/g, "")),
  "Reflex",
  "Fashion",
  "Silk",
  "Pastel",
  "Crystal",
];

/**
 * Idempotente: una frase ya perceptual no contiene ninguno de los patrones, así
 * que puede aplicarse sobre vocabulario viejo o ya corregido sin romperlo.
 */
export function aDescriptorPerceptual(frase: string): string {
  let resultado = frase;
  for (const [patron, reemplazo] of [...COLORES, ...ACABADOS]) {
    resultado = resultado.replace(patron, reemplazo);
  }
  // "with a soft pearlescent finish" queda bien; "sheen finish" no.
  return resultado.replace(/\bsheen finish\b/gi, "sheen");
}

function patternDescription(pattern: ProductConcept["visual"]["pattern"]): string[] {
  const kind = pattern.kind.trim().toLowerCase();
  const parts: string[] = [];
  if (kind === "printed" || pattern.motif) {
    parts.push(pattern.motif ? `printed with ${pattern.motif.trim()}` : "with a printed pattern");
  } else if (!new Set(["solid", "plain", "none"]).has(kind)) {
    parts.push(`with a ${pattern.kind.trim()} pattern`);
  }
  if (pattern.text_policy === "exact_approved") {
    if (!pattern.approved_text || !pattern.evidence_ref) {
      throw new Error("Descriptor perceptual inválido: exact_approved requiere approved_text y evidence_ref.");
    }
    parts.push(`with approved lettering \"${pattern.approved_text.trim()}\"`);
  } else if (pattern.text_policy === "graphic_lettering" || (pattern.contains_text && !pattern.motif)) {
    parts.push("with graphic lettering");
  }
  return parts;
}

/** Compila solo atributos visuales evidenciados; nunca usa título, SKU o familia comercial. */
export function compilarDescriptorProductoPerceptual(concepto: ProductConcept): string {
  const visual = concepto.visual;
  const parts = [
    visual.shape.trim(),
    visual.material.trim(),
    visual.color.trim() ? `in ${visual.color.trim()}` : "",
    visual.finish.trim() ? `with ${visual.finish.trim()} finish` : "",
    visual.transparency?.trim() ? visual.transparency.trim() : "",
    ...patternDescription(visual.pattern),
  ].filter(Boolean);
  const descriptor = aDescriptorPerceptual(parts.join(" ")).replace(/\s+/g, " ").trim();
  assertDescriptorPerceptualSeguro(descriptor);
  return descriptor;
}

/** Gate central para cualquier frase de descriptor antes de entrar al modelo. */
export function assertDescriptorPerceptualSeguro(texto: string): void {
  const normalized = texto.trim();
  if (!normalized) throw new Error("Descriptor perceptual inválido: está vacío.");
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leaks = TERMINOS_COMERCIALES.filter((term) => new RegExp(`\\b${escape(term)}\\b`, "i").test(normalized));
  if (/\b(?:sku|catalog_|est_|prop_|variant_id|product_id)\b|\b\d{6,}\b|\$\s?\d|\b(?:cop|usd|price|precio|package|paquete)\b/i.test(normalized)) {
    leaks.push("identidad o compra");
  }
  if (/\b(?:globo|globos|redondo|redonda|metalizado|dorado|rosado|negro|blanco|impreso|con texto)\b/i.test(normalized)) {
    leaks.push("español");
  }
  if (leaks.length) throw new Error(`Descriptor perceptual inseguro: ${[...new Set(leaks)].join(", ")}`);
}
