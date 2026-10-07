import { z } from "zod";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { FalloPlanEditar, MENSAJE_EDICION_LENTA, mensajeErrorRespuesta, mensajeFalloPlanEditar, pedirPlanEditar } from "@/lib/plan/peticion-plan-editar";
import type { EdicionPlan } from "@/lib/plan/edicion-esquemas";
import type { CandidatoDelServidor } from "@/components/plan/ajuste/ajuste-propuesta";
import { CATALOGO_ERRORES_UI_V1 } from "@/lib/ia/contracts/ui-error-v1";
import { planSinPieza } from "@/lib/plan/ajuste-estructural";
import {
  admiteColorNuevo,
  coloresDelPlan,
  edicionProtagonismo,
  edicionQuitarColor,
  edicionTamano,
  elegirGloboLiso,
  MAX_COLORES_PLAN,
  sinGloboLiso,
  type CambioPlan,
  type GloboElegido,
  type PlanGuiado,
} from "./ajuste-plan-guiado";

/**
 * Cómo se lleva a cabo un ajuste de «Ajustar mi plan», sin React: qué se pide y en qué orden. La red llega por
 * `DependenciasAjuste` (en la pantalla, `/api/plan-editar`; en las pruebas, dobles sin coste). Ningún ajuste pasa por
 * el modelo: «Quitar pieza» y «Añadir un color» cambian la entrada del plan firmado y Python la vuelve a resolver,
 * así que las piezas que no se tocan conservan medidas, pesos y nombres.
 */

/** El plan que Python resolvió y firmó; `piezas`: las que recibieron el color nuevo (solo al añadir un color). */
export type PlanFirmado = { plan: PlanGuiado; cotizacion: unknown; piezas?: string[] };

export type DependenciasAjuste = {
  /** Aplica una edición sobre `base` y devuelve el plan que Python resolvió y firmó. */
  aplicar: (base: PlanGuiado, edicion: EdicionPlan) => Promise<PlanFirmado>;
  /** Quita UNA pieza del plan firmado; las demás quedan como estaban. */
  quitarPieza: (base: PlanGuiado, estructuraId: string) => Promise<PlanFirmado>;
  /** Añade un color a las piezas que lo admiten, con sus medidas intactas. */
  agregarColor: (base: PlanGuiado, globo: GloboElegido) => Promise<PlanFirmado>;
  /** Globos del catálogo de un color (búsqueda del explorador de la clásica). */
  buscar: (color: string, approvalToken: string) => Promise<readonly CandidatoDelServidor[]>;
  /** Un color sin globo liso disponible: el panel deja de ofrecerlo. */
  alDescartarColor?: (color: string) => void;
};

export const RESPALDO_AJUSTE = "No pude hacer ese cambio. Tu plan sigue como estaba.";
const RespuestaSchema = z.object({ plan: PlanGuiadoSchema, cotizacion: z.unknown().optional(), piezas: z.array(z.string()).optional() }).passthrough();

/** Lo que el servidor dice con códigos o con palabras de la clásica («R-5», «armado», «motor») no se le muestra al cliente. */
const JERGA = /\bR-\d|armad|motor|decorador|patr[oó]n|variante|sku|estructura_|plan_hash|token/i;

/** Los avisos genéricos de red y de plazo, en la voz de la guiada («No pude…») y diciendo que el plan no cambió. */
const SIN_CONEXION = "No pude conectarme para hacer ese cambio. Tu plan sigue como estaba; revisa tu conexión y vuelve a intentarlo.";
const MUY_LENTO = "Ese cambio tardó demasiado y lo cancelé. Tu plan sigue como estaba; vuelve a intentarlo.";

/** El motivo de un fallo, en palabras del cliente: el del servidor si ya lo es, si no el respaldo. */
export function mensajeAjuste(error: unknown): string {
  const mensaje = mensajeFalloPlanEditar(error, RESPALDO_AJUSTE);
  if (mensaje === CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario) return SIN_CONEXION;
  if (mensaje === MENSAJE_EDICION_LENTA) return MUY_LENTO;
  return JERGA.test(mensaje) ? "No pude hacer ese cambio en esta pieza. Tu plan sigue como estaba; prueba con otro ajuste." : mensaje;
}

async function pedirAlServidor(cuerpo: Record<string, unknown>, fetcher?: typeof fetch): Promise<PlanFirmado> {
  const datos = await pedirPlanEditar(cuerpo, RESPALDO_AJUSTE, fetcher ? { fetcher } : {});
  const leido = RespuestaSchema.safeParse(datos);
  if (!leido.success) throw new FalloPlanEditar(mensajeErrorRespuesta(datos, RESPALDO_AJUSTE));
  return { plan: leido.data.plan, cotizacion: leido.data.cotizacion, ...(leido.data.piezas ? { piezas: leido.data.piezas } : {}) };
}

/** Una edición con la misma ruta y validaciones que la propuesta clásica: Python rehace y firma el plan. */
export function aplicarEnServidor(base: PlanGuiado, edicion: EdicionPlan, fetcher?: typeof fetch): Promise<PlanFirmado> {
  return pedirAlServidor({ modo: "aplicar", base, edicion }, fetcher);
}

/** «Quitar pieza» por `/api/plan-editar` (`modo: "quitar_pieza"`): sin modelo. */
export function quitarPiezaEnServidor(base: PlanGuiado, estructuraId: string, fetcher?: typeof fetch): Promise<PlanFirmado> {
  return pedirAlServidor({ modo: "quitar_pieza", base, estructura_id: estructuraId }, fetcher);
}

/** «Añadir un color» por `/api/plan-editar` (`modo: "agregar_color"`): sin modelo. */
export function agregarColorEnServidor(base: PlanGuiado, globo: GloboElegido, fetcher?: typeof fetch): Promise<PlanFirmado> {
  return pedirAlServidor({ modo: "agregar_color", base, color: globo.color, product_id: globo.productId, variant_ids: globo.variantIds }, fetcher);
}

function exigir<T>(valor: T | null, mensaje: string): T {
  if (valor === null) throw new FalloPlanEditar(mensaje);
  return valor;
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
      const presentes = coloresDelPlan(base);
      if (presentes.includes(cambio.color.trim().toLocaleLowerCase("es"))) throw new FalloPlanEditar("Tu plan ya lleva ese color.");
      if (presentes.length >= MAX_COLORES_PLAN) throw new FalloPlanEditar("Tu plan ya tiene cinco colores: quita uno para añadir otro.");
      if (!admiteColorNuevo(base)) throw new FalloPlanEditar("Ninguna pieza de tu plan admite otro color.");
      // Primero, que exista un globo liso de ese color (una búsqueda, sin modelo), con todos sus tamaños.
      const candidatos = await dependencias.buscar(cambio.color, base.approval_token);
      const globo = elegirGloboLiso(candidatos, cambio.color, null);
      if (!globo) {
        dependencias.alDescartarColor?.(cambio.color);
        throw new FalloPlanEditar(sinGloboLiso(cambio.color));
      }
      return dependencias.agregarColor(base, globo);
    }
    case "quitar-pieza":
      exigir(planSinPieza(base.plan, cambio.estructuraId), "Esa pieza no se puede quitar: tu plan necesita al menos una.");
      return dependencias.quitarPieza(base, cambio.estructuraId);
  }
}
