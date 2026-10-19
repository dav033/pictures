/**
 * Las bases contra las que corren las pruebas de los topes de gasto (`scripts/test/test-topes-*.ts`), todas con la misma forma
 * (`BaseDePrueba`) para que un solo conjunto de escenarios corra en cada una:
 * - un doble en memoria que replica la sentencia (siempre; el reloj es suyo y se mueve a mano);
 * - Postgres real en memoria (PGlite) si se pasa PGLITE_DIR, una carpeta con node_modules/@electric-sql/pglite;
 * - un `pg.Pool` de varias conexiones contra una base de pruebas LOCAL: la de la CI (su servicio pgvector/pg16, ya migrado por
 *   `rag:migrate`) o la de TOPES_TEST_DATABASE_URL. Es la única que ejercita los bloqueos de fila entre conexiones y el adaptador de
 *   producción (`crearConsultaDePool`). Nunca corre contra un host que no sea local: la prueba vacía `topes_gasto`, y el
 *   `.env.local` de esta máquina apunta a la base de producción.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { crearConsultaDePool } from "../../src/lib/topes/consulta-pool";
import { SQL_DEVOLVER_TOPE, SQL_LIMPIAR_TOPES, SQL_TOMAR_TOPE, type Consulta, type ResultadoTope } from "../../src/lib/topes/tope-durable";

export const RUTA_MIGRACION = path.join(process.cwd(), "scripts", "migrations", "035_topes_gasto.sql");
export const sqlMigracion = (): string => readFileSync(RUTA_MIGRACION, "utf8").replace(/\r\n/g, "\n");
export const DIA_MS = 86_400_000;

export type BaseDePrueba = {
  consulta: Consulta;
  sentencias: string[];
  /** Cuántas tomas lleva la clave, o `null` si no tiene fila. */
  leer: (clave: string) => Promise<number | null>;
  claves: () => Promise<string[]>;
  /** Hace pasar `ms` para la ventana de esa clave (la base tiene su propio reloj; el doble adelanta el suyo, para todas las claves). */
  envejecer: (clave: string, ms: number) => Promise<void>;
  plantar: (clave: string, usadas: number, haceMs: number) => Promise<void>;
  /** Deja la base como recién migrada. */
  vaciar: () => Promise<void>;
};

export type ModoBase = "normal" | "caida" | "colgada" | "tabla_inexistente" | "malformada";

/** Réplica en memoria de `SQL_TOMAR_TOPE`: lo que sigue a su único `await` es síncrono, o sea atómico, como la sentencia. */
export function crearBaseDoble(): BaseDePrueba & { estado: { ahora: number; modo: ModoBase } } {
  const filas = new Map<string, { inicio: number; usadas: number }>();
  const sentencias: string[] = [];
  const estado = { ahora: 10_000_000, modo: "normal" as ModoBase };
  const consulta: Consulta = async (sql, valores) => {
    sentencias.push(sql);
    if (estado.modo === "caida") throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    if (estado.modo === "tabla_inexistente") throw Object.assign(new Error('relation "topes_gasto" does not exist'), { code: "42P01" });
    if (estado.modo === "colgada") return new Promise<never>(() => undefined);
    await Promise.resolve();
    if (estado.modo === "malformada") return { rows: [{ usadas: "no-es-un-numero", ventana: "x" }] };
    if (sql === SQL_TOMAR_TOPE) {
      const [clave, ventana, tope] = valores as [string, number, number];
      const fila = filas.get(clave);
      if (!fila || estado.ahora - fila.inicio > ventana) {
        filas.set(clave, { inicio: estado.ahora, usadas: 1 });
        return { rows: [{ usadas: 1, ventana: String(estado.ahora) }] };
      }
      if (fila.usadas >= tope) return { rows: [] };
      fila.usadas += 1;
      return { rows: [{ usadas: fila.usadas, ventana: String(fila.inicio) }] };
    }
    if (sql === SQL_DEVOLVER_TOPE) {
      const [clave, ventana] = valores as [string, string];
      const fila = filas.get(clave);
      if (fila && String(fila.inicio) === ventana && fila.usadas > 0) fila.usadas -= 1;
      return { rows: [] };
    }
    if (sql === SQL_LIMPIAR_TOPES) {
      for (const [clave, fila] of filas) if (estado.ahora - fila.inicio > DIA_MS) filas.delete(clave);
      return { rows: [] };
    }
    throw new Error(`sentencia inesperada: ${sql}`);
  };
  return {
    consulta, sentencias, estado,
    leer: async (clave) => filas.get(clave)?.usadas ?? null,
    claves: async () => [...filas.keys()],
    envejecer: async (_clave, ms) => { estado.ahora += ms; },
    plantar: async (clave, usadas, haceMs) => { filas.set(clave, { inicio: estado.ahora - haceMs, usadas }); },
    vaciar: async () => { filas.clear(); sentencias.length = 0; estado.modo = "normal"; },
  };
}

type Ejecutar = (sql: string, valores?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Lo que tienen en común las bases que son Postgres de verdad: leer, envejecer y plantar filas con SQL. */
function baseSobreSql(ejecutar: Ejecutar, consultaReal: Consulta): BaseDePrueba {
  const sentencias: string[] = [];
  return {
    consulta: (sql, valores, plazoMs) => { sentencias.push(sql); return consultaReal(sql, valores, plazoMs); },
    sentencias,
    leer: async (clave) => { const fila = (await ejecutar("SELECT usadas FROM topes_gasto WHERE clave = $1", [clave])).rows[0]; return fila ? Number(fila.usadas) : null; },
    claves: async () => (await ejecutar("SELECT clave FROM topes_gasto ORDER BY clave")).rows.map((fila) => String(fila.clave)),
    envejecer: async (clave, ms) => { await ejecutar("UPDATE topes_gasto SET ventana_inicio = ventana_inicio - $2::double precision * interval '1 millisecond' WHERE clave = $1", [clave, ms]); },
    plantar: async (clave, usadas, haceMs) => { await ejecutar("INSERT INTO topes_gasto (clave, ventana_inicio, usadas) VALUES ($1, now() - $3::double precision * interval '1 millisecond', $2)", [clave, usadas, haceMs]); },
    vaciar: async () => { await ejecutar("DELETE FROM topes_gasto"); sentencias.length = 0; },
  };
}

export type PgliteMinimo = { query: Ejecutar; exec: (sql: string) => Promise<unknown>; close: () => Promise<void> };

/** Una sola instancia de PGlite para todo el archivo (arrancarla cuesta unos 5 s): cada prueba la deja vacía con `vaciar`. */
let pgliteCompartido: Promise<PgliteMinimo> | null = null;
export function abrirPglite(carpeta: string): Promise<PgliteMinimo> {
  pgliteCompartido ??= (async () => {
    const requerir = createRequire(path.join(carpeta, "package.json"));
    const { PGlite } = (await import(pathToFileURL(requerir.resolve("@electric-sql/pglite")).href)) as { PGlite: { create: () => Promise<PgliteMinimo> } };
    const db = await PGlite.create();
    await db.exec(sqlMigracion());
    return db;
  })();
  return pgliteCompartido;
}

/** Postgres real en memoria (una sola conexión) con la migración 035 aplicada. */
export async function crearBasePglite(carpeta: string): Promise<BaseDePrueba> {
  const db = await abrirPglite(carpeta);
  await db.exec("DELETE FROM topes_gasto");
  return baseSobreSql((sql, valores) => db.query(sql, valores), (sql, valores) => db.query(sql, valores));
}

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * La base de pruebas de Postgres, o `null` si no hay (la prueba se salta): TOPES_TEST_DATABASE_URL, o el `DATABASE_URL` de la CI
 * (la variable CI=true la pone GitHub Actions). Un host que no sea local es un error, no un salto: nunca la base de producción.
 */
export function urlDePruebaPg(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.TOPES_TEST_DATABASE_URL?.trim() || (env.CI === "true" ? env.DATABASE_URL?.trim() : undefined);
  if (!url) return null;
  const host = new URL(url).hostname;
  if (!HOSTS_LOCALES.has(host)) throw new Error(`La prueba de los topes vacía topes_gasto y solo corre contra una base local, no contra «${host}».`);
  return url;
}

let poolCompartido: Promise<Pool> | null = null;
function abrirPool(url: string): Promise<Pool> {
  poolCompartido ??= (async () => {
    // Varias conexiones de verdad: las tomas simultáneas toman bloqueos de fila entre sí. TOPES_TEST_POOL_MAX=1 solo sirve para
    // probar esta prueba misma contra un servidor de una sola conexión (PGlite por socket), que no es la base de la CI.
    const pool = new Pool({ connectionString: url, max: Number(process.env.TOPES_TEST_POOL_MAX) || 8 });
    await pool.query(sqlMigracion());
    return pool;
  })();
  return poolCompartido;
}

/** Un `pg.Pool` de 8 conexiones contra la base de pruebas local, con el adaptador de producción (`crearConsultaDePool`). */
export async function crearBasePg(url: string): Promise<BaseDePrueba> {
  const pool = await abrirPool(url);
  const consulta = crearConsultaDePool({
    connect: async () => {
      const cliente = await pool.connect();
      return { query: (config) => cliente.query(config), release: (destruir) => cliente.release(destruir) };
    },
  });
  const base = baseSobreSql((sql, valores) => pool.query(sql, valores), consulta);
  await base.vaciar();
  return base;
}

/** Cierra lo que las bases compartidas dejaron abierto; se llama una vez al terminar el archivo. */
export async function cerrarBasesCompartidas(): Promise<void> {
  if (pgliteCompartido) await (await pgliteCompartido).close();
  if (poolCompartido) await (await poolCompartido).end();
}

/** El contador en memoria de una instancia (el que responde si la base no): lo que había antes de la migración. */
export function crearMemoria(tope: number): () => ResultadoTope {
  let usadas = 0;
  return () => {
    if (usadas >= tope) return { ok: false, usadas, tope };
    usadas += 1;
    return { ok: true, usadas };
  };
}

export type RegistroDePrueba = { quien: string; que: string; resultado: unknown };

export function crearEspia(): { registros: RegistroDePrueba[]; registrar: (quien: string, que: string, resultado: unknown) => void; reglas: (quien: string) => RegistroDePrueba[] } {
  const registros: RegistroDePrueba[] = [];
  return {
    registros,
    registrar: (quien, que, resultado) => { registros.push({ quien, que, resultado }); },
    reglas: (quien) => registros.filter((r) => r.quien === quien),
  };
}
