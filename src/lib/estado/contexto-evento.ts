import type { Brief } from "@/lib/types";

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function unirColores(colores: readonly string[]): string {
  const limpios = colores.map((color) => color.trim()).filter(Boolean);
  if (limpios.length <= 1) return limpios.join("");
  return `${limpios.slice(0, -1).join(", ")} y ${limpios[limpios.length - 1]}`;
}

function textoPresupuesto(presupuesto: Brief["presupuesto"]): string | null {
  if (typeof presupuesto === "number" && Number.isFinite(presupuesto) && presupuesto > 0) {
    return `hasta ${PESOS.format(presupuesto)}`;
  }
  if (typeof presupuesto === "string" && presupuesto.trim()) return presupuesto.trim();
  return null;
}

/**
 * Línea de contexto del evento para la cabecera (maqueta Main):
 * "Cumpleaños · rosa, blanco y plateado · hasta $ 1.500.000". Solo incluye
 * lo que el brief realmente trae; sin datos devuelve null y no se muestra.
 */
export function contextoEvento(brief: Brief): string | null {
  const partes = [
    brief.tipo_evento?.trim() || null,
    brief.colores?.length ? unirColores(brief.colores) || null : null,
    textoPresupuesto(brief.presupuesto),
  ].filter((parte): parte is string => Boolean(parte));
  return partes.length ? partes.join(" · ") : null;
}
