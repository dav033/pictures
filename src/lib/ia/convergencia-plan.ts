import type { ProductoCandidato } from "@/lib/rag/chat/buscar";
import type { DisponibilidadProducto } from "@/lib/plan/cobertura-materiales";
import { coloresRealesProducto } from "@/lib/plan/colores-producto";
import { mezclasCompatiblesConDiametros } from "@/lib/plan/resolver";
import type { PlanDecoracion } from "@/lib/plan/tipos";

/**
 * Deterministic convergence of one chat turn (E2E 2026-09-15: "Semiarcos rosa
 * y plata" + "Quiero algo así para un cumpleaños" failed 4 of 5 real runs, two
 * of them looping SIN_COBERTURA + COLORES_REFERENCIA_OMITIDOS until the 75 s
 * deadline).
 *
 * - After `RECHAZOS_PARA_CONVERGER` refusals of `confirmar_plan_decoracion` in
 *   the same turn, a refusal the server can repair is not sent back: photo
 *   colors stop being claimed and the materials without size coverage are
 *   removed (with a customer notice) before resolving again.
 * - After `RECHAZOS_MAXIMOS` refusals the tool stops answering with repair
 *   instructions: the model must reply to the customer.
 * - `cierreAnticipado` ends the turn before the next model call once the turn
 *   has run long enough, so the customer gets a useful question instead of a
 *   timeout.
 *
 * Pure: no provider, HTTP, database or environment.
 */
export const RECHAZOS_PARA_CONVERGER = 2;
export const RECHAZOS_MAXIMOS = 4;
/** Without a plan, the turn answers with a question once it has run this long (route deadline: 75 s). */
export const LIMITE_TURNO_SIN_PLAN_MS = 40_000;
/** With a verified plan, the model still gets time for its summary up to this point. */
export const LIMITE_TURNO_CON_PLAN_MS = 58_000;

export const ACCION_PLAN_NO_CONVERGE = "No vuelvas a llamar confirmar_plan_decoracion ni a buscar en este mensaje. Responde ya al cliente, en una o dos frases y sin jerga: dile qué no pudiste armar con el catálogo disponible y pregúntale cómo prefiere seguir (por ejemplo con otros colores, otros tamaños u otra pieza).";

/** Candidates of several searches of the same turn: one entry per product with every variant seen. */
export function unirCandidatosTurno(previos: readonly ProductoCandidato[], nuevos: readonly ProductoCandidato[]): ProductoCandidato[] {
  const porProducto = new Map<string, ProductoCandidato>();
  for (const candidato of [...previos, ...nuevos]) {
    const anterior = porProducto.get(candidato.productId);
    if (!anterior) {
      porProducto.set(candidato.productId, candidato);
      continue;
    }
    const variantes = new Map(anterior.variantes.map((variante) => [variante.variantId, variante]));
    for (const variante of candidato.variantes) variantes.set(variante.variantId, variante);
    // The latest search wins for product fields (event evidence, availability).
    porProducto.set(candidato.productId, { ...candidato, variantes: [...variantes.values()] });
  }
  return [...porProducto.values()];
}

/** Colors and buildable mixes of every product this turn's searches returned. */
export function disponibilidadDelTurno(candidatos: readonly ProductoCandidato[]): Map<string, DisponibilidadProducto> {
  const disponibilidad = new Map<string, DisponibilidadProducto>();
  for (const candidato of candidatos) {
    const redondas = candidato.variantes.filter((variante) => variante.disponible && variante.forma === "redondo" && variante.diamPulg != null);
    disponibilidad.set(candidato.productId, {
      titulo: candidato.titulo,
      colores: coloresRealesProducto(candidato.titulo, [...candidato.colores, ...candidato.variantes.flatMap((variante) => variante.colores)]),
      mezclas: mezclasCompatiblesConDiametros([...new Set(redondas.map((variante) => variante.diamPulg!))]),
      acabados: candidato.acabados,
    });
  }
  return disponibilidad;
}

/**
 * Removes the materials the resolver could not cover in every size, when the
 * structure keeps its main material and at least one covered material. Shares
 * are rescaled to add up to 1. Otherwise the structure is left as it is.
 */
export function quitarMaterialesSinCobertura(
  plan: PlanDecoracion,
  sinCobertura: ReadonlyArray<{ estructura_id: string; product_id: string }>,
): { plan: PlanDecoracion; avisos: string[]; cambiado: boolean } {
  const avisos: string[] = [];
  let cambiado = false;
  const estructuras = plan.estructuras.map((estructura) => {
    const faltan = new Set(sinCobertura.filter((item) => item.estructura_id === estructura.estructura_id).map((item) => item.product_id));
    if (faltan.size === 0) return estructura;
    const quedan = estructura.materiales.filter((material) => !faltan.has(material.product_id));
    // The main material is the design: without it the piece is not the one proposed.
    const principalSinCobertura = estructura.materiales.some((material) => material.rol_material === "principal" && faltan.has(material.product_id));
    if (principalSinCobertura || quedan.length === 0 || quedan.length === estructura.materiales.length) return estructura;
    cambiado = true;
    const total = quedan.reduce((suma, material) => suma + material.participacion, 0);
    const materiales = quedan.map((material) => ({ ...material, participacion: material.participacion / total }));
    materiales[0] = { ...materiales[0]!, participacion: materiales[0]!.participacion + (1 - materiales.reduce((suma, material) => suma + material.participacion, 0)) };
    if (!materiales.some((material) => material.rol_material === "principal")) materiales[0] = { ...materiales[0]!, rol_material: "principal" };
    const colores = [...new Set(materiales.map((material) => material.color).filter((color): color is string => Boolean(color)))];
    for (const material of estructura.materiales.filter((item) => faltan.has(item.product_id))) {
      avisos.push(`No tengo ${material.color ? `globos ${material.color}` : "uno de los globos"} en todos los tamaños que necesita ${estructura.nombre.toLowerCase()}${colores.length ? `: la armé con ${unirColores(colores)}` : ""}.`);
    }
    return { ...estructura, materiales };
  });
  return { plan: { ...plan, estructuras }, avisos, cambiado };
}

function unirColores(colores: readonly string[]): string {
  return colores.length <= 1 ? (colores[0] ?? "") : `${colores.slice(0, -1).join(", ")} y ${colores.at(-1)}`;
}

/**
 * Text that closes the turn without another model call, or null to go on.
 * With a plan the customer already sees the proposal; without one the turn
 * asks how to go on, naming the photo or customer colors this turn's search
 * does have.
 */
export function cierreAnticipado(input: {
  transcurridoMs: number;
  hayPlan: boolean;
  coloresPedidos: readonly string[];
  coloresDisponibles: readonly string[];
}): string | null {
  if (input.hayPlan) {
    return input.transcurridoMs >= LIMITE_TURNO_CON_PLAN_MS
      ? "Ya te armé la propuesta: revisa el desglose en pantalla y dime si la apruebas o qué quieres ajustar."
      : null;
  }
  if (input.transcurridoMs < LIMITE_TURNO_SIN_PLAN_MS) return null;
  const disponibles = input.coloresPedidos.filter((color) => input.coloresDisponibles.includes(color));
  const faltan = input.coloresPedidos.filter((color) => !input.coloresDisponibles.includes(color));
  if (disponibles.length > 0) {
    return `No logré cerrar la propuesta con los tamaños que tengo disponibles${faltan.length ? ` en ${unirColores(faltan)}` : ""}. ¿Quieres que la arme con ${unirColores(disponibles)}, o prefieres cambiar algún color o pieza?`;
  }
  return "No logré cerrar la propuesta con los globos que tengo disponibles. ¿Me dices qué colores y qué piezas prefieres para armarla?";
}
