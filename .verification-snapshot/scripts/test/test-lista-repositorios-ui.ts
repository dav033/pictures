/**
 * La lista de compra y la ficha por repositorio en un navegador de verdad — REQ-013 fase 5, T25. La lista de compra real
 * (`TablaProductos` con `productosDe` de una escena con sillas, mesas, un sofá, un panel y una base de pastel) con el hook de la
 * interfaz por repositorio, y la línea de procedencia de la ficha de una idea de Sempertex:
 * - encendida: «Mobiliario» y «Escenografía» por separado, también en el texto que se copia, y la ficha dice su repositorio y su licencia;
 * - marcha atrás (apagada o lectura caída): una sola sección «Escenografía» con todo, el texto de siempre y la ficha sin procedencia.
 * Misma infraestructura que `test-anadir-repositorios-ui.ts` (arnés real, sin servidor ni coste).
 *
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe" npx tsx scripts/test/test-lista-repositorios-ui.ts
 */
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import type { Page } from "playwright";
import { abrirLista, capturar, cerrarContextos, cerrarNavegador, iniciarNavegador, lectura, TODOS } from "./fixtures/anadir-repositorios-ui/navegador";

before(iniciarNavegador);
afterEach(cerrarContextos);
after(cerrarNavegador);

// ---------------------------------------------------------------------------------------------------------------------
// La lista de compra (T25) y la ficha
// ---------------------------------------------------------------------------------------------------------------------

/** Las líneas de la sección con ese título de la lista de compra. */
const lineasDe = (page: Page, titulo: RegExp) => page.getByRole("region", { name: "Productos" }).getByRole("heading", { name: titulo }).locator("xpath=following-sibling::ul[1]/li").allInnerTexts();
const copiada = async (page: Page) => {
  await page.getByRole("button", { name: /Copiar la lista/ }).click();
  await page.getByRole("button", { name: /Lista copiada/ }).waitFor();
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
};

test("lista de compra, encendido: las líneas de escenografía se reparten en Mobiliario y Escenografía, y el texto copiado también; la ficha dice su procedencia", async () => {
  const { page, errores, cerrar } = await abrirLista(lectura());
  await page.getByRole("heading", { name: /^Mobiliario/ }).waitFor();
  assert.deepEqual(await lineasDe(page, /^Mobiliario/), ["1 × Silla Tiffany (mobiliario)", "1 × Mesa redonda (mobiliario)", "1 × Sofá (mobiliario)"]);
  assert.deepEqual(await lineasDe(page, /^Escenografía/), ["1 × Panel redondo (escenografía)", "1 × Base de pastel (escenografía)"]);
  const texto = await copiada(page);
  assert.ok(texto.includes("\nMOBILIARIO (no es producto de la tienda)\n1 × Silla Tiffany\n1 × Mesa redonda\n1 × Sofá\n"), texto);
  assert.ok(texto.includes("\nESCENOGRAFÍA (no es producto de la tienda)\n1 × Panel redondo\n1 × Base de pastel"), texto);
  assert.match(await page.getByTestId("procedencia-item").innerText(), /^Repositorio: Sempertex v\S+ · licencia de la marca socia: Sempertex$/);
  await capturar(page, "10-lista-por-repositorio");
  assert.deepEqual(errores, []);
  await cerrar();
});

test("lista de compra, marcha atrás (apagada o lectura caída): una sola sección «Escenografía» con todo, el texto de siempre y la ficha sin procedencia", async () => {
  for (const marchaAtras of [lectura(TODOS, false), { tipo: "error", estado: 500 } as const]) {
    const { page, errores, cerrar } = await abrirLista(marchaAtras);
    await page.getByRole("heading", { name: /^Escenografía/ }).waitFor();
    assert.equal(await page.getByRole("region", { name: "Productos" }).getByRole("heading", { name: /^Mobiliario/ }).count(), 0);
    assert.deepEqual(await lineasDe(page, /^Escenografía/), [
      "1 × Silla Tiffany (escenografía)", "1 × Mesa redonda (escenografía)", "1 × Sofá (escenografía)", "1 × Panel redondo (escenografía)", "1 × Base de pastel (escenografía)",
    ]);
    const texto = await copiada(page);
    assert.ok(texto.includes("\nESCENOGRAFÍA (no es producto de la tienda)\n1 × Silla Tiffany\n1 × Mesa redonda\n1 × Sofá\n1 × Panel redondo\n1 × Base de pastel"), texto);
    assert.ok(!texto.includes("MOBILIARIO"));
    assert.equal(await page.getByTestId("procedencia-item").count(), 0);
    assert.deepEqual(errores, []);
    await cerrar();
  }
});

