import "server-only";
import { getRagPool } from "@/lib/rag/db";

/**
 * El lector de **ajustes de ejecución** (tabla `ajustes_runtime`, migración 032): una fila clave → valor que se cambia en
 * producción sin desplegar. Lo comparten la bandera del motor de la guiada (`guiada-motor/bandera.ts`), la de la hoja de armado
 * del Taller (`taller/hoja-armado-bandera.ts`) y la visibilidad de los repositorios del catálogo (`catalogo/visibilidad.ts`):
 * cada una decide qué hace con el valor; aquí solo se lee, con un caché de 30 s por instancia, y leer nunca tumba ni retrasa más de
 * `PLAZO_LECTURA_AJUSTE_MS` una petición.
 */

export const TTL_AJUSTE_MS = 30_000;

/**
 * Cuánto espera una petición a la lectura de la fila cuando vence el caché. Con Neon lento (arranque en frío, red) la primera
 * petición de cada 30 s no puede esperar los 5 s del pool ni los 30 s de la consulta: pasado el plazo sigue con la última lectura
 * buena (o «sin fila») y la lectura termina sola en segundo plano, dejando el valor nuevo para las siguientes.
 */
export const PLAZO_LECTURA_AJUSTE_MS = 1_500;

export type OpcionesAjusteConCache = {
  /** Por defecto `PLAZO_LECTURA_AJUSTE_MS`. */
  plazoMs?: number;
  /** De qué fila se trata, para el aviso de que tardó. */
  etiqueta?: string;
};

const VENCIDO = Symbol("plazo vencido");

/**
 * Una fila de `ajustes_runtime` con un caché de `TTL_AJUSTE_MS` por instancia. Las lecturas simultáneas comparten una sola
 * consulta. Si la base falla, vale la última lectura buena (o «sin fila» si nunca la hubo) hasta que vence el caché: no se
 * reintenta en cada petición. Si la lectura tarda más del plazo se trata igual que si fallara (la última buena, o «sin fila»,
 * durante un caché), pero la lectura sigue y, al terminar, deja su valor: quien llame después ve el nuevo.
 */
export function crearAjusteConCache(leer: () => Promise<string | null>, ahora: () => number, opciones: OpcionesAjusteConCache = {}): () => Promise<string | null> {
  const plazoMs = opciones.plazoMs ?? PLAZO_LECTURA_AJUSTE_MS;
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
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const plazo = new Promise<typeof VENCIDO>((resolver) => { temporizador = setTimeout(() => resolver(VENCIDO), plazoMs); });
    try {
      const primero = await Promise.race([enCurso, plazo]);
      if (primero !== VENCIDO) return primero;
      const valor = ultimaBuena?.valor ?? null;
      cache = { valor, venceEn: ahora() + TTL_AJUSTE_MS };
      console.warn(`[ajustes] ${opciones.etiqueta ?? "una fila de ajustes_runtime"} tardó más de ${plazoMs} ms en leerse; sigue la última lectura buena o la variable de entorno.`);
      return valor;
    } finally {
      clearTimeout(temporizador);
    }
  };
}

export type ConsultaAjuste = (sql: string, valores: string[]) => Promise<{ rows: Array<{ valor: string }> }>;

/** Postgres: «relation does not exist». La tabla llega con la migración 032; sin ella no hay fila, no un fallo. */
const TABLA_INEXISTENTE = "42P01";

/**
 * El valor de una fila de `ajustes_runtime`, `null` si no la hay (o no hay tabla). Un fallo de la base se avisa y se lanza.
 * `origen` es el prefijo del aviso en el log: quién leía la fila (`guiada-motor`, `taller-hoja-armado`, `catalogo`).
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

/** La fila en Neon (el pool del RAG). Sin `DATABASE_URL` no hay base: no hay fila y deciden las variables de entorno. */
export async function leerAjusteNeon(clave: string, origen: string): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  return leerFilaAjuste((sql, valores) => getRagPool().query<{ valor: string }>(sql, valores), clave, origen);
}
