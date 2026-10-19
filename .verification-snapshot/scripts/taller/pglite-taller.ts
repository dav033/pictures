/**
 * PGlite (Postgres en memoria con pgvector, pg_trgm y unaccent) con el esquema de la biblioteca del taller: lo que comparten la
 * evaluación local del RAG (`evaluar-rag-local.ts`) y la prueba de la migración 034 (`test-migracion-034.ts`). PGlite no es
 * dependencia del repo: se instala aparte (`npm i @electric-sql/pglite @electric-sql/pglite-pgvector`) y se pasa su carpeta.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type BasePglite = {
  query: (texto: string, valores?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (texto: string) => Promise<unknown>;
};

/** Las migraciones del índice de la biblioteca, en orden: 028 crea las tablas, 034 las parte por repositorio (REQ-013). */
export const MIGRACIONES_TALLER = ["028_taller_biblioteca.sql", "034_catalogo_repositorios.sql"] as const;

export const leerMigracion = (archivo: string): string => readFileSync(path.join(process.cwd(), "scripts", "migrations", archivo), "utf8").replace(/\r\n/g, "\n");

/** Abre PGlite (en memoria, o en `carpetaBase` para reutilizar una base ya indexada) desde la carpeta donde está instalado. */
export async function abrirPglite(carpetaPglite: string, carpetaBase?: string): Promise<BasePglite> {
  const req = createRequire(carpetaPglite.replace(/[\\/]$/, "") + "/package.json");
  const cargar = async (modulo: string) => import(pathToFileURL(req.resolve(modulo)).href);
  const { PGlite } = await cargar("@electric-sql/pglite");
  const { vector } = await cargar("@electric-sql/pglite-pgvector");
  const { pg_trgm } = await cargar("@electric-sql/pglite/contrib/pg_trgm");
  const { unaccent } = await cargar("@electric-sql/pglite/contrib/unaccent");
  const opciones = { extensions: { vector, pg_trgm, unaccent } };
  return carpetaBase ? PGlite.create(carpetaBase, opciones) : PGlite.create(opciones);
}

/** La configuración `spanish_unaccent` (la crea 002, que trae más cosas) y las migraciones pedidas (por defecto, las dos). */
export async function prepararEsquemaTaller(db: BasePglite, migraciones: readonly string[] = MIGRACIONES_TALLER): Promise<void> {
  await db.exec("CREATE EXTENSION IF NOT EXISTS unaccent; CREATE TEXT SEARCH CONFIGURATION spanish_unaccent (COPY = spanish); ALTER TEXT SEARCH CONFIGURATION spanish_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;");
  for (const archivo of migraciones) await db.exec(leerMigracion(archivo));
}
