import { z } from "zod";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { FalloPlanEditar, MENSAJE_EDICION_LENTA, mensajeErrorRespuesta, mensajeFalloPlanEditar, pedirPlanEditar } from "@/lib/plan/peticion-plan-editar";
import type { EdicionPlan } from "@/lib/plan/edicion-esquemas";
import type { CandidatoDelServidor } from "@/components/plan/ajuste/ajuste-propuesta";
import { CATALOGO_ERRORES_UI_V1 } from "@/lib/ia/contracts/ui-error-v1";
import { planSinPieza } from "@/lib/plan/ajuste-estructural";
import {
  coloresDelPlan,
  edicionCantidad,
  edicionMedidas,
  edicionProtagonismo,
  edicionQuitarColor,
  edicionTamano,
  elegirGloboLiso,
  globosDeColor,
  indiceDeColor,
  motivoSinColorNuevo,
  parejaDe,
  sinGloboLiso,
  type CambioPlan,
  type GloboElegido,
  type MedidasObjetivo,
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
  /** Cambia un color por otro globo del catálogo en todas sus medidas (las demás cosas quedan igual). */
  reemplazarColor?: (base: PlanGuiado, cambio: Extract<CambioPlan, { tipo: "reemplazar-color" }>) => Promise<PlanFirmado>;
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

/** «Cambiar» un color por otro globo del catálogo por `/api/plan-editar` (`modo: "reemplazar_color"`): sin modelo. */
export function reemplazarColorEnServidor(base: PlanGuiado, cambio: Extract<CambioPlan, { tipo: "reemplazar-color" }>, fetcher?: typeof fetch): Promise<PlanFirmado> {
  return pedirAlServidor({
    modo: "reemplazar_color",
    base,
    color: cambio.color,
    ...(cambio.productIdAnterior ? { product_id_anterior: cambio.productIdAnterior } : {}),
    ...(cambio.estructuraIds?.length ? { estructura_ids: cambio.estructuraIds } : {}),
    color_nuevo: cambio.globo.color,
    product_id: cambio.globo.productId,
    variant_ids: cambio.globo.variantIds,
  }, fetcher);
}

function exigir<T>(valor: T | null, mensaje: string): T {
  if (valor === null) throw new FalloPlanEditar(mensaje);
  return valor;
}

/** El color (por nombre) del material `indice` de una pieza: así se encuentra el mismo color en su pareja. */
function colorEn(plan: PlanGuiado, estructuraId: string, indice: number): string {
  return plan.plan.estructuras.find((item) => item.estructura_id === estructuraId)?.materiales[indice]?.color ?? "";
}

/** Las medidas que Python dejó en una pieza (las de la tarjeta). */
function medidasDe(plan: PlanGuiado, estructuraId: string): MedidasObjetivo {
  const medidas = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId)?.medidas ?? {};
  return { ...(medidas.ancho_m ? { ancho_m: medidas.ancho_m } : {}), ...(medidas.alto_m ? { alto_m: medidas.alto_m } : {}), ...(medidas.largo_m ? { largo_m: medidas.largo_m } : {}) };
}

/**
 * El mismo cambio en la pieza pareja, sobre el plan que ya trae el de la primera. Por COLOR, no por posición (la
 * pareja puede tener sus colores en otro orden); el tamaño, con las medidas que quedaron en la primera, para que las
 * dos midan lo mismo. Null si en la pareja no cambia nada.
 */
function edicionEnPareja(cambio: CambioPlan, antes: PlanGuiado, despues: PlanGuiado, pareja: string): EdicionPlan | null {
  switch (cambio.tipo) {
    case "protagonismo": {
      const indice = indiceDeColor(despues, pareja, colorEn(antes, cambio.estructuraId, cambio.indice));
      return indice < 0 ? null : edicionProtagonismo(despues, pareja, indice, cambio.direccion);
    }
    case "cantidad": {
      const color = colorEn(antes, cambio.estructuraId, cambio.indice);
      const indice = indiceDeColor(despues, pareja, color);
      if (indice < 0) return null;
      // La misma cifra que quedó en la primera (si las dos llevaban lo mismo); si no, la misma diferencia.
      const propia = globosDeColor(antes, pareja, color);
      const objetivo = propia === cambio.desde ? globosDeColor(despues, cambio.estructuraId, color) : propia + (globosDeColor(despues, cambio.estructuraId, color) - cambio.desde);
      return edicionCantidad(despues, pareja, indice, objetivo);
    }
    case "tamano":
    case "medidas":
      return edicionMedidas(despues, pareja, medidasDe(despues, cambio.estructuraId));
    case "quitar-color": {
      const indice = indiceDeColor(despues, pareja, colorEn(antes, cambio.estructuraId, cambio.indice));
      return indice < 0 ? null : edicionQuitarColor(despues, pareja, indice);
    }
    default:
      return null;
  }
}

/** Intentos de «−1» / «+1» cuando Python deja la cifra igual al armar: 1, luego 2 y luego 4 globos de diferencia. */
const PASOS_CANTIDAD = [1, 2, 4];

/**
 * «Que lleve N globos de este color». Python arma la pieza y cuenta: con los − y + de a uno puede que el reparto deje
 * la cifra igual (el motor reparte por cuotas enteras); entonces se pide con un paso algo mayor, hasta que se mueva.
 */
async function aplicarCantidad(cambio: Extract<CambioPlan, { tipo: "cantidad" }>, base: PlanGuiado, aplicar: DependenciasAjuste["aplicar"]): Promise<PlanFirmado> {
  const color = colorEn(base, cambio.estructuraId, cambio.indice);
  const diferencia = Math.round(cambio.objetivo) - cambio.desde;
  const sentido = Math.sign(diferencia);
  const pasos = Math.abs(diferencia) === 1 ? PASOS_CANTIDAD : [Math.abs(diferencia)];
  let ultimo: PlanFirmado | null = null;
  for (const paso of pasos) {
    const edicion = edicionCantidad(base, cambio.estructuraId, cambio.indice, cambio.desde + sentido * paso);
    if (!edicion) break;
    ultimo = await aplicar(base, edicion);
    const quedo = globosDeColor(ultimo.plan, cambio.estructuraId, color);
    if (Math.sign(quedo - cambio.desde) === sentido) return ultimo;
  }
  if (ultimo) return ultimo;
  throw new FalloPlanEditar("Esa cifra no se puede: deja al menos un globo de cada color (para ninguno, quita el color).");
}

/** Primero en la pieza; luego, con `pareja`, lo mismo en su pareja sobre el plan que ya lo trae. */
async function conPareja(cambio: CambioPlan, base: PlanGuiado, primero: PlanFirmado, aplicar: DependenciasAjuste["aplicar"]): Promise<PlanFirmado> {
  if (!("pareja" in cambio) || !cambio.pareja || !("estructuraId" in cambio)) return primero;
  const pareja = parejaDe(base, cambio.estructuraId);
  if (!pareja) return primero;
  const edicion = edicionEnPareja(cambio, base, primero.plan, pareja.estructura_id);
  return edicion ? aplicar(primero.plan, edicion) : primero;
}

/**
 * Lleva a cabo un ajuste sobre `base`. Lanza `FalloPlanEditar` con el mensaje para el cliente si no se pudo; el plan
 * que se ve no se toca hasta que esto resuelve.
 */
export async function ejecutarCambio(cambio: CambioPlan, base: PlanGuiado, dependencias: DependenciasAjuste): Promise<PlanFirmado> {
  const { aplicar } = dependencias;
  switch (cambio.tipo) {
    case "protagonismo":
      return conPareja(cambio, base, await aplicar(base, exigir(edicionProtagonismo(base, cambio.estructuraId, cambio.indice, cambio.direccion), "Ese color ya está en su límite.")), aplicar);
    case "cantidad":
      return conPareja(cambio, base, await aplicarCantidad(cambio, base, aplicar), aplicar);
    case "tamano":
      return conPareja(cambio, base, await aplicar(base, exigir(edicionTamano(base, cambio.estructuraId, cambio.direccion), "La pieza ya está en su tamaño límite.")), aplicar);
    case "medidas":
      return conPareja(cambio, base, await aplicar(base, exigir(edicionMedidas(base, cambio.estructuraId, cambio.medidas), "Esa medida ya es la de tu pieza, o está fuera de lo que se puede armar.")), aplicar);
    case "quitar-color":
      return conPareja(cambio, base, await aplicar(base, exigir(edicionQuitarColor(base, cambio.estructuraId, cambio.indice), "Ese color no se puede quitar: la pieza necesita al menos uno.")), aplicar);
    case "tamano-todo": {
      // «Hacerla más grande»: cada pieza un 10 %, una tras otra sobre el plan que ya trae las anteriores.
      let actual: PlanFirmado | null = null;
      for (const estructura of base.plan.estructuras) {
        const sobre = actual?.plan ?? base;
        const edicion = edicionTamano(sobre, estructura.estructura_id, cambio.direccion);
        if (edicion) actual = await aplicar(sobre, edicion);
      }
      return exigir(actual, cambio.direccion > 0 ? "Tus piezas ya están en su tamaño máximo." : "Tus piezas ya están en su tamaño mínimo.");
    }
    case "reemplazar-color": {
      if (!dependencias.reemplazarColor) throw new FalloPlanEditar(RESPALDO_AJUSTE);
      return dependencias.reemplazarColor(base, cambio);
    }
    case "agregar-color": {
      const presentes = coloresDelPlan(base);
      const color = cambio.color.trim().toLocaleLowerCase("es");
      // Con un globo elegido, lo que no se repite es ESE globo (otro blanco, perlado, junto al de siempre sí entra).
      const repetido = cambio.globo
        ? base.plan.estructuras.every((estructura) => estructura.materiales.some((material) => material.product_id === cambio.globo!.productId && (material.color ?? "").toLocaleLowerCase("es") === color))
        : presentes.includes(color);
      if (repetido) throw new FalloPlanEditar(cambio.globo ? "Tus piezas ya llevan ese globo. Elige otro, o cambia un color con «Cambiar»." : "Tu plan ya lleva ese color. Para otro tono, usa «Cambiar» en ese color.");
      const motivo = motivoSinColorNuevo(base);
      if (motivo) throw new FalloPlanEditar(motivo);
      // El globo elegido en el catálogo va tal cual, con todos sus tamaños.
      if (cambio.globo) return dependencias.agregarColor(base, { productId: cambio.globo.productId, variantId: cambio.globo.variantIds[0]!, variantIds: cambio.globo.variantIds, color: cambio.globo.color });
      // Sin elegir globo: que exista uno liso de ese color (una búsqueda, sin modelo), con todos sus tamaños.
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

