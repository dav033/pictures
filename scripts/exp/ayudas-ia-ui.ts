/**
 * Ayudas de los e2e del taller 3D con Playwright para el panel de la IA (D-021): la IA vive en la pestaña «IA» del panel derecho
 * (caja `#ia-pedido`), su respuesta llega por flujo NDJSON (líneas fase, paso y final) y mientras trabaja «Enviar» es «Detener».
 */
import type { Page, Response } from "playwright";

/** El cuerpo de una respuesta de `/api/escena-ia`: el de siempre (JSON) o el `final` de un flujo NDJSON. */
export async function cuerpoDeRespuesta(r: Response): Promise<unknown> {
  const texto = await r.text().catch(() => "");
  if (!(r.headers()["content-type"] ?? "").includes("ndjson")) { try { return JSON.parse(texto) as unknown; } catch { return {}; } }
  for (const linea of texto.split("\n").reverse()) {
    try {
      const evento = JSON.parse(linea) as { tipo?: string; cuerpo?: unknown };
      if (evento.tipo === "final") return evento.cuerpo ?? {};
    } catch { /* línea cortada: se sigue con la anterior */ }
  }
  return {};
}

/** Abre la pestaña «IA» del panel derecho (en el teléfono, la de la hoja) y espera la caja del pedido. */
export async function abrirIA(pagina: Page): Promise<void> {
  const pestana = pagina.getByRole("tab", { name: /IA/ });
  if (await pestana.count()) await pestana.click({ timeout: 120_000 });
  else await pagina.getByRole("navigation", { name: "Secciones" }).getByRole("button", { name: /IA/ }).click({ timeout: 120_000 });
  await pagina.waitForSelector("#ia-pedido", { timeout: 120_000 });
}

/** ¿La IA está trabajando (pidiendo o comparando con la foto)? */
export const trabajando = async (pagina: Page): Promise<boolean> =>
  (await pagina.locator('button[aria-label="Detener"], article[aria-label="Comparando con la foto"]').count()) > 0;

/** Lo que dice ahora el panel sobre la comparación con la foto («Comparando con la foto… ronda 1/2»), o vacío. */
export const textoComparando = (pagina: Page): Promise<string> =>
  pagina.locator('article[aria-label="Comparando con la foto"]').innerText({ timeout: 500 }).then((t) => t.replace(/\s+/g, " ").trim(), () => "");

/** El hilo de la conversación como texto (lo que dijo la IA, sus cambios y su «Deshacer turno»). */
export const textoDelHilo = (pagina: Page): Promise<string> => pagina.locator('[role="log"]').innerText().catch(() => "");
