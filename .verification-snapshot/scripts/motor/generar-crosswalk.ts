import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { leerFilasCatalogo } from "../../src/lib/globos3d/motor/crosswalk-consulta";
import { construirCrosswalk, CrosswalkSchema } from "../../src/lib/globos3d/motor/crosswalk-variantes";

/**
 * Genera el cruce motor 3D -> variantes de la tienda del snapshot publicado (REQ-007, fase 2):
 *   data/motor/crosswalk-<snapshot>.json                              el cruce de ese snapshot (versionado)
 *   src/lib/globos3d/motor/datos/crosswalk-vigente.json               la copia que viaja con el servidor (`crosswalk-vigente.ts`)
 *
 *   npx tsx scripts/motor/generar-crosswalk.ts [--env ruta/.env.local]   solo lee el catálogo: sin escritura en la base, sin coste
 *
 * La conexión sale de DATABASE_URL (de `.env.local`, o del archivo que diga --env); ningún valor se imprime.
 */
const RAIZ = path.resolve(__dirname, "..", "..");
export const RUTA_VIGENTE = path.join(RAIZ, "src", "lib", "globos3d", "motor", "datos", "crosswalk-vigente.json");
export const nombreArchivoDeSnapshot = (snapshot: string): string => `crosswalk-${snapshot.replace(/[^A-Za-z0-9_.-]/g, "-")}.json`;

function cargarEntorno(): void {
  const indice = process.argv.indexOf("--env");
  const candidatos = [indice >= 0 ? process.argv[indice + 1] : undefined, process.env.ENV_LOCAL_RUTA, path.join(process.cwd(), ".env.local"), path.join(RAIZ, ".env.local")];
  for (const ruta of candidatos) if (ruta && existsSync(ruta)) { process.loadEnvFile(ruta); return; }
}

async function main(): Promise<void> {
  cargarEntorno();
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL: pasa --env <ruta al .env.local> o define ENV_LOCAL_RUTA.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000 });
  try {
    const filas = await leerFilasCatalogo(pool);
    const snapshot = filas[0]?.snapshot;
    if (!snapshot) throw new Error("El catálogo publicado no devolvió filas.");
    const { crosswalk, diagnostico } = construirCrosswalk(filas, snapshot);
    CrosswalkSchema.parse(crosswalk);
    const contenido = `${JSON.stringify(crosswalk, null, 1)}\n`;
    const carpeta = path.join(RAIZ, "data", "motor");
    await mkdir(carpeta, { recursive: true });
    await writeFile(path.join(carpeta, nombreArchivoDeSnapshot(snapshot)), contenido, "utf8");
    await writeFile(RUTA_VIGENTE, contenido, "utf8");
    const motivos = Object.values(crosswalk.sinCobertura).reduce<Record<string, number>>((suma, motivo) => ({ ...suma, [motivo]: (suma[motivo] ?? 0) + 1 }), {});
    console.log(`snapshot ${snapshot}`);
    console.log(`filas del catálogo: ${filas.length}; productos emparejados: ${diagnostico.productosEmparejados}`);
    console.log(`pares con variante: ${Object.keys(crosswalk.entradas).length}; sin cobertura: ${Object.keys(crosswalk.sinCobertura).length} ${JSON.stringify(motivos)}`);
    if (diagnostico.colisiones.length) console.log(`pares reclamados por dos productos (gana el de más variantes): ${diagnostico.colisiones.map((c) => c.clave).join(", ")}`);
    if (diagnostico.titulosAmbiguos.length) console.log(`títulos ambiguos (no se usaron): ${diagnostico.titulosAmbiguos.join(" | ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "falló la generación");
  process.exit(1);
});
