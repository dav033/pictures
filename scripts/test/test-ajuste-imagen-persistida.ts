import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";

const root = path.resolve(__dirname, "../..");
const vistaPath = path.join(root, "src/components/guiado/VistaGuiada.tsx");
const origin = "http://ajuste-imagen.test";
const oldImage = "data:image/png;base64,b2xk";
const otherImage = "data:image/png;base64,b3RoZXI=";
const newImage = "data:image/png;base64,bmV3";
const plan = PlanGuiadoSchema.parse(JSON.parse(readFileSync(path.join(root, "scripts/test/fixtures/plan-guiado-columnas-repetidas.json"), "utf8")) as unknown);
const adjusted = PlanGuiadoSchema.parse({ ...plan, plan_hash: "a".repeat(64), plan: { ...plan.plan, concepto: { ...plan.plan.concepto, titulo: "Adjusted decoration" } } });
const queuedPlan = PlanGuiadoSchema.parse({ ...plan, plan_hash: "b".repeat(64) });

type Harness = {
  seed: (replaced?: boolean) => Promise<void>;
  adjust: (baseHash: string, messageId?: string) => boolean;
  adjustQueued: (mode: "hash" | "replaced" | "same-plan") => boolean;
  images: () => Promise<Record<string, string>>;
  visibleImages: () => Record<string, string>;
  saveNewImage: () => Promise<void>;
  hash: () => string;
  ready: boolean;
};
declare global {
  interface Window { __adjustment: Harness }
}

async function main() {
  const result = await build({
    stdin: {
      resolveDir: path.dirname(vistaPath), loader: "ts", sourcefile: "adjustment-image-harness.ts",
      contents: `
        import { createElement, StrictMode, useEffect, useState } from "react";
        import { createRoot } from "react-dom/client";
        import { usePublicarAjustePlan } from "./ajuste/publicar-ajuste-plan";
        import { planDelMensaje } from "./plan-del-mensaje";
        import { useDeshacerAjuste } from "./usarDeshacerAjuste";
        import { EstadoGuardadoSchema } from "./estado-guardado";
        import { guardarImagenNavegador, leerImagenesNavegador } from "./imagenes-navegador";
        const initialPlan = ${JSON.stringify(plan)};
        const adjustedPlan = ${JSON.stringify(adjusted)};
        const queuedPlan = ${JSON.stringify(queuedPlan)};
        function HarnessView() {
          const [mensajes, setMensajes] = useState(() => {
            const saved = sessionStorage.getItem("adjustment-test-session");
            return saved ? EstadoGuardadoSchema.parse(JSON.parse(saved)).mensajes : [];
          });
          const [imagenesLocales, setImagenesLocales] = useState({});
          const [ready, setReady] = useState(false);
          const [anuncio, setAnuncio] = useState("");
          const deshacerAjuste = useDeshacerAjuste();
          const publicar = usePublicarAjustePlan({
            mensajes, setMensajes, setImagenesLocales, setAnuncio,
            recordar: deshacerAjuste.recordar, decoracionDeLaConversacion: () => null,
          });
          useEffect(() => {
            sessionStorage.setItem("adjustment-test-session", JSON.stringify(EstadoGuardadoSchema.parse({ mensajes })));
          }, [mensajes]);
          useEffect(() => {
            void leerImagenesNavegador().then((images) => { setImagenesLocales(images); setReady(true); });
          }, []);
          window.__adjustment = {
            ready,
            seed: async (reemplazado = false) => {
              setMensajes([{ id: "plan-message", role: "assistant", content: "Plan", widgets: [{ tipo: "plan", plan: initialPlan, pasos: [], hechas: ["ver"], ...(reemplazado ? { reemplazado: true } : {}) }] }]);
              await guardarImagenNavegador("plan-message", ${JSON.stringify(oldImage)});
              await guardarImagenNavegador("other-message", ${JSON.stringify(otherImage)});
              setImagenesLocales(await leerImagenesNavegador());
            },
            adjust: (baseHash, id = "plan-message") => publicar(id, adjustedPlan, undefined, { descripcion: "A larger decoration", baseHash }),
            adjustQueued: (mode) => {
              setMensajes((current) => current.map((message) => ({ ...message, widgets: message.widgets.map((widget) => ({ ...widget, ...(mode === "replaced" ? { reemplazado: true } : { plan: mode === "same-plan" ? adjustedPlan : queuedPlan }) })) })));
              return publicar("plan-message", adjustedPlan, undefined, { descripcion: "A larger decoration", baseHash: initialPlan.plan_hash });
            },
            images: leerImagenesNavegador,
            visibleImages: () => imagenesLocales,
            saveNewImage: async () => {
              await guardarImagenNavegador("plan-message", ${JSON.stringify(newImage)});
              setImagenesLocales(await leerImagenesNavegador());
            },
            hash: () => planDelMensaje(mensajes[0])?.plan.plan_hash,
          };
          return createElement("div", { id: "announcement" }, anuncio);
        }
        window.addEventListener("DOMContentLoaded", () => {
          createRoot(document.querySelector("#root")).render(createElement(StrictMode, null, createElement(HarnessView)));
        }, { once: true });
      `,
    },
    bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent",
    alias: { "@": path.join(root, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined });
  let tests = 0;
  async function run(name: string, body: (page: Page) => Promise<void>) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(`${origin}/**`, (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.addInitScript({ content: result.outputFiles[0]!.text });
    try {
      await page.goto(origin);
      await page.waitForFunction(() => window.__adjustment?.ready);
      await body(page);
      assert.deepEqual(errors, []);
      tests += 1;
      console.log(`PASS ${name}`);
    } finally { await context.close(); }
  }
  try {
    for (const mode of ["hash", "replaced", "same-plan"] as const) {
      await run(`updater rejects queued ${mode} state without losing its valid image`, async (page) => {
        await page.evaluate(() => window.__adjustment.seed());
        await page.evaluate(() => window.__adjustment.saveNewImage());
        await page.evaluate((value) => window.__adjustment.adjustQueued(value), mode);
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(() => window.__adjustment.images()), { "plan-message": newImage, "other-message": otherImage });
        await page.reload();
        await page.waitForFunction(() => window.__adjustment?.ready);
        assert.equal(await page.evaluate(() => window.__adjustment.hash()), mode === "replaced" ? plan.plan_hash : mode === "same-plan" ? adjusted.plan_hash : queuedPlan.plan_hash);
        assert.deepEqual(await page.evaluate(() => window.__adjustment.visibleImages()), { "plan-message": newImage, "other-message": otherImage });
      });
    }
    await run("accepted adjustment removes only the old plan image across reload; a new image persists", async (page) => {
      await page.evaluate(() => window.__adjustment.seed());
      assert.equal(await page.evaluate((hash) => window.__adjustment.adjust(hash), plan.plan_hash), true);
      await page.waitForFunction(() => !("plan-message" in window.__adjustment.visibleImages()));
      assert.deepEqual(await page.evaluate(() => window.__adjustment.visibleImages()), { "other-message": otherImage });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const images = await page.evaluate(() => window.__adjustment.images());
        if (!("plan-message" in images)) break;
        await page.waitForTimeout(20);
      }
      assert.deepEqual(await page.evaluate(() => window.__adjustment.images()), { "other-message": otherImage });
      await page.reload();
      await page.waitForFunction(() => window.__adjustment?.ready);
      assert.equal(await page.evaluate(() => window.__adjustment.hash()), adjusted.plan_hash);
      assert.deepEqual(await page.evaluate(() => window.__adjustment.visibleImages()), { "other-message": otherImage });
      await page.evaluate(() => window.__adjustment.saveNewImage());
      await page.reload();
      await page.waitForFunction(() => window.__adjustment?.ready);
      assert.deepEqual(await page.evaluate(() => window.__adjustment.visibleImages()), { "plan-message": newImage, "other-message": otherImage });
    });
    for (const rejected of ["stale", "replaced", "missing"] as const) {
      await run(`${rejected} adjustment preserves the current image across reload`, async (page) => {
        await page.evaluate((replaced) => window.__adjustment.seed(replaced), rejected === "replaced");
        assert.equal(await page.evaluate(({ hash, id }) => window.__adjustment.adjust(hash, id), { hash: rejected === "stale" ? "stale-hash" : plan.plan_hash, id: rejected === "missing" ? "missing-message" : "plan-message" }), false);
        await page.reload();
        await page.waitForFunction(() => window.__adjustment?.ready);
        assert.equal(await page.evaluate(() => window.__adjustment.hash()), plan.plan_hash);
        assert.deepEqual(await page.evaluate(() => window.__adjustment.visibleImages()), { "plan-message": oldImage, "other-message": otherImage });
      });
    }
    console.log(`${tests}/7 adjustment image persistence tests passed`);
  } finally { await browser.close(); }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
