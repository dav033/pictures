import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookieValue, isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import type { CodigoErrorFeedback, ErrorFeedback } from "./contrato";

/**
 * Quién puede llamar a las rutas de la calificación de la IA.
 *
 * - Escribir (taller y chat del cliente): sesión de la app + mismo origen + tope por IP. La app tiene UNA contraseña
 *   compartida, así que la identidad de quien califica es una cookie aleatoria por navegador (`feedback_usuario`, httpOnly,
 *   creada en la primera calificación): solo ese navegador modifica sus turnos (TURNO_AJENO para los demás).
 * - Administrar (panel, exportaciones, imágenes, análisis): además de la sesión, la contraseña propia `ADMIN_PASSWORD`
 *   (cookie `feedback_admin`). Sin `ADMIN_PASSWORD` configurada el administrador queda CERRADO. REQ-004 (usuarios
 *   admin|staff) reemplazará esto; mientras tanto el panel no se abre con la contraseña que usa todo el equipo.
 */

export const COOKIE_USUARIO = "feedback_usuario";
export const COOKIE_ADMIN = "feedback_admin";
const DURACION_COOKIE_USUARIO_S = 60 * 60 * 24 * 365;
const DURACION_COOKIE_ADMIN_S = 60 * 60 * 8;
const RE_USUARIO = /^[0-9a-f]{32}$/;

export function errorFeedback(codigo: CodigoErrorFeedback, error: string, estado: number, detalle?: string[]): Response {
  const cuerpo: ErrorFeedback = { error, codigo, ...(detalle ? { detalle } : {}) };
  return Response.json(cuerpo, { status: estado });
}

function atributosCookie(segundos: number, sameSite: "Lax" | "Strict"): string {
  const seguro = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${segundos}${seguro}`;
}

/* ---------- Escritura (taller y cliente) ---------- */

export type AccesoEscritura =
  | { usuarioId: string; conCookie: (respuesta: Response) => Response }
  | { respuesta: Response };

export type ResultadoAcceso = { ok: true } | { respuesta: Response };

/** Sesión de la app válida y, si el navegador manda Origin, que sea el de la app (contra CSRF). */
export function exigirSesionMismoOrigen(request: Request): ResultadoAcceso {
  if (!isAuthenticatedRequest(request)) return { respuesta: errorFeedback("SESION_REQUERIDA", "Sesión requerida.", 401) };
  if (!isSameOriginRequest(request)) return { respuesta: errorFeedback("ORIGEN_NO_PERMITIDO", "Origen no permitido.", 403) };
  return { ok: true };
}

/** Sesión válida + mismo origen; devuelve la identidad del navegador y cómo fijar su cookie en la respuesta si es nueva. */
export function exigirEscritura(request: Request): AccesoEscritura {
  const sesion = exigirSesionMismoOrigen(request);
  if ("respuesta" in sesion) return sesion;
  const existente = cookieValue(request, COOKIE_USUARIO);
  const identificador = existente && RE_USUARIO.test(existente) ? existente : randomBytes(16).toString("hex");
  const esNueva = identificador !== existente;
  return {
    usuarioId: `nav-${identificador}`,
    conCookie: (respuesta) => {
      if (esNueva) respuesta.headers.append("set-cookie", `${COOKIE_USUARIO}=${identificador}${atributosCookie(DURACION_COOKIE_USUARIO_S, "Lax")}`);
      return respuesta;
    },
  };
}

/* ---------- Administración ---------- */

const resumen = (texto: string): Buffer => createHash("sha256").update(texto).digest();

export function adminConfigurado(contrasena = process.env.ADMIN_PASSWORD): boolean {
  return Boolean(contrasena);
}

export function claveAdminValida(clave: string, contrasena = process.env.ADMIN_PASSWORD): boolean {
  return Boolean(contrasena) && timingSafeEqual(resumen(clave), resumen(contrasena as string));
}

function tokenAdmin(contrasena: string): string {
  return createHmac("sha256", contrasena).update("feedback-admin-v1").digest("hex");
}

/** `Set-Cookie` de la sesión de administrador (8 h, SameSite=Strict): se entrega solo tras `claveAdminValida`. */
export function cookieDeAdministrador(contrasena = process.env.ADMIN_PASSWORD): string {
  if (!contrasena) throw new Error("ADMIN_PASSWORD no está configurada.");
  return `${COOKIE_ADMIN}=${tokenAdmin(contrasena)}${atributosCookie(DURACION_COOKIE_ADMIN_S, "Strict")}`;
}

export function esAdministrador(request: Request, contrasena = process.env.ADMIN_PASSWORD): boolean {
  if (!contrasena || !isAuthenticatedRequest(request)) return false;
  const recibido = Buffer.from(cookieValue(request, COOKIE_ADMIN) ?? "");
  const esperado = Buffer.from(tokenAdmin(contrasena));
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

/** Panel, exportaciones, imágenes y análisis: sesión + contraseña de administrador. Sin ADMIN_PASSWORD, cerrado. */
export function exigirAdministrador(request: Request): ResultadoAcceso {
  if (!isAuthenticatedRequest(request)) return { respuesta: errorFeedback("SESION_REQUERIDA", "Sesión requerida.", 401) };
  if (!adminConfigurado()) return { respuesta: errorFeedback("ADMIN_NO_CONFIGURADO", "El acceso de administrador no está configurado.", 403) };
  if (!esAdministrador(request)) return { respuesta: errorFeedback("SOLO_ADMINISTRADOR", "Ingresa la clave de administrador.", 401) };
  return { ok: true };
}

/** Administrador + mismo origen: lo que exigen las rutas del panel que escriben o gastan (análisis a pedido). */
export function exigirAdministradorMismoOrigen(request: Request): ResultadoAcceso {
  const admin = exigirAdministrador(request);
  if ("respuesta" in admin) return admin;
  if (!isSameOriginRequest(request)) return { respuesta: errorFeedback("ORIGEN_NO_PERMITIDO", "Origen no permitido.", 403) };
  return admin;
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
export function crearLimitador(maximo: number, ventanaMs = 60_000): Limitador {
  const marcasPorClave = new Map<string, number[]>();
  return (clave, ahora = Date.now()) => {
    if (marcasPorClave.size > 5_000) {
      for (const [otra, marcas] of marcasPorClave) if (!marcas.some((marca) => ahora - marca < ventanaMs)) marcasPorClave.delete(otra);
      if (marcasPorClave.size > 5_000) marcasPorClave.clear();
    }
    const recientes = (marcasPorClave.get(clave) ?? []).filter((marca) => ahora - marca < ventanaMs);
    if (recientes.length >= maximo) {
      marcasPorClave.set(clave, recientes);
      return false;
    }
    recientes.push(ahora);
    marcasPorClave.set(clave, recientes);
    return true;
  };
}
