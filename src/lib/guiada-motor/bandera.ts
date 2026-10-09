import "server-only";
import { cookieValue } from "@/lib/auth/request";
import { esAdministrador } from "@/lib/feedback-ia/acceso";
import { getRagPool } from "@/lib/rag/db";
import { MOTOR_POR_DEFECTO, MotorGuiadaSchema, type MotorGuiada, type RespuestaMotor } from "./tipos";

/**
 * La bandera de ejecución `GUIADA_MOTOR` (REQ-007, D-024): decide con qué motor se crea un plan nuevo de la guiada.
 * Orden, de mayor a menor prioridad:
 *   1. cookie `guiada_motor` (3d|python), SOLO si quien llama tiene la sesión de administrador (`ADMIN_PASSWORD`): el
 *      dueño prueba en producción sin cambiar nada para los clientes;
 *   2. fila `guiada_motor` de la tabla `ajustes_runtime` (Neon), leída con un caché de 30 s por instancia;
 *   3. variable de entorno `GUIADA_MOTOR`;
 *   4. `python`.
 * Un valor que no sea `3d` o `python` en cualquier nivel se ignora y se pasa al siguiente. Si Neon falla (o la tabla
 * aún no existe) la bandera sigue con la variable de entorno: leerla nunca tumba una petición.
 */

export const COOKIE_MOTOR = "guiada_motor";
export const CLAVE_AJUSTE_MOTOR = "guiada_motor";
export const TTL_AJUSTE_MS = 30_000;

export type DependenciasBandera = {
  esAdministrador: (request: Request) => boolean;
  /** Valor crudo de la fila `ajustes_runtime`, o `null` si no hay (o no se pudo leer). */
  leerAjuste: () => Promise<string | null>;
  env: () => string | undefined;
  ahora: () => number;
};

function motorValido(valor: string | null | undefined): MotorGuiada | null {
  const lectura = MotorGuiadaSchema.safeParse(valor?.trim().toLowerCase());
  return lectura.success ? lectura.data : null;
}

export function crearLectorBandera(deps: DependenciasBandera): (request: Request) => Promise<RespuestaMotor> {
  let cache: { motor: MotorGuiada | null; venceEn: number } | null = null;
  let enCurso: Promise<MotorGuiada | null> | null = null;

  async function ajusteVigente(): Promise<MotorGuiada | null> {
    if (cache && deps.ahora() < cache.venceEn) return cache.motor;
    // Las lecturas simultáneas comparten una sola consulta.
    enCurso ??= deps.leerAjuste().then(motorValido).catch(() => null).then((motor) => {
      cache = { motor, venceEn: deps.ahora() + TTL_AJUSTE_MS };
      enCurso = null;
      return motor;
    });
    return enCurso;
  }

  return async (request) => {
    const delAdmin = deps.esAdministrador(request) ? motorValido(cookieValue(request, COOKIE_MOTOR)) : null;
    if (delAdmin) return { motor: delAdmin, fuente: "cookie" };
    const ajuste = await ajusteVigente();
    if (ajuste) return { motor: ajuste, fuente: "ajuste" };
    const delEntorno = motorValido(deps.env());
    if (delEntorno) return { motor: delEntorno, fuente: "env" };
    return { motor: MOTOR_POR_DEFECTO, fuente: "defecto" };
  };
}

async function leerAjusteNeon(): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { rows } = await getRagPool().query<{ valor: string }>("SELECT valor FROM ajustes_runtime WHERE clave = $1", [CLAVE_AJUSTE_MOTOR]);
    return rows[0]?.valor ?? null;
  } catch (cause) {
    console.warn("[guiada-motor] no se pudo leer ajustes_runtime; se usa la variable de entorno.", cause instanceof Error ? cause.message : "error");
    return null;
  }
}

/** `leerMotorGuiada(req)`: el motor con el que se crea un plan nuevo y de dónde salió ese valor. */
export const leerMotorGuiada = crearLectorBandera({
  esAdministrador: (request) => esAdministrador(request),
  leerAjuste: leerAjusteNeon,
  env: () => process.env.GUIADA_MOTOR,
  ahora: () => Date.now(),
});
