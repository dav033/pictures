import { timingSafeEqual } from "node:crypto";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import type { CodigoErrorFeedback, ErrorFeedback } from "./contrato";

/**
 * Quién puede llamar a las rutas de la calificación de la IA.
 *
 * Hoy la app tiene UNA contraseña compartida (APP_PASSWORD) y no hay cuentas ni roles: quien tiene la sesión es el
 * equipo, y el mismo guardia protege /admin. REQ-004 (usuarios admin|staff) todavía no está en main; cuando llegue,
 * `actorDeSesion` es el único lugar que cambia (devolverá el usuario y su rol reales) y `exigirAdministrador` ya
 * rechaza a quien no sea admin. El chat del cliente usa este mismo modelo (sesión + mismo origen + tope por IP):
 * /api/asistente-guiado tampoco tiene otro.
 */

export type Actor = { usuarioId: string; rol: "admin" | "staff" };

const USUARIO_SESION_COMPARTIDA = "sesion-compartida";

export function actorDeSesion(request: Request): Actor | null {
  return isAuthenticatedRequest(request) ? { usuarioId: USUARIO_SESION_COMPARTIDA, rol: "admin" } : null;
}

export function errorFeedback(codigo: CodigoErrorFeedback, error: string, estado: number, detalle?: string[]): Response {
  const cuerpo: ErrorFeedback = { error, codigo, ...(detalle ? { detalle } : {}) };
  return Response.json(cuerpo, { status: estado });
}

export type ResultadoAcceso = { actor: Actor } | { respuesta: Response };

/** Sesión válida + mismo origen: lo que exigen las rutas que escriben (taller y chat del cliente). */
export function exigirSesionMismoOrigen(request: Request): ResultadoAcceso {
  const actor = actorDeSesion(request);
  if (!actor) return { respuesta: errorFeedback("SESION_REQUERIDA", "Sesión requerida.", 401) };
  if (!isSameOriginRequest(request)) return { respuesta: errorFeedback("ORIGEN_NO_PERMITIDO", "Origen no permitido.", 403) };
  return { actor };
}

/** Solo administrador: panel, exportaciones, imágenes y análisis. */
export function exigirAdministrador(request: Request, resolverActor: (peticion: Request) => Actor | null = actorDeSesion): ResultadoAcceso {
  const actor = resolverActor(request);
  if (!actor) return { respuesta: errorFeedback("SESION_REQUERIDA", "Sesión requerida.", 401) };
  if (actor.rol !== "admin") return { respuesta: errorFeedback("SOLO_ADMINISTRADOR", "Solo el administrador puede ver esto.", 403) };
  return { actor };
}

/** El cron se autentica con `Authorization: Bearer ${CRON_SECRET}`; sin el secreto configurado la ruta queda cerrada. */
export function esPeticionDeCron(request: Request, secreto = process.env.CRON_SECRET): boolean {
  if (!secreto) return false;
  const recibido = Buffer.from(request.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${secreto}`);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

export function ipDe(request: Request): string {
  const reenviada = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (reenviada || request.headers.get("x-real-ip")?.trim() || "desconocida").slice(0, 64);
}

export type Limitador = (clave: string, ahora?: number) => boolean;

/** Ventana deslizante en memoria (por instancia), con el mapa podado para que no crezca sin límite. */
export function crearLimitador(maximoPorMinuto: number): Limitador {
  const marcasPorClave = new Map<string, number[]>();
  return (clave, ahora = Date.now()) => {
    if (marcasPorClave.size > 5_000) {
      for (const [otra, marcas] of marcasPorClave) if (!marcas.some((marca) => ahora - marca < 60_000)) marcasPorClave.delete(otra);
      if (marcasPorClave.size > 5_000) marcasPorClave.clear();
    }
    const recientes = (marcasPorClave.get(clave) ?? []).filter((marca) => ahora - marca < 60_000);
    if (recientes.length >= maximoPorMinuto) {
      marcasPorClave.set(clave, recientes);
      return false;
    }
    recientes.push(ahora);
    marcasPorClave.set(clave, recientes);
    return true;
  };
}
