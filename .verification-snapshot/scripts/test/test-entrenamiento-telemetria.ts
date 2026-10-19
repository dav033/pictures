/**
 * Arnés de entrenamiento (W4): un entrenamiento no escribe `ai_call_log` en la base del dueño. Se sustituye el pool de Postgres
 * por uno falso que anota cada consulta (sin base real) y se comprueba que, con el apagado del arnés, ninguna llamada de IA
 * intenta escribir la telemetría, mientras la traza en archivos y el búfer en memoria siguen:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-telemetria.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-telemetria-"));
Object.assign(process.env, {
  NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "seco-sin-llave",
  TALLER_RAG_ENABLED: "false", RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED: "false",
  REGISTRO_ACTIVO: "1", REGISTRO_DIR: path.join(tmp, "registro"), REGISTRO_NIVEL_STDOUT: "error",
});
delete process.env.VERCEL;
delete process.env.GEMINI_API_KEY;
delete process.env.FAL_KEY;
delete process.env.DATABASE_URL;

const consultas: string[] = [];
(globalThis as { __ragPool?: unknown }).__ragPool = {
  query: async (sql: string) => {
    consultas.push(sql);
    if (/ai_call_log/.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error("sin base de datos en la prueba");
  },
};
const escriturasDeTelemetria = () => consultas.filter((sql) => /INSERT INTO ai_call_log/.test(sql)).length;

async function main(): Promise<void> {
  let pruebas = 0;
  const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

  const { default: sharp } = await import("sharp");
  const { esperarPersistenciaTelemetria, ultimosEventos } = await import("@sempertex/agente-core");
  const { instalarGuardaRed } = await import("../entrenamiento/lib-red");
  const red = instalarGuardaRed("seco", {});
  const { ContadorLlamadas } = await import("../entrenamiento/lib-contador");
  const { CupoGasto } = await import("../entrenamiento/lib-cupo-gasto");
  const { pasadaDeFoto } = await import("../entrenamiento/lib-pasada");
  const { desactivarTelemetriaEnBaseDeDatos } = await import("../entrenamiento/lib-telemetria");
  const { esperarRegistros } = await import("../../src/lib/registro/escritor");

  const fotoJpeg = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer());
  const pasada = async (nombre: string) => {
    const contador = new ContadorLlamadas(new CupoGasto(1), 400, "seco");
    contador.activar();
    try {
      const r = await pasadaDeFoto({ corrida: "2026-10-10T00-00-00-000Z", nombre, bytes: fotoJpeg, turnos: 1, contador, modo: "seco", transporte: "seco", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, commit: "test", dirCacheDeteccion: path.join(tmp, "cache") });
      await esperarPersistenciaTelemetria();
      return r;
    } finally {
      contador.desactivar();
    }
  };

  console.log("Telemetría del arnés (sin escribir en la base):");

  await prueba("control: sin el apagado, cada llamada de IA intenta escribir ai_call_log (la prueba sí ve las escrituras)", async () => {
    const r = await pasada("images (25).jpg");
    assert.equal(r.registro.error, null);
    assert.ok(escriturasDeTelemetria() >= 3, `escrituras: ${escriturasDeTelemetria()}`);
  });

  await prueba("con el apagado del arnés ninguna llamada de IA intenta escribir ai_call_log, y la traza en archivos y el búfer siguen", async () => {
    await desactivarTelemetriaEnBaseDeDatos();
    const antes = escriturasDeTelemetria();
    const inicio = new Date().toISOString();
    const r = await pasada("images (26).jpg");
    assert.equal(r.registro.error, null);
    assert.ok(r.registro.llamadas >= 3, "la pasada hizo llamadas de IA");
    assert.equal(escriturasDeTelemetria(), antes, "ni una escritura nueva a la base");
    assert.ok((ultimosEventos()[0]?.cuando ?? "") >= inicio, "el búfer en memoria sigue registrando");
    await esperarRegistros();
    const raiz = path.join(tmp, "registro", "conversaciones");
    const archivos = readdirSync(raiz).flatMap((dia) => readdirSync(path.join(raiz, dia)));
    assert.ok(archivos.includes("entrenamiento-2026-10-10T00-00-00-000Z-images-26.jsonl"), `la auditoría en archivos sigue: ${archivos.join(", ")}`);
  });

  red.restaurar();
  await esperarRegistros();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pruebas} pruebas de la telemetría del arnés: OK`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
