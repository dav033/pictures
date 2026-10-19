import { errorFeedback, esPeticionDeCron, exigirAdministrador, exigirAdministradorMismoOrigen } from "./acceso";
import { PedidoAnalisisSchema } from "./contrato";
import type { DependenciasRutas } from "./dependencias";
import { leerJsonValidado } from "./entrada-http";
import { ultimosAnalisis } from "./repositorio-analisis";
import { aplicarRetencion, type ResultadoRetencion } from "./retencion";
import { ejecutarAnalisis } from "./servicio-analisis";

/** Análisis periódico de huecos: último guardado (panel), ejecución a pedido (panel) y ejecución del cron (con retención). */

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

/** Botón «Analizar ahora» del panel: administrador, mismo origen, y Gemini (de pago) solo si el pedido lo pide y dentro del tope por hora. */
export async function atenderAnalisisManual(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirAdministradorMismoOrigen(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  const leido = await leerJsonValidado(request, PedidoAnalisisSchema, MAX_CUERPO_ANALISIS_BYTES);
  if ("respuesta" in leido) return leido.respuesta;
  if (leido.valor.conResumen && !deps.limitadorResumenGemini("analisis-manual")) {
    return errorFeedback("DEMASIADAS_PETICIONES", "Ya se pidieron 5 resúmenes con IA en la última hora; vuelve a intentarlo más tarde.", 429);
  }

  try {
    const analisis = await ejecutarAnalisis(
      { db: deps.db(), resumir: leido.valor.conResumen ? deps.resumir : null, avisar: deps.avisar },
      { dias: leido.valor.dias, origen: "manual" },
    );
    deps.auditar("regla:feedback_ia_analisis", "análisis de huecos ejecutado a pedido", { id: analisis.id, dias: analisis.dias, calificados: analisis.totalCalificados, conResumen: analisis.resumen !== null });
    return Response.json({ analisis }, { status: 201 });
  } catch (error) {
    deps.registrarFallo("feedback_ia.analisis_manual", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo ejecutar el análisis.", 503);
  }
}

/**
 * Cron (Vercel Cron o curl con `Authorization: Bearer $CRON_SECRET`): análisis de los últimos 7 días (el resumen con
 * Gemini solo con FEEDBACK_IA_RESUMEN_GEMINI=1) y retención (borra lo no valorado de más de 30 días y las imágenes huérfanas).
 * Cada parte falla por separado: un error en una no impide la otra.
 */
export async function atenderAnalisisCron(request: Request, deps: DependenciasRutas): Promise<Response> {
  if (!esPeticionDeCron(request)) return errorFeedback("SESION_REQUERIDA", "Credencial de cron inválida.", 401);

  let analisis: { id: number; totalCalificados: number; promedio: number | null } | null = null;
  let retencion: ResultadoRetencion | null = null;
  const fallos: string[] = [];

  try {
    const hecho = await ejecutarAnalisis(
      { db: deps.db(), resumir: deps.resumenAutomaticoActivo() ? deps.resumir : null, avisar: deps.avisar },
      { dias: DIAS_DEL_CRON, origen: "cron" },
    );
    analisis = { id: hecho.id, totalCalificados: hecho.totalCalificados, promedio: hecho.promedio };
    deps.auditar("regla:feedback_ia_analisis", "análisis de huecos ejecutado por el cron", { id: hecho.id, dias: hecho.dias, calificados: hecho.totalCalificados, conResumen: hecho.resumen !== null });
  } catch (error) {
    deps.registrarFallo("feedback_ia.analisis_cron", error);
    fallos.push("analisis");
  }

  try {
    retencion = await aplicarRetencion({ db: deps.db(), almacen: deps.almacen() });
    deps.auditar("regla:feedback_ia_retencion", "retención del feedback aplicada por el cron", retencion);
  } catch (error) {
    deps.registrarFallo("feedback_ia.retencion_cron", error);
    fallos.push("retencion");
  }

  return Response.json({ ok: fallos.length === 0, fallos, analisis, retencion }, { status: fallos.length === 2 ? 503 : 200 });
}
