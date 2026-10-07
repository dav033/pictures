import { clasificarColores, type PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

type ColorCatalogo = (typeof PALETA_COLORES_V2)[number];

const COLOR_CLIENTE: Readonly<Record<string, { nombre: string; color: ColorCatalogo }>> = {
  rosewood: { nombre: "Palo de rosa", color: "rosado" },
  "palo de rosa": { nombre: "Palo de rosa", color: "rosado" },
  durazno: { nombre: "Durazno", color: "naranja" },
};

/**
 * Nota de la biblioteca real: el nombre del catálogo, su tamaño y el color del cliente.
 * «B2b Globo Latex Redondo Fashion Palo De Rosa — R-12 / PAQUETE X 50 · R-12 · rosado».
 */
const NOTA_CATALOGO = /^\s*(?:b2b\s+)?globo\s+l[aá]tex\s+(?:redondo\s+)?(.+?)\s*[—–]\s*R-(\d+)\b[^·]*(?:·\s*R-\d+\s*·\s*([^·]+?))?\s*$/i;

function enFrase(texto: string): string {
  const minuscula = texto.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
  return minuscula.charAt(0).toLocaleUpperCase("es") + minuscula.slice(1);
}

/**
 * Convierte la nota de un material de la biblioteca en el nombre de la línea de costeo («Globo de látex 12" Palo de
 * rosa») y su color de paleta (la muestra de color). Acepta las notas de ejemplo («Globo látex R-12 Rosewood,
 * paquete x50») y las del catálogo real; antes estas últimas salían como «… / PAQUETE X 50 · R-12 · blanco» y la
 * vista personal decía «Globo de de 12"». No participa en el costeo.
 */
export function presentacionMaterialGuiado(nota: string | undefined): { nombre: string; color?: ColorCatalogo } {
  const catalogo = nota?.match(NOTA_CATALOGO);
  if (catalogo) {
    // «Fashion» es el liso de siempre; Reflex, Satin o Metal se conservan porque distinguen el producto.
    const producto = catalogo[1]!.replace(/^fashion\s+/i, "");
    const etiqueta = catalogo[3]?.trim();
    const clasificado = clasificarColores(etiqueta || producto);
    return {
      nombre: `Globo de látex ${catalogo[2]}" ${enFrase(producto)}`,
      ...(clasificado.status === "known" && clasificado.values[0] ? { color: clasificado.values[0] } : {}),
    };
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
