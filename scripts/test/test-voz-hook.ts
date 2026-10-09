/**
 * `useDictado` en un navegador de verdad (Chromium de Playwright, con micrófono, grabadora, Web Audio y red falsos), sin red ni coste:
 *   npx tsx scripts/test/test-voz-hook.ts
 * No hay jsdom en el repo: se empaqueta el hook con esbuild y se corre con el reloj de Playwright, que lo controla sin esperas.
 * Cubre: el orden y la liberación del micrófono, cancelar en cada fase, desmontar a mitad de un pedido, la guarda de turno (una
 * respuesta tardía no escribe), el corte automático, Esc (solo si nadie lo atendió antes), y los errores de micrófono y de red.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import type { Dictado } from "../../src/components/voz/useDictado";
import type { EstadoFalso } from "./fixtures/voz-hook/falsos";

const RAIZ = path.resolve(__dirname, "..", "..");

type Ventana = { __dictado: Dictado; __textos: string[]; __montar: () => void; __desmontar: () => void; __voz: EstadoFalso };

let pruebas = 0;
const fase = (page: Page) => page.locator("#fase").innerText();
const alternar = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__dictado.alternar());
const cancelar = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__dictado.cancelar());
const voz = (page: Page) => page.evaluate(() => {
  const v = (window as unknown as Ventana).__voz;
  return { orden: v.orden, pistas: v.pistasAbiertas, contextosCerrados: v.contextosCerrados, detenidas: v.grabadorasDetenidas, llamadas: v.llamadas.map((l) => ({ url: l.url, tipo: l.tipo, bytes: l.bytes, abortada: l.abortada })) };
});
const textos = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__textos);
const responder = (page: Page, indice: number, status: number, cuerpo: unknown) =>
  page.evaluate(([i, s, c]) => (window as unknown as Ventana).__voz.llamadas[i as number].responder(s as number, c), [indice, status, cuerpo] as const);

/** Empieza a grabar y deja correr el reloj lo bastante para pasar el mínimo de 0,4 s. */
async function grabar(page: Page, ms = 700) {
  await alternar(page);
  await page.clock.runFor(100);
  assert.equal(await fase(page), "grabando");
  await page.clock.runFor(ms);
}

async function prueba(nombre: string, bundle: string, fn: (page: Page) => Promise<void>, navegador: Awaited<ReturnType<typeof chromium.launch>>) {
  const contexto = await navegador.newContext();
  const page = await contexto.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.clock.install({ time: 1_760_000_000_000 });
  await page.goto("about:blank");
  await page.setContent('<div id="raiz"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as Ventana).__montar());
  await page.clock.runFor(50);
  await fn(page);
  assert.deepEqual(errores, [], "la página no lanzó errores");
  await contexto.close();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

async function principal() {
  const resultado = await build({
    entryPoints: [path.join(__dirname, "fixtures", "voz-hook", "arnes.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    alias: { "@": path.join(RAIZ, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const bundle = resultado.outputFiles[0].text;
  const navegador = await chromium.launch();
  try {
    await prueba("grabar y terminar: el contexto de audio nace antes de pedir el micrófono, el micrófono se suelta al parar y el texto llega una vez", bundle, async (page) => {
      await grabar(page);
      let v = await voz(page);
      assert.deepEqual(v.orden, ["contexto", "microfono"], "Web Audio se crea en el mismo toque, antes de esperar el permiso");
      assert.equal(v.pistas, 1);
      await alternar(page);
      await page.clock.runFor(50);
      assert.equal(await fase(page), "transcribiendo");
      v = await voz(page);
      assert.equal(v.pistas, 0, "el micrófono se suelta al parar, antes de la respuesta");
      assert.equal(v.contextosCerrados, 1);
      assert.equal(v.llamadas.length, 1);
      assert.equal(v.llamadas[0].url, "/api/voz/transcribir");
      assert.equal(v.llamadas[0].tipo, "audio/webm;codecs=opus");
      assert.ok(v.llamadas[0].bytes > 0);
      await responder(page, 0, 200, { texto: "pon la columna dorada" });
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:");
      assert.deepEqual(await textos(page), ["pon la columna dorada"]);
    }, navegador);

    await prueba("cancelar grabando: suelta el micrófono, no manda nada y no escribe", bundle, async (page) => {
      await grabar(page);
      await cancelar(page);
      await page.clock.runFor(50);
      const v = await voz(page);
      assert.equal(await fase(page), "reposo:");
      assert.equal(v.pistas, 0);
      assert.equal(v.llamadas.length, 0);
      assert.deepEqual(await textos(page), []);
    }, navegador);

    await prueba("cancelar mientras transcribe: aborta el pedido y la respuesta tardía no escribe (guarda de turno)", bundle, async (page) => {
      await grabar(page);
      await alternar(page);
      await page.clock.runFor(50);
      assert.equal(await fase(page), "transcribiendo");
      await cancelar(page);
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:");
      assert.equal((await voz(page)).llamadas[0].abortada, true);
      await responder(page, 0, 200, { texto: "tarde" });
      await page.clock.runFor(50);
      assert.deepEqual(await textos(page), []);
    }, navegador);

    await prueba("un dictado nuevo no recibe la respuesta del anterior cancelado", bundle, async (page) => {
      await grabar(page);
      await alternar(page);
      await page.clock.runFor(50);
      await cancelar(page);
      await grabar(page);
      await alternar(page);
      await page.clock.runFor(50);
      assert.equal((await voz(page)).llamadas.length, 2);
      await responder(page, 0, 200, { texto: "viejo" });
      await responder(page, 1, 200, { texto: "nuevo" });
      await page.clock.runFor(50);
      assert.deepEqual(await textos(page), ["nuevo"]);
    }, navegador);

    await prueba("desmontar a mitad del pedido: aborta, no deja pistas abiertas y no escribe ni lanza errores", bundle, async (page) => {
      await grabar(page);
      await alternar(page);
      await page.clock.runFor(50);
      await page.evaluate(() => (window as unknown as Ventana).__desmontar());
      await page.clock.runFor(50);
      const v = await voz(page);
      assert.equal(v.llamadas[0].abortada, true);
      assert.equal(v.pistas, 0);
      await responder(page, 0, 200, { texto: "con la pantalla ya cerrada" });
      await page.clock.runFor(50);
      assert.deepEqual(await textos(page), []);
    }, navegador);

    await prueba("desmontar grabando: suelta el micrófono y el contexto de audio", bundle, async (page) => {
      await grabar(page);
      assert.equal((await voz(page)).pistas, 1);
      await page.evaluate(() => (window as unknown as Ventana).__desmontar());
      await page.clock.runFor(50);
      const v = await voz(page);
      assert.equal(v.pistas, 0);
      assert.equal(v.contextosCerrados, 1);
      assert.equal(v.llamadas.length, 0);
    }, navegador);

    await prueba("corte automático a los 58,5 s: termina solo y manda lo grabado", bundle, async (page) => {
      await alternar(page);
      await page.clock.runFor(100);
      assert.equal(await fase(page), "grabando");
      await page.clock.runFor(57_000);
      assert.equal(await fase(page), "grabando", "a los 57 s todavía graba");
      await page.clock.runFor(2_500);
      assert.equal(await fase(page), "transcribiendo");
      const v = await voz(page);
      assert.equal(v.llamadas.length, 1);
      assert.equal(v.pistas, 0);
    }, navegador);

    await prueba("muy corto (menos de 0,4 s) → error, sin mandar nada", bundle, async (page) => {
      await alternar(page);
      await page.clock.runFor(100);
      await alternar(page);
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:muy_corto");
      assert.equal((await voz(page)).llamadas.length, 0);
    }, navegador);

    await prueba("Esc cancela mientras graba; si otro ya lo atendió (diálogo) no cancela", bundle, async (page) => {
      await page.evaluate(() => window.addEventListener("keydown", (e) => { if ((e.target as HTMLElement | null)?.id === "dialogo") e.preventDefault(); }));
      await grabar(page);
      await page.evaluate(() => { const d = document.createElement("div"); d.id = "dialogo"; document.body.append(d); d.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      await page.clock.runFor(50);
      assert.equal(await fase(page), "grabando", "Esc ya atendido por un diálogo: el dictado sigue");
      await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:");
      assert.equal((await voz(page)).pistas, 0);
    }, navegador);

    await prueba("sin permiso de micrófono → error claro, sin pistas ni contextos abiertos", bundle, async (page) => {
      await page.evaluate(() => { (window as unknown as Ventana).__voz.fallaMicrofono = "NotAllowedError"; });
      await alternar(page);
      await page.clock.runFor(100);
      assert.equal(await fase(page), "reposo:sin_permiso");
      const v = await voz(page);
      assert.equal(v.pistas, 0);
      assert.equal(v.contextosCerrados, 1);
    }, navegador);

    await prueba("sin conexión → no pide el micrófono; y el servidor ocupado (503) o sin sesión (401) se explican", bundle, async (page) => {
      await page.evaluate('Object.defineProperty(navigator, "onLine", { configurable: true, get: function () { return false; } })');
      await alternar(page);
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:sin_conexion");
      assert.deepEqual((await voz(page)).orden, []);
      await page.evaluate('Object.defineProperty(navigator, "onLine", { configurable: true, get: function () { return true; } })');
      await page.evaluate(() => (window as unknown as Ventana).__dictado.descartarError());
      await grabar(page);
      await alternar(page);
      await page.clock.runFor(50);
      await responder(page, 0, 503, { error: "ocupado", codigo: "ocupado" });
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:ocupado");
      await grabar(page);
      await alternar(page);
      await page.clock.runFor(50);
      await responder(page, 1, 401, { error: "Sesión requerida." });
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:sesion");
    }, navegador);

    await prueba("el servidor devuelve texto vacío (silencio) → «no se escuchó nada», sin escribir", bundle, async (page) => {
      await grabar(page);
      await alternar(page);
      await page.clock.runFor(50);
      await responder(page, 0, 200, { texto: "" });
      await page.clock.runFor(50);
      assert.equal(await fase(page), "reposo:no_se_entendio");
      assert.deepEqual(await textos(page), []);
    }, navegador);
  } finally {
    await navegador.close();
  }
  console.log(`\n[PASS] ${pruebas} pruebas de useDictado en el navegador`);
}

principal().catch((error) => {
  console.error(error);
  process.exit(1);
});
