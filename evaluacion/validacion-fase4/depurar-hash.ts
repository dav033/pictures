/**
 * Depuración (FUERA del repo): ¿qué cambia entre el plan firmado al confirmar y el que /api/generate re-resuelve?
 * Llama a la ruta real con el plan del caso, guarda la respuesta del resolvedor Python y la compara campo a campo
 * con el plan firmado. Ningún modelo de imagen se llama (el hash falla antes, y además fal/Gemini se bloquean).
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server <este archivo> --caso 8 --dir planes-ui4
 */
import { DATOS } from "../rutas";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const F4 = `${DATOS}/validacion-fase4`;
const LB = `${DATOS}/linea-base`;
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };

function diff(a: unknown, b: unknown, ruta: string, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${ruta}.${k}`, out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) { a.forEach((x, i) => diff(x, b[i], `${ruta}[${i}]`, out)); return; }
  out.push(`${ruta}: ${JSON.stringify(a)?.slice(0, 200)}  ->  ${JSON.stringify(b)?.slice(0, 200)}`);
}

async function main(): Promise<void> {
  const caso = Number(arg("--caso", "8"));
  const base = `${F4}/${arg("--dir", "planes-ui4")}/caso-${caso}/corrida-1`;
  const { Pool } = await import(pathToFileURL(resolve(REPO, "node_modules/pg/lib/index.js")).href).then((m) => (m.default ?? m) as typeof import("pg"));
  const real = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  delete process.env.DATABASE_URL;
  (globalThis as { __ragPool?: unknown }).__ragPool = {
    query: async (sql: string, params?: unknown[]) => (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? { rows: [], rowCount: 0 } : real.query(sql, params as never)),
    connect: async () => { throw new Error("solo lectura"); }, on: () => undefined, end: async () => undefined,
  };
  await import(pathToFileURL(resolve(REPO, "src/lib/ia/nucleo/telemetria-llamadas.ts")).href);
  const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href) as { configurarPersistenciaTelemetria: (x: undefined) => void };
  core.configurarPersistenciaTelemetria(undefined);
  const fetchOriginal = globalThis.fetch;
  const resoluciones: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/fal\.(run|ai|media)|image/i.test(url)) throw new Error("bloqueado");
    const res = await fetchOriginal(input, init);
    if (/127\.0\.0\.1:8000/.test(url) && /resol/i.test(url)) {
      resoluciones.push(await res.clone().json().catch(() => null));
      if (typeof init?.body === "string") writeFileSync(`${base}/peticion-generar.json`, init.body);
    }
    return res;
  }) as typeof fetch;
  const { POST } = await import(pathToFileURL(resolve(REPO, "src/app/api/generate/route.ts")).href);
  const plan = JSON.parse(readFileSync(`${base}/plan-resuelto.json`, "utf8"));
  const blueprint = JSON.parse(readFileSync(`${base}/blueprint.json`, "utf8"));
  const imagen = { base64: readFileSync(`${LB}/sin-etiquetas/case-00${caso}-ref.png`).toString("base64"), mime: "image/png" };
  const res = await POST(new Request("http://localhost/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, planHash: plan.plan_hash, brief: {}, solicitudUsuario: "Adjunto imágenes de referencia del estilo que busco.", imagenesReferencia: [imagen], blueprint, usarLora: false, proveedor: "gemini" }) }));
  console.log("status", res.status, "resoluciones capturadas", resoluciones.length);
  const re = resoluciones[0] as { plan_resuelto?: { plan_hash: string; plan: unknown } } | undefined;
  const nuevo = re?.plan_resuelto ?? (resoluciones[0] as { plan_hash?: string; plan?: unknown });
  writeFileSync(`${base}/re-resuelto.json`, JSON.stringify(resoluciones, null, 1));
  console.log("hash firmado", plan.plan_hash, "hash re-resuelto", (nuevo as { plan_hash?: string })?.plan_hash);
  const out: string[] = [];
  diff(plan.plan, (nuevo as { plan?: unknown })?.plan, "plan", out);
  console.log(out.slice(0, 40).join("\n") || "(plan idéntico: la diferencia está fuera de `plan`)");
  if (!out.length) { const o2: string[] = []; diff(plan, nuevo, "resuelto", o2); console.log(o2.slice(0, 30).join("\n")); }
  await real.end();
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });
