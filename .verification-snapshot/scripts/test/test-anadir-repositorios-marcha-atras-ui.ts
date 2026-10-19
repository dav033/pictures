/**
 * La marcha atrás del panel «Añadir» por repositorio en un navegador de verdad — REQ-013 fase 5, T26 (D-039: la interfaz por
 * repositorio nace encendida y «apagada» es solo la marcha atrás, que tiene que dejar el panel idéntico al de antes).
 * - con la interfaz apagada (`ui: false`) y con la lectura caída (HTTP 500 o 401): sin selector, las cuatro pestañas, en Utilería los 51
 *   fondos y muebles de siempre más la mesa con sillas a medida, sin procedencias, y el aviso de añadir sin procedencia;
 * - la estructura de cada pestaña (escritorio y hoja del teléfono) es la de `origin/main`: huellas del esqueleto del panel.
 * Misma infraestructura que `test-anadir-repositorios-ui.ts` (arnés real, sin servidor ni coste).
 *
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe" npx tsx scripts/test/test-anadir-repositorios-marcha-atras-ui.ts
 */
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { abrir, capturar, cerrarContextos, cerrarNavegador, iniciarNavegador, lectura, pestanas, selector, tarjetasDe, TODOS, type Taller } from "./fixtures/anadir-repositorios-ui/navegador";
import { esqueletoEstable, huellaDeEsqueleto } from "./fixtures/anadir-repositorios-ui/esqueleto";

before(iniciarNavegador);
afterEach(cerrarContextos);
after(cerrarNavegador);

// ---------------------------------------------------------------------------------------------------------------------
// La marcha atrás: el panel de siempre
// ---------------------------------------------------------------------------------------------------------------------

/** Lo que define el panel de antes: sin selector ni procedencias, las cuatro pestañas, y en Utilería los 51 de siempre y la mesa con sillas en sus cuatro grupos. */
async function comprobarPanelDeSiempre(taller: Taller): Promise<void> {
  const { page, errores } = taller;
  assert.equal(await selector(page).count(), 0, "sin selector");
  assert.deepEqual(await pestanas(page).allInnerTexts(), ["Estructuras", "Decoraciones", "Utilería", "Ideas"]);
  await pestanas(page).nth(2).click();
  const fondos = page.getByRole("region", { name: "Fondos y muebles" });
  await fondos.waitFor();
  assert.deepEqual(await fondos.locator("h4").allInnerTexts(), ["Fondos y tapetes", "Sillas y asientos", "Mesas", "Decorado de pie"]);
  assert.equal(await tarjetasDe(fondos).count(), 52);
  assert.equal(await page.getByTestId("procedencia-repositorio").count(), 0, "sin procedencias");
  const ayudas = await tarjetasDe(fondos).evaluateAll((bs) => bs.map((b) => b.getAttribute("title") ?? ""));
  assert.ok(ayudas.every((a) => !a.includes("licencia")), "ni en la ayuda de las tarjetas");
  await fondos.getByRole("button", { name: "Silla Tiffany" }).click();
  assert.match(await fondos.getByRole("status").innerText(), /^Listo: «Silla Tiffany» quedó en la escena\. Arrástralo para moverlo\.$/, "el aviso de antes, sin procedencia");
  assert.equal(await page.getByRole("button", { name: /^(Mobiliario|Escenografía)\b/ }).count(), 0);
  assert.deepEqual(errores, []);
}

test("marcha atrás: con la interfaz apagada (ui: false) el panel es el de siempre", async () => {
  const taller = await abrir({ lectura: lectura(TODOS, false) });
  assert.equal(taller.lecturas(), 1, "el panel pidió la ruta una sola vez y con eso decidió");
  await comprobarPanelDeSiempre(taller);
  await capturar(taller.page, "06-marcha-atras");
  await taller.cerrar();
});

/**
 * El dorado de la marcha atrás: la huella del esqueleto (`fixtures/anadir-repositorios-ui/esqueleto.ts`) de cada pestaña con la interfaz apagada,
 * en el escritorio y en la hoja del teléfono. Salen del panel de `origin/main` 8955d367: se montaron los dos paneles, el de entonces y este, con
 * el mismo arnés y se comprobó que su DOM era idéntico byte a byte antes de fijarlas. Si cambian a propósito (una tarjeta nueva en el catálogo cambia el contador y los botones por sección), el fallo imprime el esqueleto nuevo y `ANADIR_UI_HUELLAS=1` imprime las huellas.
 */
const DORADO_DE_LA_MARCHA_ATRAS: Readonly<Record<"escritorio" | "movil", ReadonlyArray<readonly [pestana: string, huella: string]>>> = {
  escritorio: [
    ["Estructuras", "10fa909933cc343240186362e18dbb3f16be180964574cb52869340b3d7cf41e"],
    ["Decoraciones", "f2f01adccd5728e3724389d502b9a6453de0fe1d4f8a6499bb315c8a653d612f"],
    ["Utilería", "51cafc401f43eeef6201671b2635bb4fa380fead30a59e7605081940f30771db"],
    ["Ideas", "6d199c7ae9fe0c356987c2403444d51c7009faa22c1cda45f98e20420b1ffa8d"],
  ],
  movil: [
    ["Estructuras", "583e7ea0a98c4f2dd9bfdebaf2258f4880fa047ef048bb87a06db6db74af0021"],
    ["Decoraciones", "00a2e204e1f97a8f4478e222960acd0e40f01ce5b14678a711fbca62aac5efbf"],
    ["Utilería", "9c5abf20b0ab8112f9a5e98f8d9db996b465bd124ca3530d9f79b89913011e6a"],
    ["Ideas", "6ab301527ea4b2a458e7d6cb066460dbae9941a6bc823413f3d73126c2090075"],
  ],
};

test("marcha atrás: la estructura de cada pestaña (escritorio y hoja del teléfono) es la de origin/main", async () => {
  for (const [donde, movil] of [["escritorio", false], ["movil", true]] as const) {
    const { page, errores, cerrar } = await abrir({ movil, lectura: lectura(TODOS, false) });
    for (const [pestana, huella] of DORADO_DE_LA_MARCHA_ATRAS[donde]) {
      await page.getByRole("tab", { name: pestana }).click();
      const filas = await esqueletoEstable(page);
      if (process.env.ANADIR_UI_HUELLAS) console.log(JSON.stringify([donde, pestana, huellaDeEsqueleto(filas)]));
      assert.equal(huellaDeEsqueleto(filas), huella, `${donde} · ${pestana}: cambió la estructura del panel con la interfaz apagada. Esqueleto:\n${filas.join("\n")}`);
    }
    assert.deepEqual(errores, []);
    await cerrar();
  }
});

test("marcha atrás: si la lectura falla (HTTP 500 o 401) el panel es el de siempre", async () => {
  for (const estado of [500, 401]) {
    const taller = await abrir({ lectura: { tipo: "error", estado } });
    assert.equal(huellaDeEsqueleto(await esqueletoEstable(taller.page)), DORADO_DE_LA_MARCHA_ATRAS.escritorio[0]![1], `HTTP ${estado}: el panel de entrada (Estructuras) no es el de origin/main`);
    await comprobarPanelDeSiempre(taller);
    await taller.cerrar();
  }
});

