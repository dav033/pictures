import { dependenciasReales } from "@/lib/feedback-ia/dependencias";
import { atenderAnalisisManual, atenderUltimosAnalisis } from "@/lib/feedback-ia/manejadores-analisis";
import { conRegistro } from "@/lib/registro";

export const maxDuration = 60;

/** Últimos análisis de huecos recurrentes (arriba del panel). Solo administrador. */
export async function GET(request: Request): Promise<Response> {
  return atenderUltimosAnalisis(request, dependenciasReales());
}

/** Ejecuta un análisis a pedido (con resumen de Gemini Flash si se pide). Solo administrador. */
export const POST = conRegistro("/api/feedback-ia/analisis", (request: Request) => atenderAnalisisManual(request, dependenciasReales()));
