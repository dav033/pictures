import { atenderSesionAdmin } from "@/lib/feedback-ia/manejadores-admin";

/**
 * Entrega la cookie de administrador del feedback a quien manda `ADMIN_PASSWORD`. Sin `conRegistro` a propósito: su
 * auditoría guardaría el cuerpo, que lleva la clave.
 */
export async function POST(request: Request): Promise<Response> {
  return atenderSesionAdmin(request);
}
