import "server-only";
import { z } from "zod";
import { cookieValue } from "@/lib/auth/request";
import { esAdministrador } from "@/lib/feedback-ia/acceso";
import { getRagPool } from "@/lib/rag/db";
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
 * Las filas se leen con un caché de 30 s por instancia. Un valor fuera de los admitidos en cualquier nivel se ignora y se
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
export const TTL_AJUSTE_MS = 30_000;

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

/**
 * Una fila de `ajustes_runtime` con un caché de `TTL_AJUSTE_MS` por instancia. Las lecturas simultáneas comparten una sola
 * consulta. Si la base falla, vale la última lectura buena (o «sin fila» si nunca la hubo) hasta que vence el caché: no se
 * reintenta en cada petición. La usa también la bandera de la hoja de armado del Taller (`taller/hoja-armado-bandera.ts`).
 */
export function crearAjusteConCache(leer: () => Promise<string | null>, ahora: () => number): () => Promise<string | null> {
  let cache: { valor: string | null; venceEn: number } | null = null;
  let ultimaBuena: { valor: string | null } | null = null;
  let enCurso: Promise<string | null> | null = null;
  return async () => {
    if (cache && ahora() < cache.venceEn) return cache.valor;
    enCurso ??= leer().then((valor) => { ultimaBuena = { valor }; return valor; }, () => ultimaBuena?.valor ?? null).then((valor) => {
      cache = { valor, venceEn: ahora() + TTL_AJUSTE_MS };
      enCurso = null;
      return valor;
    });
    return enCurso;
  };
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

export type ConsultaAjuste = (sql: string, valores: string[]) => Promise<{ rows: Array<{ valor: string }> }>;

/** Postgres: «relation does not exist». La tabla llega con la migración 032; sin ella no hay fila, no un fallo. */
const TABLA_INEXISTENTE = "42P01";

/**
 * El valor de una fila de `ajustes_runtime`, `null` si no la hay (o no hay tabla). Un fallo de la base se avisa y se lanza.
 * `origen` es el prefijo del aviso en el log: quién leía la fila (`guiada-motor`, `taller-hoja-armado`).
 */
export async function leerFilaAjuste(consultar: ConsultaAjuste, clave: string, origen = "guiada-motor"): Promise<string | null> {
  try {
    const { rows } = await consultar("SELECT valor FROM ajustes_runtime WHERE clave = $1", [clave]);
    return rows[0]?.valor ?? null;
  } catch (causa) {
    if ((causa as { code?: unknown } | null)?.code === TABLA_INEXISTENTE) return null;
    console.warn(`[${origen}] no se pudo leer ${clave} de ajustes_runtime; sigue la última lectura buena o la variable de entorno.`, causa instanceof Error ? causa.message : "error");
    throw causa;
  }
}

async function leerAjusteNeon(clave: string): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  return leerFilaAjuste((sql, valores) => getRagPool().query<{ valor: string }>(sql, valores), clave);
}

/**
 * `leerMotorGuiada(req)`: el motor con el que se crea un plan nuevo y de dónde salió ese valor; `fuente: "corte"` dice
 * además que el 3D está cortado también para los planes abiertos.
 */
export const leerMotorGuiada = crearLectorBandera({
  esAdministrador: (request) => esAdministrador(request),
  leerAjuste: () => leerAjusteNeon(CLAVE_AJUSTE_MOTOR),
  env: () => process.env.GUIADA_MOTOR,
  leerCorte: () => leerAjusteNeon(CLAVE_AJUSTE_CORTE),
  envCorte: () => process.env.GUIADA_MOTOR_CORTE,
  ahora: () => Date.now(),
});
