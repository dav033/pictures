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
  const diametros = [...new Set(lineas.map((linea) => linea.diamPulg))];
  const filas = lineas
    .slice()
    .sort((a, b) => b.cantidad - a.cantidad)
    .map((l) => {
      const pct = Math.round((l.cantidad / total) * 100);
      const desc = descripcionFisicaTamano(l.diamPulg, l.forma) ?? `${l.diamPulg}-inch balloon`;
      return `- ${l.cantidad} balloons (${pct}%): ${desc}`;
    });
  return [
    "BALLOON SIZE MIX — HARD CONSTRAINT",
    "This installation uses EXACTLY these balloon diameters, in these proportions:",
    ...filas,
    ...(diametros.length === 1
      ? [`SINGLE DIAMETER: every balloon in this installation MUST be exactly ${diametros[0]} inches. Do not vary balloon size, even for depth, overlap, or visual interest.`]
      : []),
    "Every listed diameter must be visibly represented. Every visible balloon must be one of the listed, quoted sizes above; do not add unquoted mini or intermediate balloons.",
    "Do not introduce any other diameter. Do not add jumbo, mini, or intermediate sizes not listed above.",
  ].join("\n");
}

export function bloqueMezclaPorEstructura(estructuras: Array<{
  estructura_id: string;
  nombre: string;
  total_unidades: number;
  mezcla_real: Array<{ diamPulg: number; forma: string | null; unidades: number; pct: number }>;
}>): string | null {
  const bloques = estructuras.filter((estructura) => estructura.mezcla_real.length > 0).map((estructura) => {
    const filas = estructura.mezcla_real.slice().sort((a, b) => b.unidades - a.unidades || b.diamPulg - a.diamPulg).map((linea) => {
      const desc = descripcionFisicaTamano(linea.diamPulg, linea.forma) ?? `${linea.diamPulg}-inch balloon`;
      return `- ${linea.unidades} balloons (${Math.round(linea.pct)}%): ${desc}`;
    });
    return [
      `${estructura.estructura_id} — "${estructura.nombre}", ${estructura.total_unidades} balloons total:`,
      ...filas,
      ...(estructura.mezcla_real.length === 1
        ? [`SINGLE DIAMETER FOR THIS STRUCTURE: every balloon in this structure MUST be exactly ${estructura.mezcla_real[0]!.diamPulg} inches. Do not vary balloon size.`]
        : []),
    ].join("\n");
  });
  if (bloques.length === 0) return null;
  return [
    "BALLOON SIZE MIX — HARD CONSTRAINT (per structure)",
    ...bloques,
    "Each structure uses EXACTLY its own quoted diameters and quantities. Every listed diameter must be visibly represented; every visible balloon must be one of its listed, quoted sizes. Do not apply one structure's mix to another. Do not introduce any other diameter, and do not add jumbo, mini, or intermediate sizes not listed above.",
  ].join("\n");
}
