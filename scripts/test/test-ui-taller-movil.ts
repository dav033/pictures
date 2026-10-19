/**
 * Auditoría táctil del Taller en un teléfono de verdad (Chromium de Playwright a 390x844, con táctil). Sin servidor, sin red,
 * sin base de datos ni .env: se empaqueta con esbuild el `Taller3D` real (como `test-ui-taller-reentrada.ts`), el CSS es
 * `globals.css` compilado con Tailwind y cualquier otra ruta responde vacía.
 *
 *   npm run taller:test-movil-ui -- [--informe|--autoprueba|--listar-checks] [--solo <check>]
 *
 * Sin banderas es estricto (sale 1 si hay violaciones). `--informe` lista las violaciones y sale 0 si la auditoría corrió;
 * si no pudo correr sale 2. `--autoprueba` valida el evaluador estricto con un fixture propio. Variable opcional:
 * TALLER_MOVIL_SALIDA (carpeta de las capturas; por defecto, el directorio temporal del sistema).
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";

const ROOT = path.resolve(__dirname, "..", "..");
const ORIGEN = "http://taller-movil.test";
const ANCHO = 390;
const ALTO = 844;
const OBJETIVO_MIN = 44;
const TEXTO_MIN = 11;
const CAMPO_MIN = 16;
/** tsx compila con keepNames: `medirPagina` viaja serializada y necesita `__name` en la página. */
const SHIM_NAME = "window.__name = (f) => f;";
const ALTURAS = ["cerrada", "media", "alta"] as const;
type Altura = (typeof ALTURAS)[number];
/** Parte mínima del alto del teléfono que debe quedar para el lienzo sobre la hoja. */
const LIENZO_MIN: Readonly<Record<Altura, number>> = { cerrada: 0.7, media: 0.4, alta: 0.15 };

const CHECKS = [
  ["primer-render", "El Taller3D real monta a 390x844 con táctil, con lienzo y sin errores de página."],
  ["hoja", "La hoja inferior alcanza sus tres alturas (cerrada, media, alta) y se guarda una captura de cada una."],
  ["objetivos", `Todo control visible mide al menos ${OBJETIVO_MIN}x${OBJETIVO_MIN} px.`],
  ["hover", "Ningún control depende de :hover para verse (opacidad ~0 en reposo)."],
  ["desborde", "Nada se sale del ancho del teléfono ni hay desplazamiento horizontal."],
  ["lienzo", "El lienzo conserva una parte mínima de la pantalla sobre la hoja en cada altura."],
  ["texto", `Texto de al menos ${TEXTO_MIN} px y campos de al menos ${CAMPO_MIN} px (sin zoom automático).`],
] as const;
type Check = (typeof CHECKS)[number][0];

export type Violacion = { check: Check; altura: Altura | "fixture"; selector: string; detalle: string };
type Medida = { selector: string; ancho: number; alto: number; opacidad: number; texto: number; esCampo: boolean };
type Datos = { medidas: Medida[]; fuera: { selector: string; ancho: number; alto: number }[]; scrollX: number; vw: number; lienzoVisible: number };

/** Evaluador estricto: función pura sobre lo medido en el navegador. */
export function evaluar(datos: Datos, altura: Violacion["altura"]): Violacion[] {
  const v: Violacion[] = [];
  const poner = (check: Check, selector: string, detalle: string) => v.push({ check, altura, selector, detalle });
  for (const m of datos.medidas) {
    const tam = `${Math.round(m.ancho)}x${Math.round(m.alto)}`;
    if (m.opacidad < 0.1) poner("hover", m.selector, `invisible en reposo (opacidad ${m.opacidad}), solo aparece con :hover; ${tam}`);
    else if (m.ancho < OBJETIVO_MIN || m.alto < OBJETIVO_MIN) poner("objetivos", m.selector, `${tam} px < ${OBJETIVO_MIN}x${OBJETIVO_MIN}`);
    if (m.texto > 0 && m.texto < (m.esCampo ? CAMPO_MIN : TEXTO_MIN)) poner("texto", m.selector, `fuente ${m.texto}px < ${m.esCampo ? CAMPO_MIN : TEXTO_MIN}px`);
  }
  for (const f of datos.fuera) poner("desborde", f.selector, `${Math.round(f.ancho)}x${Math.round(f.alto)} se sale del ancho ${datos.vw}px`);
  if (datos.scrollX > datos.vw) poner("desborde", "html", `scrollWidth ${datos.scrollX} > ${datos.vw}`);
  if (altura !== "fixture" && datos.lienzoVisible < LIENZO_MIN[altura]) poner("lienzo", "canvas", `visible ${(datos.lienzoVisible * 100).toFixed(0)}% < ${(LIENZO_MIN[altura] * 100).toFixed(0)}%`);
  return v;
}

/** Corre en la página: mide controles visibles, desbordes y la parte visible del lienzo. */
function medirPagina(): Datos {
  const sel = (el: Element): string => {
    const partes: string[] = [];
    for (let n: Element | null = el; n && n !== document.body && partes.length < 4; n = n.parentElement) {
      const etiqueta = n.getAttribute("aria-label");
      partes.unshift(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${etiqueta ? `[aria-label="${etiqueta}"]` : ""}`);
      if (n.id || etiqueta) break;
    }
    const texto = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    return partes.join(" > ") + (texto ? ` «${texto}»` : "");
  };
  const opacidad = (el: Element): number => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return Math.round(o * 100) / 100;
  };
  const vw = window.innerWidth, vh = window.innerHeight;
  const medidas: Medida[] = [];
  const interactivos = "button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=switch], [tabindex='0']";
  for (const el of document.querySelectorAll(interactivos)) {
    const estilo = getComputedStyle(el);
    if (estilo.display === "none" || estilo.visibility === "hidden" || estilo.pointerEvents === "none") continue;
    if ((el as HTMLInputElement).type === "hidden" || el.closest("[inert], [hidden]")) continue;
    let caja = el.getBoundingClientRect();
    const campo = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.closest("label") : null;
    if (campo) caja = campo.getBoundingClientRect();
    if (caja.width === 0 && caja.height === 0) continue;
    const esCampo = el instanceof HTMLInputElement ? !["checkbox", "radio", "range", "button", "submit"].includes(el.type) : el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    medidas.push({ selector: sel(el), ancho: caja.width, alto: caja.height, opacidad: opacidad(el), texto: Number.parseFloat(estilo.fontSize), esCampo });
  }
  const fuera: Datos["fuera"] = [];
  for (const el of document.querySelectorAll("body *")) {
    const estilo = getComputedStyle(el);
    if (estilo.display === "none" || estilo.visibility === "hidden" || el instanceof SVGElement || el.tagName === "CANVAS") continue;
    const c = el.getBoundingClientRect();
    if (c.width === 0 || c.height === 0 || (c.right <= vw + 1 && c.left >= -1)) continue;
    let recortado = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX !== "visible" && p.getBoundingClientRect().right <= vw + 1) { recortado = true; break; }
    }
    if (!recortado) fuera.push({ selector: sel(el), ancho: c.width, alto: c.height });
  }
  const lienzo = document.querySelector("canvas")?.getBoundingClientRect();
  const hoja = document.querySelector('section[aria-label="Paneles del taller"]')?.getBoundingClientRect();
  const visible = lienzo ? Math.max(0, Math.min(lienzo.bottom, hoja ? hoja.top : vh) - Math.max(lienzo.top, 0)) * Math.max(0, Math.min(lienzo.right, vw) - Math.max(lienzo.left, 0)) : 0;
  return { medidas, fuera: fuera.slice(0, 40), scrollX: document.documentElement.scrollWidth, vw, lienzoVisible: visible / (vw * vh) };
}

async function crearBundle(): Promise<{ javascript: string; css: string }> {
  const resultado = await build({
    entryPoints: [path.join(__dirname, "fixtures", "taller-movil", "arnes.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "development" } };' },
    alias: { "@": path.join(ROOT, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const globals = path.join(ROOT, "src", "app", "globals.css");
  const css = await postcss([tailwind({ base: ROOT })]).process(readFileSync(globals, "utf8"), { from: globals });
  return { javascript: resultado.outputFiles[0]!.text, css: css.css };
}

async function abrirTaller(browser: Browser, javascript: string, css: string): Promise<{ page: Page; errores: string[]; cerrar: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: ANCHO, height: ALTO }, isMobile: true, hasTouch: true });
  await context.addInitScript(SHIM_NAME);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push(m.text()); });
  await page.route(`${ORIGEN}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: javascript });
    if (pathname === "/estilos.css") return route.fulfill({ contentType: "text/css", body: css });
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/estilos.css"></head><body><div id="raiz"></div><script src="/arnes.js"></script></body></html>' });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${ORIGEN}/`);
  await page.waitForFunction(() => typeof (window as unknown as { __montarTallerMovil?: unknown }).__montarTallerMovil === "function", undefined, { timeout: 5_000 })
    .catch(() => { throw new Error(`El arnés no cargó: ${errores.join("; ") || "sin errores de página"}`); });
  await page.evaluate(() => (window as unknown as { __montarTallerMovil: () => void }).__montarTallerMovil());
  await page.locator("canvas").first().waitFor({ state: "attached" });
  await page.locator('section[aria-label="Paneles del taller"]').waitFor();
  await page.waitForTimeout(400);
  return { page, errores, cerrar: () => context.close() };
}

async function ponerAltura(page: Page, objetivo: Altura): Promise<number> {
  const hoja = page.locator('section[aria-label="Paneles del taller"]');
  const asa = hoja.locator('[role=button][tabindex="0"]').first();
  const alto = async () => Math.round((await hoja.boundingBox())!.height);
  for (let i = 0; i < 4; i++) {
    const altoMedio = ALTO * 0.44, altoAlta = ALTO * 0.78, actual = await alto();
    const actualNombre: Altura = Math.abs(actual - altoAlta) < 8 ? "alta" : Math.abs(actual - altoMedio) < 8 ? "media" : actual < ALTO * 0.2 ? "cerrada" : "media";
    if (actualNombre === objetivo) return actual;
    await asa.focus();
    await page.keyboard.press(ALTURAS.indexOf(objetivo) > ALTURAS.indexOf(actualNombre) ? "ArrowUp" : "ArrowDown");
    await page.waitForTimeout(250);
  }
  return alto();
}

function esperadoAlto(a: Altura): ((h: number) => boolean) {
  if (a === "cerrada") return (h) => h < ALTO * 0.2;
  const f = a === "media" ? 0.44 : 0.78;
  return (h) => Math.abs(h - ALTO * f) <= 8;
}

type Resultado = { violaciones: Violacion[]; resumen: string[] };

async function auditar(solo: Check | null, salida: string): Promise<Resultado> {
  const corre = (c: Check) => solo === null || solo === c;
  const { javascript, css } = await crearBundle();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
  const violaciones: Violacion[] = [];
  const resumen: string[] = [];
  try {
    const { page, errores, cerrar } = await abrirTaller(browser, javascript, css);
    try {
      if (corre("primer-render")) {
        const lienzo = await page.locator("canvas").first().boundingBox();
        const tactil = await page.evaluate(() => navigator.maxTouchPoints > 0);
        const problemas = [
          ...(lienzo && lienzo.width > 20 && lienzo.height > 20 ? [] : ["el lienzo no tiene tamaño"]),
          ...(tactil ? [] : ["el contexto no es táctil"]),
          ...errores.map((e) => `error de página: ${e.slice(0, 160)}`),
        ];
        for (const p of problemas) violaciones.push({ check: "primer-render", altura: "media", selector: "página", detalle: p });
        resumen.push(`primer-render: lienzo ${lienzo ? `${Math.round(lienzo.width)}x${Math.round(lienzo.height)}` : "ausente"}, ${errores.length} errores`);
      }
      mkdirSync(salida, { recursive: true });
      for (const altura of ALTURAS) {
        const alto = await ponerAltura(page, altura);
        const captura = path.join(salida, `taller-movil-${altura}.png`);
        await page.screenshot({ path: captura });
        resumen.push(`captura ${altura}: hoja ${alto}px → ${captura}`);
        if (corre("hoja") && !esperadoAlto(altura)(alto)) violaciones.push({ check: "hoja", altura, selector: 'section[aria-label="Paneles del taller"]', detalle: `alto ${alto}px no corresponde a «${altura}»` });
        const datos = await page.evaluate(medirPagina);
        for (const x of evaluar(datos, altura)) if (corre(x.check)) violaciones.push(x);
      }
    } finally {
      await cerrar();
    }
  } finally {
    await browser.close();
  }
  return { violaciones, resumen };
}

/** Fixture propio: un objetivo de 30 px y un control solo-hover deben marcarse; uno conforme, no. */
async function autoprueba(): Promise<void> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width: ANCHO, height: ALTO }, isMobile: true, hasTouch: true });
    await context.addInitScript(SHIM_NAME);
    const page = await context.newPage();
    const medir = async (cuerpo: string) => {
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><style>.c .oculto{opacity:0}.c:hover .oculto{opacity:1}button{font:16px sans-serif}</style><body>${cuerpo}</body>`);
      return evaluar(await page.evaluate(medirPagina), "fixture");
    };
    const chico = await medir('<button id="chico" style="width:30px;height:30px">x</button>');
    assert.ok(chico.some((v) => v.check === "objetivos" && v.selector.includes("#chico")), "no marcó el objetivo de 30 px");
    const hover = await medir('<div class="c"><button id="solohover" class="oculto" style="width:48px;height:48px">x</button></div>');
    assert.ok(hover.some((v) => v.check === "hover" && v.selector.includes("#solohover")), "no marcó el control solo-hover");
    const bueno = await medir('<button id="bueno" style="width:48px;height:48px">ok</button>');
    assert.deepEqual(bueno, [], `marcó un control conforme: ${JSON.stringify(bueno)}`);
    console.log("Autoprueba OK: marca 30 px y solo-hover; acepta el control de 48 px.");
    await context.close();
  } finally {
    await browser.close();
  }
}

type Opciones = { modo: "estricto" | "informe" | "autoprueba" | "listar"; solo: Check | null };
function leerArgumentos(args: string[]): Opciones {
  const nombres = CHECKS.map(([n]) => n as string);
  let modo: Opciones["modo"] = "estricto";
  let solo: Check | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--informe") modo = "informe";
    else if (a === "--autoprueba") modo = "autoprueba";
    else if (a === "--listar-checks") modo = "listar";
    else if (a === "--solo" || a.startsWith("--solo=")) {
      const valor = a === "--solo" ? args[++i] : a.slice("--solo=".length);
      if (!valor || !nombres.includes(valor)) throw new Error(`--solo necesita uno de: ${nombres.join(", ")}`);
      solo = valor as Check;
    } else throw new Error(`Argumento desconocido: ${a}. Uso: --informe | --autoprueba | --listar-checks | --solo <check>`);
  }
  return { modo, solo };
}

async function main(): Promise<number> {
  const { modo, solo } = leerArgumentos(process.argv.slice(2));
  if (modo === "listar") {
    for (const [nombre, descripcion] of CHECKS) console.log(`${nombre}\t${descripcion}`);
    return 0;
  }
  if (modo === "autoprueba") { await autoprueba(); return 0; }
  const salida = process.env.TALLER_MOVIL_SALIDA?.trim() || path.join(os.tmpdir(), "taller-movil-ui");
  const { violaciones, resumen } = await auditar(solo, salida);
  for (const linea of resumen) console.log(linea);
  for (const v of violaciones) console.log(`VIOLACIÓN [${v.check}] (${v.altura}) ${v.selector}: ${v.detalle}`);
  console.log(`${violaciones.length} violaciones${solo ? ` (solo ${solo})` : ""}.`);
  if (modo === "informe") return 0;
  return violaciones.length === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then((codigo) => { process.exitCode = codigo; }, (error: unknown) => {
    console.error(error);
    process.exitCode = 2;
  });
}
