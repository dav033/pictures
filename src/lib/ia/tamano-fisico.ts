/**
 * Traduce un código de catálogo ("R-12") a una descripción física anclada
 * (plan de tamaños F4). Un modelo de imagen no sabe qué es "R-12" — es un
 * SKU interno — pero sí resuelve escala por comparación con un objeto
 * conocido, igual que lo haría un humano leyendo una ficha técnica. Sin
 * este anclaje, el prompt solo podía decir "size" en abstracto y el modelo
 * volvía a su propio criterio de qué tan grande es un globo.
 */

const ANCLAJES_REDONDO: Record<number, string> = {
  5: "about the size of a fist or an orange",
  9: "about the size of a grapefruit or small melon",
  12: "about the size of a human head or a basketball",
  18: "about the size of a large beach ball or a human torso",
  24: "jumbo-sized, notably larger than a beach ball",
  36: "giant-sized, roughly waist-to-chest height on an adult",
};

const NOMBRES_FORMA_EN: Record<string, string> = {
  redondo: "round latex",
  corazon: "heart-shaped latex",
  link: "Link-O-Loon® linking",
  modelar: "twisting/modeling",
};

function pulgadasACm(pulgadas: number): number {
  return Math.round(pulgadas * 2.54 * 10) / 10;
}

/**
 * Descripción física de una pieza para el prompt de imagen — null cuando no
 * hay diámetro real que anclar (backdrop, kit, empaque…), que es el caso
 * correcto de "no forzar un tamaño que no aplica" en vez de inventar uno.
 */
export function descripcionFisicaTamano(diamPulg: number | null | undefined, forma: string | null | undefined): string | null {
  if (diamPulg == null) return null;
  const cm = pulgadasACm(diamPulg);
  const tipoMaterial = forma ? (NOMBRES_FORMA_EN[forma] ?? forma) : "latex";
  const anclaje = forma === "redondo" || !forma ? ANCLAJES_REDONDO[diamPulg] : undefined;
  const base = `${diamPulg}-inch (${cm} cm) ${tipoMaterial} balloon`;
  return anclaje ? `${base} — ${anclaje}` : base;
}

export type LineaMezclaTamanos = { diamPulg: number; forma: string | null; cantidad: number };

/**
 * Bloque SIZE MIX del prompt (plan F4): declara las proporciones EXACTAS de
 * tamaño que se cotizaron, para que "vary scale" (necesario para que una
 * guirnalda orgánica se vea creíble) quede acotado a los diámetros reales en
 * vez de licencia libre para inventar un tamaño intermedio.
 */
export function bloqueMezclaTamanos(lineas: LineaMezclaTamanos[]): string | null {
  if (lineas.length === 0) return null;
  const total = lineas.reduce((suma, l) => suma + l.cantidad, 0);
  if (total === 0) return null;
  const filas = lineas
    .slice()
    .sort((a, b) => b.cantidad - a.cantidad)
    .map((l) => {
      const pct = Math.round((l.cantidad / total) * 100);
      const desc = descripcionFisicaTamano(l.diamPulg, l.forma) ?? `${l.diamPulg}-inch balloon`;
      return `- ${pct}% ${desc}`;
    });
  return [
    "BALLOON SIZE MIX — HARD CONSTRAINT",
    "This installation uses EXACTLY these balloon diameters, in these proportions:",
    ...filas,
    "Do not introduce any other diameter. Do not add jumbo, mini, or intermediate sizes not listed above.",
  ].join("\n");
}
