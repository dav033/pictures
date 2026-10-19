import { dependenciasReales } from "@/lib/feedback-ia/dependencias";
import { atenderListado } from "@/lib/feedback-ia/manejadores-admin";

/** Listado del panel (peor calificación primero) y exportación CSV/JSON con los mismos filtros. Solo administrador. */
export async function GET(request: Request): Promise<Response> {
  return atenderListado(request, dependenciasReales());
}
