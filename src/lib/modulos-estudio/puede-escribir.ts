import { isSameOriginRequest } from "@/lib/auth/request";
import { esAdministrador } from "@/lib/feedback-ia/acceso";

/**
 * LA PUERTA de las escrituras del caché de renders: generar uno nuevo (POST, que paga FLUX) y descartar uno guardado
 * (DELETE). Leer el caché (GET) queda abierto a toda sesión iniciada. Es una sola función: la ven `POST`, `DELETE` y el
 * `puedeEscribir` que el GET le dice a la interfaz.
 *
 * Quién pasa (siempre con mismo origen, contra CSRF):
 * - `MODULOS_ESCRITURA=cerrada`: nadie, ni con sesión (freno de gasto de FLUX);
 * - la sesión de la app (`esAdministrador`, D-056: sin clave aparte, administrar y escribir usan la misma sesión);
 * - `MODULOS_ESCRITURA=abierta`: todos los que tengan sesión (equivalente a la sesión, mientras no haya roles, REQ-004);
 * - en desarrollo y pruebas, sin la variable: abierta; en producción, sin sesión ni variable: CERRADA.
 */
export function puedeEscribirCacheModulos(request: Request): boolean {
  if (!isSameOriginRequest(request)) return false;
  const modo = process.env.MODULOS_ESCRITURA;
  if (modo === "cerrada") return false;
  if (modo === "abierta" || esAdministrador(request)) return true;
  return process.env.NODE_ENV !== "production";
}
