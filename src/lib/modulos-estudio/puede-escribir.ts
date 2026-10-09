import { isSameOriginRequest } from "@/lib/auth/request";
import { esAdministrador } from "@/lib/feedback-ia/acceso";

/**
 * LA PUERTA de las escrituras del caché de renders: generar uno nuevo (POST, que paga FLUX) y descartar uno guardado
 * (DELETE). Leer el caché (GET) queda abierto a toda sesión iniciada. Es una sola función: la ven `POST`, `DELETE` y el
 * `puedeEscribir` que el GET le dice a la interfaz.
 *
 * Quién pasa (siempre con mismo origen, contra CSRF, como el panel de la IA):
 * - la sesión de administración del panel de la IA (`esAdministrador`: cookie `feedback_admin`, contraseña `ADMIN_PASSWORD`),
 *   la misma función que usa ese panel;
 * - `MODULOS_ESCRITURA=abierta`: todos los que tengan sesión (para el equipo, mientras no haya usuarios con roles, REQ-004);
 * - en desarrollo y pruebas, sin la variable: abierta (`MODULOS_ESCRITURA=cerrada` la cierra);
 * - en producción, sin ninguna de las dos: CERRADA.
 */
export function puedeEscribirCacheModulos(request: Request): boolean {
  if (!isSameOriginRequest(request)) return false;
  const modo = process.env.MODULOS_ESCRITURA;
  if (modo === "abierta") return true;
  if (esAdministrador(request)) return true;
  return process.env.NODE_ENV !== "production" && modo !== "cerrada";
}
