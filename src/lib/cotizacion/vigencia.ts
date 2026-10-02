/**
 * Qué tan vigente está el precio que se ve en pantalla, y qué se le dice a
 * quien cotiza. Sin React y sin cuentas: el precio y cada total son de Python;
 * aquí solo se decide si lo que se muestra corresponde a lo que hay escrito.
 *
 * La regla que corrige un engaño con dinero: tras un error o con un campo que
 * no se puede leer, la pantalla conserva el resultado anterior, pero ese
 * resultado deja de ser vigente y se marca ENTERO (precio, desglose, resumen).
 * Y una lista que no estuvo en el cálculo no se pinta `$ 0`: se pinta «—».
 */

export type EstadoCalculo = "vacio" | "calculando" | "listo" | "error";

export type MotivoNoVigente = "campo-ilegible" | "error-de-calculo";

export type Vigencia =
  /** No hay nada que mostrar todavía (o nunca hubo resultado). */
  | { tipo: "sin-resultado"; motivo: MotivoNoVigente | null }
  /** Corresponde a lo escrito. */
  | { tipo: "vigente" }
  /** Se está pidiendo el nuevo; el anterior se ve mientras tanto. */
  | { tipo: "recalculando" }
  /** El resultado que se ve es el anterior: no refleja lo escrito. */
  | { tipo: "no-vigente"; motivo: MotivoNoVigente };

export function vigenciaDe(entrada: { estado: EstadoCalculo; hayResultado: boolean; hayErroresEscritos: boolean }): Vigencia {
  const { estado, hayResultado, hayErroresEscritos } = entrada;
  // Lo escrito manda: con un campo ilegible no se calcula, estado aparte.
  if (hayErroresEscritos) return hayResultado ? { tipo: "no-vigente", motivo: "campo-ilegible" } : { tipo: "sin-resultado", motivo: "campo-ilegible" };
  if (estado === "error") return hayResultado ? { tipo: "no-vigente", motivo: "error-de-calculo" } : { tipo: "sin-resultado", motivo: "error-de-calculo" };
  if (!hayResultado) return { tipo: "sin-resultado", motivo: null };
  return estado === "calculando" ? { tipo: "recalculando" } : { tipo: "vigente" };
}

/** Los importes que se ven son los de un resultado viejo: hay que atenuarlos. */
export const esNoVigente = (vigencia: Vigencia): boolean => vigencia.tipo === "no-vigente";

/**
 * Total de una lista de gastos, o `null` si no corresponde pintarlo. Una lista
 * que no formó parte del cálculo (no tenía ninguna fila completa) no vale $ 0:
 * no tiene total, y la pantalla muestra «—».
 */
export function totalDeLista(total: number | null | undefined, filasEnElCalculo: number): number | null {
  if (total === null || total === undefined) return null;
  return filasEnElCalculo > 0 ? total : null;
}

export type Leyenda = {
  texto: string;
  tono: "normal" | "aviso" | "error";
  /** Se ofrece «Reintentar»: el fallo es del cálculo, no de lo escrito. */
  reintentar: boolean;
};

const PORCENTAJE = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/**
 * La línea de estado bajo el precio: calculando, no actualizado (y por qué) o
 * lo que incluye. `mensajeError` es el aviso ya traducido para el usuario.
 */
export function leyendaDelPrecio(entrada: {
  vigencia: Vigencia;
  mensajeError: string | null;
  /** Lo que de verdad calculó Python; `null` mientras no hay resultado. */
  ganancia: { cop: number; margenPorcentaje: number | null } | null;
}): Leyenda {
  const { vigencia, mensajeError, ganancia } = entrada;
  if (vigencia.tipo === "sin-resultado" || vigencia.tipo === "no-vigente") {
    const anterior = vigencia.tipo === "no-vigente";
    if (vigencia.motivo === "campo-ilegible") {
      return { texto: anterior ? "Este precio es el anterior y no se actualizó: revisa lo que está en rojo." : "Revisa lo que está en rojo para ver el precio.", tono: "aviso", reintentar: false };
    }
    if (vigencia.motivo === "error-de-calculo") {
      const aviso = mensajeError ?? "No pude calcular tu precio.";
      return { texto: anterior ? `${aviso} Este precio es el anterior y no se actualizó.` : aviso, tono: "error", reintentar: true };
    }
    return { texto: "Calculando…", tono: "normal", reintentar: false };
  }
  if (vigencia.tipo === "recalculando") return { texto: "Calculando…", tono: "normal", reintentar: false };
  if (ganancia && ganancia.cop > 0 && ganancia.margenPorcentaje !== null) {
    return { texto: `Incluye tu ganancia: el ${PORCENTAJE.format(ganancia.margenPorcentaje)} % del precio es tuyo.`, tono: "normal", reintentar: false };
  }
  return { texto: "Todavía no incluye tu ganancia.", tono: "normal", reintentar: false };
}

/** La frase que dice qué incluye el precio (¿con IVA?, ¿con mi ganancia?), siempre a la vista. */
export function subtituloDelPrecio(incluyeIva: boolean): string {
  return `Materiales (${incluyeIva ? "con" : "sin"} IVA) + tus gastos + tu ganancia.`;
}
