import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { HEX_SIN_COLOR, acabadoVisual, colorLeido, familiaSempertex, sinTildes, type AcabadoGlobo } from "./color-globo";
import { partesLinea } from "./formato";

/**
 * La ficha visual de un material de la cotización: qué globo Sempertex es («Reflex Plata»), su familia, su
 * color y acabado para pintarlo, su tamaño y su foto de catálogo. Solo presentación: las cantidades, los
 * paquetes y los precios los resolvió Python y aquí no se tocan. Puro: sin React.
 */
export type FichaGlobo = {
  /** Cómo se pide el globo en Sempertex, sin tamaño ni paquete: «Reflex Plata», «Silk Blanco Nácar». */
  producto: string;
  /** La familia Sempertex («Reflex», «Fashion»…), o null si el nombre no la dice. */
  familia: string | null;
  /** El acabado en palabras de cliente: «cromado», «perlado», «liso»… */
  acabadoCliente: string | null;
  /** Para `GloboMiniatura`. */
  acabado: AcabadoGlobo;
  hex: string;
  /** Pulgadas del globo, si las tiene (un globo para modelar no). */
  pulgadas: number | null;
  /** El tamaño como se lee en un chip: «12″», «Link 6″», «Corazón 12″», «Para modelar». */
  medida: string | null;
  /** Foto real del producto (catálogo), ya a tamaño de miniatura. */
  foto: string | null;
  /** Agrupa las variantes del mismo producto en distintos tamaños. */
  grupo: string;
  /** Globos por paquete, si la línea lo dice (lo resolvió Python). */
  unidadesPaquete: number | null;
};

/** Lo que trae una línea de la cotización y sirve para pintarla (todos opcionales: los materiales no los traen). */
export type DatosLinea = {
  nombre?: string;
  color?: string;
  tamano?: string;
  tamanoCodigo?: string;
  diamPulg?: number;
  foto?: string;
  unidadesPaquete?: number;
};

/** Pide a la CDN de Shopify la foto a tamaño de miniatura; otra URL queda igual. */
export function fotoMiniatura(foto: string | null | undefined, ancho = 160): string | null {
  if (!foto) return null;
  try {
    const url = new URL(foto);
    if (url.protocol !== "https:") return null;
    if (url.hostname === "cdn.shopify.com") url.searchParams.set("width", String(ancho));
    return url.toString();
  } catch {
    return null;
  }
}

/** «B2b Globo Latex Redondo Reflex Plata — R-5 / PAQUETE X 50 · R-5 · plateado» → «Reflex Plata». */
function productoDe(nombre: string): string {
  const sinMarca = nombre
    .replace(/^\s*b2b\s+/i, "")
    .replace(/\s*[—–]\s.*$/, "")
    .replace(/\s*·.*$/, "")
    .replace(/\s*\/?\s*paquete\b.*$/i, "")
    .trim();
  // Nombres de costeo de la guiada: «Globo de látex 12" Palo de rosa», «Globo metalizado 18" Plata».
  const costeo = /^globo\s+(?:de\s+)?(?:l[aá]tex\s+|metalizado\s+|de\s+eslab[oó]n\s+|de\s+coraz[oó]n\s+)?(?:para\s+modelar\s+)?\d{1,2}(?:[.,]\d)?"\s+(.+)$/i.exec(sinMarca)?.[1];
  if (costeo) return costeo.trim();
  const producto = sinMarca
    .replace(/^globos?\s+/i, "")
    .replace(/^(?:de\s+)?l[aá]tex\s+/i, "")
    .replace(/^redondos?\s+/i, "")
    .replace(/\s*\bR-?\d{1,2}\b.*$/i, "")
    // Nombres ya dichos para el cliente: «Globo pastel mate rosado de 5"» → «pastel mate rosado».
    .replace(/\s+(?:de\s+)?\d{1,2}(?:[.,]\d)?\s*(?:"|”|''|pulgadas?|pulg\.?)\s*$/i, "")
    .trim();
  return producto || sinMarca || nombre.trim();
}

function enTitulo(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().replace(/(^|\s)(\p{Ll})/gu, (_, espacio: string, letra: string) => `${espacio}${letra.toLocaleUpperCase("es")}`);
}

/** El chip del tamaño: «12″», «Link 6″», «Corazón 12″», «Para modelar»; null si no se sabe. */
function medidaDe(datos: DatosLinea, pulgadas: number | null): string | null {
  const nombre = datos.nombre ?? "";
  const partes = partesLinea({ ...(datos.nombre ? { nombre: datos.nombre } : {}), ...(datos.tamano ? { tamano: datos.tamano } : {}) });
  const numero = pulgadas !== null ? String(pulgadas).replace(".", ",") : null;
  if (partes.forma === "modelar" || /\bT\d{3}\b/.test(nombre)) return "Para modelar";
  if (partes.forma === "eslabon") return numero ? `Link ${numero}″` : "Link";
  if (partes.forma === "corazon") return numero ? `Corazón ${numero}″` : "Corazón";
  return numero ? `${numero}″` : null;
}

/** La ficha de una línea de cotización o de un material (`descripcion` en el lugar de `nombre`). */
export function fichaGlobo(datos: DatosLinea): FichaGlobo {
  const nombre = (datos.nombre ?? "").trim();
  const familia = familiaSempertex(nombre);
  const partes = partesLinea({ ...(nombre ? { nombre } : {}), ...(datos.tamano ? { tamano: datos.tamano } : {}), ...(datos.color ? { color: datos.color } : {}) });
  const producto = enTitulo(productoDe(nombre || datos.color || "Globo"));
  const pulgadasTexto = partes.pulgadas ?? (datos.tamanoCodigo ? /\bR-?(\d{1,2})\b/i.exec(datos.tamanoCodigo)?.[1] ?? null : null);
  const pulgadas = typeof datos.diamPulg === "number" && datos.diamPulg > 0 ? datos.diamPulg
    : pulgadasTexto ? Number.parseFloat(pulgadasTexto.replace(",", ".")) : null;
  // El color se pinta desde el nombre del producto (dice el tono exacto: «Palo De Rosa», «Azul Naval») y, si no
  // se reconoce, desde el color de paleta que trae la línea.
  const leido = colorLeido(producto) ?? colorLeido(partes.color) ?? null;
  const hexPaleta = datos.color ? HEX_COLORES_V2[datos.color as keyof typeof HEX_COLORES_V2] : undefined;
  const hex = leido?.hex ?? hexPaleta ?? HEX_SIN_COLOR;
  const metalizado = partes.forma === "metalizado" || /\bmetalizado\b|\b\d{1,2}\s*IN\b/i.test(nombre);
  const transparente = /\b(crystal|cristal|transparente|clear)\b/i.test(sinTildes(nombre)) || datos.color === "transparente";
  const acabado: AcabadoGlobo = metalizado ? "metalizado"
    : transparente ? "cristal"
      : familia?.acabado ?? (acabadoVisual(nombre) === "espejo" ? "reflex" : "estandar");
  const acabadoCliente = metalizado ? "metalizado" : familia?.cliente ?? null;
  return {
    producto,
    familia: familia?.nombre ?? null,
    acabadoCliente,
    acabado,
    hex,
    pulgadas: pulgadas !== null && Number.isFinite(pulgadas) ? pulgadas : null,
    medida: medidaDe({ ...datos, nombre }, pulgadas !== null && Number.isFinite(pulgadas) ? pulgadas : null),
    foto: fotoMiniatura(datos.foto),
    grupo: sinTildes(`${producto}|${acabado}`),
    unidadesPaquete: typeof datos.unidadesPaquete === "number" && datos.unidadesPaquete > 0 ? datos.unidadesPaquete : unidadesDelTitulo(nombre),
  };
}

/** «… / PAQUETE X 50» → 50; null si el título no lo dice. */
function unidadesDelTitulo(nombre: string): number | null {
  const unidades = Number.parseInt(/\bPAQUETE\s*X\s*(\d{1,4})\b/i.exec(nombre)?.[1] ?? "", 10);
  return Number.isFinite(unidades) && unidades > 0 ? unidades : null;
}

/** Las fichas de una cotización por variante (la primera línea de cada variante manda). */
export function fichasDeCotizacion(lineas: ReadonlyArray<DatosLinea & { id: string; varianteId?: string }>): Record<string, FichaGlobo> {
  const fichas: Record<string, FichaGlobo> = {};
  for (const linea of lineas) {
    const clave = linea.varianteId ?? linea.id;
    if (!fichas[clave]) fichas[clave] = fichaGlobo(linea);
  }
  return fichas;
}

export type GrupoProducto<T> = { clave: string; ficha: FichaGlobo; items: Array<{ item: T; ficha: FichaGlobo }> };

/**
 * Junta las variantes del mismo producto (mismo globo Sempertex en distintos tamaños): los grupos en el orden en
 * que aparecen y, dentro de cada uno, de menor a mayor tamaño. Solo ordena: no suma ni cambia nada.
 */
export function agruparPorProducto<T>(items: readonly T[], fichaDe: (item: T) => FichaGlobo): Array<GrupoProducto<T>> {
  const grupos = new Map<string, GrupoProducto<T>>();
  for (const item of items) {
    const ficha = fichaDe(item);
    const grupo = grupos.get(ficha.grupo);
    if (grupo) grupo.items.push({ item, ficha });
    else grupos.set(ficha.grupo, { clave: ficha.grupo, ficha, items: [{ item, ficha }] });
  }
  for (const grupo of grupos.values()) {
    grupo.items.sort((a, b) => (a.ficha.pulgadas ?? Number.POSITIVE_INFINITY) - (b.ficha.pulgadas ?? Number.POSITIVE_INFINITY));
    // La baldosa del grupo usa la primera foto que haya.
    const conFoto = grupo.items.find((entrada) => entrada.ficha.foto);
    if (conFoto && !grupo.ficha.foto) grupo.ficha = { ...grupo.ficha, foto: conFoto.ficha.foto };
  }
  return [...grupos.values()];
}
