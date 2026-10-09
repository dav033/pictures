import { agregarFeedback, type ResultadoAgregacion } from "./analisis";
import type { AnalisisFeedback } from "./contrato";
import { filasParaAnalisis, guardarAnalisis } from "./repositorio-analisis";
import type { BaseDatos } from "./repositorio";
import type { ResumenGemini } from "./resumen-gemini";

const DIA_MS = 24 * 60 * 60 * 1000;

export type DependenciasAnalisis = {
  db: BaseDatos;
  /** `null` cuando el resumen con Gemini no está disponible o no se pidió. */
  resumir: ((resultado: ResultadoAgregacion, dias: number) => Promise<ResumenGemini | null>) | null;
  ahora?: () => Date;
};

/** Resume los últimos `dias` días de feedback, lo guarda en `ai_feedback_analisis` y lo devuelve. */
export async function ejecutarAnalisis(
  deps: DependenciasAnalisis,
  pedido: { dias: number; origen: AnalisisFeedback["origen"] },
): Promise<AnalisisFeedback> {
  const hasta = (deps.ahora ?? (() => new Date()))();
  const desde = new Date(hasta.getTime() - pedido.dias * DIA_MS);
  const resultado = agregarFeedback(await filasParaAnalisis(deps.db, desde, hasta));
  const resumen = deps.resumir && resultado.totalCalificados > 0 ? await deps.resumir(resultado, pedido.dias) : null;
  return guardarAnalisis(deps.db, {
    origen: pedido.origen,
    desde,
    hasta,
    dias: pedido.dias,
    totalTurnos: resultado.totalTurnos,
    totalCalificados: resultado.totalCalificados,
    promedio: resultado.promedio,
    metricas: resultado.metricas,
    resumen: resumen?.texto ?? null,
    resumenModelo: resumen?.modelo ?? null,
    resumenCosteUsd: resumen?.costeUsd ?? null,
  });
}
