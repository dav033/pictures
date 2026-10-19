import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext } from "playwright";
import postcss from "postcss";

const ROOT = path.resolve(__dirname, "..", "..");
const ORIGIN = "http://taller-reentrada.test";
const DISTANCIA_MINIMA = 0.05;
const ASSERTIONS = [
  "Primera montura: la cámara queda encuadrada, a más de 0.05 unidades del objetivo.",
  "Reentrada: tras ocultar y mostrar el Taller3D dentro de React Activity, la cámara conserva un encuadre válido.",
  "Órbita: un arrastre cambia la cámara; en viewport táctil usa un dedo.",
  "Pérdida de contexto: WEBGL_lose_context muestra un aviso con reintento y reconstruye la escena encuadrada.",
  "Destruir: al desmontar, los contextos WebGL creados quedan liberados.",
  "Cobertura: escritorio y viewport táctil 390x844.",
];

type Mode = "base" | "fixed";
type CameraReading = { posicion: { x: number; y: number; z: number }; objetivo: { x: number; y: number; z: number }; distancia: number };
type HarnessWindow = Window & {
  __montarTallerReentrada: () => void;
  __ocultarTallerReentrada: () => void;
  __mostrarTallerReentrada: () => void;
  __visor3d?: { camara: () => CameraReading | null };
};

const fixtures = [
  { nombre: "escritorio", width: 1280, height: 900, isMobile: false, hasTouch: false },
  { nombre: "táctil 390x844", width: 390, height: 844, isMobile: true, hasTouch: true },
] as const;

function argumento(): Mode | "list" {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1, `Argumentos inesperados: ${args.join(" ")}`);
  if (args[0] === "--listar-aserciones") return "list";
  if (args[0] === "--base") return "base";
  assert.ok(args.length === 0, `Uso: npm run taller:test-reentrada-ui -- [--base|--listar-aserciones]`);
  return "fixed";
}

async function crearBundle(): Promise<{ javascript: string; css: string }> {
  const resultado = await build({
    entryPoints: [path.join(__dirname, "fixtures", "taller-reentrada", "arnes.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "development" } };' },
    alias: { "@": path.join(ROOT, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const globals = path.join(ROOT, "src", "app", "globals.css");
  const css = await postcss([tailwind({ base: ROOT })]).process(readFileSync(globals, "utf8"), { from: globals });
  return { javascript: resultado.outputFiles[0]!.text, css: css.css };
}

async function montarPagina(browser: Browser, viewport: typeof fixtures[number], javascript: string, css: string): Promise<{ context: BrowserContext; page: import("playwright").Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __contextos: WebGLRenderingContext[] };
    w.__contextos = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      const contexto = (original as (...a: unknown[]) => unknown).apply(this, args);
      if (contexto && /webgl/.test(String(args[0])) && !w.__contextos.includes(contexto as WebGLRenderingContext)) w.__contextos.push(contexto as WebGLRenderingContext);
      return contexto;
    } as typeof original;
  });
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(`${ORIGIN}/**`, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: javascript });
    if (pathname === "/estilos.css") return route.fulfill({ contentType: "text/css", body: css });
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/estilos.css"></head><body><div id="raiz"></div><script src="/arnes.js"></script></body></html>' });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => typeof (window as HarnessWindow).__montarTallerReentrada === "function", undefined, { timeout: 5_000 })
    .catch(() => { throw new Error(`El arnés no cargó: ${errors.join("; ") || "sin errores de página"}`); });
  await page.evaluate(() => (window as HarnessWindow).__montarTallerReentrada());
  return { context, page, errors };
}

async function esperarCamara(page: import("playwright").Page, presente: boolean): Promise<CameraReading | null> {
  await page.waitForFunction((wantCamera) => {
    const reading = (window as HarnessWindow).__visor3d?.camara() ?? null;
    return wantCamera ? reading !== null : reading === null;
  }, presente);
  return page.evaluate(() => (window as HarnessWindow).__visor3d?.camara() ?? null);
}

async function arrastrarCamara(page: import("playwright").Page, tactil: boolean): Promise<CameraReading> {
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible" });
  const bounds = await canvas.boundingBox();
  assert.ok(bounds && bounds.width > 20 && bounds.height > 20, "el lienzo real del visor tiene tamaño para interactuar");
  const x = bounds.x + bounds.width * 0.5;
  const y = bounds.y + bounds.height * 0.5;
  if (tactil) {
    const sesion = await page.context().newCDPSession(page);
    try {
      await sesion.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
      for (let paso = 1; paso <= 8; paso += 1) {
        await sesion.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (100 * paso) / 8, y: y + (65 * paso) / 8, id: 0 }],
        });
      }
      await sesion.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await sesion.detach();
    }
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 65, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  return (await page.evaluate(() => (window as HarnessWindow).__visor3d?.camara() ?? null))!;
}

async function probarPerdidaDeContexto(page: import("playwright").Page, nombre: string): Promise<void> {
  const antes = await esperarCamara(page, true);
  assert.ok(antes, `${nombre}: cámara antes de perder el contexto`);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext;
    gl.getExtension("WEBGL_lose_context")!.loseContext();
  });
  const aviso = page.getByRole("alert");
  await aviso.waitFor({ state: "visible" });
  const boton = aviso.getByRole("button", { name: /reintentar/i });
  await boton.waitFor({ state: "visible" });
  await boton.click();
  await aviso.waitFor({ state: "detached" });
  const despues = await esperarCamara(page, true);
  assert.ok(despues && despues.distancia > DISTANCIA_MINIMA, `${nombre}: escena reconstruida y encuadrada (${despues?.distancia})`);
  await page.evaluate(() => (window as HarnessWindow).__ocultarTallerReentrada());
  await esperarCamara(page, false);
  const perdidos = await page.evaluate(() => (window as unknown as { __contextos: WebGLRenderingContext[] }).__contextos.map((c) => c.isContextLost()));
  assert.ok(perdidos.length > 0 && perdidos.every(Boolean), `${nombre}: contextos liberados al destruir (${perdidos.join(",")})`);
  console.log(`${nombre}: pérdida de contexto recuperada, ${perdidos.length} contexto(s) liberados`);
}

async function probar(browser: Browser, mode: Mode, viewport: typeof fixtures[number], javascript: string, css: string): Promise<void> {
  const { context, page, errors } = await montarPagina(browser, viewport, javascript, css);
  try {
    const inicio = await esperarCamara(page, true);
    assert.ok(inicio && inicio.distancia > DISTANCIA_MINIMA, `${viewport.nombre}: primera montura encuadrada (${inicio?.distancia ?? "sin cámara"})`);
    await page.evaluate(() => (window as HarnessWindow).__ocultarTallerReentrada());
    await esperarCamara(page, false);
    await page.evaluate(() => (window as HarnessWindow).__mostrarTallerReentrada());
    const reentrada = await esperarCamara(page, true);
    assert.ok(reentrada, `${viewport.nombre}: hay una cámara registrada tras reentrada`);

    if (mode === "base") {
      assert.ok(reentrada.distancia <= DISTANCIA_MINIMA, `${viewport.nombre}: el modo base reproduce el radio casi cero (${reentrada.distancia})`);
      console.log(`${viewport.nombre}: inicial=${inicio.distancia.toFixed(4)}, reentrada=${reentrada.distancia.toFixed(6)} (fallo base reproducido)`);
    } else {
      const despuesDelArrastre = await arrastrarCamara(page, viewport.hasTouch);
      const delta = Math.hypot(
        despuesDelArrastre.posicion.x - reentrada.posicion.x,
        despuesDelArrastre.posicion.y - reentrada.posicion.y,
        despuesDelArrastre.posicion.z - reentrada.posicion.z,
      );
      console.log(`${viewport.nombre}: encuadre=${reentrada.distancia > DISTANCIA_MINIMA ? "sí" : "no"}, órbita=${delta.toFixed(4)}`);
      const failedAssertions = [
        ...(reentrada.distancia > DISTANCIA_MINIMA ? [] : [`cámara encuadrada después de reentrar (${reentrada.distancia})`]),
        ...(delta > 0.01 ? [] : [`el arrastre mueve la cámara (${delta})`]),
      ];
      assert.deepEqual(failedAssertions, [], `${viewport.nombre}: aserciones fallidas: ${failedAssertions.join("; ")}`);
      console.log(`${viewport.nombre}: inicial=${inicio.distancia.toFixed(4)}, reentrada=${reentrada.distancia.toFixed(4)}, órbita=${delta.toFixed(4)}`);
    }
    if (mode === "fixed") await probarPerdidaDeContexto(page, viewport.nombre);
    assert.deepEqual(errors.filter((e) => !/WebGL|context|contexto|\[3d\]/i.test(e)), [], `${viewport.nombre}: errores de página`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const mode = argumento();
  if (mode === "list") {
    for (const assertion of ASSERTIONS) console.log(`- ${assertion}`);
    return;
  }
  const { javascript, css } = await crearBundle();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
  try {
    for (const viewport of fixtures) await probar(browser, mode, viewport, javascript, css);
    console.log(mode === "base" ? "OK: el arnés reproduce el defecto en ambas vistas." : "OK: encuadre y órbita verificados en ambas vistas.");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
