/**
 * Auditoría táctil del Taller en un teléfono de verdad (Chromium de Playwright a 390x844, con táctil). Sin servidor, sin red,
 * sin base de datos ni .env: se empaqueta con esbuild el `Taller3D` real (como `test-ui-taller-reentrada.ts`), el CSS es
 * `globals.css` compilado con Tailwind y cualquier otra ruta responde vacía.
 *
 *   npm run taller:test-movil-ui -- [--rutas taller,asistente,cotizacion] [--informe|--autoprueba|--listar-checks|--validar-pendientes] [--solo <check>]
 *
 * Sin banderas es estricto (sale 1 si hay violaciones). `--informe` lista las violaciones y sale 0 si la auditoría corrió;
 * si no pudo correr sale 2. `--autoprueba` valida el evaluador estricto con un fixture propio. Variable opcional:
 * TALLER_MOVIL_SALIDA (carpeta de las capturas; por defecto, el directorio temporal del sistema).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const LIENZO_MIN: Readonly<Record<Altura, number>> = { cerrada: 0.7, media: 0.4, alta: 0.14 };

const CHECKS = [
  ["primer-render", "El Taller3D real monta a 390x844 con táctil, con lienzo y sin errores de página."],
  ["hoja", "La hoja inferior alcanza sus tres alturas (cerrada, media, alta) y se guarda una captura de cada una."],
  ["objetivos", `Todo control visible mide al menos ${OBJETIVO_MIN}x${OBJETIVO_MIN} px.`],
  ["hover", "Ningún control depende de :hover para verse (opacidad ~0 en reposo)."],
  ["desborde", "Nada se sale del ancho del teléfono ni hay desplazamiento horizontal."],
  ["lienzo", "El lienzo conserva una parte mínima de la pantalla sobre la hoja en cada altura."],
  ["texto", `Texto de al menos ${TEXTO_MIN} px y campos de al menos ${CAMPO_MIN} px (sin zoom automático).`],
  ["arrastre", "El asa sigue el dedo y el gesto ajusta por velocidad o por la altura más cercana."],
  ["movimiento-reducido", "La hoja cambia de altura sin transición cuando se prefiere movimiento reducido."],
  ["desplazamiento-camara", "La cámara centra la escena en el área visible sobre la hoja en cada altura."],
] as const;
type Check = (typeof CHECKS)[number][0];
export type Ruta = "taller" | "asistente" | "cotizacion";
const RUTAS: Readonly<Record<Ruta, { ruta: string; fixture: string }>> = {
  taller: { ruta: "/3d", fixture: "taller-movil" },
  asistente: { ruta: "/asistente", fixture: "asistente-movil" },
  cotizacion: { ruta: "/cotizacion-compartida/[token]", fixture: "cotizacion-compartida-movil" },
};
const PENDIENTES = path.join(__dirname, "fixtures", "movil-pendientes.json");

export type Violacion = { ruta?: Ruta; check: Check; altura: Altura | "fixture"; selector: string; detalle: string };
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

export async function crearBundle(ruta: Ruta, root = ROOT, instrumentarCamara = true): Promise<{ javascript: string; css: string }> {
  const resultado = await build({
    entryPoints: [path.join(root, "scripts", "test", "fixtures", RUTAS[ruta].fixture, "arnes.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "development" } };' },
    alias: { "@": path.join(root, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: instrumentarCamara ? [{
      name: "movil-camera-observation",
      setup(buildApi) {
        buildApi.onLoad({ filter: /[\\/]escena-globos\.ts$/ }, (args) => {
          const original = readFileSync(args.path, "utf8");
          const target = "    camara.updateProjectionMatrix();\n  }\n  function tapadoAbajo(px: number)";
          if (!original.includes(target)) throw new Error("No se encontró el punto de observación del desplazamiento de cámara.");
          const instrumentado = original.replace(target,
            "    camara.updateProjectionMatrix();\n    ;(globalThis as typeof globalThis & { __tallerMovilCapturarCamara?: (tapado: number, vista: unknown) => void }).__tallerMovilCapturarCamara?.(tapado, camara.view);\n  }\n  function tapadoAbajo(px: number)");
          return { contents: instrumentado, loader: "tsx" };
        });
      },
    }] : [],
  });
  const globals = path.join(root, "src", "app", "globals.css");
  const cssUi = path.join(root, "src", "components", "ui", "icon-button.css");
  const cssFuenteOriginal = readFileSync(globals, "utf8");
  const cssFuente = existsSync(cssUi)
    ? cssFuenteOriginal.replace('@import "../components/ui/icon-button.css";', readFileSync(cssUi, "utf8"))
    : cssFuenteOriginal;
  const css = await postcss([tailwind({ base: root })]).process(cssFuente, { from: globals });
  return { javascript: resultado.outputFiles[0]!.text, css: css.css };
}

export async function abrirRuta(browser: Browser, ruta: Ruta, javascript: string, css: string): Promise<{ page: Page; errores: string[]; cerrar: () => Promise<void> }> {
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
    if (pathname === RUTAS[ruta].ruta.replace("[token]", "fixture-movil")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/estilos.css"></head><body><div id="raiz"></div><script src="/arnes.js"></script></body></html>' });
    if (pathname === "/3d" && ruta === "taller") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/estilos.css"></head><body><div id="raiz"></div><script src="/arnes.js"></script></body></html>' });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  const rutaPagina = RUTAS[ruta].ruta.replace("[token]", "fixture-movil");
  await page.goto(`${ORIGEN}${rutaPagina}`);
  await page.waitForFunction(() => typeof (window as unknown as { __montarMovil?: unknown }).__montarMovil === "function", undefined, { timeout: 5_000 })
    .catch(() => { throw new Error(`El arnés no cargó: ${errores.join("; ") || "sin errores de página"}`); });
  await page.evaluate(() => {
    const w = window as typeof window & { __tallerMovilObservaciones?: { tapado: number; vista: { enabled: boolean; fullWidth: number; fullHeight: number; offsetY: number; width: number; height: number } | null }[]; __tallerMovilCapturarCamara?: (tapado: number, vista: unknown) => void };
    w.__tallerMovilObservaciones = [];
    w.__tallerMovilCapturarCamara = (tapado, vista) => {
      const v = vista as { enabled?: boolean; fullWidth?: number; fullHeight?: number; offsetY?: number; width?: number; height?: number } | null;
      w.__tallerMovilObservaciones?.push({ tapado, vista: v ? { enabled: v.enabled === true, fullWidth: v.fullWidth ?? 0, fullHeight: v.fullHeight ?? 0, offsetY: v.offsetY ?? 0, width: v.width ?? 0, height: v.height ?? 0 } : null });
    };
  });
  await page.evaluate(() => (window as unknown as { __montarMovil: () => void }).__montarMovil());
  if (ruta === "taller") {
    await page.locator("canvas").first().waitFor({ state: "attached" });
    await page.locator('section[aria-label="Paneles del taller"]').waitFor();
  }
  await page.waitForTimeout(900);
  return { page, errores, cerrar: () => context.close() };
}

export async function ponerAltura(page: Page, objetivo: Altura): Promise<number> {
  const hoja = page.locator('section[aria-label="Paneles del taller"]');
  const asa = hoja.locator('[role=button][tabindex="0"]').first();
  const alto = async () => Math.round((await hoja.boundingBox())!.height);
  for (let i = 0; i < 4; i++) {
    const altoMedio = ALTO * 0.45, altoAlta = ALTO * 0.85, actual = await alto();
    const actualNombre: Altura = Math.abs(actual - altoAlta) < 8 ? "alta" : Math.abs(actual - altoMedio) < 8 ? "media" : actual < ALTO * 0.2 ? "cerrada" : "media";
    if (actualNombre === objetivo) return actual;
    await asa.focus();
    await page.keyboard.press(ALTURAS.indexOf(objetivo) > ALTURAS.indexOf(actualNombre) ? "ArrowUp" : "ArrowDown");
    await page.waitForTimeout(450);
  }
  return alto();
}

const SELECTOR_HOJA = 'section[aria-label="Paneles del taller"]';
const SELECTOR_ASA = `${SELECTOR_HOJA} [role=button][tabindex="0"]`;

export async function arrastrarTactil(page: Page, movimientos: { dy: number; espera: number }[], alIniciar?: () => Promise<void>, alMover?: () => Promise<void>): Promise<void> {
  const caja = await page.locator(SELECTOR_ASA).boundingBox();
  if (!caja) throw new Error("El asa de la hoja no tiene caja táctil.");
  const x = caja.x + caja.width / 2, inicioY = caja.y + caja.height / 2;
  const sesion = await page.context().newCDPSession(page);
  try {
    await sesion.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: inicioY }] });
    await alIniciar?.();
    let acumulado = 0;
    for (const [indice, movimiento] of movimientos.entries()) {
      acumulado += movimiento.dy;
      if (movimiento.espera > 0) await page.waitForTimeout(movimiento.espera);
      await sesion.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: inicioY + acumulado }] });
      if (indice === 0) await alMover?.();
    }
    await sesion.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await sesion.detach();
  }
}

function fallo(check: Check, altura: Altura | "fixture", detalle: string): Violacion {
  return { check, altura, selector: SELECTOR_HOJA, detalle };
}

async function auditarArrastre(page: Page): Promise<Violacion[]> {
  const violaciones: Violacion[] = [];
  await ponerAltura(page, "media");
  const hoja = page.locator(SELECTOR_HOJA);
  let antesLento = 0;
  let durante = antesLento;
  await arrastrarTactil(page, [{ dy: -40, espera: 0 }, { dy: -1, espera: 320 }], async () => {
    antesLento = (await hoja.boundingBox())!.height;
  }, async () => {
    await page.waitForTimeout(30);
    durante = (await hoja.boundingBox())!.height;
  });
  if (Math.abs(durante - (antesLento + 40)) > 5) violaciones.push(fallo("arrastre", "media", `el dedo subió 40px pero la hoja cambió ${Math.round(durante - antesLento)}px`));
  await page.waitForTimeout(450);
  const lento = (await hoja.boundingBox())!.height;
  if (!esperadoAlto("media")(lento)) violaciones.push(fallo("arrastre", "media", `la suelta lenta terminó en ${Math.round(lento)}px; debía elegir el escalón más cercano (media)`));

  await ponerAltura(page, "media");
  await arrastrarTactil(page, [{ dy: -30, espera: 15 }, { dy: -60, espera: 15 }]);
  await page.waitForTimeout(450);
  const rapido = (await hoja.boundingBox())!.height;
  if (!esperadoAlto("alta")(rapido)) violaciones.push(fallo("arrastre", "alta", `el flick hacia arriba terminó en ${Math.round(rapido)}px; debía avanzar al escalón alto`));
  return violaciones;
}

async function auditarMovimientoReducido(page: Page): Promise<Violacion[]> {
  const violaciones: Violacion[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ponerAltura(page, "media");
  await page.locator(SELECTOR_ASA).focus();
  await page.keyboard.press("ArrowUp");
  const muestras = await page.evaluate(async (selector) => {
    const hoja = document.querySelector(selector);
    if (!(hoja instanceof HTMLElement)) throw new Error("No se encontró la hoja al muestrear movimiento reducido.");
    const alto: number[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      alto.push(hoja.getBoundingClientRect().height);
    }
    return { alto, transicion: getComputedStyle(hoja).transitionProperty, reduccion: matchMedia("(prefers-reduced-motion: reduce)").matches };
  }, SELECTOR_HOJA);
  const rango = Math.max(...muestras.alto) - Math.min(...muestras.alto);
  if (!muestras.reduccion || muestras.transicion !== "none" || rango > 0.5 || !esperadoAlto("alta")(muestras.alto.at(-1) ?? 0)) {
    violaciones.push(fallo("movimiento-reducido", "alta", `prefers-reduced-motion=${muestras.reduccion}, transition-property=${muestras.transicion}, rango muestreado=${rango.toFixed(1)}px en ${muestras.alto.length} cuadros`));
  }
  return violaciones;
}

async function auditarDesplazamientoCamara(page: Page): Promise<Violacion[]> {
  const violaciones: Violacion[] = [];
  for (const altura of ALTURAS) {
    await ponerAltura(page, altura);
    await page.waitForTimeout(100);
    type EstadoCamara = {
      tapado: number;
      vista: { enabled: boolean; fullWidth: number; fullHeight: number; offsetY: number; width: number; height: number } | null;
      ancho: number;
      alto: number;
    };
    const estadoHandle = await page.waitForFunction<EstadoCamara | false, string>((selector) => {
      const hoja = document.querySelector(selector)?.getBoundingClientRect();
      const canvas = document.querySelector("canvas")?.getBoundingClientRect();
      const observaciones = (window as typeof window & { __tallerMovilObservaciones?: { tapado: number; vista: { enabled: boolean; fullWidth: number; fullHeight: number; offsetY: number; width: number; height: number } | null }[] }).__tallerMovilObservaciones ?? [];
      if (!hoja || !canvas) return false;
      const tapado = Math.max(0, window.innerHeight - hoja.top);
      const ultima = observaciones.at(-1);
      return ultima && Math.abs(ultima.tapado - tapado) < 1 ? { tapado, vista: ultima.vista, ancho: canvas.width, alto: canvas.height } : false;
    }, SELECTOR_HOJA, { timeout: 2_000 });
    const estado = await estadoHandle.jsonValue();
    if (estado === false) throw new Error("La cámara no produjo una observación estable durante la auditoría.");
    const vista = estado.vista;
    const coincide = vista?.enabled && Math.abs(vista.offsetY - estado.tapado / 2) < 1 && Math.abs(vista.fullWidth - estado.ancho) < 1 && Math.abs(vista.fullHeight - estado.alto) < 1 && Math.abs(vista.width - estado.ancho) < 1 && Math.abs(vista.height - estado.alto) < 1;
    if (!coincide) violaciones.push(fallo("desplazamiento-camara", altura, `hoja tapa ${Math.round(estado.tapado)}px; viewOffset observado ${vista ? `y=${vista.offsetY}, ${vista.width}x${vista.height}/${vista.fullWidth}x${vista.fullHeight}` : "desactivado"}`));
  }
  return violaciones;
}

function esperadoAlto(a: Altura): ((h: number) => boolean) {
  if (a === "cerrada") return (h) => h < ALTO * 0.2;
  const f = a === "media" ? 0.45 : 0.85;
  return (h) => Math.abs(h - ALTO * f) <= 8;
}

type Resultado = { violaciones: Violacion[]; resumen: string[] };

async function auditarRuta(ruta: Ruta, solo: Check | null, salida: string): Promise<Resultado> {
  const corre = (c: Check) => solo === null || solo === c;
  const { javascript, css } = await crearBundle(ruta);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
  const violaciones: Violacion[] = [];
  const resumen: string[] = [];
  try {
    const { page, errores, cerrar } = await abrirRuta(browser, ruta, javascript, css);
    try {
      if (corre("primer-render")) {
        const lienzo = ruta === "taller" ? await page.locator("canvas").first().boundingBox() : null;
        const tactil = await page.evaluate(() => navigator.maxTouchPoints > 0);
        const problemas = [
          ...(ruta === "taller" && !(lienzo && lienzo.width > 20 && lienzo.height > 20) ? ["el lienzo no tiene tamaño"] : []),
          ...(ruta !== "taller" && !(await page.locator("#raiz").locator(":scope > *").count()) ? ["la página no montó contenido"] : []),
          ...(tactil ? [] : ["el contexto no es táctil"]),
          ...errores.map((e) => `error de página: ${e.slice(0, 160)}`),
        ];
        for (const p of problemas) violaciones.push({ check: "primer-render", altura: "media", selector: "página", detalle: p });
        resumen.push(`${ruta} primer-render: ${ruta === "taller" ? `lienzo ${lienzo ? `${Math.round(lienzo.width)}x${Math.round(lienzo.height)}` : "ausente"}` : "contenido montado"}, ${errores.length} errores`);
      }
      mkdirSync(salida, { recursive: true });
      const alturas: readonly Altura[] = ruta === "taller" ? ALTURAS : ["media"];
      for (const altura of alturas) {
        const alto = ruta === "taller" ? await ponerAltura(page, altura) : 0;
        const captura = path.join(salida, `${ruta}-movil-${altura}.png`);
        await page.screenshot({ path: captura });
        resumen.push(`${ruta}: captura ${altura}${ruta === "taller" ? `, hoja ${alto}px` : ""} → ${captura}`);
        if (ruta === "taller" && corre("hoja") && !esperadoAlto(altura)(alto)) violaciones.push({ check: "hoja", altura, selector: 'section[aria-label="Paneles del taller"]', detalle: `alto ${alto}px no corresponde a «${altura}»` });
        const datos = await page.evaluate(medirPagina);
        for (const x of evaluar(datos, ruta === "taller" ? altura : "fixture")) if (corre(x.check) && (ruta === "taller" || (x.check !== "lienzo" && x.check !== "hoja"))) violaciones.push(x);
      }
      if (ruta === "taller" && corre("arrastre")) {
        violaciones.push(...await auditarArrastre(page));
        resumen.push("taller: asa táctil comprobada durante el gesto, tras la suelta lenta y tras el flick rápido");
      }
      if (ruta === "taller" && corre("movimiento-reducido")) {
        violaciones.push(...await auditarMovimientoReducido(page));
        resumen.push("taller: 20 cuadros muestreados con prefers-reduced-motion");
      }
      if (ruta === "taller" && corre("desplazamiento-camara")) {
        violaciones.push(...await auditarDesplazamientoCamara(page));
        resumen.push("taller: viewOffset comparado con la obstrucción real de la hoja en sus tres alturas");
      }
    } finally {
      await cerrar();
    }
  } finally {
    await browser.close();
  }
  return { violaciones: violaciones.map((violacion) => ({ ...violacion, ruta })), resumen };
}

type Pendiente = { route: Ruta; selector: string; size: string; cause: string; urgency: string; complexity: string };

function cargarPendientes(): Pendiente[] {
  const data: unknown = JSON.parse(readFileSync(PENDIENTES, "utf8"));
  if (!Array.isArray(data)) throw new Error(`${PENDIENTES}: se esperaba una lista`);
  const keys = ["route", "selector", "size", "cause", "urgency", "complexity"] as const;
  const vistos = new Set<string>();
  for (const [i, valor] of data.entries()) {
    if (typeof valor !== "object" || valor === null || keys.some((key) => typeof (valor as Record<string, unknown>)[key] !== "string" || !(valor as Record<string, string>)[key].trim())) {
      throw new Error(`${PENDIENTES}[${i}]: cada entrada requiere route, selector, size, cause, urgency y complexity no vacíos`);
    }
    const item = valor as Pendiente;
    if (!(item.route in RUTAS)) throw new Error(`${PENDIENTES}[${i}]: ruta desconocida «${item.route}»`);
    const clave = `${item.route}\0${item.selector}\0${item.size}`;
    if (vistos.has(clave)) throw new Error(`${PENDIENTES}[${i}]: entrada duplicada ${item.route} ${item.selector} ${item.size}`);
    vistos.add(clave);
  }
  return data as Pendiente[];
}

function aceptarPendiente(v: Violacion, pendientes: readonly Pendiente[]): boolean {
  return pendientes.some((p) => p.route === v.ruta && p.selector === v.selector && v.detalle.includes(p.size));
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

type Opciones = { modo: "estricto" | "informe" | "autoprueba" | "listar" | "validar-pendientes"; solo: Check | null; rutas: Ruta[] };
function leerArgumentos(args: string[]): Opciones {
  const nombres = CHECKS.map(([n]) => n as string);
  const rutasDisponibles = Object.keys(RUTAS) as Ruta[];
  let modo: Opciones["modo"] = "estricto";
  let solo: Check | null = null;
  let rutas = ["taller"] as Ruta[];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--informe") modo = "informe";
    else if (a === "--autoprueba") modo = "autoprueba";
    else if (a === "--listar-checks") modo = "listar";
    else if (a === "--validar-pendientes") modo = "validar-pendientes";
    else if (a === "--rutas" || a.startsWith("--rutas=")) {
      const valor = a === "--rutas" ? args[++i] : a.slice("--rutas=".length);
      if (!valor) throw new Error(`--rutas necesita una lista separada por comas: ${rutasDisponibles.join(",")}`);
      rutas = valor.split(",").map((nombre) => nombre.trim()).filter(Boolean) as Ruta[];
      const desconocidas = rutas.filter((nombre) => !rutasDisponibles.includes(nombre));
      if (!rutas.length || desconocidas.length) throw new Error(`Rutas desconocidas: ${desconocidas.join(", ") || valor}. Usa: ${rutasDisponibles.join(", ")}`);
      rutas = [...new Set(rutas)];
    }
    else if (a === "--solo" || a.startsWith("--solo=")) {
      const valor = a === "--solo" ? args[++i] : a.slice("--solo=".length);
      if (!valor || !nombres.includes(valor)) throw new Error(`--solo necesita uno de: ${nombres.join(", ")}`);
      solo = valor as Check;
    } else throw new Error(`Argumento desconocido: ${a}. Uso: --rutas <lista> | --informe | --autoprueba | --listar-checks | --validar-pendientes | --solo <check>`);
  }
  return { modo, solo, rutas };
}

async function main(): Promise<number> {
  const { modo, solo, rutas } = leerArgumentos(process.argv.slice(2));
  if (modo === "listar") {
    for (const [nombre, descripcion] of CHECKS) console.log(`${nombre}\t${descripcion}`);
    return 0;
  }
  if (modo === "autoprueba") { await autoprueba(); return 0; }
  if (modo === "validar-pendientes") {
    const pendientes = cargarPendientes();
    console.log(`Lista de pendientes válida: ${pendientes.length} entradas completas.`);
    return 0;
  }
  const salida = process.env.TALLER_MOVIL_SALIDA?.trim() || path.join(os.tmpdir(), "taller-movil-ui");
  const resultados = await Promise.all(rutas.map((ruta) => auditarRuta(ruta, solo, salida)));
  const violaciones = resultados.flatMap((resultado) => resultado.violaciones);
  for (const resultado of resultados) for (const linea of resultado.resumen) console.log(linea);
  for (const v of violaciones) console.log(`VIOLACIÓN [${v.ruta}][${v.check}] (${v.altura}) ${v.selector}: ${v.detalle}`);
  console.log(`${violaciones.length} violaciones${solo ? ` (solo ${solo})` : ""}.`);
  if (modo === "informe") return 0;
  const pendientes = cargarPendientes();
  const fueraDeLista = violaciones.filter((violacion) => !aceptarPendiente(violacion, pendientes));
  if (fueraDeLista.length) console.log(`${fueraDeLista.length} violaciones fuera de movil-pendientes.json.`);
  return fueraDeLista.length === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then((codigo) => { process.exitCode = codigo; }, (error: unknown) => {
    console.error(error);
    process.exitCode = 2;
  });
}
