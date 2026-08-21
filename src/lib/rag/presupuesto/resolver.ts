import { FRANJAS, FRANJA_SLUGS, type Franja, type FranjaSlug } from "./franjas";

export type FranjaResuelta = {
  franja: Franja;
  /** Cifra concreta que dio el cliente, cuando la hay — se usa para el
   * techo efectivo de `escena_completa` y para reportar holgura real. */
  cifraCliente?: number;
};

/**
 * Busca la franja cuyo rango [minCop, maxCop) contiene `cifra`. Una cifra
 * por debajo de 0 o no finita cae en la primera franja en vez de reventar —
 * nunca se le niega una propuesta al cliente por un número mal formado.
 */
function franjaPorCifra(cifra: number): Franja {
  if (!Number.isFinite(cifra)) return FRANJAS.detalle;
  for (const slug of FRANJA_SLUGS) {
    const franja = FRANJAS[slug];
    if (cifra >= franja.minCop && (franja.maxCop == null || cifra < franja.maxCop)) return franja;
  }
  return FRANJAS.escena_completa;
}

/**
 * Extrae la cifra representativa de una etiqueta de presupuesto en texto
 * libre. Las 4 franjas son intervalos semiabiertos [min, max) (§2.1), así
 * que qué número se elige de un rango o de un "hasta" SÍ decide la franja:
 *
 * - "Desde $150.000" / "$150.000+" → el número es un PISO: se usa tal cual
 *   (franjaPorCifra es inclusiva en el mínimo).
 * - "Hasta $50.000" / "máximo $50.000" → el número es un TECHO exclusivo de
 *   la intención del cliente: se resta 1 para que "hasta $50.000" caiga en
 *   la franja que termina justo en $50.000 (`detalle`), no en la siguiente.
 * - "$50.000 a $100.000" (rango) → se usa el límite INFERIOR: en este
 *   catálogo los rangos de la UI están alineados exactamente a los cortes
 *   de franja, así que el inferior es el que identifica sin ambigüedad cuál
 *   de las dos franjas vecinas es ("50.000 a 100.000" → `focal`, no
 *   `escena`, que es lo que daría tomar el límite superior).
 * - Un solo número suelto ("alrededor de 80 mil") → se usa tal cual.
 */
export function extraerCifraDeTexto(texto: string): number | null {
  const normalizado = texto.replace(/\./g, "").replace(/,/g, "");

  const mil = normalizado.match(/(\d+(?:\.\d+)?)\s*(mil|k)\b/i);
  if (mil && !/\d{4,}/.test(normalizado)) return Number(mil[1]) * 1000;

  const numeros = [...normalizado.matchAll(/(\d{4,})/g)].map((m) => Number(m[1]));
  if (numeros.length === 0) return null;

  if (/desde|a partir de|\+\s*$|más de|superior/i.test(normalizado)) return numeros[0];
  if (/hasta|máximo|maximo|menos de|económic/i.test(normalizado)) return numeros[0] - 1;
  if (numeros.length >= 2) return Math.min(...numeros); // rango "X a Y"
  return numeros[0];
}

/**
 * Resuelve la franja de presupuesto de forma determinista — NUNCA la nombra
 * el LLM (§3, Etapa 0). Sin ninguna señal usable devuelve `null`: el
 * pipeline de franjas no se activa y el asistente conserva una razón real
 * para preguntar, en vez de asumir una franja que el cliente no dio.
 */
export function resolverFranja(presupuesto: number | string | null | undefined): FranjaResuelta | null {
  if (presupuesto == null) return null;

  if (typeof presupuesto === "number") {
    if (!Number.isFinite(presupuesto) || presupuesto <= 0) return null;
    return { franja: franjaPorCifra(presupuesto), cifraCliente: presupuesto };
  }

  const texto = presupuesto.trim();
  if (!texto) return null;

  // Slug directo (ej. brief.presupuesto ya normalizado por un turno previo).
  if ((FRANJA_SLUGS as readonly string[]).includes(texto)) {
    return { franja: FRANJAS[texto as FranjaSlug] };
  }

  const cifra = extraerCifraDeTexto(texto);
  if (cifra == null) return null;
  return { franja: franjaPorCifra(cifra), cifraCliente: cifra };
}
