/**
 * Captura de la escena con la cámara de la foto, sin cabeza (REQ-001 paso 9): abre la página interna `/3d/captura` de un
 * servidor de desarrollo con Playwright y le pide `window.__capturarFoto(escena, encuadre)`, que es el mismo código que usa
 * el taller en el navegador para «Comparando con la foto…». Sin red externa ni gasto.
 *
 *   npx next dev -p 3014     # en otra terminal (con node_modules enlazado, Turbopack pide `turbopack.root` en next.config.ts)
 */
import { chromium, type Browser, type Page } from "playwright";
import type { Escena } from "../../src/lib/globos3d/escena";
import type { Encuadre } from "../../src/lib/globos3d/encuadre-foto";
import type { FotoAdjuntaIA } from "../../src/lib/globos3d/cuerpo-escena-ia";

type VentanaCaptura = { __capturarFoto?: (escena: Escena, encuadre: Encuadre) => Promise<FotoAdjuntaIA> };

export type CapturadorSinCabeza = { capturar: (escena: Escena, encuadre: Encuadre) => Promise<FotoAdjuntaIA>; cerrar: () => Promise<void> };

const TIEMPO_MS = 120_000;

async function abrirNavegador(): Promise<Browser> {
  // Con la GPU (Direct3D 11) es varias veces más rápido que por software; si no está, SwiftShader. Primero el Chromium de Playwright.
  const args = ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"];
  try { return await chromium.launch({ headless: true, args }); } catch { return chromium.launch({ headless: true, channel: "chrome", args }); }
}

export async function abrirCapturador(urlBase: string): Promise<CapturadorSinCabeza> {
  const navegador = await abrirNavegador();
  let pagina: Page | null = null;
  const abrirPagina = async (): Promise<Page> => {
    const nueva = await navegador.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    nueva.setDefaultTimeout(TIEMPO_MS);
    await nueva.goto(`${urlBase.replace(/\/$/, "")}/3d/captura`, { waitUntil: "load", timeout: TIEMPO_MS });
    await nueva.waitForFunction(() => typeof (window as VentanaCaptura).__capturarFoto === "function", undefined, { timeout: TIEMPO_MS });
    return nueva;
  };
  return {
    async capturar(escena, encuadre) {
      pagina ??= await abrirPagina();
      try {
        return await pagina.evaluate(([e, enc]) => (window as VentanaCaptura).__capturarFoto!(e as Escena, enc as Encuadre), [escena, encuadre] as const);
      } catch (error) {
        // Una página que falló no se reutiliza.
        await pagina.close().catch(() => undefined);
        pagina = null;
        throw error;
      }
    },
    async cerrar() { await pagina?.close().catch(() => undefined); await navegador.close().catch(() => undefined); },
  };
}
