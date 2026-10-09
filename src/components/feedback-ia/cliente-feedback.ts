import {
  MAX_PASOS_CLIENTE,
  TOPE_CAPTURA_BYTES,
  TOPE_ESCENA_BYTES,
  type CodigoErrorFeedback,
  type EntradaFeedback,
  type MomentoCaptura,
  type ProductoFeedback,
  type RespuestaFeedback,
} from "@/lib/feedback-ia/contrato";
import type { MotivoId } from "@/lib/feedback-ia/motivos";

/**
 * El lado del navegador de la calificación de la IA (REQ-010): arma lo que se manda a POST /api/feedback-ia (respetando los
 * topes del contrato, sin lanzar nunca) y hace las dos llamadas (la calificación y las capturas). Sin React ni servidor.
 */

export type PasoFeedback = { nombre: string; ok: boolean; resumen: string; ms?: number };

/** Lo que se sabe del turno de la IA; todo es opcional porque cada superficie conoce cosas distintas. */
export type DatosTurno = {
  pedido?: string;
  respuesta?: string;
  /** Cabecera `x-request-id` de la respuesta del turno. */
  solicitudId?: string | null;
  modelo?: string;
  costeUsd?: number | null;
  latenciaMs?: number | null;
  pasos?: readonly PasoFeedback[];
};

/** El estado de lo que se renderizó antes y después del turno (la escena del taller, el plan del cliente). */
export type EscenasTurno = { antes?: unknown; despues?: unknown };
export type CapturasTurno = { antes?: Blob | null; despues?: Blob | null };

export type ResultadoFeedback =
  | { ok: true; respuesta: RespuestaFeedback }
  | { ok: false; estado: number; codigo: CodigoErrorFeedback | null };

export type ResultadoCaptura = "ok" | "sin_almacen" | "error";

const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;
export const esIdSeguro = (valor: unknown): valor is string => typeof valor === "string" && ID_SEGURO.test(valor);

const esRegistro = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);

function recortar(texto: string | undefined, max: number): string | undefined {
  const limpio = texto?.trim().slice(0, max).trim();
  return limpio ? limpio : undefined;
}

/** La escena si es un objeto que cabe en el tope del contrato; si no, nada (mejor sin escena que un 413 que pierda la nota). */
export function escenaAcotada(valor: unknown): Record<string, unknown> | undefined {
  if (!esRegistro(valor)) return undefined;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(valor)).length;
    return bytes <= TOPE_ESCENA_BYTES ? valor : undefined;
  } catch {
    return undefined;
  }
}

function pasosValidos(pasos: readonly PasoFeedback[] | undefined): EntradaFeedback["pasos"] {
  if (!pasos?.length) return undefined;
  return pasos.slice(0, MAX_PASOS_CLIENTE).map((paso) => ({
    nombre: recortar(paso.nombre, 120) ?? "paso",
    ok: paso.ok,
    resumen: recortar(paso.resumen, 300) ?? "",
    ...(typeof paso.ms === "number" && Number.isFinite(paso.ms) ? { ms: Math.min(3_600_000, Math.max(0, Math.round(paso.ms))) } : {}),
  }));
}

const numeroOpcional = (valor: number | null | undefined, max: number): number | undefined =>
  typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? Math.min(max, valor) : undefined;

export type EntradaArmado = {
  producto: ProductoFeedback;
  turnoId: string;
  conversacionId?: string | undefined;
  datos: DatosTurno;
  calificacion?: number | null;
  motivos?: readonly MotivoId[] | undefined;
  comentario?: string | undefined;
  deshecho?: boolean;
  escenas?: EscenasTurno | undefined;
};

/** El cuerpo de POST /api/feedback-ia, o `null` si el turno no tiene un id que el servidor acepte. */
export function armarEntrada(p: EntradaArmado): EntradaFeedback | null {
  if (!esIdSeguro(p.turnoId)) return null;
  const { datos } = p;
  const antes = escenaAcotada(p.escenas?.antes);
  const despues = escenaAcotada(p.escenas?.despues);
  const pedido = recortar(datos.pedido, 4000);
  const respuesta = recortar(datos.respuesta, 8000);
  const modelo = recortar(datos.modelo, 120);
  const coste = numeroOpcional(datos.costeUsd, 1000);
  const latencia = numeroOpcional(datos.latenciaMs, 3_600_000);
  const comentario = recortar(p.comentario, 2000);
  const pasos = pasosValidos(datos.pasos);
  return {
    turnoId: p.turnoId,
    producto: p.producto,
    ...(esIdSeguro(p.conversacionId) ? { conversacionId: p.conversacionId } : {}),
    ...(esIdSeguro(datos.solicitudId) ? { solicitudId: datos.solicitudId } : {}),
    ...(typeof p.calificacion === "number" ? { calificacion: p.calificacion } : {}),
    ...(p.motivos ? { motivos: [...p.motivos] } : {}),
    ...(p.comentario !== undefined && comentario ? { comentario } : {}),
    ...(p.deshecho ? { deshecho: true } : {}),
    ...(pedido ? { pedido } : {}),
    ...(respuesta ? { respuesta } : {}),
    ...(modelo ? { modelo } : {}),
    ...(coste !== undefined ? { costeUsd: coste } : {}),
    ...(latencia !== undefined ? { latenciaMs: Math.round(latencia) } : {}),
    ...(antes ? { escenaAntes: antes } : {}),
    ...(despues ? { escenaDespues: despues } : {}),
    ...(pasos ? { pasos } : {}),
  };
}

export const tieneEscenas = (entrada: EntradaFeedback): boolean => entrada.escenaAntes !== undefined || entrada.escenaDespues !== undefined;

export function sinEscenas(entrada: EntradaFeedback): EntradaFeedback {
  const copia = { ...entrada };
  delete copia.escenaAntes;
  delete copia.escenaDespues;
  return copia;
}

function codigoDe(cuerpo: unknown): CodigoErrorFeedback | null {
  return esRegistro(cuerpo) && typeof cuerpo.codigo === "string" ? (cuerpo.codigo as CodigoErrorFeedback) : null;
}

function respuestaValida(cuerpo: unknown): cuerpo is RespuestaFeedback {
  return esRegistro(cuerpo) && cuerpo.ok === true && typeof cuerpo.turnoId === "string";
}

/** Manda la calificación (o el registro, el deshacer, el comentario). Nunca lanza: un fallo de red es `estado: 0`. */
export async function enviarFeedback(entrada: EntradaFeedback, buscar: typeof fetch = fetch): Promise<ResultadoFeedback> {
  try {
    const r = await buscar("/api/feedback-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entrada), credentials: "same-origin" });
    const cuerpo: unknown = await r.json().catch(() => null);
    if (r.ok && respuestaValida(cuerpo)) return { ok: true, respuesta: cuerpo };
    return { ok: false, estado: r.status, codigo: codigoDe(cuerpo) };
  } catch {
    return { ok: false, estado: 0, codigo: null };
  }
}

export type EntradaCaptura = { turnoId: string; producto: ProductoFeedback; momento: MomentoCaptura; conversacionId?: string | undefined; imagen: Blob };

/** Sube una captura JPEG. `sin_almacen`: el servidor no tiene dónde guardarla (se sigue sin captura, sin error). */
export async function enviarCaptura(entrada: EntradaCaptura, buscar: typeof fetch = fetch): Promise<ResultadoCaptura> {
  if (!esIdSeguro(entrada.turnoId) || entrada.imagen.size === 0 || entrada.imagen.size > TOPE_CAPTURA_BYTES) return "error";
  try {
    const formulario = new FormData();
    formulario.set("turnoId", entrada.turnoId);
    formulario.set("producto", entrada.producto);
    formulario.set("momento", entrada.momento);
    if (esIdSeguro(entrada.conversacionId)) formulario.set("conversacionId", entrada.conversacionId);
    formulario.set("imagen", entrada.imagen, `${entrada.momento}.jpg`);
    const r = await buscar("/api/feedback-ia/capturas", { method: "POST", body: formulario, credentials: "same-origin" });
    if (r.ok) return "ok";
    const cuerpo: unknown = await r.json().catch(() => null);
    return codigoDe(cuerpo) === "ALMACEN_NO_CONFIGURADO" ? "sin_almacen" : "error";
  } catch {
    return "error";
  }
}
