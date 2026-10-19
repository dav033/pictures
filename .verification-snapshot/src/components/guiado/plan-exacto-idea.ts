import { z } from "zod";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

/**
 * Pide a `/api/plan-idea` el plan EXACTO de una idea de la biblioteca (sus piezas, medidas, productos Sempertex y
 * tamaños; Python lo cuenta y lo firma, sin modelo). Con `base` («Agregar a mi plan») el plan vigente conserva sus
 * piezas y suma las de la idea. Nunca lanza: un fallo dice su motivo y la vista sigue por el camino de siempre
 * (propuesta → /api/chat). Sin React, para probarlo sin navegador.
 */

const RespuestaSchema = z.object({
  plan: PlanGuiadoSchema,
  cotizacion: z.unknown().optional(),
  nuevas: z.array(z.string()).optional(),
  globosIdea: z.number().optional(),
  /** Si salió con las cantidades exactas de la idea; un servidor anterior no lo manda. */
  exacto: z.boolean().optional(),
  /** Si no salió exacto, por qué, en palabras de cliente («Ajustamos un tamaño que no había: 36″ por 24″.»). */
  avisos: z.unknown().optional(),
}).passthrough();

/** Los avisos que se pueden mostrar: textos cortos, a lo sumo cuatro. Uno raro no tumba el plan, que es lo que importa. */
function avisosLegibles(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((aviso): aviso is string => typeof aviso === "string" && aviso.trim().length > 0 && aviso.length <= 300).map((aviso) => aviso.trim()).slice(0, 4);
}

export type PlanExacto =
  | { ok: true; plan: PlanGuiado; cotizacion: unknown; nuevas: string[]; globosIdea: number | null; exacto: boolean | null; avisos: string[] }
  | { ok: false; motivo: string; estado: number | null; detenido: boolean };

export async function pedirPlanDeIdea(ideaId: string, base: PlanGuiado | null, signal: AbortSignal, red: typeof fetch = (...argumentos) => fetch(...argumentos)): Promise<PlanExacto> {
  try {
    const respuesta = await red("/api/plan-idea", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea_id: ideaId, ...(base ? { base } : {}) }),
      signal,
    });
    const datos: unknown = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      const motivo = typeof datos === "object" && datos !== null && "error" in datos && typeof datos.error === "string" ? datos.error : `estado ${respuesta.status}`;
      return { ok: false, motivo, estado: respuesta.status, detenido: false };
    }
    const leido = RespuestaSchema.safeParse(datos);
    if (!leido.success) return { ok: false, motivo: "respuesta sin plan válido", estado: respuesta.status, detenido: false };
    return {
      ok: true, plan: leido.data.plan, cotizacion: leido.data.cotizacion, nuevas: leido.data.nuevas ?? [], globosIdea: leido.data.globosIdea ?? null,
      exacto: leido.data.exacto ?? null,
      // Solo un plan que NO salió exacto trae qué cambió; uno exacto no dice nada.
      avisos: leido.data.exacto === false ? avisosLegibles(leido.data.avisos) : [],
    };
  } catch (causa) {
    return { ok: false, motivo: causa instanceof Error ? causa.message : String(causa), estado: null, detenido: signal.aborted };
  }
}
