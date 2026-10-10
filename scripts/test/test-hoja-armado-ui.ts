/**
 * La «Hoja de armado» del Taller 3D en un navegador de verdad (Chromium de Playwright, o Chrome con
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE), por el camino de la persona: «Lista de compra» → «Hoja de armado» → «Imprimir». Sin
 * servidor, sin red ni coste: se empaqueta con esbuild `DialogoCompra` (lo que monta `Taller3D`: la lista en un `<dialog>`
 * nativo modal y la hoja en un diálogo de Radix), el CSS es `globals.css` compilado con Tailwind (con sus reglas de impresión)
 * y la bandera (`/api/taller/hoja-armado`) se simula.
 *
 * El fallo que cuida: la hoja montada DENTRO de la lista (un `<dialog>` abierto con `showModal()`) queda inerte por la capa
 * superior del navegador y «Imprimir» no responde. Playwright no hace clic en lo que está inerte o tapado.
 *
 *   npm run taller:test-hoja-armado-ui   (o npx tsx scripts/test/test-hoja-armado-ui.ts). No va en CI: necesita Chrome.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";
import { chromium, type Browser, type Page } from "playwright";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "../../src/lib/globos3d/biblioteca";
import type { Escena } from "../../src/lib/globos3d/escena";
import { RUTA_HOJA_ARMADO, type LecturaHojaArmado } from "../../src/lib/taller/hoja-armado-bandera-tipos";

const RAIZ = path.resolve(__dirname, "..", "..");
const ORIGEN = "http://arnes.test";
/** Una escena pequeña con globos de aire y de helio: la hoja sale en pocas páginas y dice «de helio». */
const IDEA = "idea:olla-embrujada";

/** Lo que el arnés deja en `window` (`fixtures/hoja-armado-ui/arnes.tsx`). */
type Ventana = { __montarHoja: (nombre: string, escena: Escena) => void; __impresiones: number };

let navegador: Browser;
let bundle = "";
let css = "";

before(async () => {
  const resultado = await build({
    entryPoints: [path.join(__dirname, "fixtures", "hoja-armado-ui", "arnes.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    alias: { "@": path.join(RAIZ, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  bundle = resultado.outputFiles[0]!.text;
  const globals = path.join(RAIZ, "src", "app", "globals.css");
  css = (await postcss([tailwind({ base: RAIZ })]).process(readFileSync(globals, "utf8"), { from: globals })).css;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  navegador = await chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
});

after(async () => {
  await navegador?.close();
});

/** El taller del arnés con la escena de `IDEA`, y la bandera respondiendo `activa`. */
async function abrirTaller(activa: boolean): Promise<{ page: Page; errores: string[]; cerrar: () => Promise<void> }> {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexto.newPage();
  page.setDefaultTimeout(15_000);
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(String(error)));
  await page.route(`${ORIGEN}/**`, (ruta) => {
    const { pathname } = new URL(ruta.request().url());
    if (pathname === RUTA_HOJA_ARMADO) return ruta.fulfill({ contentType: "application/json", body: JSON.stringify({ activa, fuente: "ajuste" } satisfies LecturaHojaArmado) });
    if (pathname === "/arnes.js") return ruta.fulfill({ contentType: "text/javascript", body: bundle });
    if (pathname === "/estilos.css") return ruta.fulfill({ contentType: "text/css", body: css });
    return ruta.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="/estilos.css"></head><body class="flex min-h-dvh flex-col font-sans"><div id="raiz"></div><script src="/arnes.js"></script></body></html>' });
  });
  const lectura = page.waitForResponse((r) => r.url().endsWith(RUTA_HOJA_ARMADO));
  await page.goto(`${ORIGEN}/`);
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === IDEA)!;
  await page.evaluate(([nombre, escena]) => (window as unknown as Ventana).__montarHoja(nombre, escena), [item.nombre ?? IDEA, escenaDeItem(item)] as const);
  await lectura;
  return { page, errores, cerrar: () => contexto.close() };
}

async function abrirLista(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Lista de compra" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: /Copiar la lista/ }).waitFor();
}

const botonHoja = (page: Page) => page.locator("dialog[open]").getByRole("button", { name: "Hoja de armado" });

test("con la bandera apagada, la lista de compra no lleva el botón «Hoja de armado»", async () => {
  const { page, errores, cerrar } = await abrirTaller(false);
  await abrirLista(page);
  assert.equal(await botonHoja(page).count(), 0);
  assert.deepEqual(errores, []);
  await cerrar();
});

test("lista → hoja → imprimir: la hoja se abre fuera de la lista, «Imprimir» recibe el clic, se imprime solo la hoja y se vuelve a la lista", async () => {
  const { page, errores, cerrar } = await abrirTaller(true);
  await abrirLista(page);
  await botonHoja(page).click();

  const hoja = page.getByRole("dialog", { name: "Hoja de armado" });
  await hoja.locator("[data-pagina]").first().waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 0, "la lista se cierra: ningún <dialog> modal deja la hoja inerte");
  const paginas = await hoja.locator("[data-pagina]").count();
  assert.ok(paginas >= 2, `${paginas} páginas`);
  assert.match(await hoja.innerText(), /de helio/);

  const imprimir = hoja.getByRole("button", { name: "Imprimir" });
  assert.equal(await imprimir.evaluate((boton) => boton.closest("[inert]") !== null), false, "«Imprimir» no está inerte");
  await imprimir.click({ timeout: 5_000 });
  assert.equal(await page.evaluate(() => (window as unknown as Ventana).__impresiones), 1, "el clic llega y llama a window.print()");

  await page.emulateMedia({ media: "print" });
  const visibles = await page.evaluate(() => [...document.body.children]
    .filter((el) => !el.classList.contains("hoja-armado-dialogo") && getComputedStyle(el).display !== "none")
    .map((el) => el.tagName.toLowerCase()));
  assert.deepEqual(visibles, [], "al imprimir se oculta todo menos la hoja");
  assert.ok(await hoja.isVisible());
  for (const format of ["Letter", "A4"] as const) {
    const pdf = await page.pdf({ format, printBackground: true });
    const hojasDePapel = (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    assert.equal(hojasDePapel, paginas, `${format}: una hoja de papel por página de la hoja`);
  }
  await page.emulateMedia({ media: "screen" });

  await hoja.getByRole("button", { name: "Cerrar hoja de armado" }).click();
  await botonHoja(page).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Hoja de armado" }).count(), 0);

  // Con Esc también se vuelve a la lista.
  await botonHoja(page).click();
  await hoja.waitFor();
  await page.keyboard.press("Escape");
  await botonHoja(page).waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.deepEqual(errores, []);
  await cerrar();
});

/** El texto del elemento con el foco («BODY» si no lo tiene nadie). */
const conFoco = (page: Page) => page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement.textContent?.trim() ?? "" : "BODY"));

test("con el teclado: lista → hoja → Esc → Esc devuelve el foco al botón que abrió la lista", async () => {
  const { page, errores, cerrar } = await abrirTaller(true);
  await page.getByRole("button", { name: "Lista de compra" }).focus();
  await page.keyboard.press("Enter");
  await botonHoja(page).waitFor();
  await botonHoja(page).focus();
  await page.keyboard.press("Enter");
  const hoja = page.getByRole("dialog", { name: "Hoja de armado" });
  await hoja.waitFor();
  await page.keyboard.press("Escape");
  await botonHoja(page).waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement !== null);
  assert.equal(await page.locator("dialog[open]").count(), 0, "la lista se cerró");
  assert.equal(await conFoco(page), "Lista de compra", "el foco vuelve al botón que abrió la lista");
  // La vuelta sencilla (sin pasar por la hoja) también deja el foco en el botón.
  await page.keyboard.press("Enter");
  await botonHoja(page).waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  assert.equal(await conFoco(page), "Lista de compra");
  assert.deepEqual(errores, []);
  await cerrar();
});
