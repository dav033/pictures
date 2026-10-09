import { errorFeedback, esPeticionDeCron, exigirAdministrador, exigirSesionMismoOrigen } from "./acceso";
import { PedidoAnalisisSchema } from "./contrato";
import type { DependenciasRutas } from "./dependencias";
import { leerJsonValidado } from "./entrada-http";
import { ultimosAnalisis } from "./repositorio-analisis";
import { ejecutarAnalisis } from "./servicio-analisis";

/** Análisis periódico de huecos: último guardado (panel), ejecución a pedido (panel) y ejecución del cron. */

const ANALISIS_A_MOSTRAR = 10;
const DIAS_DEL_CRON = 7;
const MAX_CUERPO_ANALISIS_BYTES = 1_000;

export async function atenderUltimosAnalisis(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirAdministrador(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  try {
    return Response.json({ analisis: await ultimosAnalisis(deps.db(), ANALISIS_A_MOSTRAR) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    deps.registrarFallo("feedback_ia.analisis_lectura", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo leer el análisis.", 503);
  }
}

/** Botón «Analizar ahora» del panel: administrador, mismo origen, y Gemini solo si el pedido lo pide. */
export async function atenderAnalisisManual(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirAdministrador(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  const origen = exigirSesionMismoOrigen(request);
  if ("respuesta" in origen) return origen.respuesta;
  const leido = await leerJsonValidado(request, PedidoAnalisisSchema, MAX_CUERPO_ANALISIS_BYTES);
  if ("respuesta" in leido) return leido.respuesta;

  try {
    const analisis = await ejecutarAnalisis(
      { db: deps.db(), resumir: leido.valor.conResumen ? deps.resumir : null },
      { dias: leido.valor.dias, origen: "manual" },
    );
    deps.auditar("regla:feedback_ia_analisis", "análisis de huecos ejecutado a pedido", { id: analisis.id, dias: analisis.dias, calificados: analisis.totalCalificados, conResumen: analisis.resumen !== null });
    return Response.json({ analisis }, { status: 201 });
  } catch (error) {
    deps.registrarFallo("feedback_ia.analisis_manual", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo ejecutar el análisis.", 503);
  }
}

/** Cron (Vercel Cron o curl con `Authorization: Bearer $CRON_SECRET`): últimos 7 días; el resumen con Gemini solo con FEEDBACK_IA_RESUMEN_GEMINI=1. */
export async function atenderAnalisisCron(request: Request, deps: DependenciasRutas): Promise<Response> {
  if (!esPeticionDeCron(request)) return errorFeedback("SESION_REQUERIDA", "Credencial de cron inválida.", 401);
  try {
    const analisis = await ejecutarAnalisis(
      { db: deps.db(), resumir: deps.resumenAutomaticoActivo() ? deps.resumir : null },
      { dias: DIAS_DEL_CRON, origen: "cron" },
    );
    deps.auditar("regla:feedback_ia_analisis", "análisis de huecos ejecutado por el cron", { id: analisis.id, dias: analisis.dias, calificados: analisis.totalCalificados, conResumen: analisis.resumen !== null });
    return Response.json({ ok: true, id: analisis.id, totalCalificados: analisis.totalCalificados, promedio: analisis.promedio });
  } catch (error) {
    deps.registrarFallo("feedback_ia.analisis_cron", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo ejecutar el análisis.", 503);
  }
}
