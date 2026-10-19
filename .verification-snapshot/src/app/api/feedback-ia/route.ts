import { dependenciasReales } from "@/lib/feedback-ia/dependencias";
import { atenderConsulta, atenderRegistro } from "@/lib/feedback-ia/manejadores-registro";
import { conRegistro } from "@/lib/registro";

/**
 * Registra o actualiza la calificación de un turno de la IA (Taller 3D y chat del cliente). Idempotente por
 * (producto, turnoId). Contrato en src/lib/feedback-ia/contrato.ts; la lógica, en manejadores-registro.ts.
 * GET devuelve la calificación guardada de unos turnos para mostrarla al recargar.
 * Corre en Node (el runtime por defecto): con `cacheComponents` Next rechaza declarar `export const runtime`.
 */
export const POST = conRegistro("/api/feedback-ia", (request: Request) => atenderRegistro(request, dependenciasReales()));
/** Lee la calificación guardada de unos turnos (al recargar la página); ver `atenderConsulta`. */
export const GET = conRegistro("/api/feedback-ia", (request: Request) => atenderConsulta(request, dependenciasReales()));
