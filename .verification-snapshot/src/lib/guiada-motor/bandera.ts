import "server-only";
import { z } from "zod";
import { crearAjusteConCache, leerAjusteNeon } from "@/lib/ajustes/ajustes-runtime";
import { cookieValue } from "@/lib/auth/request";
import { esAdministrador } from "@/lib/feedback-ia/acceso";
import { MOTOR_POR_DEFECTO, MotorGuiadaSchema, type MotorGuiada, type RespuestaMotor } from "./tipos";

/**
 * La bandera de ejecución `GUIADA_MOTOR` (REQ-007, D-024): decide con qué motor se crea un plan NUEVO de la guiada. Un plan
 * ya creado conserva su motor (su token lo dice) aunque la bandera cambie: la marcha atrás de la bandera no le cambia el
 * precio a ningún plan abierto (P-045). Orden, de mayor a menor prioridad:
 *   1. cookie `guiada_motor` (3d|python), SOLO si quien llama tiene la sesión de administrador (`ADMIN_PASSWORD`): el
 *      dueño prueba en producción sin cambiar nada para los clientes (también con el corte puesto, para probar un arreglo);
 *   2. el corte del 3D: fila `guiada_motor_corte` de `ajustes_runtime`, si no la hay variable `GUIADA_MOTOR_CORTE`
 *      (`activo`|`inactivo`). Activo = `python` con la fuente `corte`: además de los planes nuevos, frena los del 3D ya
 *      abiertos (no se cambian ni se rehacen con el 3D; la vista avisa al cliente antes de recalcularlos con Python). Es el
 *      freno de emergencia para un 3D que cuenta o cotiza mal, no la marcha atrás normal;
 *   3. fila `guiada_motor` de la tabla `ajustes_runtime` (Neon);
 *   4. variable de entorno `GUIADA_MOTOR`;
 *   5. `python`.
 * Las filas se leen con un caché de 30 s por instancia (`ajustes/ajustes-runtime.ts`). Un valor fuera de los admitidos en cualquier nivel se ignora y se
 * pasa al siguiente. Leerla nunca tumba una petición:
 * - sin `DATABASE_URL` o sin la tabla (migración 032 sin aplicar) no hay fila: deciden las variables de entorno;
 * - si Neon FALLA, cada fila sigue con su última lectura buena de esta instancia (un corte puesto no se suelta por un error de
 *   red) y se reintenta al vencer el caché. Sin lectura buena previa (instancia recién arrancada con Neon caído) deciden las
 *   variables de entorno: no se corta «por si acaso», porque un corte falso también le cambia el plan al cliente (le pide
 *   recalcularlo) y una tabla ausente lo dejaría cortado para siempre. Para que un corte resista una caída de Neon al
 *   reiniciar, se pone también `GUIADA_MOTOR_CORTE=activo` (dossier §4).
 */

export const COOKIE_MOTOR = "guiada_motor";
export const CLAVE_AJUSTE_MOTOR = "guiada_motor";
export const CLAVE_AJUSTE_CORTE = "guiada_motor_corte";

/** El lector de `ajustes_runtime` vive en `ajustes/ajustes-runtime.ts`; las pruebas de esta bandera lo importan de aquí. */
export { leerFilaAjuste, TTL_AJUSTE_MS, type ConsultaAjuste } from "@/lib/ajustes/ajustes-runtime";

export type DependenciasBandera = {
  esAdministrador: (request: Request) => boolean;
  /** Valor crudo de la fila `guiada_motor` de `ajustes_runtime`, o `null` si no hay. LANZA si la base falló. */
  leerAjuste: () => Promise<string | null>;
  env: () => string | undefined;
  /** Valor crudo de la fila `guiada_motor_corte`, o `null` si no hay. LANZA si la base falló. */
  leerCorte: () => Promise<string | null>;
  envCorte: () => string | undefined;
  ahora: () => number;
};

function motorValido(valor: string | null | undefined): MotorGuiada | null {
  const lectura = MotorGuiadaSchema.safeParse(valor?.trim().toLowerCase());
  return lectura.success ? lectura.data : null;
}

/** Solo `activo` corta: un valor inventado («true», «si») no debe frenar ni soltar el 3D por error. */
const EstadoCorteSchema = z.enum(["activo", "inactivo"]);
function corteValido(valor: string | null | undefined): boolean | null {
  const lectura = EstadoCorteSchema.safeParse(valor?.trim().toLowerCase());
  return lectura.success ? lectura.data === "activo" : null;
}

export function crearLectorBandera(deps: DependenciasBandera): (request: Request) => Promise<RespuestaMotor> {
  const ajusteVigente = crearAjusteConCache(deps.leerAjuste, deps.ahora);
  const corteVigente = crearAjusteConCache(deps.leerCorte, deps.ahora);

  return async (request) => {
    const delAdmin = deps.esAdministrador(request) ? motorValido(cookieValue(request, COOKIE_MOTOR)) : null;
    if (delAdmin) return { motor: delAdmin, fuente: "cookie" };
    const [filaCorte, filaMotor] = await Promise.all([corteVigente(), ajusteVigente()]);
    if (corteValido(filaCorte) ?? corteValido(deps.envCorte()) ?? false) return { motor: "python", fuente: "corte" };
    const ajuste = motorValido(filaMotor);
    if (ajuste) return { motor: ajuste, fuente: "ajuste" };
    const delEntorno = motorValido(deps.env());
    if (delEntorno) return { motor: delEntorno, fuente: "env" };
    return { motor: MOTOR_POR_DEFECTO, fuente: "defecto" };
  };
}

const leerAjuste = (clave: string) => leerAjusteNeon(clave, "guiada-motor");

/**
 * `leerMotorGuiada(req)`: el motor con el que se crea un plan nuevo y de dónde salió ese valor; `fuente: "corte"` dice
 * además que el 3D está cortado también para los planes abiertos.
 */
export const leerMotorGuiada = crearLectorBandera({
  esAdministrador: (request) => esAdministrador(request),
  leerAjuste: () => leerAjuste(CLAVE_AJUSTE_MOTOR),
  env: () => process.env.GUIADA_MOTOR,
  leerCorte: () => leerAjuste(CLAVE_AJUSTE_CORTE),
  envCorte: () => process.env.GUIADA_MOTOR_CORTE,
  ahora: () => Date.now(),
});
