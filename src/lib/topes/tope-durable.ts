import { decidir } from "@/lib/registro/servidor";
import { consultaDeNeon } from "./consulta-pool";
import { PLAZO_TOPE_MS, PlazoDeTopeVencido, VENTANA_TOPE_MS, type Consulta, type OrigenTope, type ProveedorDeConsulta, type ReciboTope, type ResultadoTope } from "./tipos";

export { PLAZO_TOPE_MS, VENTANA_TOPE_MS };
export type { Consulta, OrigenTope, ProveedorDeConsulta, ReciboTope, ResultadoTope };

/**
 * Topes de gasto por hora **durables y globales**: el contador vive en Neon (tabla `topes_gasto`, migración 035), no en la memoria
 * de cada instancia de Vercel, así que el límite vale para todas a la vez. La toma es una sola sentencia atómica
 * (`SQL_TOMAR_TOPE`): dos instancias a la vez no pueden pasarse del tope. El reloj es el de Postgres.
 *
 * Nunca bloquea a un cliente por culpa del contador, ni deja la llamada de pago sin tope:
 * - sin base (fuera de producción o sin `DATABASE_URL`, ver `topesDurablesActivos`), con la tabla sin migrar, con Neon caído o con una
 *   respuesta que tarda más de `PLAZO_TOPE_MS`, la toma pasa al contador en memoria de la instancia (el de antes: acotado por
 *   instancia, no global) y el fallo queda en el registro;
 * - tras un fallo se deja de consultar la base `PAUSA_TRAS_FALLO_MS`: una Neon lenta no suma el plazo a cada petición, y al
 *   vencer la pausa solo una toma sondea (las demás siguen en memoria hasta que responda).
 */

export const PAUSA_TRAS_FALLO_MS = 30_000;
/** Con la tabla sin migrar reintentar cada 30 s no arregla nada: se avisa fuerte una vez y se vuelve a mirar cada cinco minutos. */
export const PAUSA_SIN_TABLA_MS = 300_000;
const LIMPIEZA_CADA_MS = 600_000;
/** `undefined_table` y `undefined_column` de Postgres: la migración 035 no está aplicada (o es otra). */
const CODIGOS_SIN_TABLA: readonly unknown[] = ["42P01", "42703"];

/**
 * Suma una toma a la ventana vigente solo si cabe, o abre una nueva si la anterior venció. Sin fila en la respuesta = no cabe.
 * `$1` clave, `$2` duración de la ventana en ms, `$3` tope. Devuelve el contador y la ventana (su `ventana_inicio` como texto,
 * con los microsegundos que un `Date` perdería) para que la devolución caiga en la misma.
 */
export const SQL_TOMAR_TOPE = `
INSERT INTO topes_gasto AS t (clave, ventana_inicio, usadas)
VALUES ($1, now(), 1)
ON CONFLICT (clave) DO UPDATE SET
  usadas = CASE WHEN now() - t.ventana_inicio > $2::double precision * interval '1 millisecond' THEN 1 ELSE t.usadas + 1 END,
  ventana_inicio = CASE WHEN now() - t.ventana_inicio > $2::double precision * interval '1 millisecond' THEN now() ELSE t.ventana_inicio END
WHERE now() - t.ventana_inicio > $2::double precision * interval '1 millisecond' OR t.usadas < $3::integer
RETURNING usadas, ventana_inicio::text AS ventana`;

/** Devuelve una toma que no llegó a gastarse, solo si su ventana sigue siendo la vigente. `$1` clave, `$2` la ventana de la toma. */
export const SQL_DEVOLVER_TOPE = "UPDATE topes_gasto SET usadas = usadas - 1 WHERE clave = $1 AND ventana_inicio = $2::timestamptz AND usadas > 0";

/** Borra los contadores sin uso hace más de un día (una ventana dura una hora). */
export const SQL_LIMPIAR_TOPES = "DELETE FROM topes_gasto WHERE ventana_inicio < now() - interval '1 day'";

export type OpcionesTopeDurable = {
  proveedor?: ProveedorDeConsulta;
  reloj?: () => number;
  plazoMs?: number;
  pausaMs?: number;
  registrar?: typeof decidir;
};

export type TopeDurable = {
  /**
   * Toma una unidad del contador `clave` (con el tope `tope`); `enMemoria` es el contador de esta instancia, que responde si la base
   * no. Una toma concedida trae su `recibo`: con él se devuelve al mismo contador.
   */
  tomar: (clave: string, tope: number, enMemoria: () => ResultadoTope) => Promise<{ toma: ResultadoTope; origen: OrigenTope }>;
  /**
   * Devuelve una unidad que no se gastó al contador y la ventana de su `recibo`. Una toma de memoria se devuelve en memoria; una de la
   * base solo en la base, y si no responde la devolución se pierde (el contador cuenta de más, nunca de menos).
   */
  devolver: (clave: string, recibo: ReciboTope, enMemoria: () => void) => Promise<void>;
  /** Solo para las pruebas: cambia de dónde sale la consulta (inyectan una base propia) y borra el estado de fallos. */
  usarProveedor: (proveedor: ProveedorDeConsulta) => void;
};

function conPlazo<T>(promesa: Promise<T>, plazoMs: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const temporizador = setTimeout(() => rechazar(new PlazoDeTopeVencido(plazoMs)), plazoMs);
    // El rechazo tardío de una consulta que ya perdió la carrera queda atendido aquí: no escapa como «unhandled rejection».
    promesa.then(
      (valor) => { clearTimeout(temporizador); resolver(valor); },
      (causa: unknown) => { clearTimeout(temporizador); rechazar(causa); },
    );
  });
}

function leerToma(filas: Array<Record<string, unknown>>, tope: number): ResultadoTope {
  const fila = filas[0];
  if (!fila) return { ok: false, usadas: tope, tope };
  const usadas = Number(fila.usadas);
  const ventana = typeof fila.ventana === "string" ? fila.ventana : "";
  if (!Number.isInteger(usadas) || usadas < 1 || !ventana) throw new Error("la base devolvió un contador de tope inválido");
  return { ok: true, usadas, recibo: { origen: "base", ventana } };
}

const mensajeDe = (causa: unknown): string => (causa instanceof Error ? causa.message : String(causa)).slice(0, 200);
const codigoDe = (causa: unknown): unknown => (causa as { code?: unknown } | null)?.code;

export function crearTopeDurable(opciones: OpcionesTopeDurable = {}): TopeDurable {
  const reloj = opciones.reloj ?? Date.now;
  const plazoMs = opciones.plazoMs ?? PLAZO_TOPE_MS;
  const pausaMs = opciones.pausaMs ?? PAUSA_TRAS_FALLO_MS;
  const registrar = opciones.registrar ?? decidir;
  let proveedor: ProveedorDeConsulta = opciones.proveedor ?? consultaDeNeon;
  let pausadoHasta = 0;
  let ultimaLimpieza = Number.NEGATIVE_INFINITY;
  let avisadoSinTabla = false;

  function caer(clave: string, causa: unknown): void {
    const tope = clave.split(":")[0];
    if (CODIGOS_SIN_TABLA.includes(codigoDe(causa))) {
      pausadoHasta = reloj() + PAUSA_SIN_TABLA_MS;
      registrar("regla:tope_durable_sin_tabla", "la tabla topes_gasto no existe en la base: falta aplicar la migración 035; los topes siguen en la memoria de cada instancia (no son globales)", {
        tope, codigo: String(codigoDe(causa)), pausaSeg: Math.round(PAUSA_SIN_TABLA_MS / 1000),
      });
      if (!avisadoSinTabla) {
        avisadoSinTabla = true;
        console.error("[topes] falta la tabla topes_gasto (migración 035): los topes de gasto por hora NO son globales, cuenta cada instancia por su lado. Aplica scripts/migrations/035_topes_gasto.sql.");
      }
      return;
    }
    pausadoHasta = reloj() + pausaMs;
    registrar("regla:tope_durable_caido", "el tope de gasto no pudo contar en la base: sigue el contador en memoria de esta instancia (el límite deja de ser global hasta que la base responda)", {
      tope,
      causa: mensajeDe(causa),
      pausaSeg: Math.round(pausaMs / 1000),
    });
  }

  /** La consulta si toca usar la base; `null` si no hay base o está en pausa tras un fallo. */
  async function consultaDisponible(clave: string): Promise<Consulta | null> {
    const ahora = reloj();
    if (ahora < pausadoHasta) return null;
    // Venció una pausa: esta toma sondea y las demás siguen en memoria hasta que responda. Se reserva antes de cualquier
    // `await`, o varias tomas simultáneas verían la pausa vencida a la vez.
    if (pausadoHasta > 0) pausadoHasta = ahora + plazoMs;
    try {
      return await proveedor();
    } catch (causa) {
      caer(clave, causa);
      return null;
    }
  }

  function limpiarSiToca(consulta: Consulta): void {
    const ahora = reloj();
    if (ahora - ultimaLimpieza < LIMPIEZA_CADA_MS) return;
    ultimaLimpieza = ahora;
    consulta(SQL_LIMPIAR_TOPES, []).catch((causa: unknown) => console.warn("[topes] no se pudo limpiar topes_gasto", mensajeDe(causa)));
  }

  const deMemoria = (enMemoria: () => ResultadoTope): { toma: ResultadoTope; origen: OrigenTope } => {
    const toma = enMemoria();
    return { toma: toma.ok ? { ...toma, recibo: { origen: "memoria" } } : toma, origen: "memoria" };
  };

  return {
    async tomar(clave, tope, enMemoria) {
      // Con tope < 1 el INSERT de la primera toma concedería una unidad que no existe.
      if (tope < 1) return deMemoria(enMemoria);
      const consulta = await consultaDisponible(clave);
      if (!consulta) return deMemoria(enMemoria);
      try {
        const { rows } = await conPlazo(consulta(SQL_TOMAR_TOPE, [clave, VENTANA_TOPE_MS, tope], plazoMs), plazoMs);
        const toma = leerToma(rows, tope);
        pausadoHasta = 0;
        limpiarSiToca(consulta);
        return { toma, origen: "base" };
      } catch (causa) {
        caer(clave, causa);
        return deMemoria(enMemoria);
      }
    },

    async devolver(clave, recibo, enMemoria) {
      if (recibo.origen === "memoria") { enMemoria(); return; }
      const consulta = await consultaDisponible(clave);
      if (!consulta) return;
      try {
        await conPlazo(consulta(SQL_DEVOLVER_TOPE, [clave, recibo.ventana], plazoMs), plazoMs);
        pausadoHasta = 0;
      } catch (causa) {
        caer(clave, causa);
      }
    },

    usarProveedor(nuevo) {
      proveedor = nuevo;
      pausadoHasta = 0;
      ultimaLimpieza = Number.NEGATIVE_INFINITY;
      avisadoSinTabla = false;
    },
  };
}

declare global {
  var __topeDurable: TopeDurable | undefined;
}

/** El de esta instancia; en `globalThis` porque Next puede empaquetar cada ruta con su propia copia del módulo. */
export function topeDurable(): TopeDurable {
  return (globalThis.__topeDurable ??= crearTopeDurable());
}
