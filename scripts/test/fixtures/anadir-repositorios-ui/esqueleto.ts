/**
 * El «esqueleto» del panel «Añadir» en el navegador: la estructura que importa de cada pestaña (etiquetas, roles, rótulos
 * accesibles y títulos de cada sección), sin clases, estilos ni dibujos, pero con el contador de resultados y cuántos botones (tarjetas) hay en cada sección: una tarjeta nueva en el catálogo cambia las huellas y se regeneran a propósito (`ANADIR_UI_HUELLAS=1` las imprime). Es lo que `test-anadir-repositorios-ui.ts`
 * fija para la marcha atrás: si el panel con la interfaz apagada deja de ser el de antes, el esqueleto cambia.
 */
import { createHash } from "node:crypto";
import type { Page } from "playwright";

const LEER = () => {
  const raiz = document.querySelector("aside[aria-label='Panel Añadir'], section[aria-label='Paneles del taller']");
  if (!raiz) return [];
  const filas: string[] = [];
  for (const el of raiz.querySelectorAll("[role], [aria-label], h2, h3, h4, input, select, textarea, section")) {
    if (el.getAttribute("role") === "img") continue;
    const partes = [el.tagName.toLowerCase()];
    for (const atributo of ["role", "aria-label", "id", "type", "aria-selected", "aria-pressed", "aria-controls", "aria-labelledby"]) {
      const valor = el.getAttribute(atributo);
      if (valor !== null) partes.push(`${atributo}=${valor}`);
    }
    if (/^H[1-4]$/.test(el.tagName)) partes.push(`«${(el.textContent ?? "").replace(/\s+/g, " ").trim()}»`);
    if (el.tagName === "SECTION" || el.getAttribute("role") === "tabpanel") partes.push(`botones=${el.querySelectorAll("button").length}`);
    filas.push(partes.join(" "));
  }
  return filas;
};

/** El esqueleto cuando deja de cambiar (la clasificación de la biblioteca se carga aparte): dos lecturas iguales seguidas. */
export async function esqueletoEstable(page: Page): Promise<string[]> {
  let anterior = "";
  for (let intento = 0; intento < 40; intento += 1) {
    const filas = await page.evaluate(LEER);
    const texto = filas.join("\n");
    if (texto === anterior && filas.length > 0) return filas;
    anterior = texto;
    await page.waitForTimeout(250);
  }
  throw new Error("el panel no se estabiliza");
}

export const huellaDeEsqueleto = (filas: readonly string[]): string => createHash("sha256").update(filas.join("\n")).digest("hex");
