import { dependenciasReales } from "@/lib/feedback-ia/dependencias";
import { atenderImagen } from "@/lib/feedback-ia/manejadores-admin";

/** Sirve la captura antes/después de un turno leyéndola del almacén S3. Solo administrador. */
export async function GET(request: Request): Promise<Response> {
  return atenderImagen(request, dependenciasReales());
}
