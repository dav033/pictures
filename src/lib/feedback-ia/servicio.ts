import {
  TOPE_ESCENAS_CONVERSACION_BYTES,
  TOPE_TURNOS_CONVERSACION,
  type EntradaFeedback,
  type PasoAuditado,
  type RespuestaFeedback,
} from "./contrato";
import { diferenciaEscenas } from "./diferencia-escena";
import { herramientasDePasos } from "./pasos-auditoria";
import { guardar, volumenDeConversacion, type BaseDatos, type ParcheFeedback } from "./repositorio";

/**
 * Registro idempotente del feedback de un turno de la IA. El mismo turno (producto + turnoId) puede llegar varias
 * veces —al terminar la IA, al calificar, al deshacer—: cada pedido solo cambia los campos que trae (la mezcla es SQL,
 * atómica) y conserva el resto. Las escenas pesan: solo se guardan cuando la persona califica, deshace o comenta, y con
 * tope por conversación.
 */

export type DependenciasServicio = {
  db: BaseDatos;
  /** Pasos del turno desde la auditoría de la conversación (mejor esfuerzo: en Vercel el archivo suele no estar). */
  leerPasos: (conversacionId: string, solicitudId: string) => Promise<PasoAuditado[]>;
  versionApp: () => string;
  ahora?: () => Date;
};

export type ResultadoRegistro =
  | { estado: "ok"; respuesta: RespuestaFeedback }
  | { estado: "turno_ajeno" }
  | { estado: "conversacion_llena" };

/** La persona valoró el turno: califica, lo deshace o deja un comentario. */
export function turnoValorado(entrada: Pick<EntradaFeedback, "calificacion" | "deshecho" | "comentario">): boolean {
  return entrada.calificacion !== undefined || entrada.deshecho === true || (entrada.comentario !== undefined && entrada.comentario !== "");
}

function bytesDe(escena: Record<string, unknown> | undefined): number {
  return escena ? Buffer.byteLength(JSON.stringify(escena)) : 0;
}

type PasosElegidos = { pasos: PasoAuditado[]; fuente: "cliente" | "servidor" } | null;

async function elegirPasos(deps: DependenciasServicio, entrada: EntradaFeedback): Promise<PasosElegidos> {
  if (entrada.pasos?.length) {
    const ts = (deps.ahora?.() ?? new Date()).toISOString();
    return {
      fuente: "cliente",
      pasos: entrada.pasos.map((paso) => ({ ts, tipo: "herramienta", nombre: paso.nombre, ok: paso.ok, resumen: paso.resumen, ...(paso.ms !== undefined ? { ms: paso.ms } : {}) })),
    };
  }
  if (!entrada.solicitudId || !entrada.conversacionId) return null;
  const delServidor = await deps.leerPasos(entrada.conversacionId, entrada.solicitudId);
  return delServidor.length > 0 ? { pasos: delServidor, fuente: "servidor" } : null;
}

export async function registrarFeedback(deps: DependenciasServicio, usuarioId: string, entrada: EntradaFeedback): Promise<ResultadoRegistro> {
  const trae = entrada.escenaAntes !== undefined || entrada.escenaDespues !== undefined;
  let escenasPermitidas = trae && turnoValorado(entrada);

  if (entrada.conversacionId) {
    const volumen = await volumenDeConversacion(deps.db, entrada.conversacionId, entrada.producto, entrada.turnoId);
    if (!volumen.existe && volumen.turnos >= TOPE_TURNOS_CONVERSACION) return { estado: "conversacion_llena" };
    const nuevos = bytesDe(entrada.escenaAntes) + bytesDe(entrada.escenaDespues);
    if (volumen.bytesEscenas + nuevos > TOPE_ESCENAS_CONVERSACION_BYTES) escenasPermitidas = false;
  }

  const escenaAntes = escenasPermitidas ? entrada.escenaAntes ?? null : null;
  const escenaDespues = escenasPermitidas ? entrada.escenaDespues ?? null : null;
  const elegidos = await elegirPasos(deps, entrada);

  const parche: ParcheFeedback = {
    turnoId: entrada.turnoId,
    producto: entrada.producto,
    usuarioId,
    calificacion: entrada.calificacion ?? null,
    motivos: entrada.motivos ? [...new Set(entrada.motivos)] : null,
    comentario: entrada.comentario ?? null,
    deshecho: entrada.deshecho ?? null,
    pedido: entrada.pedido ?? null,
    respuesta: entrada.respuesta ?? null,
    solicitudId: entrada.solicitudId ?? null,
    conversacionId: entrada.conversacionId ?? null,
    herramientas: elegidos ? herramientasDePasos(elegidos.pasos) : null,
    pasos: elegidos?.pasos ?? null,
    pasosFuente: elegidos?.fuente ?? null,
    modelo: entrada.modelo ?? null,
    costeUsd: entrada.costeUsd ?? null,
    latenciaMs: entrada.latenciaMs ?? null,
    versionApp: deps.versionApp(),
    escenaAntes,
    escenaDespues,
    diferencia: escenaAntes && escenaDespues ? diferenciaEscenas(escenaAntes, escenaDespues) : null,
  };

  const guardado = await guardar(deps.db, parche);
  if (!guardado) return { estado: "turno_ajeno" };
  return {
    estado: "ok",
    respuesta: {
      ok: true,
      turnoId: entrada.turnoId,
      producto: entrada.producto,
      calificacion: guardado.calificacion,
      creado: guardado.creado,
      escenasGuardadas: escenasPermitidas,
      actualizadoEn: guardado.actualizadoEn,
    },
  };
}
