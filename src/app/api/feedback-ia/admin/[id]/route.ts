import { dependenciasReales } from "@/lib/feedback-ia/dependencias";
import { atenderDetalle } from "@/lib/feedback-ia/manejadores-admin";

/** Detalle de un turno calificado: escenas, diferencia, pasos de la auditoría y llamadas a modelos. Solo administrador. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return atenderDetalle(request, id, dependenciasReales());
}
