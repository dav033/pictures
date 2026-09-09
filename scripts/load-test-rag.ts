import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { getRagPool } from "../src/lib/rag/db";
import { buscarCatalogoRag } from "../src/lib/rag/chat/buscar";
import { buscarCatalogoRagConPresupuesto } from "../src/lib/rag/chat/buscar-presupuesto";
import { resolverFranja } from "../src/lib/rag/presupuesto/resolver";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

/**
 * Fase 7.1 (plan §Fase 7): escenario de carga reproducible con proveedor
 * falso. Mismo patrón "no-key" que scripts/bench-rag-v2.ts: sin
 * GEMINI_API_KEY, interpretarConsulta() jamás llama a Gemini y cae siempre
 * al parser determinista local (src/lib/rag/query-parser/parse.ts:34-39) —
 * esto no es una aproximación, es la misma ruta de código que corre en
 * producción cuando no hay llave o el proveedor está caído. Cero gasto real.
 *
 * Reusa getRagPool() (src/lib/rag/db.ts) para medir el pool tal cual está
 * configurado hoy en producción (max: 20, connectionTimeoutMillis: 5000),
 * no una aproximación hecha a mano.
 */
process.env.GEMINI_API_KEY = "";
process.env.RAG_USE_VECTOR = "false";

const ROOT = process.cwd();
const DEFAULT_REPORT = path.join(ROOT, "reports", "load-test-rag.md");

// Consultas representativas de los dos flujos que golpean el pool con más
// concurrencia por turno (identificados en el propio plan como el riesgo:
// franjas dispara hasta 5 roles en paralelo, cada uno con sus propias ramas
// léxicas concurrentes). Frases con intención clara para el parser
// determinista local — no dependen de Gemini para clasificar bien.
const QUERIES = [
  "globos plateados para cumpleaños",
  "arco de globos rosados para baby shower",
  "centro de mesa dorado para boda",
  "telon de fondo blanco para 15 anos",
  "10 globos metalicos morados",
  "decoracion para baby shower azul",
  "globos number 30 dorado",
  "kit de mesa de dulces rosa pastel",
];

// Franja "escena" (media-alta): dispara el fan-out completo de 5 roles
// (ROLES_PRESUPUESTO en src/lib/rag/presupuesto/franjas.ts) en paralelo por
// turno — el caso que el plan cita como origen del riesgo de saturación.
const CIFRA_PRESUPUESTO = 400_000;

type Flow = "chat" | "presupuesto";

type TurnResult = { ok: boolean; ms: number; error?: string };

async function runTurn(flow: Flow, index: number): Promise<TurnResult> {
  const pool = getRagPool();
  const query = QUERIES[index % QUERIES.length];
  const started = performance.now();
  try {
    if (flow === "chat") {
      await buscarCatalogoRag(pool, query);
    } else {
      const resuelta = resolverFranja(CIFRA_PRESUPUESTO);
      if (!resuelta) throw new Error("resolverFranja() no resolvió la cifra fija del arnés — revisar franjas.ts");
      await buscarCatalogoRagConPresupuesto(pool, query, resuelta.franja, resuelta.cifraCliente);
    }
    return { ok: true, ms: performance.now() - started };
  } catch (error) {
    return { ok: false, ms: performance.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

type PoolSample = { tMs: number; total: number; idle: number; waiting: number };

async function runLevel(flow: Flow, concurrency: number, durationMs: number): Promise<{ results: TurnResult[]; poolSamples: PoolSample[] }> {
  const pool = getRagPool();
  const results: TurnResult[] = [];
  const poolSamples: PoolSample[] = [];
  const start = performance.now();
  const sampleTimer = setInterval(() => {
    poolSamples.push({ tMs: performance.now() - start, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });
  }, 50);

  let counter = 0;
  const worker = async () => {
    while (performance.now() - start < durationMs) {
      results.push(await runTurn(flow, counter++));
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    clearInterval(sampleTimer);
  }
  return { results, poolSamples };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((p / 100) * ordered.length) - 1));
  return ordered[index];
}

function summarize(results: TurnResult[]) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const latencies = ok.map((r) => r.ms);
  const errorSamples = [...new Set(failed.map((r) => r.error ?? "unknown"))].slice(0, 5);
  return {
    total: results.length,
    ok: ok.length,
    failed: failed.length,
    errorRate: results.length ? failed.length / results.length : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.length ? Math.max(...latencies) : 0,
    errorSamples,
  };
}

function summarizePool(samples: PoolSample[]) {
  if (!samples.length) return { maxWaiting: 0, avgWaiting: 0, maxTotal: 0 };
  const waiting = samples.map((s) => s.waiting);
  return {
    maxWaiting: Math.max(...waiting),
    avgWaiting: waiting.reduce((a, b) => a + b, 0) / waiting.length,
    maxTotal: Math.max(...samples.map((s) => s.total)),
  };
}

type LevelReport = {
  flow: Flow;
  concurrency: number;
  durationMs: number;
  summary: ReturnType<typeof summarize>;
  pool: ReturnType<typeof summarizePool>;
};

type Options = { concurrencyLevels: number[]; durationMs: number; flows: Flow[]; report: string };

function parseArgs(argv: string[]): Options {
  let concurrencyLevels = [1, 5, 10, 20, 30, 50];
  let durationMs = 8_000;
  let flows: Flow[] = ["chat", "presupuesto"];
  let report = DEFAULT_REPORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--concurrency") {
      const next = argv[++i];
      concurrencyLevels = next.split(",").map((v) => Number(v.trim()));
      if (concurrencyLevels.some((v) => !Number.isInteger(v) || v < 1)) throw new Error("--concurrency requiere enteros positivos separados por coma");
    } else if (arg === "--duration") {
      const next = Number(argv[++i]);
      if (!Number.isFinite(next) || next <= 0) throw new Error("--duration requiere segundos > 0");
      durationMs = next * 1000;
    } else if (arg === "--flow") {
      const next = argv[++i];
      if (next !== "chat" && next !== "presupuesto" && next !== "both") throw new Error("--flow debe ser chat, presupuesto o both");
      flows = next === "both" ? ["chat", "presupuesto"] : [next];
    } else if (arg === "--report") {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error("--report requiere una ruta");
      report = path.resolve(ROOT, next);
    } else throw new Error(`argumento no reconocido: ${arg}`);
  }
  return { concurrencyLevels, durationMs, flows, report };
}

function renderReport(levels: LevelReport[], options: Options): string {
  const rows = levels.map((l) => `| ${l.flow} | ${l.concurrency} | ${l.summary.total} | ${l.summary.ok} | ${(l.summary.errorRate * 100).toFixed(2)}% | ${l.summary.p50.toFixed(0)} | ${l.summary.p95.toFixed(0)} | ${l.summary.p99.toFixed(0)} | ${l.summary.max.toFixed(0)} | ${l.pool.maxWaiting} | ${l.pool.avgWaiting.toFixed(1)} | ${l.pool.maxTotal} |`).join("\n");
  const errorDetail = levels.filter((l) => l.summary.errorSamples.length).map((l) => `- **${l.flow}, concurrencia ${l.concurrency}**: ${l.summary.errorSamples.map((e) => `\`${e}\``).join("; ")}`).join("\n") || "- Ningún error en ningún nivel.";
  return `# Carga RAG: turnos concurrentes contra el pool real — Fase 7.1

Generado: ${new Date().toISOString()}
Proveedor: **falso** (sin \`GEMINI_API_KEY\`, \`RAG_USE_VECTOR=false\`) — cero gasto real, misma ruta de código que producción sin llave.
Pool bajo prueba: el real de \`src/lib/rag/db.ts\` (\`getRagPool()\`), sin modificar.
Duración por nivel: ${options.durationMs / 1000}s. Niveles de concurrencia: ${options.concurrencyLevels.join(", ")}.

**Este documento mide, no fija un umbral.** La Fase 7.2 (presupuesto de latencia) queda pendiente de un requisito de negocio explícito — no hay uno documentado al momento de esta corrida.

## Resultados por nivel

| Flujo | Concurrencia | Turnos | OK | Error % | p50 ms | p95 ms | p99 ms | max ms | pool.waiting max | pool.waiting avg | pool.total max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

## Errores observados (muestra, hasta 5 por nivel)

${errorDetail}

## Cómo leer esto

- **pool.total max** vs el \`max: 20\` configurado en \`src/lib/rag/db.ts\`: si llega a 20, el pool está saturado en ese nivel.
- **pool.waiting** > 0 significa que hubo turnos esperando una conexión libre; si el error % sube junto con esto, la saturación se está traduciendo en fallos, no solo en cola.
- El flujo \`presupuesto\` dispara 5 roles en paralelo por turno (\`ROLES_PRESUPUESTO\`), cada uno con sus propias ramas léxicas concurrentes — es el que más agresivamente demanda el pool, tal como anticipa la Fase 7 del plan.

## Reproducción

\`\`\`powershell
$env:DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/demo_rag"
npx tsx --conditions=react-server scripts/load-test-rag.ts --concurrency ${options.concurrencyLevels.join(",")} --duration ${options.durationMs / 1000} --flow ${options.flows.length === 2 ? "both" : options.flows[0]}
\`\`\`
`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es requerido");
  await mkdir(path.dirname(options.report), { recursive: true });

  const pool = getRagPool();
  const levels: LevelReport[] = [];
  try {
    for (const flow of options.flows) {
      for (const concurrency of options.concurrencyLevels) {
        console.log(`[carga] flujo=${flow} concurrencia=${concurrency} duracion=${options.durationMs}ms`);
        const { results, poolSamples } = await runLevel(flow, concurrency, options.durationMs);
        const summary = summarize(results);
        const poolSummary = summarizePool(poolSamples);
        levels.push({ flow, concurrency, durationMs: options.durationMs, summary, pool: poolSummary });
        console.log(`  -> ${summary.ok}/${summary.total} ok, p50=${summary.p50.toFixed(0)}ms p95=${summary.p95.toFixed(0)}ms p99=${summary.p99.toFixed(0)}ms error=${(summary.errorRate * 100).toFixed(1)}% pool.waiting.max=${poolSummary.maxWaiting}`);
      }
    }
    const report = renderReport(levels, options);
    await writeFile(options.report, report, "utf8");
    console.log(`\nReporte: ${path.relative(ROOT, options.report)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] carga RAG: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
