import { celebracionesDeTexto, tematicasDeTexto } from "./taxonomia-celebraciones";

/**
 * **Entender la consulta** del taller (REQ-002): de un texto libre («una columna como de metro y medio», «los medios
 * arcos de las fotos del dueño», «decoración para un bautizo») saca lo que la base puede usar como refuerzo suave:
 * celebraciones y temáticas (taxonomía), la fuente nombrada, la medida pedida (alto o ancho) y las palabras de la
 * taxonomía que el texto de la ficha sí lleva. PURO y determinista: sin red ni base. Lo que no está claro no se
 * devuelve (mejor sin refuerzo que con uno equivocado), y nada de esto filtra: solo suma puntos en `buscar-sql.ts`.
 */

export type FuenteConsulta = "referencia-dueno" | "idea-sempertex" | "celebra" | "referencia-web";

export type EntendidoConsulta = {
  /** Ids de celebración con pista fuerte (las débiles, como «cumple» o «mamá», no cuentan). */
  celebraciones: string[];
  /** Ids de temática con pista fuerte. */
  tematicas: string[];
  /** Valores de `fuente_tipo` que el texto nombra. */
  fuentes: FuenteConsulta[];
  /** Alto pedido en cm («una columna de 2 metros») o `null`. */
  altoCm: number | null;
  /** Ancho pedido en cm («un arco de 3 m de ancho») o `null`. */
  anchoCm: number | null;
  /** Palabras de los ids de celebración y temática halladas: la ficha las lleva (celebraciones y temáticas) y el texto no. */
  expansion: string[];
};

/** Sin tildes ni ñ, en minúsculas, conservando cifras, puntos y comas (para «1,5 m»). */
export function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// ----------------------------------------------------------------------------------------------------------
// Fuente
// ----------------------------------------------------------------------------------------------------------

const PATRONES_FUENTE: ReadonlyArray<readonly [FuenteConsulta, RegExp]> = [
  ["referencia-dueno", /\b(?:pinterest|dueno|duena)\b/],
  ["celebra", /\brevista\b|\b(?:de|del|en)\s+celebra\b/],
  ["idea-sempertex", /\bsempertex\b|\bideas?\s+de\s+fiesta\b/],
  ["referencia-web", /\breferencias?\s+(?:de\s+la\s+)?web\b|\b(?:de|en)\s+internet\b/],
];

export function fuentesDeTexto(texto: string): FuenteConsulta[] {
  const t = sinTildes(texto);
  return PATRONES_FUENTE.filter(([, patron]) => patron.test(t)).map(([fuente]) => fuente);
}

// ----------------------------------------------------------------------------------------------------------
// Medidas
// ----------------------------------------------------------------------------------------------------------

const NUMERO_EN_LETRAS: Readonly<Record<string, number>> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUMERO = `\\d+(?:[.,]\\d+)?|${Object.keys(NUMERO_EN_LETRAS).join("|")}`;
const aNumero = (s: string): number => NUMERO_EN_LETRAS[s] ?? Number(s.replace(",", "."));

/** Cuántos centímetros dice un trozo («2 metros», «metro y medio», «3,5 m», «150 cm»). */
const MEDIDA_EN_METROS = new RegExp(`(?:\\b(${NUMERO})\\s*)?\\bmetros?\\s+y\\s+medio\\b|\\b(${NUMERO})\\s*(?:metros?|mts?|m)\\b(?!\\w)|\\bmedio\\s+metro\\b`, "g");
const MEDIDA_EN_CM = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(?:cm|centimetros?)\\b`, "g");

type MedidaHallada = { cm: number; inicio: number; fin: number };

function medidasHalladas(t: string): MedidaHallada[] {
  const salida: MedidaHallada[] = [];
  for (const m of t.matchAll(MEDIDA_EN_METROS)) {
    const inicio = m.index ?? 0, fin = inicio + m[0].length;
    if (/metros?\s+y\s+medio/.test(m[0])) salida.push({ cm: (m[1] ? aNumero(m[1]) : 1) * 100 + 50, inicio, fin });
    else if (/^medio\s+metro/.test(m[0])) salida.push({ cm: 50, inicio, fin });
    else if (m[2]) salida.push({ cm: aNumero(m[2]) * 100, inicio, fin });
  }
  for (const m of t.matchAll(MEDIDA_EN_CM)) {
    const inicio = m.index ?? 0;
    salida.push({ cm: aNumero(m[1]!), inicio, fin: inicio + m[0].length });
  }
  return salida.filter((x) => Number.isFinite(x.cm) && x.cm >= 20 && x.cm <= 3000);
}

/** Piezas que se miden a lo ancho: si el texto no dice «de alto» ni «de ancho», «3 metros» es su ancho. */
const PIEZAS_ANCHAS = /\b(?:arcos?|semiarcos?|medios?\s+arcos?|guirnaldas?|paredes?|murales?|mallas?|festones?|techos?|marcos?|portales?|banners?|cortinas?|backdrops?)\b/;
const DICE_ALTO = /^\s*(?:de\s+|en\s+)?(?:alto|alta|altura)\b/;
const DICE_ANCHO = /^\s*(?:de\s+|en\s+)?(?:ancho|ancha|largo|larga|lado a lado)\b/;

/** Alto y ancho pedidos. La primera medida con unidad manda; «de alto» / «de ancho» detrás de ella decide el eje. */
export function medidasDeTexto(texto: string): { altoCm: number | null; anchoCm: number | null } {
  const t = sinTildes(texto);
  const medidas = medidasHalladas(t).sort((a, b) => a.inicio - b.inicio);
  let altoCm: number | null = null, anchoCm: number | null = null;
  for (const m of medidas) {
    const detras = t.slice(m.fin, m.fin + 24);
    const eje = DICE_ALTO.test(detras) ? "alto" : DICE_ANCHO.test(detras) ? "ancho" : PIEZAS_ANCHAS.test(t) ? "ancho" : "alto";
    if (eje === "alto") altoCm ??= m.cm;
    else anchoCm ??= m.cm;
  }
  return { altoCm, anchoCm };
}

// ----------------------------------------------------------------------------------------------------------
// Todo junto
// ----------------------------------------------------------------------------------------------------------

/** Las palabras de un id de taxonomía como las lleva la ficha («quince-anos» → quince, anos). */
const palabrasDeId = (id: string): string[] => id.split(/[-_]/).filter((p) => p.length >= 3);

export function entenderConsulta(texto: string): EntendidoConsulta {
  const celebraciones = [...new Set(celebracionesDeTexto(texto).filter((c) => !c.debil).map((c) => c.id))];
  const tematicas = [...new Set(tematicasDeTexto(texto).filter((c) => !c.debil).map((c) => c.id))];
  const { altoCm, anchoCm } = medidasDeTexto(texto);
  return {
    celebraciones,
    tematicas,
    fuentes: fuentesDeTexto(texto),
    altoCm,
    anchoCm,
    expansion: [...new Set([...celebraciones, ...tematicas].flatMap(palabrasDeId))],
  };
}

export const sinEntender = (e: EntendidoConsulta): boolean =>
  !e.celebraciones.length && !e.tematicas.length && !e.fuentes.length && e.altoCm === null && e.anchoCm === null;
