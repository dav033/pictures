/**
 * LA PUERTA de las escrituras del caché de renders: generar uno nuevo (POST, que paga FLUX) y descartar uno guardado
 * (DELETE). Leer el caché (GET) queda abierto a toda sesión iniciada. Es una sola función a propósito: al fusionar con la rama
 * del panel de administración se enchufa su sesión en `esSesionAdmin` y no hay que tocar nada más.
 *
 * Quién pasa hoy:
 * - `MODULOS_ESCRITURA=abierta`: todos los que tengan sesión (para el equipo, mientras no haya puerta de administración).
 * - la sesión de administración (TODO abajo).
 * - en desarrollo y pruebas, sin la variable: abierta (`MODULOS_ESCRITURA=cerrada` la cierra).
 * - en producción, sin ninguna de las dos: CERRADA.
 */
export function puedeEscribirCacheModulos(request: Request): boolean {
  const modo = process.env.MODULOS_ESCRITURA;
  if (modo === "abierta") return true;
  if (esSesionAdmin(request)) return true;
  return process.env.NODE_ENV !== "production" && modo !== "cerrada";
}

/**
 * TODO(feat/feedback-ia): devolver `true` cuando la petición lleve la sesión de administración (la puerta con `ADMIN_PASSWORD`
 * que esa rama añade). Hasta que se fusione no hay otra sesión que reconocer.
 */
function esSesionAdmin(request: Request): boolean {
  void request;
  return false;
}
