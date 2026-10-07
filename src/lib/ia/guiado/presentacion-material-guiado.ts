import { clasificarColores, type PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

type ColorCatalogo = (typeof PALETA_COLORES_V2)[number];

const COLOR_CLIENTE: Readonly<Record<string, { nombre: string; color: ColorCatalogo }>> = {
  rosewood: { nombre: "Palo de rosa", color: "rosado" },
  "palo de rosa": { nombre: "Palo de rosa", color: "rosado" },
  durazno: { nombre: "Durazno", color: "naranja" },
};

/**
 * Nota de la biblioteca real: el nombre del catálogo, su variante y, tras el código de tamaño, el color del cliente.
 * «B2b Globo Latex Redondo Fashion Palo De Rosa — R-12 / PAQUETE X 50 · R-12 · rosado»; también globos para modelar
 * («Tubito … — T260 / PAQUETE X 20 · T260 · naranja»), de eslabón («LOL 6»), corazones («CORAZON 12 · C-12») y
 * metalizados («18 IN»).
 */
const NOTA_CATALOGO = /^\s*(?:b2b\s+)?globo\s+(?:l[aá]tex\s+)?(?:redondo\s+)?(.+?)\s*[—–]\s*([^·]*?)\s*(?:·\s*([^·]+?)\s*·\s*([^·]+?))?\s*$/i;
/** Un producto del catálogo que no es globo («B2b Cortina Metalica Roja — PAQUETE X 1 · rojo»). */
const NOTA_OTRO_PRODUCTO = /^\s*(?:b2b\s+)?(?!globo\b)(.+?)\s*[—–][^·]*(?:·\s*([^·]+?))?\s*$/i;

function enFrase(texto: string): string {
  const minuscula = texto.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
  return minuscula.charAt(0).toLocaleUpperCase("es") + minuscula.slice(1);
}

/** Nombre de la línea según la forma del globo; null si la nota no dice ningún tamaño reconocible. */
function nombreGloboCatalogo(producto: string, variante: string, codigo: string): string | null {
  const texto = `${variante} · ${codigo}`;
  if (/\btubito\b/i.test(producto)) return `Globo de látex para modelar ${enFrase(producto.replace(/\btubito\s+/i, "").replace(/^fashion\s+/i, ""))}`;
  const eslabon = /link-o-loon/i.test(producto) ? /\bLOL\s?(\d{1,2})\b/i.exec(texto)?.[1] : undefined;
  if (eslabon) return `Globo de eslabón ${eslabon}" ${enFrase(producto.replace(/link-o-loon®?\s*/i, "").replace(/^fashion\s+/i, ""))}`;
  const corazon = /\bCORAZ[OÓ]N\s+(\d{1,2})\b/i.exec(texto)?.[1];
  if (corazon) return `Globo de corazón ${corazon}" ${enFrase(producto.replace(/\bcoraz[oó]n\s+/i, "").replace(/\bfashion\s+/i, ""))}`;
  const metalizado = /\bmetalizado\b/i.test(producto) ? /\b(\d{1,2})\s*IN\b/.exec(texto)?.[1] : undefined;
  if (metalizado) return `Globo metalizado ${metalizado}" ${enFrase(producto.replace(/\bmetalizado\s+/i, ""))}`;
  const redondo = /\bR-(\d{1,2})\b/i.exec(texto)?.[1];
  // «Fashion» es el liso de siempre; Reflex, Satin o Metal se conservan porque distinguen el producto.
  return redondo ? `Globo de látex ${redondo}" ${enFrase(producto.replace(/^fashion\s+/i, ""))}` : null;
}

/**
 * Convierte la nota de un material de la biblioteca en el nombre de la línea de costeo («Globo de látex 12" Palo de
 * rosa») y su color de paleta (la muestra de color). Acepta las notas de ejemplo («Globo látex R-12 Rosewood,
 * paquete x50») y las del catálogo real; antes estas últimas salían como «… / PAQUETE X 50 · R-12 · blanco» y la
 * vista personal decía «Globo de de 12"». No participa en el costeo.
 */
export function presentacionMaterialGuiado(nota: string | undefined): { nombre: string; color?: ColorCatalogo } {
  const catalogo = nota?.match(NOTA_CATALOGO);
  const nombreCatalogo = catalogo ? nombreGloboCatalogo(catalogo[1]!, catalogo[2] ?? "", catalogo[3] ?? "") : null;
  if (catalogo && nombreCatalogo) {
    const etiqueta = catalogo[4]?.trim();
    const clasificado = clasificarColores(etiqueta || catalogo[1]!);
    return {
      nombre: nombreCatalogo,
      ...(clasificado.status === "known" && clasificado.values[0] ? { color: clasificado.values[0] } : {}),
    };
  }
  const otro = nota?.match(NOTA_OTRO_PRODUCTO);
  if (otro) {
    const clasificado = clasificarColores(otro[2]?.trim() || otro[1]!);
    return { nombre: enFrase(otro[1]!), ...(clasificado.status === "known" && clasificado.values[0] ? { color: clasificado.values[0] } : {}) };
  }
  const referencia = nota?.match(/\bR-(\d+)\s+([^,;.]+)/i);
  if (!referencia) return { nombre: "Globo de látex" };
  const nombreOriginal = referencia[2]!.trim();
  const conocido = COLOR_CLIENTE[nombreOriginal.toLocaleLowerCase("es")];
  const clasificado = clasificarColores(nombreOriginal);
  const color = conocido?.color ?? (clasificado.status === "known" ? clasificado.values[0] : undefined);
  const nombreColor = conocido?.nombre ?? nombreOriginal;
  return {
    nombre: `Globo de látex ${referencia[1]}\" ${nombreColor}`,
    ...(color ? { color } : {}),
  };
}
