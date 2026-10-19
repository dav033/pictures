import "server-only";
import { llamarPythonPlanResolution } from "@/lib/ia/nucleo/python-adapter";
import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { errorAllowlistDesdePython } from "./allowlist-producto-variante";
import { canonizarColoresPlan } from "./colores-catalogo";
import { decidir } from "@/lib/registro";
import type { EntradaAllowlistPlan } from "./aprobacion";
import type { PistaArmado } from "./armado-bouquet";
import type { PistaGuirnalda } from "./armado-guirnalda";
import type { PistaConteo } from "./conteo-referencia";
import type { PistaGeometria } from "./geometria-referencia";
import type { MotivoSinSilueta, PatronColorResuelto, PistaPatron, PistaTamanos } from "./patron-color";
import { cotizacionDesdePython, planResueltoDesdePython } from "./python-mapper";
import type { PlanResuelto } from "./resuelto";
import type { PlanDecoracion } from "./tipos";

/**
 * Única puerta de resolución de un plan (ADR-0023 paso 5).
 *
 * Hasta el paso 5 existía aquí un segundo camino, el resolutor TypeScript, que
 * era el destino del kill switch. Con él vivían las reglas de conteo, medidas,
 * estimación y cotización duplicadas a mano en los dos lenguajes; el 2026-09-16
 * esa duplicación produjo un fallo silencioso en producción. Ahora Python es el
 * único dueño: lo que devuelve no se recalcula ni se completa desde aquí, para
 * no volver a crear un segundo dueño de la misma regla comercial.
 *
 * No hay reserva implícita. Si Python falla, el error se propaga y quien llama
 * decide qué ve el cliente; responder con otra resolución escondería un corte
 * roto detrás de un plan que nadie verificó. La recuperación es desplegar la
 * revisión anterior del servicio, no cambiar una variable de entorno.
 */
export type ResolucionPlan = {
  resuelto: PlanResuelto;
  materialEstimate: DesignMaterialEstimate;
  cotizacion: Cotizacion;
};

export type EntradaResolucionPlan = {
  plan: PlanDecoracion;
  /** Allowlist del mismo turno, tal como quedó firmada en el contexto del plan. */
  allowlist: readonly EntradaAllowlistPlan[];
  catalogSnapshotId: string;
  /**
   * Solo al confirmar un plan (ADR-0028 §7): Python le asigna un patrón de color
   * a cada estructura que no lo tiene, desde la pista de la foto o su preset.
   * La edición y la generación no lo pasan: re-resolver nunca completa, y sin
   * estos campos la petición es la de siempre, byte a byte.
   */
  completarPatrones?: boolean;
  /** Pistas de patrón leídas en la foto, por elemento de referencia. */
  pistasPatron?: readonly PistaPatron[];
  /** Los tamaños que la foto leyó, en su propia pista: no son una disposición de color. */
  pistasTamanos?: readonly PistaTamanos[];
  /**
   * Solo al confirmar un plan (ADR-0030): Python arma por niveles cada bouquet
   * que no tiene armado, desde la lectura de la foto o su receta, sin cambiar
   * lo que se compra. Misma regla: sin estos campos la petición es la de siempre.
   */
  completarArmados?: boolean;
  /** Lecturas del armado de cada bouquet de la foto, por elemento de referencia. */
  pistasArmado?: readonly PistaArmado[];
  /** Con `completarArmados` o `completarArmadosGuirnalda`: solo estas piezas (la editada, tras una edición que quitó su armado). */
  completarArmadosDe?: readonly string[];
  /**
   * Solo al confirmar un plan (ADR-0032): Python arma por partes cada guirnalda
   * que no tiene armado (receta), sin cambiar lo que se compra. Misma regla:
   * sin este campo la petición es la de siempre.
   */
  completarArmadosGuirnalda?: boolean;
  /** Con `completarArmadosGuirnalda`: la lectura de cada guirnalda de la foto, por elemento (E4). */
  pistasGuirnalda?: readonly PistaGuirnalda[];
  /**
   * Solo al confirmar un plan (ADR-0031): Python ajusta la cantidad (kits) o las
   * medidas, la densidad y la mezcla (geométricas) de cada estructura al conteo
   * de globos leído en la foto. Misma regla: sin estos campos la petición es la
   * de siempre.
   */
  completarConteos?: boolean;
  /** Conteos leídos en la foto, por elemento de referencia. */
  pistasConteo?: readonly PistaConteo[];
  /** Cajas aprobadas de la referencia para que Python derive medidas relativas. */
  pistasGeometria?: readonly PistaGeometria[];
  /** Piezas cuya medida concreta expresó el cliente; sobreviven intactas a la escala de foto. */
  medidasClienteDe?: readonly string[];
  /** Con `completarConteos`: solo estas piezas (la editada, tras cambiar su mezcla). */
  completarConteosDe?: readonly string[];
  /** Con `completarConteos`: el cliente dio medidas; las que el plan declara por estructura no se mueven. */
  medidasDelCliente?: boolean;
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  deadlineMs?: number;
};

export async function resolverPlan(entrada: EntradaResolucionPlan): Promise<ResolucionPlan> {
  // Los colores se canonizan AQUÍ y no en cada llamador (fase 2.7). De los tres
  // que entran por esta puerta, solo `registro-herramientas` canonizaba: la
  // generación y la edición mandaban a Python lo que el modelo hubiera escrito
  // ("rosa", "azul rey"), que el resolver compara literalmente y devuelve
  // SIN_COBERTURA. Eran dos comportamientos según el llamador, que es
  // exactamente lo que `AGENTS.md` prohíbe. Canonizar es idempotente, así que el
  // llamador que ya lo hacía sigue igual y conserva sus `cambios` para
  // reportárselos al cliente.
  const { plan, cambios } = canonizarColoresPlan(entrada.plan);
  if (cambios.length) decidir("regla:canonizar_colores", "colores del plan llevados al nombre del catálogo antes de resolver", cambios, { entrada: { estructuras: entrada.plan.estructuras.length } });

  let resultado: Awaited<ReturnType<typeof llamarPythonPlanResolution>>;
  try {
    resultado = await llamarPythonPlanResolution({
      plan,
      allowlist: entrada.allowlist.map((item) => ({ product_id: item.product_id, variant_ids: [...item.variant_ids] })),
      catalogSnapshotId: entrada.catalogSnapshotId,
      ...(entrada.completarPatrones === undefined ? {} : { completarPatrones: entrada.completarPatrones }),
      ...(entrada.pistasPatron === undefined ? {} : { pistasPatron: [...entrada.pistasPatron] }),
      ...(entrada.pistasTamanos === undefined ? {} : { pistasTamanos: [...entrada.pistasTamanos] }),
      ...(entrada.completarArmados === undefined ? {} : { completarArmados: entrada.completarArmados }),
      ...(entrada.pistasArmado === undefined ? {} : { pistasArmado: [...entrada.pistasArmado] }),
      ...(entrada.completarArmadosDe === undefined ? {} : { completarArmadosDe: [...entrada.completarArmadosDe] }),
      ...(entrada.completarArmadosGuirnalda === undefined ? {} : { completarArmadosGuirnalda: entrada.completarArmadosGuirnalda }),
      ...(entrada.pistasGuirnalda === undefined ? {} : { pistasGuirnalda: [...entrada.pistasGuirnalda] }),
      ...(entrada.completarConteos === undefined ? {} : { completarConteos: entrada.completarConteos }),
      ...(entrada.pistasConteo === undefined ? {} : { pistasConteo: [...entrada.pistasConteo] }),
      ...(entrada.pistasGeometria === undefined ? {} : { pistasGeometria: [...entrada.pistasGeometria] }),
      ...(entrada.medidasClienteDe === undefined ? {} : { medidasClienteDe: [...entrada.medidasClienteDe] }),
      ...(entrada.completarConteosDe === undefined ? {} : { completarConteosDe: [...entrada.completarConteosDe] }),
      ...(entrada.medidasDelCliente === undefined ? {} : { medidasDelCliente: entrada.medidasDelCliente }),
      requestId: entrada.requestId,
      correlationId: entrada.correlationId,
      ...(entrada.signal ? { parentSignal: entrada.signal } : {}),
      ...(entrada.deadlineMs === undefined ? {} : { deadlineMs: entrada.deadlineMs }),
    });
  } catch (error) {
    throw errorAllowlistDesdePython(error) ?? error;
  }
  const resuelto = planResueltoDesdePython(resultado.plan_resuelto);
  const croquis = croquisDelPlan(resuelto.patrones_color ?? [], entrada.requestId);
  if (croquis) console.info("[plan] croquis de silueta", JSON.stringify(croquis));
  return {
    resuelto,
    materialEstimate: resultado.material_estimate,
    cotizacion: cotizacionDesdePython(resultado),
  };
}

/**
 * Diagnóstico del croquis de silueta de cada patrón (nunca un número del plan,
 * nunca datos del cliente): qué piezas se dibujan con su silueta real y cuáles
 * se quedaron con la rejilla genérica, con el motivo que dio Python. `null`
 * cuando la resolución no trae ningún patrón y no hay nada que decir.
 *
 * La caída a la rejilla es correcta —un aro no tiene silueta, una pieza de más de
 * 420 globos por instancia no cabe en el presupuesto de dibujo, y 840 globos por
 * resolución se los reparten las piezas en orden— pero era invisible: la
 * propuesta enseñaba una pared con su contorno y la de al lado una rejilla, y no
 * había ni un log ni un campo que dijera por qué. Con `globos` al lado del
 * motivo se ve en una sola línea si sobró poco o mucho. No es un error y no se
 * registra como tal.
 *
 * `motivo: null` es un croquis que falta sin que Python diga por qué: un
 * servicio más viejo que este campo. Se distingue de un motivo conocido en vez
 * de inventarle uno.
 */
export function croquisDelPlan(
  patrones: readonly PatronColorResuelto[],
  requestId: string,
): { request_id: string; con_silueta: number; de: number; sin_silueta: { id: string; motivo: MotivoSinSilueta | null; globos: number }[] } | null {
  if (patrones.length === 0) return null;
  const sinCroquis = patrones.filter((patron) => patron.posiciones === undefined);
  return {
    request_id: requestId,
    con_silueta: patrones.length - sinCroquis.length,
    de: patrones.length,
    sin_silueta: sinCroquis.map((patron) => ({
      id: patron.estructura_id,
      motivo: patron.sin_silueta ?? null,
      globos: patron.globos_por_instancia,
    })),
  };
}

/**
 * Razón estable por la que un plan aprobado ya no se puede volver a resolver.
 * `PYTHON_NO_SELECCIONADO` desapareció con el kill switch (ADR-0023 paso 5);
 * queda el caso del snapshot, que sigue siendo real: el catálogo rota y una
 * propuesta con hasta 24 h de vida puede apuntar a uno que ya no se publica.
 */
export type MotivoBackendNoDisponible = "SIN_SNAPSHOT_CATALOGO";

export class PlanBackendNoDisponibleError extends Error {
  readonly motivo: MotivoBackendNoDisponible;

  constructor(motivo: MotivoBackendNoDisponible, message: string) {
    super(message);
    this.name = "PlanBackendNoDisponibleError";
    this.motivo = motivo;
  }
}
