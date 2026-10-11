import "server-only";
import { after } from "next/server";
import type { Pool } from "pg";
import { getRagPool } from "@/lib/rag/db";
import { registrarPlanAudit } from "@/lib/rag/observability/log";
import { avisar, contextoActual, registrarError } from "@/lib/registro";
import type { DecisionCarrusel } from "./carrusel";

/**
 * Auditoría DURABLE de lo que decide el motor 3D de la vista guiada (plan nuevo, cambios del cliente, «¿cuánto cuesta?» de una
 * idea). `decidir` / `conRegistro` solo escriben a stdout y a /tmp: en Vercel stdout dura ~30 minutos y /tmp muere con la
 * instancia, y el 3D no llama a Python `/internal/v1/plan/resolve`, que era quien dejaba la fila. Desde que la bandera
 * `guiada_motor=3d` quedó encendida para todos, `plan_audit_log` no recibió más filas.
 *
 * Misma tabla y mismas columnas que las filas del plan de Python y de TypeScript (`registrarPlanAudit`); sin migración. Solo
 * hechos del plan: nunca las palabras del cliente (`solicitud_original` queda vacío), tokens ni prompts, y de lo que manda el
 * navegador solo entra lo que tiene forma de código (un hash, un id de pieza, un id de idea que existe). La conversación va en
 * `flag_snapshot.conversacion` para unir la fila con la traza de la conversación (`npm run registros`).
 */

export const ESTADOS_AUDITORIA_3D = [
  "PLAN_3D_CREADO",
  "PLAN_3D_REHECHO",
  "PLAN_3D_IDEA_SUMADA",
  "PLAN_3D_EDITADO",
  "PLAN_3D_FALLBACK",
  "PLAN_3D_EDICION_RECHAZADA",
  "COTIZACION_IDEA_3D",
  "COTIZACION_IDEA_FALLBACK",
] as const;
export type EstadoAuditoria3d = (typeof ESTADOS_AUDITORIA_3D)[number];

export type CompraAuditada = { variantId: string; paquetes: number; subtotal: number };

export type FilaAuditoriaPlan3d = {
  /** UUID: el mismo con el que se pidió el precio a Python (correlación), para unir la fila con sus llamadas. */
  requestId: string;
  estado: EstadoAuditoria3d;
  /** La ruta que decidió (`/api/guiada/motor/plan`, `/api/guiada/motor/editar`, `/api/asistente-guiado`). */
  superficie: string;
  planHash?: string;
  /** Lo que se pidió, reducido a hechos del plan (piezas, colores, operaciones): `plan_audit_log.restricciones`. */
  pedido: Record<string, unknown>;
  /** Lo que salió: motor, piezas, globos, lo hecho: `plan_audit_log.geometry`. */
  resultado: Record<string, unknown>;
  /** La bandera `guiada_motor` que se leyó (`null` si no se pudo leer) y con qué motor se resolvió. */
  motor: { bandera?: string | null; fuente?: string; efectivo: "3d" | "python" | "ninguno" };
  totalCop?: number;
  compras?: readonly CompraAuditada[];
  snapshotPrecios?: string;
  /** Por qué no salió (razón del fallback o código del rechazo). */
  error?: string;
};

/* ---------- Lo que manda el navegador: solo con forma de código ---------- */

const FORMA_DE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const FORMA_DE_HASH = /^[0-9a-f]{64}$/;
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un código de motivo, de razón o de id de catálogo; lo que no tiene esa forma (texto libre, el nombre de una pieza) es `otro`. */
export const codigoSeguro = (texto: string): string => (FORMA_DE_CODIGO.test(texto) ? texto : "otro");
/** El hash de un plan: un sha256 en hexadecimal; cualquier otra cosa que mande el navegador no se guarda. */
export const hashSeguro = (texto: string): string | undefined => (FORMA_DE_HASH.test(texto) ? texto : undefined);
/** El id de un turno del cliente, solo si es un UUID. */
export const uuidSeguro = (texto: string): string | undefined => (FORMA_DE_UUID.test(texto) ? texto : undefined);
/** De las piezas que el armado no pudo representar solo el id (`EST_01_ARCO`): su motivo nombra la pieza como la llamó el cliente. */
export const idsDePiezas = (piezas: ReadonlyArray<{ piezaId: string }>): string[] => piezas.map((pieza) => codigoSeguro(pieza.piezaId));

/* ---------- La escritura ---------- */

type Escritor = Pick<Pool, "query">;
type AvisarFallo = (evento: string, datos: Record<string, unknown>, causa?: unknown) => void;

export type OpcionesAuditoria3d = {
  pool?: Escritor;
  /** Cuánto se espera la escritura cuando no se puede dejar para después de la respuesta. */
  plazoMs?: number;
  /** Deja la escritura para cuando la respuesta ya salió; `true` si lo logró. Por defecto, `after()` de Next (en Vercel, `waitUntil`). */
  programar?: (escritura: Promise<void>) => boolean;
  /** Dónde queda dicho que una fila no se guardó (por defecto, el registro del servidor). */
  avisarFallo?: AvisarFallo;
};

const PLAZO_ESCRITURA_MS = 3_000;

/** La fila tal como la guarda `registrarPlanAudit` (columnas de `plan_audit_log`). */
export function datosDeAuditoria(fila: FilaAuditoriaPlan3d, conversacion: string | undefined): Parameters<typeof registrarPlanAudit>[1] {
  const compras = fila.compras ?? [];
  return {
    requestId: fila.requestId,
    ...(fila.planHash ? { planHash: fila.planHash, sceneSpecHash: fila.planHash } : {}),
    restricciones: fila.pedido,
    geometry: fila.resultado,
    selectedProductIds: compras.map((compra) => compra.variantId),
    ...(fila.totalCop !== undefined ? { costChosenCop: Math.round(fila.totalCop) } : {}),
    ...(compras.length ? { packages: { lineas: compras.map((compra) => ({ variant_id: compra.variantId, paquetes: compra.paquetes, subtotal: compra.subtotal })) } } : {}),
    status: fila.estado,
    ...(fila.error ? { error: fila.error } : {}),
    flagSnapshot: {
      guiada_motor: fila.motor.bandera ?? null,
      fuente: fila.motor.fuente ?? null,
      efectivo: fila.motor.efectivo,
      ...(fila.snapshotPrecios ? { snapshot_precios: fila.snapshotPrecios } : {}),
      ...(conversacion ? { conversacion } : {}),
    },
    hechos: { superficie: fila.superficie },
  };
}

const avisarEnElRegistro: AvisarFallo = (evento, datos, causa) => {
  if (causa === undefined) avisar(evento, datos);
  else registrarError(evento, causa, datos);
};

/** Si no se guardó queda dicho con lo bastante para rehacer la fila a mano mientras el registro (en Vercel, ~30 min) la tenga. */
function sinGuardar(evento: string, fila: FilaAuditoriaPlan3d, avisarFallo: AvisarFallo, causa?: unknown): void {
  avisarFallo(evento, { request_id: fila.requestId, estado: fila.estado, superficie: fila.superficie, plan_hash: fila.planHash ?? null, total_cop: fila.totalCop ?? null, error: fila.error ?? null }, causa);
}

let avisoSinBaseDado = false;

/** Nunca rechaza: lo que falle queda dicho (`sinGuardar`) y el plan del cliente sigue. */
async function escribir(fila: FilaAuditoriaPlan3d, datos: ReturnType<typeof datosDeAuditoria>, opciones: OpcionesAuditoria3d, avisarFallo: AvisarFallo): Promise<void> {
  if (!opciones.pool && !process.env.DATABASE_URL) {
    // El PC sin Neon: lo esperado, un aviso por proceso y no uno por plan.
    if (!avisoSinBaseDado) console.warn("[guiada-motor] sin DATABASE_URL: la auditoría del plan 3D no se guarda en plan_audit_log.");
    avisoSinBaseDado = true;
    return;
  }
  try {
    const guardada = await registrarPlanAudit(opciones.pool ?? getRagPool(), datos);
    if (!guardada) sinGuardar("guiada_motor.auditoria_plan_no_guardada", fila, avisarFallo);
  } catch (error) {
    sinGuardar("guiada_motor.auditoria_plan_no_guardada", fila, avisarFallo, error);
  }
}

function programarTrasLaRespuesta(escritura: Promise<void>): boolean {
  try {
    after(escritura);
    return true;
  } catch {
    // Fuera de una petición de Next (pruebas, scripts) `after` no existe: se espera aquí.
    return false;
  }
}

async function esperarConPlazo(escritura: Promise<void>, plazoMs: number): Promise<boolean> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<boolean>((resolver) => { temporizador = setTimeout(() => resolver(false), plazoMs); });
  try {
    return await Promise.race([escritura.then(() => true), plazo]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Escribe la fila en `plan_audit_log`. En Vercel una promesa suelta se pierde cuando la función se congela al responder, así
 * que la escritura se deja a `after()` (la respuesta no espera a Neon y la función no se congela hasta que termine); donde
 * `after` no existe se espera aquí, con plazo. Nunca lanza: un fallo de la base no tumba el plan del cliente, pero queda dicho.
 */
export async function registrarAuditoriaPlan3d(fila: FilaAuditoriaPlan3d, opciones: OpcionesAuditoria3d = {}): Promise<void> {
  const avisarFallo = opciones.avisarFallo ?? avisarEnElRegistro;
  let datos: ReturnType<typeof datosDeAuditoria>;
  try {
    datos = datosDeAuditoria(fila, contextoActual()?.conversacion);
  } catch (error) {
    sinGuardar("guiada_motor.auditoria_plan_no_guardada", fila, avisarFallo, error);
    return;
  }
  const escritura = escribir(fila, datos, opciones, avisarFallo);
  if ((opciones.programar ?? programarTrasLaRespuesta)(escritura)) return;
  if (!(await esperarConPlazo(escritura, opciones.plazoMs ?? PLAZO_ESCRITURA_MS))) sinGuardar("guiada_motor.auditoria_plan_lenta", fila, avisarFallo);
}

/** La fila de «¿cuánto cuesta?» de una idea del carrusel: lo que cotizó el motor 3D, o por qué se quedó con la lista curada. `null` si la bandera estaba en `python` (no hubo decisión del 3D). */
export function filaDeCotizacionDeIdea(decision: DecisionCarrusel, ideaId: string, requestId: string, superficie: string): FilaAuditoriaPlan3d | null {
  const pedido = { idea_id: codigoSeguro(ideaId) };
  if (decision.usar === "motor") {
    const { cotizacion, globos, avisos } = decision.resultado;
    return {
      requestId,
      estado: "COTIZACION_IDEA_3D",
      superficie,
      pedido,
      resultado: { accion: "cotizacion_idea", motor: "3d", globos, lineas: cotizacion.lineas.length, avisos: avisos.length },
      motor: { bandera: "3d", efectivo: "3d" },
      totalCop: cotizacion.total,
      compras: cotizacion.lineas.map((linea) => ({ variantId: linea.varianteId, paquetes: linea.paquetes, subtotal: linea.subtotal })),
    };
  }
  if (decision.motivo === "bandera_python") return null;
  return {
    requestId,
    estado: "COTIZACION_IDEA_FALLBACK",
    superficie,
    pedido,
    resultado: { accion: "cotizacion_idea", motor: "python", razon: decision.motivo },
    // Sin leer la bandera no se sabe qué decía; el resto de razones se dieron con ella en `3d`.
    motor: { bandera: decision.motivo === "no_se_pudo_leer_la_bandera" ? null : "3d", efectivo: "python" },
    error: decision.motivo,
  };
}
