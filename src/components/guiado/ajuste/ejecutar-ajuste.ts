import { z } from "zod";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { FalloPlanEditar, mensajeErrorRespuesta, mensajeFalloPlanEditar, pedirPlanEditar } from "@/lib/plan/peticion-plan-editar";
import type { EdicionPlan } from "@/lib/plan/edicion-esquemas";
import type { CandidatoDelServidor } from "@/components/plan/ajuste/ajuste-propuesta";
import {
  edicionProtagonismo,
  edicionQuitarColor,
  edicionTamano,
  elegirGloboLiso,
  propuestaConColor,
  propuestaSinPieza,
  sinGloboLiso,
  type CambioPlan,
  type PlanGuiado,
  type PropuestaGuiada,
} from "./ajuste-plan-guiado";

/**
 * Cómo se lleva a cabo un ajuste de «Ajustar mi plan», sin React: qué se pide y en qué orden. La red llega por
 * `DependenciasAjuste` (en la pantalla, `/api/plan-editar` y la ruta del plan guiado; en las pruebas, dobles sin coste).
 */

export type PlanFirmado = { plan: PlanGuiado; cotizacion: unknown };

/** El plan rehecho (por la ruta del plan guiado), o el motivo ya dicho para el cliente. */
export type ResultadoRehacer = PlanFirmado | { error: string };

export type DependenciasAjuste = {
  /** Aplica una edición sobre `base` y devuelve el plan que Python resolvió y firmó. */
  aplicar: (base: PlanGuiado, edicion: EdicionPlan) => Promise<PlanFirmado>;
  /** Globos del catálogo de un color (búsqueda del explorador de la clásica). */
  buscar: (color: string, approvalToken: string) => Promise<readonly CandidatoDelServidor[]>;
  /** Rehace el plan con otra propuesta (otras piezas u otros colores): modelo + Python, como «Cambiar algo». */
  rehacerPlan?: (propuesta: PropuestaGuiada) => Promise<ResultadoRehacer>;
  /** Un color sin globo liso disponible: el panel deja de ofrecerlo. */
  alDescartarColor?: (color: string) => void;
};

export const RESPALDO_AJUSTE = "No pude hacer ese cambio. Tu plan sigue como estaba.";
const RespuestaSchema = z.object({ plan: PlanGuiadoSchema, cotizacion: z.unknown().optional() }).passthrough();

/** Lo que el servidor dice con códigos o con palabras de la clásica («R-5», «armado», «motor») no se le muestra al cliente. */
const JERGA = /\bR-\d|armad|motor|decorador|patr[oó]n|variante|sku|estructura_|plan_hash|token/i;

/** El motivo de un fallo, en palabras del cliente: el del servidor si ya lo es, si no el respaldo. */
export function mensajeAjuste(error: unknown): string {
  const mensaje = mensajeFalloPlanEditar(error, RESPALDO_AJUSTE);
  return JERGA.test(mensaje) ? "No pude hacer ese cambio en esta pieza. Tu plan sigue como estaba; prueba con otro ajuste." : mensaje;
}

/** Una edición con la misma ruta y validaciones que la propuesta clásica: Python rehace y firma el plan. */
export async function aplicarEnServidor(base: PlanGuiado, edicion: EdicionPlan, fetcher?: typeof fetch): Promise<PlanFirmado> {
  const datos = await pedirPlanEditar({ modo: "aplicar", base, edicion }, RESPALDO_AJUSTE, fetcher ? { fetcher } : {});
  const leido = RespuestaSchema.safeParse(datos);
  if (!leido.success) throw new FalloPlanEditar(mensajeErrorRespuesta(datos, RESPALDO_AJUSTE));
  return { plan: leido.data.plan, cotizacion: leido.data.cotizacion };
}

function exigir<T>(valor: T | null, mensaje: string): T {
  if (valor === null) throw new FalloPlanEditar(mensaje);
  return valor;
}

async function rehacer(dependencias: DependenciasAjuste, propuesta: PropuestaGuiada): Promise<PlanFirmado> {
  if (!dependencias.rehacerPlan) throw new FalloPlanEditar("Ese cambio no se puede hacer aquí. Pídelo con «Cambiar algo».");
  const resultado = await dependencias.rehacerPlan(propuesta);
  if ("error" in resultado) throw new FalloPlanEditar(resultado.error);
  return resultado;
}

/**
 * Lleva a cabo un ajuste sobre `base`. Lanza `FalloPlanEditar` con el mensaje para el cliente si no se pudo; el plan
 * que se ve no se toca hasta que esto resuelve.
 */
export async function ejecutarCambio(cambio: CambioPlan, base: PlanGuiado, dependencias: DependenciasAjuste): Promise<PlanFirmado> {
  const { aplicar } = dependencias;
  switch (cambio.tipo) {
    case "protagonismo":
      return aplicar(base, exigir(edicionProtagonismo(base, cambio.estructuraId, cambio.indice, cambio.direccion), "Ese color ya está en su límite."));
    case "tamano":
      return aplicar(base, exigir(edicionTamano(base, cambio.estructuraId, cambio.direccion), "La pieza ya está en su tamaño límite."));
    case "quitar-color":
      return aplicar(base, exigir(edicionQuitarColor(base, cambio.estructuraId, cambio.indice), "Ese color no se puede quitar: la pieza necesita al menos uno."));
    case "agregar-color": {
      const propuesta = exigir(propuestaConColor(base, cambio.color), "Tu plan ya tiene cinco colores: quita uno para añadir otro.");
      // Primero, que exista un globo liso de ese color (una búsqueda, sin modelo): si no, no se gasta un plan.
      const candidatos = await dependencias.buscar(cambio.color, base.approval_token);
      if (!elegirGloboLiso(candidatos, cambio.color, null)) {
        dependencias.alDescartarColor?.(cambio.color);
        throw new FalloPlanEditar(sinGloboLiso(cambio.color));
      }
      return rehacer(dependencias, propuesta);
    }
    case "quitar-pieza":
      return rehacer(dependencias, exigir(propuestaSinPieza(base, cambio.estructuraId), "Esa pieza no se puede quitar."));
  }
}
