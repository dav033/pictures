/**
 * Lo que comparten las pruebas del panel «Añadir» por repositorio en un navegador de verdad (`test-anadir-repositorios-ui.ts`,
 * `test-anadir-repositorios-marcha-atras-ui.ts`, `test-lista-repositorios-ui.ts`): empaquetar el arnés con esbuild, abrir Chrome
 * (Chromium de Playwright, o el de PLAYWRIGHT_CHROMIUM_EXECUTABLE), servir la página y simular `GET /api/catalogo/repositorios`.
 * Sin servidor, sin red ni coste. `ANADIR_UI_CAPTURAS=<carpeta>` guarda una captura de cada paso para mirarlas.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { ASIGNACION_FONDOS } from "../../../../src/lib/catalogo/asignacion-fondos";
import { MANIFIESTOS } from "../../../../src/lib/catalogo/manifiestos";
import { RUTA_REPOSITORIOS, type RespuestaRepositorios } from "../../../../src/lib/catalogo/repositorios-api-tipos";
import { construirRespuestaRepositorios } from "../../../../src/lib/catalogo/repositorios-publicos";
import type { IdRepositorio } from "../../../../src/lib/catalogo/tipos";
import { FONDOS_CATALOGO } from "../../../../src/lib/globos3d/fondos-escenografia";

const RAIZ = path.resolve(__dirname, "..", "..", "..", "..");
/** Un origen seguro (localhost): sin él el navegador no ofrece el portapapeles. */
const ORIGEN = "http://localhost:47831";
const CAPTURAS = process.env.ANADIR_UI_CAPTURAS?.trim();
/** Donde el taller guarda lo del usuario (`Biblioteca.tsx`). */
const CLAVE_PROPIA = "taller3d:biblioteca-propia:v1";

export const TODOS: readonly IdRepositorio[] = ["sempertex", "mobiliario", "escenografia"];

/** Los nombres de las tarjetas de un repositorio de fondos, según la asignación del registro (sin la mesa con sillas a medida). */
export const nombresDe = (repositorio: "mobiliario" | "escenografia") => new Set(FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === repositorio).map((f) => f.nombre));

const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Las tarjetas que tiene que dejar una búsqueda dentro de un repositorio: las que traen todas sus palabras en el nombre o la descripción (otro oráculo que el del panel). */
export function esperadasPor(repositorio: "mobiliario" | "escenografia", busqueda: string): string[] {
  const palabras = sinTildes(busqueda).split(/\s+/).filter(Boolean);
  return FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === repositorio && palabras.every((p) => sinTildes(`${f.nombre} ${f.descripcion}`).includes(p))).map((f) => f.nombre);
}

type Ventana = { __montarAnadir: (opciones: { movil: boolean }) => void; __montarLista: () => void };

/** Lo que responde la ruta: los repositorios (`lectura`) o un fallo HTTP. */
export type Lectura = { tipo: "respuesta"; cuerpo: RespuestaRepositorios } | { tipo: "error"; estado: number };

export const lectura = (visibles: readonly IdRepositorio[] = TODOS, ui = true): Lectura => ({
  tipo: "respuesta", cuerpo: construirRespuestaRepositorios({ manifiestos: Object.values(MANIFIESTOS), visibles, ui }),
});

/** `errores`: los de la página y los `console.error`; `avisos`: los `console.warn`; `pedidas`: las URL de todo lo que pidió la página. */
export type Taller = { page: Page; errores: string[]; avisos: string[]; pedidas: string[]; lecturas: () => number; cerrar: () => Promise<void> };

let navegador: Browser;
let bundle = "";
let css = "";
/** Los contextos abiertos por la prueba en curso: `cerrarContextos` (el `afterEach` de cada archivo) los cierra aunque la prueba falle a medias. */
const abiertos: BrowserContext[] = [];

/** Empaqueta el arnés (con el motor de la biblioteca falso), compila el CSS y abre el navegador. Va en el `before` de cada prueba. */
export async function iniciarNavegador(): Promise<void> {
  const resultado = await build({
    entryPoints: [path.join(__dirname, "arnes.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    alias: { "@": path.join(RAIZ, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "motor-de-biblioteca-falso",
      setup: (b) => b.onResolve({ filter: /(^|\/)biblioteca-cliente$/ }, () => ({ path: path.join(__dirname, "biblioteca-cliente-falsa.ts") })),
    }],
  });
  bundle = resultado.outputFiles[0]!.text;
  const globals = path.join(RAIZ, "src", "app", "globals.css");
  css = (await postcss([tailwind({ base: RAIZ })]).process(readFileSync(globals, "utf8"), { from: globals })).css;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  navegador = await chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
}

export async function cerrarNavegador(): Promise<void> {
  await cerrarContextos();
  await navegador?.close();
}

export async function cerrarContextos(): Promise<void> {
  await Promise.all(abiertos.splice(0).map((contexto) => contexto.close().catch(() => undefined)));
}

/** Una página con el arnés cargado (todavía sin montar) y `/api/catalogo/repositorios` respondiendo `respuesta`. `movil`: 390 × 844 con el dedo. */
async function nuevaPagina(movil: boolean, respuesta: Lectura, propios: readonly unknown[] = []): Promise<Taller> {
  const contexto: BrowserContext = await navegador.newContext(movil
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 900 } });
  abiertos.push(contexto);
  await contexto.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEN });
  const page = await contexto.newPage();
  page.setDefaultTimeout(30_000);
  const errores: string[] = [];
  const avisos: string[] = [];
  const pedidas: string[] = [];
  page.on("pageerror", (error) => errores.push(`pageerror: ${error}`));
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error" && !/Failed to load resource/.test(mensaje.text())) errores.push(`console: ${mensaje.text().slice(0, 300)}`);
    if (mensaje.type() === "warning") avisos.push(mensaje.text());
  });
  page.on("request", (peticion) => pedidas.push(peticion.url()));
  if (propios.length > 0) await page.addInitScript(([clave, json]) => window.localStorage.setItem(clave!, json!), [CLAVE_PROPIA, JSON.stringify(propios)]);
  let leidas = 0;
  await page.route(`${ORIGEN}/**`, (ruta) => {
    const { pathname } = new URL(ruta.request().url());
    if (pathname === RUTA_REPOSITORIOS) {
      leidas += 1;
      return respuesta.tipo === "respuesta"
        ? ruta.fulfill({ contentType: "application/json", body: JSON.stringify(respuesta.cuerpo) })
        : ruta.fulfill({ status: respuesta.estado, contentType: "application/json", body: JSON.stringify({ error: "no" }) });
    }
    if (pathname === "/arnes.js") return ruta.fulfill({ contentType: "text/javascript", body: bundle });
    if (pathname === "/estilos.css") return ruta.fulfill({ contentType: "text/css", body: css });
    if (pathname.startsWith("/api/")) return ruta.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return ruta.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/estilos.css"></head><body class="min-h-dvh font-sans"><div id="raiz"></div><script src="/arnes.js"></script></body></html>' });
  });
  await page.goto(`${ORIGEN}/`);
  return { page, errores, avisos, pedidas, lecturas: () => leidas, cerrar: () => contexto.close() };
}

/** El taller del arnés con el panel «Añadir» y `/api/catalogo/repositorios` respondiendo `lectura`. `movil`: 390 × 844 con el dedo y la hoja inferior. */
export async function abrir(opciones: { movil?: boolean; lectura?: Lectura; propios?: readonly unknown[] } = {}): Promise<Taller> {
  const movil = opciones.movil ?? false;
  const respuesta = opciones.lectura ?? lectura();
  const taller = await nuevaPagina(movil, respuesta, opciones.propios);
  const { page } = taller;
  const leida = page.waitForResponse((r) => r.url().endsWith(RUTA_REPOSITORIOS));
  await page.evaluate((m) => (window as unknown as Ventana).__montarAnadir({ movil: m }), movil);
  await page.locator("#anadir-buscar").waitFor();
  await leida;
  if (respuesta.tipo === "respuesta" && respuesta.cuerpo.ui && respuesta.cuerpo.repositorios.filter((r) => r.visible).length > 1) await selector(page).waitFor();
  else if (respuesta.tipo === "respuesta" && respuesta.cuerpo.ui) await page.getByRole("tablist", { name: "Qué añadir" }).waitFor();
  return taller;
}

/** La lista de compra (`TablaProductos`) de una escena con sillas, mesas, un sofá, un panel y una base de pastel, y la ficha de una idea de Sempertex. */
export async function abrirLista(lecturaDeLosRepositorios: Lectura): Promise<Taller> {
  const taller = await nuevaPagina(false, lecturaDeLosRepositorios);
  const leida = taller.page.waitForResponse((r) => r.url().endsWith(RUTA_REPOSITORIOS));
  await taller.page.evaluate(() => (window as unknown as Ventana).__montarLista());
  await taller.page.getByRole("region", { name: "Productos" }).waitFor();
  await leida;
  return taller;
}

export async function capturar(page: Page, nombre: string): Promise<void> {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) });
}

export const selector = (page: Page): Locator => page.getByRole("group", { name: "Repositorio" });
export const opcion = (page: Page, nombre: string): Locator => selector(page).getByRole("button", { name: new RegExp(`^${nombre}\\b`) });
export const pestanas = (page: Page): Locator => page.getByRole("tablist", { name: "Qué añadir" }).getByRole("tab");
export const escena = (page: Page): Promise<string[]> => page.getByTestId("escena").locator("li").allInnerTexts();
export const tarjetasDe = (seccion: Locator): Locator => seccion.locator("button[title]");
export const contador = (page: Page): Promise<string | null> => page.locator("#anadir-buscar").locator("xpath=..").locator("[aria-live=polite]").getAttribute("aria-label");

/** Elige un repositorio (con el ratón, o con `tocar`) y espera a que el selector lo marque. */
export async function elegir(page: Page, nombre: string, tocar: (l: Locator) => Promise<void> = (l) => l.click()): Promise<void> {
  await tocar(opcion(page, nombre));
  await page.waitForFunction((n) => [...document.querySelectorAll("[role=group][aria-label=Repositorio] button")].some((b) => b.getAttribute("aria-pressed") === "true" && (b.textContent ?? "").startsWith(n)), nombre);
}

/** Las cuentas del selector: «Mobiliario» → 27. */
export async function cuentas(page: Page): Promise<Record<string, number>> {
  const botones = await selector(page).getByRole("button").evaluateAll((bs) => bs.map((b) => [b.querySelector("span")?.textContent ?? "", Number(b.querySelectorAll("span")[1]?.textContent)] as const));
  return Object.fromEntries(botones);
}
