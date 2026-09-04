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
