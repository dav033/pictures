/**
 * Fase 7: análisis de las fotos de `Downloads/test` por la ruta REAL `/api/references/analyze` (en proceso), sin
 * caché, con la variante de producción. Escribe `blueprints/case-00N-run-1.json` ({ blueprint }), que es lo que
 * lee `trazar-plan.ts --bp-dir`.
 *
 * Gasto: cada caso es una llamada de visión a Gemini. `--max-llamadas` corta las que excedan el tope declarado.
 * Telemetría y escrituras a Postgres desactivadas (pool sumidero, como `trazar-plan.ts`).
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server <este archivo> --casos 1,2,3,4,5 --max-llamadas 5
 */
import { DATOS, REPO } from "../rutas";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

const AQUI = `${DATOS}/validacion-fase7`;
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };

async function main(): Promise<void> {
  delete process.env.DATABASE_URL;
  delete process.env.CATALOG_DATABASE_URL;
  const casos = arg("--casos", "1,2,3,4,5").split(",").map(Number);
  const maxLlamadas = Number(arg("--max-llamadas", "5"));
  const imagenPersonalizada = arg("--imagen", "");
  const casoPersonalizado = Number(arg("--caso", "1"));
  const bloqueadas: Record<string, number> = {};
  (globalThis as { __ragPool?: unknown }).__ragPool = {
    query: async (sql: string) => {
      const verbo = String(sql).trim().split(/\s+/)[0]!.toUpperCase();
      if (["INSERT", "UPDATE", "DELETE"].includes(verbo)) bloqueadas[verbo] = (bloqueadas[verbo] ?? 0) + 1;
      return { rows: [], rowCount: 0 };
    },
    on: () => undefined,
    end: async () => undefined,
  };
  let llamadas = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(url) && (init?.method ?? "GET") === "POST") {
      if (llamadas >= maxLlamadas) throw new Error("FASE7_TOPE: llamada a Gemini bloqueada por el tope declarado");
      llamadas += 1;
    }
    return fetchOriginal(input, init);
  }) as typeof fetch;
  await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
  const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href) as { configurarPersistenciaTelemetria: (x: undefined) => void };
  core.configurarPersistenciaTelemetria(undefined);
  const { POST } = await imp("src/app/api/references/analyze/route.ts") as { POST: (r: Request) => Promise<Response> };

  const SALIDA = arg("--salida", `${AQUI}/blueprints`);
  mkdirSync(SALIDA, { recursive: true });
  for (const c of imagenPersonalizada ? [casoPersonalizado] : casos) {
    const destino = `${SALIDA}/case-00${c}-run-1.json`;
    if (existsSync(destino)) { console.log(`[ya existe] caso ${c}`); continue; }
    const rutaImagen = imagenPersonalizada || `${AQUI}/entradas/case-00${c}-ref.png`;
    const extension = extname(rutaImagen).toLowerCase();
    const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    const base64 = readFileSync(rutaImagen).toString("base64");
    const res = await POST(new Request("http://localhost/api/references/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [{ base64, mime }], sinCache: true }),
    }));
    const cuerpo = await res.json() as { blueprint?: unknown; error?: unknown };
    if (!res.ok || !cuerpo.blueprint) { console.log(`[caso ${c}] status=${res.status} ${JSON.stringify(cuerpo).slice(0, 300)}`); continue; }
    writeFileSync(destino, JSON.stringify({ blueprint: cuerpo.blueprint }, null, 1));
    const elementos = (cuerpo.blueprint as { elements: Array<{ approved: boolean; category: string; visual_semantics?: { structure_type?: string; placement?: string } }> }).elements;
    console.log(`[caso ${c}] ok · ${elementos.filter((e) => e.approved && e.category === "balloon_structure").map((e) => `${e.visual_semantics?.structure_type}/${e.visual_semantics?.placement}`).join(", ")}`);
  }
  console.log(`[fin] llamadas a Gemini: ${llamadas}/${maxLlamadas}; escrituras bloqueadas: ${JSON.stringify(bloqueadas)}`);
}

void main();
