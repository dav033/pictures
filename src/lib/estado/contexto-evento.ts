import type { Brief } from "@/lib/types";
import { nombreColorCliente } from "@/lib/plan/presentacion-cliente";

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

type PlanParaContexto = { estructuras: ReadonlyArray<{ lineas: ReadonlyArray<{ color: string | null; unidades: number }> }> };

/** Turno de la conversación: la respuesta guarda el brief y el plan de su evento `fin`. */
export type TurnoParaContexto = { role: "user" | "assistant"; brief?: Brief; plan?: PlanParaContexto };

/** Colores reales de la propuesta en palabras del cliente, del más usado al menos usado. */
function coloresPlan(plan: PlanParaContexto): string[] {
  const unidades = new Map<string, number>();
  for (const estructura of plan.estructuras) {
    for (const linea of estructura.lineas) {
      if (!linea.color?.trim()) continue;
      const nombre = nombreColorCliente(linea.color);
      unidades.set(nombre, (unidades.get(nombre) ?? 0) + Math.max(0, linea.unidades));
    }
  }
  return [...unidades.entries()].sort((a, b) => b[1] - a[1]).map(([nombre]) => nombre);
}

function mismosColores(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const normalizar = (colores: readonly string[] | undefined) => [...new Set((colores ?? []).map((color) => color.trim().toLowerCase()).filter(Boolean))].sort().join("|");
  return normalizar(a) === normalizar(b);
}

/**
 * Contexto de la cabecera según lo más reciente de la conversación (E2E real
 * 3: tras «quita el azul» seguía «azul y blanco»). Tipo de evento y
 * presupuesto salen del brief del último `fin`. Los colores salen de la
 * propuesta más reciente, que es lo que el cliente está viendo, salvo que el
 * brief haya cambiado de colores en un turno posterior a esa propuesta (el
 * cliente pidió otros colores y aún no hay propuesta nueva). Sin propuesta, o
 * con una sin colores, mandan los del brief.
 */
export function contextoEventoConversacion(turnos: readonly TurnoParaContexto[], briefActual: Brief): string | null {
  let indicePlan = -1;
  for (let indice = turnos.length - 1; indice >= 0; indice -= 1) {
    const turno = turnos[indice]!;
    if (turno.role === "assistant" && turno.plan) {
      indicePlan = indice;
      break;
    }
  }
  if (indicePlan < 0) return contextoEvento(briefActual);
  const turnoPlan = turnos[indicePlan]!;
  const colores = coloresPlan(turnoPlan.plan!);
  if (!colores.length) return contextoEvento(briefActual);
  const briefCambioDespues = turnos
    .slice(indicePlan + 1)
    .some((turno) => turno.role === "assistant" && turno.brief !== undefined && !mismosColores(turno.brief.colores, turnoPlan.brief?.colores ?? turno.brief.colores));
  if (briefCambioDespues) return contextoEvento(briefActual);
  return contextoEvento({ ...briefActual, colores });
}
