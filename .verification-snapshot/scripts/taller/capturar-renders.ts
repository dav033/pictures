/**
 * Captura de renders estándar de la biblioteca del taller (REQ-002, paso 3): un PNG de 512×512 por item, con la misma
 * cámara por tipo, para las incrustaciones de imagen (foto ↔ render). Abre `/3d/captura` de un servidor de desarrollo
 * (la página solo existe en desarrollo o con `CAPTURA_RENDERS_ENABLED=1`) y le pide cada item con Playwright. Sin red
 * externa ni gasto. Se puede interrumpir y repetir: salta lo que ya está hecho con la misma ficha (`hash`).
 *
 *   npx next dev -p 3012              # en otra terminal (con node_modules enlazado, Turbopack pide `turbopack.root` en next.config.ts)
 *   npx tsx scripts/taller/capturar-renders.ts [--url=http://127.0.0.1:3012] [--solo-fabrica] [--concurrencia=3]
 *       [--ids=a,b] [--limite=N] [--rehacer] [--sin-gpu] [--salida=data/taller/renders] [--fichas=data/taller/fichas.jsonl]
 *       [--timeout-ms=60000]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { BIBLIOTECA_FABRICA } from "../../src/lib/globos3d/biblioteca";

const RAIZ = path.resolve(__dirname, "../..");
const argumento = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);

const URL_BASE = (argumento("url") ?? "http://127.0.0.1:3012").replace(/\/$/, "");
const FICHAS = path.resolve(RAIZ, argumento("fichas") ?? "data/taller/fichas.jsonl");
const SALIDA = path.resolve(RAIZ, argumento("salida") ?? "data/taller/renders");
const MANIFEST = path.join(SALIDA, "manifest.json");
const CONCURRENCIA = Math.min(3, Math.max(1, Number(argumento("concurrencia") ?? 3)));
const TIMEOUT_MS = Number(argumento("timeout-ms") ?? 60_000);
const SOLO_FABRICA = bandera("solo-fabrica");
const REHACER = bandera("rehacer");
const LIMITE = argumento("limite") ? Number(argumento("limite")) : Infinity;
const IDS = argumento("ids")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
/** Cada cuántos items se recarga la página (la memoria de la pestaña crece con las escenas armadas). */
const ITEMS_POR_PAGINA = 80;
const GUARDAR_CADA = 20;

type Ficha = { id: string; hash: string };
type EstadoPagina = { listo: boolean; dataUrl: string | null; error: string | null; id: string | null; vista: string | null; ms: number; fases?: Record<string, number> };
type Entrada = { archivo: string; hash: string; vista: string | null; ms: number; fases?: Record<string, number>; error: string | null };
type Manifest = { version: 1; actualizado: string; renders: Record<string, Entrada> };

/** Lo que la página de captura deja en `window` (ver `CapturaRender.tsx`). */
type VentanaCaptura = { __capturarItem?: (id: string, vista?: string | null) => Promise<EstadoPagina> };

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function leerFichas(): Ficha[] {
  const lineas = readFileSync(FICHAS, "utf8").split("\n").filter(Boolean);
  return lineas.map((l) => { const r = JSON.parse(l) as Ficha; return { id: r.id, hash: r.hash }; });
}

/** Nombre de archivo seguro y legible; si dos ids darían el mismo, ambos llevan además un trozo de la huella del id. */
function nombresDeArchivo(ids: readonly string[]): Map<string, string> {
  const base = (id: string) => id.replace(/~/g, "__").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  const veces = new Map<string, number>();
  for (const id of ids) veces.set(base(id), (veces.get(base(id)) ?? 0) + 1);
  return new Map(ids.map((id) => [id, `${base(id)}${(veces.get(base(id)) ?? 0) > 1 ? `-${createHash("sha1").update(id).digest("hex").slice(0, 6)}` : ""}.png`]));
}

function leerManifest(): Manifest {
  try { return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest; } catch { return { version: 1, actualizado: "", renders: {} }; }
}

function guardarManifest(m: Manifest) {
  m.actualizado = new Date().toISOString();
  const temporal = `${MANIFEST}.tmp`;
  writeFileSync(temporal, JSON.stringify(m, null, 2), "utf8");
  renameSync(temporal, MANIFEST);
}

async function abrirNavegador(): Promise<Browser> {
  // Con la GPU (Direct3D 11) el render es varias veces más rápido que por software; `--sin-gpu` fuerza el software
  // (SwiftShader). Primero el Chromium de Playwright; si no está descargado, el Chrome instalado.
  const args = bandera("sin-gpu") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"];
  try { return await chromium.launch({ headless: true, args }); } catch (e) {
    console.log(`Chromium de Playwright no disponible (${mensaje(e).split("\n")[0]}); uso el Chrome instalado.`);
    return chromium.launch({ headless: true, channel: "chrome", args });
  }
}

async function paginaNueva(navegador: Browser): Promise<Page> {
  const pagina = await navegador.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  pagina.setDefaultTimeout(TIMEOUT_MS);
  await pagina.goto(`${URL_BASE}/3d/captura`, { waitUntil: "load", timeout: Math.max(TIMEOUT_MS, 120_000) });
  await pagina.waitForFunction(() => typeof (window as VentanaCaptura).__capturarItem === "function", undefined, { timeout: Math.max(TIMEOUT_MS, 120_000) });
  return pagina;
}

/** Pide un item a la página; si tarda más del tiempo, falla (la página se descarta). */
async function pedir(pagina: Page, id: string): Promise<EstadoPagina> {
  let reloj: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => { reloj = setTimeout(() => rechazar(new Error(`tiempo agotado (${TIMEOUT_MS} ms)`)), TIMEOUT_MS); });
  try { return await Promise.race([pagina.evaluate((i) => (window as VentanaCaptura).__capturarItem!(i), id), limite]); } finally { clearTimeout(reloj); }
}

async function main() {
  const fichas = leerFichas();
  const fabrica = new Set(BIBLIOTECA_FABRICA.map((i) => i.id));
  const nombres = nombresDeArchivo(fichas.map((f) => f.id));
  // De fábrica primero (son lo que el taller trae de serie); dentro de cada grupo, el orden de las fichas.
  let pendientes = [...fichas.filter((f) => fabrica.has(f.id)), ...(SOLO_FABRICA ? [] : fichas.filter((f) => !fabrica.has(f.id)))];
  if (IDS) pendientes = pendientes.filter((f) => IDS.includes(f.id));
  mkdirSync(SALIDA, { recursive: true });
  const manifest = leerManifest();
  const yaHechas = (f: Ficha) => { const e = manifest.renders[f.id]; return !REHACER && !!e && !e.error && e.hash === f.hash && existsSync(path.join(SALIDA, e.archivo)); };
  const total = pendientes.length;
  const saltadas = pendientes.filter(yaHechas).length;
  pendientes = pendientes.filter((f) => !yaHechas(f)).slice(0, LIMITE);
  console.log(`Fichas: ${fichas.length}; a considerar: ${total} (fábrica ${fichas.filter((f) => fabrica.has(f.id)).length}); ya hechas: ${saltadas}; por hacer: ${pendientes.length}; páginas: ${CONCURRENCIA}; ${URL_BASE}`);
  if (!pendientes.length) { guardarManifest(manifest); return; }

  const navegador = await abrirNavegador();
  const inicio = Date.now();
  let hechas = 0, fallos = 0, sumaMs = 0;
  const lista = [...pendientes];

  const guardar = (f: Ficha, estado: EstadoPagina | null, error: string | null, ms: number) => {
    const archivo = nombres.get(f.id)!;
    if (estado?.dataUrl && !error) writeFileSync(path.join(SALIDA, archivo), Buffer.from(estado.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
    manifest.renders[f.id] = { archivo, hash: f.hash, vista: estado?.vista ?? null, ms, ...(estado?.fases ? { fases: estado.fases } : {}), error };
    if (error) { fallos++; console.log(`  FALLO ${f.id}: ${error}`); } else { hechas++; sumaMs += ms; }
    if ((hechas + fallos) % GUARDAR_CADA === 0) guardarManifest(manifest);
    if ((hechas + fallos) % 25 === 0) console.log(`  ${hechas + fallos}/${pendientes.length} · ${hechas} bien, ${fallos} fallos · ${((Date.now() - inicio) / 1000).toFixed(0)} s · ${(sumaMs / Math.max(1, hechas)).toFixed(0)} ms por item (en la página)`);
  };

  const trabajador = async () => {
    let pagina: Page | null = null;
    let enPagina = 0;
    const cerrar = async () => { await pagina?.close().catch(() => undefined); pagina = null; enPagina = 0; };
    for (let f = lista.shift(); f; f = lista.shift()) {
      let ultimoError = "";
      for (let intento = 0; intento < 2; intento++) {
        const t0 = Date.now();
        try {
          if (pagina && enPagina >= ITEMS_POR_PAGINA) await cerrar();
          pagina ??= await paginaNueva(navegador);
          const estado = await pedir(pagina, f.id);
          enPagina++;
          if (estado.error || !estado.dataUrl) throw new Error(estado.error ?? "sin imagen");
          guardar(f, estado, null, estado.ms || Date.now() - t0);
          ultimoError = "";
          break;
        } catch (e) {
          ultimoError = mensaje(e).split("\n")[0]!;
          // Un error de la página o un tiempo agotado: se descarta la página y se reintenta en una limpia.
          await cerrar();
          await dormir(300);
        }
      }
      if (ultimoError) guardar(f, null, ultimoError, 0);
    }
    await cerrar();
  };

  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador));
  await navegador.close();
  guardarManifest(manifest);
  const seg = (Date.now() - inicio) / 1000;
  console.log(`Listo: ${hechas} renders, ${fallos} fallos, ${seg.toFixed(0)} s en total (${((seg * 1000) / Math.max(1, hechas + fallos)).toFixed(0)} ms por item con ${CONCURRENCIA} páginas).`);
  console.log(`Carpeta: ${path.relative(RAIZ, SALIDA)} · manifiesto: ${path.relative(RAIZ, MANIFEST)}`);
  if (fallos) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
