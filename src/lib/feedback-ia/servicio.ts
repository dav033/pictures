import type { EntradaFeedback, PasoAuditado, RespuestaFeedback } from "./contrato";
import { diferenciaEscenas } from "./diferencia-escena";
import { herramientasDePasos } from "./pasos-auditoria";
import { guardar, obtenerPorTurno, type BaseDatos, type DatosFeedback, type FilaFeedback } from "./repositorio";

/**
 * Registro idempotente del feedback de un turno de la IA. El mismo turno (producto + turnoId) puede llegar varias
 * veces —al terminar la IA, al calificar, al deshacer—: cada pedido solo cambia los campos que trae y conserva el resto.
 */

export type DependenciasServicio = {
  db: BaseDatos;
  /** Pasos del turno desde la auditoría de la conversación (puede no estar: en Vercel es /tmp). */
  leerPasos: (conversacionId: string, solicitudId: string) => Promise<PasoAuditado[]>;
  versionApp: () => string;
};

export type ResultadoRegistro =
  | { estado: "ok"; respuesta: RespuestaFeedback }
  | { estado: "turno_ajeno" };

function sinRepetidos<T>(valores: readonly T[]): T[] {
  return [...new Set(valores)];
}

/** Función pura: lo que queda en la fila tras aplicar `entrada` sobre lo que ya había. */
export function fusionarFeedback(
  existente: FilaFeedback | null,
  entrada: EntradaFeedback,
  usuarioId: string,
  extras: { pasos: PasoAuditado[] | null; versionApp: string },
): DatosFeedback {
  const escenaAntes = entrada.escenaAntes ?? existente?.escenaAntes ?? null;
  const escenaDespues = entrada.escenaDespues ?? existente?.escenaDespues ?? null;
  const escenasCambiaron = entrada.escenaAntes !== undefined || entrada.escenaDespues !== undefined;
  const diferencia = escenaAntes && escenaDespues && (escenasCambiaron || !existente?.diferencia)
    ? diferenciaEscenas(escenaAntes, escenaDespues)
    : existente?.diferencia ?? null;
  const pasos = existente?.pasos?.length ? existente.pasos : extras.pasos?.length ? extras.pasos : null;

  return {
    turnoId: entrada.turnoId,
    producto: entrada.producto,
    usuarioId: existente?.usuarioId ?? usuarioId,
    calificacion: entrada.calificacion ?? existente?.calificacion ?? null,
    motivos: entrada.motivos !== undefined ? sinRepetidos(entrada.motivos) : existente?.motivos ?? [],
    comentario: entrada.comentario !== undefined ? entrada.comentario || null : existente?.comentario ?? null,
    deshecho: entrada.deshecho ?? existente?.deshecho ?? false,
    pedido: entrada.pedido ?? existente?.pedido ?? null,
    respuesta: entrada.respuesta ?? existente?.respuesta ?? null,
    solicitudId: entrada.solicitudId ?? existente?.solicitudId ?? null,
    conversacionId: entrada.conversacionId ?? existente?.conversacionId ?? null,
    herramientas: pasos ? herramientasDePasos(pasos) : existente?.herramientas ?? [],
    pasos,
    modelo: entrada.modelo ?? existente?.modelo ?? null,
    costeUsd: entrada.costeUsd ?? existente?.costeUsd ?? null,
    latenciaMs: entrada.latenciaMs ?? existente?.latenciaMs ?? null,
    // La versión es la del código que produjo el turno, no la del que recibe la calificación.
    versionApp: existente?.versionApp ?? extras.versionApp,
    escenaAntes,
    escenaDespues,
    diferencia,
  };
}

export async function registrarFeedback(deps: DependenciasServicio, usuarioId: string, entrada: EntradaFeedback): Promise<ResultadoRegistro> {
  const existente = await obtenerPorTurno(deps.db, entrada.producto, entrada.turnoId);
  if (existente && existente.usuarioId !== usuarioId) return { estado: "turno_ajeno" };

  const solicitudId = entrada.solicitudId ?? existente?.solicitudId;
  const conversacionId = entrada.conversacionId ?? existente?.conversacionId;
  const hacenFaltaPasos = !existente?.pasos?.length && solicitudId && conversacionId;
  const pasos = hacenFaltaPasos ? await deps.leerPasos(conversacionId, solicitudId) : null;

  const datos = fusionarFeedback(existente, entrada, usuarioId, { pasos, versionApp: deps.versionApp() });
  const guardado = await guardar(deps.db, datos);
  if (!guardado) return { estado: "turno_ajeno" };
  return {
    estado: "ok",
    respuesta: {
      ok: true,
      turnoId: datos.turnoId,
      producto: datos.producto,
      calificacion: datos.calificacion,
      creado: guardado.creado,
      actualizadoEn: guardado.actualizadoEn,
    },
  };
}
