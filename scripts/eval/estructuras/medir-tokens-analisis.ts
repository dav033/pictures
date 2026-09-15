import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Client } from "pg";
import { medirTokensAnalisis, type FilaTokens } from "../../../src/lib/eval/estructuras/medir-tokens";

/**
 * CLI: measures tokens per reference-analysis pass from ai_call_log with a
 * read-only transaction and prints the assumption file. `--escribir` saves it
 * under eval/estructuras/supuestos/. Never prints the connection string.
 *
 *   npx tsx scripts/eval/estructuras/medir-tokens-analisis.ts [--modelo gemini-3.6-flash] [--dias 30] [--minimo 30] [--escribir]
 */

function argumentos(argv: string[]) {
  const opciones = { modelo: "gemini-3.6-flash", dias: 30, minimo: 30, escribir: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valor = () => {
      const siguiente = argv[++i];
      if (!siguiente) throw new Error(`${arg} necesita un valor`);
      return siguiente;
    };
    if (arg === "--modelo") opciones.modelo = valor();
    else if (arg === "--dias") opciones.dias = Number(valor());
    else if (arg === "--minimo") opciones.minimo = Number(valor());
    else if (arg === "--escribir") opciones.escribir = true;
    else throw new Error(`opción desconocida: ${arg}`);
  }
  if (!/^[a-z0-9.-]{1,80}$/.test(opciones.modelo)) throw new Error("--modelo inválido");
  if (!Number.isInteger(opciones.dias) || opciones.dias < 1 || opciones.dias > 365) throw new Error("--dias debe ser un entero 1-365");
  if (!Number.isInteger(opciones.minimo) || opciones.minimo < 1) throw new Error("--minimo debe ser un entero positivo");
  return opciones;
}

async function main(): Promise<void> {
  const opciones = argumentos(process.argv.slice(2));
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error("DATABASE_URL no está configurada.");
  const client = new Client({ connectionString: dsn, statement_timeout: 30_000, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const fecha = new Date().toISOString().slice(0, 10);
    const supuesto = await medirTokensAnalisis(
      async (sql, parametros) => (await client.query<FilaTokens>(sql, [...parametros])).rows,
      { modelo: opciones.modelo, dias: opciones.dias, minimoLlamadas: opciones.minimo, fecha },
    );
    const texto = `${JSON.stringify(supuesto, null, 2)}\n`;
    process.stdout.write(texto);
    if (opciones.escribir) {
      const destino = resolve(process.cwd(), "eval/estructuras/supuestos", `${supuesto.version}.json`);
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, texto);
      console.error(`[medir-tokens] escrito ${destino}`);
    } else {
      console.error("[medir-tokens] vista previa: agrega --escribir para guardar el supuesto");
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error: unknown) => {
  // pg errors can echo the host; print only the class and a code.
  const codigo = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  console.error(`[medir-tokens] falló: ${error instanceof Error ? error.name : "Error"}${codigo ? ` (${codigo})` : ""}${error instanceof Error && !/postgres|neon|@|host/i.test(error.message) ? `: ${error.message}` : ""}`);
  process.exitCode = 1;
});
