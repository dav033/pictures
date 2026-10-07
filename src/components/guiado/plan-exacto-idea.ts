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
}).passthrough();

export type PlanExacto =
  | { ok: true; plan: PlanGuiado; cotizacion: unknown; nuevas: string[]; globosIdea: number | null }
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
    return { ok: true, plan: leido.data.plan, cotizacion: leido.data.cotizacion, nuevas: leido.data.nuevas ?? [], globosIdea: leido.data.globosIdea ?? null };
  } catch (causa) {
    return { ok: false, motivo: causa instanceof Error ? causa.message : String(causa), estado: null, detenido: signal.aborted };
  }
}
