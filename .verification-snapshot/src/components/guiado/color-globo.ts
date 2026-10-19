import { HEX_COLORES_OBSERVABLES, clasificarColores } from "@/lib/rag/taxonomy/v2";

/**
 * Colores y acabados de un globo dichos para el cliente y pintados en pantalla (miniaturas, fichas de la foto,
 * materiales). Solo presentación: traduce lo que ya trae la lectura de la foto o el catálogo; no decide ningún
 * color del plan ni de la compra. Puro: sin React.
 */

/** Acabados que entiende `GloboMiniatura`. */
export type AcabadoGlobo = "reflex" | "cromado" | "metalizado" | "perlado" | "satin" | "estandar" | "pastel" | "cristal" | "neon";

/** Cómo se pinta cada acabado: espejo metálico, nácar suave, mate, transparente o fluorescente. */
export type AcabadoVisual = "espejo" | "perlado" | "mate" | "cristal" | "neon";

export function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");
}

/**
 * Acabado visual a partir de cualquier texto: el acabado declarado («reflex», «perlado»…) o el nombre del producto
 * del catálogo («Globo Latex Redondo Silk Blanco Nácar», «Reflex Plata», «Crystal», «Neón»). Sin pista: mate.
 */
export function acabadoVisual(texto: string | null | undefined): AcabadoVisual {
  const limpio = sinTildes(texto ?? "");
  if (!limpio) return "mate";
  if (/\b(reflex|crom|chrome|espejo|mirror|metaliz|metalic|metallic|foil)/.test(limpio)) return "espejo";
  if (/\b(crist|crystal|transp|clear)/.test(limpio)) return "cristal";
  if (/\b(neon|fluor)/.test(limpio)) return "neon";
  if (/\b(perl|pearl|nacar|satin|silk|seda|metal\b)/.test(limpio)) return "perlado";
  return "mate";
}

/** Una familia (línea) de globos Sempertex tal como sale en el catálogo o en la lectura de la foto. */
export type FamiliaSempertex = { nombre: string; acabado: AcabadoGlobo; cliente: string };

/** Familias Sempertex, de la más específica a la más general (Pastel Matte antes que Fashion). */
const FAMILIAS: ReadonlyArray<{ patron: RegExp } & FamiliaSempertex> = [
  { patron: /\bpastel\s+matt?e\b/i, nombre: "Pastel Matte", acabado: "pastel", cliente: "pastel" },
  { patron: /\bpastel\s+dusk\b/i, nombre: "Pastel Dusk", acabado: "pastel", cliente: "pastel" },
  { patron: /\breflex\b/i, nombre: "Reflex", acabado: "reflex", cliente: "cromado" },
  { patron: /\bsilk\b/i, nombre: "Silk", acabado: "perlado", cliente: "perlado" },
  { patron: /\bsat[ií]n\b/i, nombre: "Satín", acabado: "satin", cliente: "satinado" },
  { patron: /\bmetal\b/i, nombre: "Metal", acabado: "perlado", cliente: "metalizado" },
  { patron: /\b(?:crystal|cristal)\b/i, nombre: "Crystal", acabado: "cristal", cliente: "transparente" },
  { patron: /\bne[oó]n\b/i, nombre: "Neón", acabado: "neon", cliente: "neón" },
  { patron: /\bdeluxe\b/i, nombre: "Deluxe", acabado: "estandar", cliente: "liso" },
  { patron: /\bpastel\b/i, nombre: "Pastel", acabado: "pastel", cliente: "pastel" },
  { patron: /\bfashion\b/i, nombre: "Fashion", acabado: "estandar", cliente: "liso" },
  { patron: /\bmatt?e\b/i, nombre: "Fashion", acabado: "estandar", cliente: "mate" },
];

/** La familia Sempertex que nombra un texto («B2b Globo Latex Redondo Reflex Plata — R-5…» → Reflex), o null. */
export function familiaSempertex(texto: string | null | undefined): FamiliaSempertex | null {
  const fuente = texto ?? "";
  const familia = FAMILIAS.find((item) => item.patron.test(fuente));
  return familia ? { nombre: familia.nombre, acabado: familia.acabado, cliente: familia.cliente } : null;
}

type Rgb = { r: number; g: number; b: number };

export function leerHex(hex: string | null | undefined): Rgb | null {
  const limpio = (hex ?? "").trim().replace(/^#/, "");
  const largo = /^[0-9a-f]{3}$/i.test(limpio) ? limpio.split("").map((c) => c + c).join("") : limpio;
  if (!/^[0-9a-f]{6}$/i.test(largo)) return null;
  const n = Number.parseInt(largo, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function aHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mezcla un color con blanco (t > 0) o con negro (t < 0). Un hex ilegible vuelve tal cual. */
export function tonoHex(hex: string, t: number): string {
  const rgb = leerHex(hex);
  if (!rgb) return hex;
  const destino = t >= 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(t));
  return aHex({ r: rgb.r + (destino - rgb.r) * k, g: rgb.g + (destino - rgb.g) * k, b: rgb.b + (destino - rgb.b) * k });
}

/** Gris de respaldo cuando no hay color que pintar. */
export const HEX_SIN_COLOR = "#9ca3af";

/** Cómo dice el cliente cada color de la paleta: «plateado» → «plata», «rosado» → «rosa». */
const NOMBRE_PALETA: Readonly<Record<string, string>> = {
  plateado: "plata", rosado: "rosa", cafe: "café", "dorado rosa": "oro rosa", burdeos: "vino", champagne: "champaña",
};

/** Tonos con nombre propio que la paleta funde con otro: se dicen y se pintan aparte. */
const TONOS: ReadonlyArray<{ patron: RegExp; nombre: string; hex: string }> = [
  { patron: /\b(navy|naval|marino)\b/, nombre: "azul marino", hex: "#1f2d5c" },
  { patron: /\b(rosewood|palo de rosa)\b/, nombre: "palo de rosa", hex: "#c48a8f" },
  { patron: /\b(sage|salvia|eucalipto|eucalyptus)\b/, nombre: "verde salvia", hex: "#9fb39a" },
  { patron: /\b(hot pink|rosa fuerte)\b/, nombre: "rosa fuerte", hex: "#e8478f" },
  { patron: /\b(peach|durazno)\b/, nombre: "durazno", hex: "#f6b48f" },
  { patron: /\b(blush)\b/, nombre: "rosa palo", hex: "#f1c3c8" },
  { patron: /\b(baby blue|celeste|sky blue)\b/, nombre: "celeste", hex: "#9cc9ef" },
  { patron: /\b(ivory|marfil)\b/, nombre: "marfil", hex: "#f7f0de" },
  { patron: /\b(mustard|mostaza)\b/, nombre: "mostaza", hex: "#d6a42b" },
  { patron: /\b(teal|petroleo)\b/, nombre: "verde azulado", hex: "#1f7f86" },
  { patron: /\b(gr[ae]y|gris)\b/, nombre: "gris", hex: "#8e9295" },
];

/** Adjetivos de acabado que trae la lectura («chrome silver», «pearl white», «soft pink», «clear»). */
const ADJETIVOS: ReadonlyArray<{ patron: RegExp; acabado: AcabadoGlobo; texto: string }> = [
  { patron: /\b(chrome|chromed|cromad[oa]|reflex|mirror|espejo)\b/, acabado: "reflex", texto: "cromado" },
  { patron: /\b(metallic|metalizad[oa]|foil)\b/, acabado: "metalizado", texto: "metalizado" },
  { patron: /\b(pearl|pearlescent|perlad[oa]|nacar|silk)\b/, acabado: "perlado", texto: "perlado" },
  { patron: /\b(satin|satinad[oa])\b/, acabado: "satin", texto: "satinado" },
  { patron: /\b(neon|fluorescent|fluor)\b/, acabado: "neon", texto: "neón" },
  { patron: /\b(pastel|soft|pale|suave)\b/, acabado: "pastel", texto: "pastel" },
  { patron: /\b(matte|mate)\b/, acabado: "estandar", texto: "mate" },
];

export type ColorLeido = {
  /** Clave de la paleta del catálogo («plateado»), o null si es un tono sin paleta. */
  clave: string | null;
  /** Color dicho para el cliente, con su acabado: «plata cromado», «rosa pastel», «transparente con confeti». */
  nombre: string;
  /** Solo el color, sin acabado: «plata». */
  color: string;
  /** Adjetivo del acabado, si la lectura lo dijo: «cromado». */
  adjetivo: string | null;
  hex: string;
  acabado: AcabadoGlobo;
};

/**
 * Un color tal como lo escribió quien leyó la foto («chrome silver», «soft pink», «clear», «Plata») dicho y pintado
 * para el cliente; null si no nombra un color que se reconozca. No inventa: el acabado solo aparece si el texto lo
 * dice, y el tono claro u oscuro solo si el texto lo dice.
 */
export function colorLeido(texto: string): ColorLeido | null {
  const limpio = sinTildes(texto).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  const confeti = /\b(confetti|confeti)\b/.test(limpio);
  const transparente = /\b(clear|transparent|transparente|crystal|cristal)\b/.test(limpio);
  const adjetivo = transparente ? null : ADJETIVOS.find((item) => item.patron.test(limpio)) ?? null;
  const tono = TONOS.find((item) => item.patron.test(limpio));
  const clasificado = clasificarColores(limpio);
  const clave = clasificado.status === "known" ? clasificado.values[0] ?? null : null;
  if (!transparente && !tono && !clave) return null;
  const claro = /\b(light|claro|clara|baby|pale)\b/.test(limpio) && !tono;
  const oscuro = /\b(dark|deep|oscuro|oscura)\b/.test(limpio) && !tono;
  let color = transparente && (!clave || clave === "transparente" || clave === "blanco") ? "transparente"
    : tono?.nombre ?? NOMBRE_PALETA[clave ?? ""] ?? clave ?? "";
  if (claro) color = `${color} claro`;
  if (oscuro) color = `${color} oscuro`;
  const base = tono?.hex ?? (clave ? HEX_COLORES_OBSERVABLES[clave] : undefined) ?? HEX_SIN_COLOR;
  const hex = claro ? tonoHex(base, 0.4) : oscuro ? tonoHex(base, -0.35) : base;
  const acabado: AcabadoGlobo = transparente ? "cristal" : adjetivo?.acabado ?? "estandar";
  // «pastel» no se repite si el tono ya lo dice («rosa palo pastel» sobra).
  const textoAcabado = adjetivo && !(adjetivo.texto === "pastel" && tono) ? adjetivo.texto : null;
  const nombre = [color, textoAcabado, confeti ? "con confeti" : null].filter(Boolean).join(" ");
  return { clave: transparente ? "transparente" : clave, nombre, color, adjetivo: textoAcabado, hex, acabado };
}

/** «plata cromado» → «Plata cromado». */
export function conMayusculaInicial(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}
