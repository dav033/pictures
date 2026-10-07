import { z } from "zod";
import { isPythonAdapterError } from "@/lib/ia/nucleo/python-adapter";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { BasePlanSchema } from "@/lib/plan/edicion-esquemas";
import { planDesdeIdea } from "@/lib/plan/plan-desde-idea";
import { conRegistro } from "@/lib/registro/servidor";

/**
 * El plan EXACTO de una idea de la biblioteca («Crear mi plan con esta idea») o el plan vigente con esa idea sumada
 * («Agregar a mi plan», con `base`): Python resuelve y firma las piezas, medidas, productos Sempertex y tamaños de la
 * idea, sin modelo (`src/lib/plan/plan-desde-idea.ts`). Si la idea no tiene plan guardado o no cabe en el plan, la vista
 * vuelve al camino de siempre (/api/chat). No manda a Python ningún campo nuevo.
 */
const BodySchema = z.object({
  idea_id: z.string().trim().min(1).max(200),
  base: BasePlanSchema.optional(),
}).strict();

export const POST = conRegistro("/api/plan-idea", atenderPOST);

async function atenderPOST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo de la solicitud no es JSON válido." }, { status: 400 });
  }
  const body = BodySchema.safeParse(json);
  if (!body.success) return Response.json({ error: "La solicitud no tiene un formato válido.", detalles: body.error.issues.slice(0, 5) }, { status: 400 });
  try {
    const { plan, cotizacion, nuevas, globosIdea, exacto, avisos } = await planDesdeIdea({ ideaId: body.data.idea_id, ...(body.data.base ? { base: body.data.base } : {}), signal: request.signal });
    // `exacto` y `avisos` (en palabras de cliente): si el plan no salió con las cantidades exactas de la idea, la
    // tarjeta lo dice. Antes se descartaban y el botón prometía «cantidades exactas» sin avisar (verificador 127).
    return Response.json({ plan, cotizacion, nuevas, globosIdea, exacto, avisos });
  } catch (error) {
    if (error instanceof PlanEditError) return Response.json({ error: error.message, causa: error.causa ?? null }, { status: error.status });
    const estado = isPythonAdapterError(error) ? 502 : 500;
    console.warn("[plan-idea] no se pudo armar el plan de la idea", error instanceof Error ? error.message : error);
    return Response.json({ error: "No pude armar el plan de esa idea." }, { status: estado });
  }
}
