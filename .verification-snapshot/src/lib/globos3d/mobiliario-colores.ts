import { buscarPorNombre, fallar, plegar } from "./herramientas-escena-colores";

/**
 * Colores del mobiliario: lo que se pide como un decorador lo diría («dorado», «azul marino», «oro rosa», «verde menta
 * claro», «madera») o `#rrggbb` → `#rrggbb`. Orden: la frase completa; si no, la palabra más específica («marino» antes
 * que «azul»); si no, la tabla de colores Sempertex. «Oscuro» y «claro» (o «pastel») oscurecen o aclaran el resultado.
 */

/** Frases con nombre propio: no se parten («azul marino» no es «azul»). */
const FRASES: Readonly<Record<string, string>> = {
  "azul marino": "#1f3366", "azul rey": "#2a4fb0", "azul cielo": "#9ec9ea", "azul petroleo": "#1f5260", "verde menta": "#a9d6c9", "verde oliva": "#6b7a3a", "verde salvia": "#a9b79a",
  "verde esmeralda": "#1f7a52", "verde botella": "#1d4a35", "verde bosque": "#2f5a3a", "rosa palo": "#e8b8b8", "rosa viejo": "#c9908f", "rosa pastel": "#f4cfd8", "oro rosa": "#e0a899", "oro blanco": "#e9e2cc",
  "rojo vino": "#6d1f2c", "gris perla": "#d8d8d4", "gris grafito": "#4a4a4c", "gris oscuro": "#4a4a4c", "azul oscuro": "#1f3366", "blanco roto": "#f1ece0", "blanco hueso": "#efe9dc",
  "madera clara": "#c9a97a", "madera oscura": "#5c3d24", "palo de rosa": "#e8b8b8",
};

/** Una sola palabra, de la más específica a la más general: se busca primero entre las específicas. */
const ESPECIFICOS: Readonly<Record<string, string>> = {
  marino: "#1f3366", salvia: "#a9b79a", menta: "#a9d6c9", turquesa: "#2fa6a0", celeste: "#9ec9ea", lila: "#b9a3d6", lavanda: "#b9a3d6", cobre: "#b87333", bronce: "#a5733a",
  terracota: "#c4704f", champana: "#e8d6b0", champagne: "#e8d6b0", marfil: "#f1e8d4", crema: "#f1e8d4", beige: "#d8cbb4", nude: "#d9b8a0", vino: "#6d1f2c", fucsia: "#d6336c",
  coral: "#f08a78", durazno: "#f4b99a", mostaza: "#d6a81f", nogal: "#5c3d24", chocolate: "#4a2e1f", cafe: "#6b4a2f", grafito: "#4a4a4c", plateado: "#c9c9c9", cromado: "#c9c9c9",
};

const BASICOS: Readonly<Record<string, string>> = {
  blanco: "#f7f6f2", negro: "#1c1c1c", dorado: "#d6b25a", oro: "#d6b25a", plata: "#c9c9c9", madera: "#8a6a45", rosa: "#f0b8c8", rosado: "#f0b8c8", rojo: "#b3262d", naranja: "#e8793a",
  amarillo: "#f2d36b", verde: "#4f7a4b", azul: "#3d8fd6", morado: "#6b3fa0", violeta: "#6b3fa0", gris: "#8a8a8a", transparente: "#e6eef0", vidrio: "#dfe9ee", espejo: "#cfd8dc",
  white: "#f7f6f2", black: "#1c1c1c", gold: "#d6b25a", silver: "#c9c9c9", pink: "#f0b8c8", red: "#b3262d", green: "#4f7a4b", blue: "#3d8fd6", wood: "#8a6a45", ivory: "#f1e8d4", cream: "#f1e8d4",
};

const mezclar = (hex: string, con: number, cuanto: number): string => {
  const n = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * (1 - cuanto) + con * cuanto);
  return `#${[n(0), n(1), n(2)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

/** Un color pedido → `#rrggbb`; `notas` recibe de dónde salió si no era un nombre común. Falla con ayuda si no lo reconoce. */
export function hexDeColor(pedido: string, notas: string[] = []): string {
  const t = pedido.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  const palabras = plegar(t).split(/[^a-z0-9]+/).filter(Boolean);
  const tono = palabras.some((p) => p === "oscuro" || p === "oscura") ? "oscuro" : palabras.some((p) => ["claro", "clara", "pastel", "suave"].includes(p)) ? "claro" : null;
  const sinTono = palabras.filter((p) => !["oscuro", "oscura", "claro", "clara", "pastel", "suave", "de", "del", "color", "tono"].includes(p));
  const completa = palabras.filter((p) => !["de", "del", "color", "tono"].includes(p)).join(" ");
  const conTono = (hex: string, yaOscuro = false) => (tono === "oscuro" && !yaOscuro ? mezclar(hex, 0, 0.35) : tono === "claro" ? mezclar(hex, 255, 0.45) : hex);
  // La frase completa, o una conocida dentro de lo pedido («un azul marino brillante»); la más larga gana.
  const dentro = Object.keys(FRASES).filter((f) => ` ${completa} `.includes(` ${f} `)).sort((x, y) => y.length - x.length)[0];
  if (dentro) return /oscur|clar|pastel/.test(dentro) ? FRASES[dentro]! : conTono(FRASES[dentro]!);
  const especifico = sinTono.find((p) => ESPECIFICOS[p]);
  if (especifico) return conTono(ESPECIFICOS[especifico]!);
  const basico = sinTono.find((p) => BASICOS[p]);
  if (basico) return conTono(BASICOS[basico]!);
  const sempertex = buscarPorNombre(t);
  if (!sempertex) return fallar(`No reconozco el color «${pedido}»: pásalo como nombre común («blanco», «dorado», «madera», «rosa», «azul marino») o como #rrggbb.`);
  notas.push(`«${pedido}» → ${sempertex.mejor.nombreCompleto}`);
  return sempertex.mejor.hexGlobo;
}
