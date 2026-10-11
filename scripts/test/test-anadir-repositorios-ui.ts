/**
 * El panel «Añadir» por repositorio en un navegador de verdad (Chromium de Playwright, o Chrome con PLAYWRIGHT_CHROMIUM_EXECUTABLE)
 * — REQ-013 fase 5, T26. Sin servidor, sin red ni coste: se empaqueta con esbuild el `PanelAnadir` REAL con su historial de
 * escena real (`fixtures/anadir-repositorios-ui/arnes.tsx`; solo el motor de la biblioteca es falso), el CSS es `globals.css`
 * compilado con Tailwind y `GET /api/catalogo/repositorios` se simula. Hace falta porque :3010 sirve `main`, no esta rama.
 *
 * Recorre, como la persona:
 * - tres repositorios: Todos (el panel de siempre), Sempertex (sus cuatro pestañas), Mobiliario (26 + «Mesa con sillas a medida»)
 *   y Escenografía (25), con la cuenta de cada uno, su procedencia y la búsqueda acotada;
 * - añadir una pieza de cada repositorio y deshacer, una a una;
 * - «Colgar otra» devuelve el panel a Todos con Decoraciones;
 * - lo que el Taller no ve (CATALOGO_REPOS_TALLER) no se pinta;
 * - la hoja inferior del teléfono a 390 px: el selector cabe, se toca con el dedo y se añade y se deshace igual.
 * La marcha atrás está en `test-anadir-repositorios-marcha-atras-ui.ts` y la lista de compra en `test-lista-repositorios-ui.ts`.
 *
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe" npx tsx scripts/test/test-anadir-repositorios-ui.ts
 * No va en CI: necesita Chrome. `ANADIR_UI_CAPTURAS=<carpeta>` guarda una captura de cada paso para mirarlas.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import type { Locator, Page } from "playwright";
import type { RespuestaRepositorios } from "../../src/lib/catalogo/repositorios-api-tipos";
import { BIBLIOTECA_FABRICA, itemDeEscena, validarItem } from "../../src/lib/globos3d/biblioteca";
import { SALA_INICIAL } from "../../src/lib/globos3d/escena";
import { entradaDeCatalogo } from "../../src/lib/globos3d/fondos-escenografia";
import { piezaDeEntrada } from "../../src/lib/globos3d/mobiliario-pieza";
import { abrir, capturar, cerrarContextos, cerrarNavegador, contador, cuentas, elegir, escena, esperadasPor, iniciarNavegador, lectura, opcion, pestanas, selector, tarjetasDe } from "./fixtures/anadir-repositorios-ui/navegador";

before(iniciarNavegador);
afterEach(cerrarContextos);
after(cerrarNavegador);

// ---------------------------------------------------------------------------------------------------------------------
// Tres repositorios
// ---------------------------------------------------------------------------------------------------------------------

test("encendido: el selector ofrece Todos, Sempertex, Mobiliario y Escenografía con sus cuentas, y empieza en Todos con el panel de siempre", async () => {
  const { page, errores, cerrar } = await abrir();
  const nombres = await selector(page).getByRole("button").evaluateAll((bs) => bs.map((b) => b.querySelector("span")?.textContent));
  assert.deepEqual(nombres, ["Todos", "Sempertex", "Mobiliario", "Escenografía"]);
  const c = await cuentas(page);
  assert.equal(c.Mobiliario, 27, "26 + la tarjeta de los 2 generadores (AC-11): lo mismo que se ve");
  assert.equal(c.Escenografía, 25);
  assert.ok(c.Sempertex > 100, `Sempertex: ${c.Sempertex}`);
  assert.equal(c.Todos, c.Sempertex + c.Mobiliario + c.Escenografía);
  assert.equal(await opcion(page, "Todos").getAttribute("aria-pressed"), "true");
  assert.deepEqual(await pestanas(page).allInnerTexts(), ["Estructuras", "Decoraciones", "Utilería", "Ideas"]);
  await pestanas(page).nth(2).click();
  const fondos = page.getByRole("region", { name: "Fondos y muebles" });
  await fondos.waitFor();
  assert.deepEqual(await fondos.locator("h4").allInnerTexts(), ["Fondos y tapetes", "Sillas y asientos", "Mesas", "Decorado de pie"]);
  assert.equal(await tarjetasDe(fondos).count(), 52, "los 51 de siempre y la mesa con sillas a medida");
  await capturar(page, "01-todos-utileria");
  assert.deepEqual(errores, []);
  await cerrar();
});

test("Sempertex: sus cuatro pestañas y su procedencia, sin los fondos y muebles", async () => {
  const { page, errores, cerrar } = await abrir();
  await elegir(page, "Sempertex");
  assert.deepEqual(await pestanas(page).allInnerTexts(), ["Estructuras", "Decoraciones", "Utilería", "Ideas"]);
  assert.match(await page.getByTestId("procedencia-repositorio").innerText(), /^Sempertex v\S+ · licencia de la marca socia: Sempertex$/);
  await pestanas(page).nth(2).click();
  await page.getByRole("tabpanel").waitFor();
  assert.equal(await page.getByRole("region", { name: "Fondos y muebles" }).count(), 0, "los fondos y muebles son de otros repositorios");
  await pestanas(page).nth(3).click();
  assert.equal(await opcion(page, "Sempertex").getAttribute("aria-pressed"), "true", "cambiar de pestaña dentro de Sempertex no suelta el repositorio");
  await capturar(page, "02-sempertex");
  assert.deepEqual(errores, []);
  await cerrar();
});

test("Mobiliario: sin pestañas, 26 muebles más la mesa con sillas a medida, su procedencia y la búsqueda acotada a él", async () => {
  const { page, errores, cerrar } = await abrir();
  await elegir(page, "Mobiliario");
  assert.equal(await pestanas(page).count(), 0, "Mobiliario no tiene pestañas");
  const seccion = page.getByRole("region", { name: "Mobiliario" });
  await seccion.waitFor();
  assert.deepEqual(await seccion.locator("h4").allInnerTexts(), ["Sillas y asientos", "Mesas"]);
  assert.equal(await tarjetasDe(seccion).count(), 27);
  assert.ok((await tarjetasDe(seccion).allInnerTexts()).includes("Mesa con sillas a medida"));
  assert.match(await seccion.getByTestId("procedencia-repositorio").innerText(), /^Mobiliario v\S+ · licencia propia: Equipo demo-decoracion · no cotiza \(aún no hay lista de alquiler de mobiliario\)$/);
  assert.equal(await contador(page), "27 resultados");
  await page.locator("#anadir-buscar").fill("tiffany");
  const halladas = await tarjetasDe(seccion).allInnerTexts();
  assert.ok(halladas.includes("Silla Tiffany"), "AC-11: se encuentra por su nombre dentro del repositorio");
  assert.deepEqual([...halladas].sort(), esperadasPor("mobiliario", "tiffany").sort(), "exactamente lo que trae «tiffany» en su nombre o descripción, nada de otro repositorio ni la lista entera");
  assert.ok(halladas.length < 27, "la búsqueda acota");
  assert.equal(await contador(page), `${halladas.length} resultados`);
  await page.locator("#anadir-buscar").fill("panel redondo");
  await seccion.waitFor({ state: "detached" });
  assert.equal(await contador(page), "0 resultados", "un panel no es mobiliario");
  await page.locator("#anadir-buscar").fill("");
  await capturar(page, "03-mobiliario");
  assert.deepEqual(errores, []);
  await cerrar();
});

test("Escenografía: sin pestañas, 25 fondos y decorados, y encuentra un panel por su nombre pero no una silla", async () => {
  const { page, errores, cerrar } = await abrir();
  await elegir(page, "Escenografía");
  assert.equal(await pestanas(page).count(), 0);
  const seccion = page.getByRole("region", { name: "Escenografía" });
  await seccion.waitFor();
  assert.deepEqual(await seccion.locator("h4").allInnerTexts(), ["Fondos y tapetes", "Decorado de pie"]);
  assert.equal(await tarjetasDe(seccion).count(), 25);
  assert.match(await seccion.getByTestId("procedencia-repositorio").innerText(), /^Escenografía v\S+ · licencia propia: .+ · no cotiza/);
  await page.locator("#anadir-buscar").fill("panel redondo");
  const halladas = await tarjetasDe(seccion).allInnerTexts();
  assert.ok(halladas.includes("Panel redondo"), "AC-11: se encuentra por su nombre dentro del repositorio");
  assert.deepEqual([...halladas].sort(), esperadasPor("escenografia", "panel redondo").sort(), "exactamente lo que trae «panel redondo», nada de otro repositorio ni la lista entera");
  assert.ok(halladas.length < 25, "la búsqueda acota");
  await page.locator("#anadir-buscar").fill("tiffany");
  await seccion.waitFor({ state: "detached" });
  assert.equal(await contador(page), "0 resultados");
  await page.getByText("Nada de Escenografía en tu biblioteca coincide con la búsqueda.").waitFor();
  await capturar(page, "04-escenografia");
  await page.locator("#anadir-buscar").fill("");
  await page.getByText("Todavía no guardas nada de Escenografía en tu biblioteca.").waitFor();
  assert.deepEqual(errores, []);
  await cerrar();
});

// ---------------------------------------------------------------------------------------------------------------------
// Añadir uno de cada repositorio y deshacer
// ---------------------------------------------------------------------------------------------------------------------

/** El historial del panel junta lo añadido en menos de 800 ms como un solo paso (`cambiarDesdePanel`): cada pieza espera para ser un paso suyo. */
const PASO_DEL_HISTORIAL_MS = 900;

async function anadirUnoDeCada(page: Page, tocar: (l: Locator) => Promise<void>, tocarNueva: (l: Locator) => Promise<void> = tocar): Promise<string[]> {
  await elegir(page, "Mobiliario", tocar);
  await tocar(page.getByRole("region", { name: "Mobiliario" }).getByRole("button", { name: "Silla Tiffany" }));
  await page.waitForFunction(() => document.querySelector('[data-testid=cuantas]')?.textContent === "1");
  const aviso = await page.getByRole("region", { name: "Mobiliario" }).getByRole("status").innerText();
  assert.match(aviso, /^Listo: «Silla Tiffany» quedó en la escena\. Arrástralo para moverlo\. Procedencia: Mobiliario v\S+ · licencia propia: Equipo demo-decoracion/);
  await page.waitForTimeout(PASO_DEL_HISTORIAL_MS);

  await elegir(page, "Escenografía", tocar);
  await tocar(page.getByRole("region", { name: "Escenografía" }).getByRole("button", { name: "Panel redondo" }));
  await page.waitForFunction(() => document.querySelector('[data-testid=cuantas]')?.textContent === "2");
  await page.waitForTimeout(PASO_DEL_HISTORIAL_MS);

  await elegir(page, "Sempertex", tocar);
  const nueva = page.getByRole("region", { name: "Nuevas y ajustables" }).locator("button[title]").first();
  const nombre = (await nueva.innerText()).split("\n")[0]!.trim();
  await tocarNueva(nueva);
  await page.waitForFunction(() => document.querySelector('[data-testid=cuantas]')?.textContent === "3");
  return ["Silla Tiffany", "Panel redondo", nombre];
}

const clic = (l: Locator) => l.click();

test("añadir una pieza de Mobiliario, una de Escenografía y una de Sempertex, y deshacer una a una", async () => {
  const { page, errores, cerrar } = await abrir();
  const esperado = await anadirUnoDeCada(page, clic);
  assert.deepEqual(await escena(page), esperado, "las tres entraron a la escena, en orden, cada una con el nombre de su tarjeta");
  await capturar(page, "05-tres-piezas");

  const deshacer = page.getByRole("button", { name: "Deshacer" });
  await deshacer.click();
  assert.deepEqual(await escena(page), esperado.slice(0, 2), "deshacer quita la de Sempertex");
  await deshacer.click();
  assert.deepEqual(await escena(page), esperado.slice(0, 1), "y la de Escenografía");
  await deshacer.click();
  assert.deepEqual(await escena(page), [], "y la de Mobiliario");
  assert.equal(await deshacer.isDisabled(), true, "ya no queda nada que deshacer");
  assert.deepEqual(errores, []);
  await cerrar();
});

test("la mesa con sillas a medida es de Mobiliario: entra con sus sillas y se deshace de una vez", async () => {
  const { page, errores, cerrar } = await abrir();
  await elegir(page, "Mobiliario");
  await page.getByRole("region", { name: "Mobiliario" }).getByRole("button", { name: "Mesa con sillas a medida" }).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=cuantas]')?.textContent) >= 2);
  const piezas = await escena(page);
  assert.ok(piezas.length >= 2 && piezas.some((p) => /mesa/i.test(p)) && piezas.some((p) => /silla/i.test(p)), piezas.join(" | "));
  await page.getByRole("button", { name: "Deshacer" }).click();
  assert.deepEqual(await escena(page), []);
  assert.deepEqual(errores, []);
  await cerrar();
});

// ---------------------------------------------------------------------------------------------------------------------
// La elección y la pestaña
// ---------------------------------------------------------------------------------------------------------------------

test("«Colgar otra» pide Decoraciones y el panel vuelve a Todos con esa pestaña, desde otra pestaña o desde la misma", async () => {
  for (const pestanaPrevia of [0, 1]) {
    const { page, errores, cerrar } = await abrir();
    await pestanas(page).nth(pestanaPrevia).click();
    await elegir(page, "Mobiliario");
    assert.equal(await pestanas(page).count(), 0);
    await page.getByTestId("colgar-otra").click();
    await pestanas(page).first().waitFor();
    assert.equal(await opcion(page, "Todos").getAttribute("aria-pressed"), "true", `desde la pestaña ${pestanaPrevia}`);
    assert.equal(await pestanas(page).nth(1).getAttribute("aria-selected"), "true", "Decoraciones, la que pidió «Colgar otra»");
    assert.deepEqual(errores, []);
    await cerrar();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Lo que el Taller no ve
// ---------------------------------------------------------------------------------------------------------------------

test("lo que el Taller no ve no se pinta: sin Mobiliario no hay opción, ni sus muebles, ni la mesa con sillas", async () => {
  const { page, errores, cerrar } = await abrir({ lectura: lectura(["sempertex", "escenografia"]) });
  const nombres = await selector(page).getByRole("button").evaluateAll((bs) => bs.map((b) => b.querySelector("span")?.textContent));
  assert.deepEqual(nombres, ["Todos", "Sempertex", "Escenografía"]);
  await pestanas(page).nth(2).click();
  const seccion = page.getByRole("region", { name: "Escenografía" });
  await seccion.waitFor();
  assert.equal(await tarjetasDe(seccion).count(), 25);
  assert.equal(await page.getByText("Mesa con sillas a medida").count(), 0);
  assert.equal(await page.getByRole("region", { name: "Mobiliario" }).count(), 0);
  assert.deepEqual(errores, []);
  await cerrar();
});

test("sin Sempertex visible, Todos junta solo lo que el Taller ve: ni sus pestañas ni su biblioteca ni su cuenta", async () => {
  const { page, errores, cerrar } = await abrir({ lectura: lectura(["mobiliario", "escenografia"]) });
  const nombres = await selector(page).getByRole("button").evaluateAll((bs) => bs.map((b) => b.querySelector("span")?.textContent));
  assert.deepEqual(nombres, ["Todos", "Mobiliario", "Escenografía"]);
  const c = await cuentas(page);
  assert.equal(c.Todos, c.Mobiliario + c.Escenografía, "Todos suma solo lo visible");
  assert.equal(c.Todos, 52);
  assert.equal(await pestanas(page).count(), 0, "sin las pestañas de Sempertex");
  assert.equal(await page.getByRole("region", { name: "Mobiliario" }).count() + await page.getByRole("region", { name: "Escenografía" }).count(), 2, "los dos repositorios de fondos, juntos");
  const biblioteca = page.getByRole("region", { name: "De la biblioteca" });
  await biblioteca.getByText("Todavía no guardas nada de Mobiliario y Escenografía en tu biblioteca.").waitFor();
  assert.equal(await biblioteca.locator("li").count(), 0);
  assert.deepEqual(errores, []);
  await cerrar();
});

test("con un solo repositorio visible no hay selector que mostrar y el panel es el de ese repositorio", async () => {
  const { page, errores, cerrar } = await abrir({ lectura: lectura(["sempertex"]) });
  await pestanas(page).nth(2).click();
  await page.getByRole("tabpanel").waitFor();
  // Sin la lectura aplicada, el panel de siempre trae «Fondos y muebles» en Utilería: que desaparezca prueba que la lectura ya se aplicó.
  await page.getByRole("region", { name: "Fondos y muebles" }).waitFor({ state: "detached" });
  assert.equal(await selector(page).count(), 0, "con un solo repositorio no hay nada que elegir");
  assert.equal(await page.getByRole("region", { name: "Escenografía" }).count(), 0);
  assert.deepEqual(errores, []);
  await cerrar();
});

// ---------------------------------------------------------------------------------------------------------------------
// Buscar dentro de un repositorio, soltar una foto, lo guardado y una lectura que el navegador no entiende del todo
// ---------------------------------------------------------------------------------------------------------------------

test("dentro de Mobiliario y de Escenografía la búsqueda acota: «silla», «mesa» y «fondo» no devuelven el repositorio entero", async () => {
  const { page, errores, cerrar } = await abrir();
  const buscar = page.locator("#anadir-buscar");
  await elegir(page, "Mobiliario");
  const mobiliario = page.getByRole("region", { name: "Mobiliario" });
  for (const palabra of ["silla", "mesa"]) {
    await buscar.fill(palabra);
    const halladas = await tarjetasDe(mobiliario).allInnerTexts();
    assert.deepEqual([...halladas].sort(), [...esperadasPor("mobiliario", palabra), "Mesa con sillas a medida"].sort(), `«${palabra}» en Mobiliario`);
    assert.ok(halladas.length < 27, `«${palabra}»: ${halladas.length} de 27`);
    assert.equal(await contador(page), `${halladas.length} resultados`);
  }
  await buscar.fill("");
  await elegir(page, "Escenografía");
  await buscar.fill("fondo");
  const halladas = await tarjetasDe(page.getByRole("region", { name: "Escenografía" })).allInnerTexts();
  assert.deepEqual([...halladas].sort(), esperadasPor("escenografia", "fondo").sort(), "«fondo» en Escenografía");
  assert.ok(halladas.length < 25, `«fondo»: ${halladas.length} de 25`);
  assert.deepEqual(errores, []);
  await cerrar();
});

/** Suelta una imagen sobre el panel como lo haría el navegador: devuelve si se cancelaron el `dragover` y el `drop` (si no, el navegador abre el archivo). */
const soltarImagen = (page: Page) => page.evaluate(() => {
  const datos = new DataTransfer();
  datos.items.add(new File(["x"], "foto.png", { type: "image/png" }));
  const destino = document.querySelector("#anadir-contenido")!;
  const sobre = new DragEvent("dragover", { dataTransfer: datos, bubbles: true, cancelable: true });
  destino.dispatchEvent(sobre);
  const suelta = new DragEvent("drop", { dataTransfer: datos, bubbles: true, cancelable: true });
  destino.dispatchEvent(suelta);
  return { dragover: sobre.defaultPrevented, drop: suelta.defaultPrevented };
});

test("una imagen soltada sobre Mobiliario o Escenografía se traga (el navegador no abre el archivo) y no busca por foto; en Sempertex sí la busca", async () => {
  const { page, pedidas, errores, cerrar } = await abrir();
  for (const nombre of ["Mobiliario", "Escenografía", "Todos"]) {
    await elegir(page, nombre);
    const { dragover, drop } = await soltarImagen(page);
    assert.deepEqual([dragover, drop], [true, true], `${nombre}: el dragover y el drop se cancelan`);
  }
  assert.deepEqual(pedidas.filter((url) => /buscar-foto/.test(url)), [], "Mobiliario y Escenografía no buscan por foto");
  await elegir(page, "Sempertex");
  assert.equal((await soltarImagen(page)).drop, true);
  await page.waitForFunction(() => document.querySelector("#anadir-contenido") !== null);
  assert.deepEqual(errores, []);
  await cerrar();
});

test("una escena guardada que solo trae muebles sigue en Sempertex → Ideas; no sale en Mobiliario", async () => {
  const muebles = ["silla_tiffany", "mesa_redonda"].map((id, i) => ({
    id, nombre: entradaDeCatalogo(id)!.nombre, pieza: piezaDeEntrada(entradaDeCatalogo(id)!), colocacion: { en: "piso" as const, xCm: i * 100, zCm: 0, giroGrados: 0 },
  }));
  const guardada = { ...itemDeEscena({ id: "propio:salon-de-muebles", nombre: "Mi salón de muebles", ocasiones: ["general"], escena: { sala: structuredClone(SALA_INICIAL), nodos: muebles } }), propio: true };
  assert.ok(validarItem(JSON.parse(JSON.stringify(guardada))), "el taller acepta lo guardado (si no, lo descarta y la prueba no dice nada)");
  const { page, errores, cerrar } = await abrir({ propios: [JSON.parse(JSON.stringify(guardada))] });
  assert.equal((await cuentas(page)).Sempertex, BIBLIOTECA_FABRICA.length + 1, "cuenta en Sempertex");
  await elegir(page, "Sempertex");
  await pestanas(page).nth(3).click();
  // La grilla pagina de a 24 y lo guardado va al final: se busca por su nombre.
  await page.locator("#anadir-buscar").fill("salón de muebles");
  await page.getByRole("region", { name: "De la biblioteca" }).getByText("Mi salón de muebles").first().waitFor();
  await elegir(page, "Mobiliario");
  await page.getByText("Nada de Mobiliario en tu biblioteca coincide con la búsqueda.").waitFor();
  assert.equal(await page.getByText("Mi salón de muebles").count(), 0);
  assert.deepEqual(errores, []);
  await cerrar();
});

test("una lectura con un repositorio que el navegador no entiende lo descarta con un aviso y el panel sigue con el resto", async () => {
  const buena = lectura();
  if (buena.tipo !== "respuesta") throw new Error("la lectura de prueba tiene que ser una respuesta");
  const [sempertex, mobiliario, escenografia] = buena.cuerpo.repositorios;
  const futuro = { ui: true, repositorios: [sempertex, mobiliario, escenografia, { ...mobiliario, id: "terceros/acme", licencia: { ...mobiliario!.licencia, regimen: "regimen-nuevo" } }] } as unknown as RespuestaRepositorios;
  const { page, avisos, errores, cerrar } = await abrir({ lectura: { tipo: "respuesta", cuerpo: futuro } });
  const nombres = await selector(page).getByRole("button").evaluateAll((bs) => bs.map((b) => b.querySelector("span")?.textContent));
  assert.deepEqual(nombres, ["Todos", "Sempertex", "Mobiliario", "Escenografía"], "el panel sigue con los tres que entiende");
  assert.ok(avisos.some((a) => /se descartan repositorios/.test(a) && /terceros\/acme/.test(a)), `avisó: ${avisos.join(" | ")}`);
  assert.deepEqual(errores, []);
  await cerrar();
});

// ---------------------------------------------------------------------------------------------------------------------
// La hoja del teléfono (390 px)
// ---------------------------------------------------------------------------------------------------------------------

test("teléfono 390 px: el selector cabe en la hoja, se toca con el dedo (44 px), y se añade y se deshace igual", async () => {
  const { page, errores, cerrar } = await abrir({ movil: true });
  const hoja = page.getByRole("region", { name: "Paneles del taller" });
  await selector(page).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "la página no se desborda de lado");
  const caja = (await selector(page).boundingBox())!;
  const cajaHoja = (await hoja.boundingBox())!;
  assert.ok(caja.x >= cajaHoja.x && caja.x + caja.width <= cajaHoja.x + cajaHoja.width + 0.5, `el selector (${Math.round(caja.x)}–${Math.round(caja.x + caja.width)}) cabe en la hoja (${Math.round(cajaHoja.width)} px)`);
  const botones = selector(page).getByRole("button");
  assert.equal(await botones.count(), 4);
  for (let i = 0; i < 4; i += 1) {
    const b = (await botones.nth(i).boundingBox())!;
    assert.ok(b.height >= 44 - 0.5 && b.width >= 44, `opción ${i}: ${Math.round(b.width)} × ${Math.round(b.height)} px`);
    assert.equal(await botones.nth(i).evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, `opción ${i}: el nombre no se corta`);
  }
  await capturar(page, "07-movil-todos");

  // En la hoja media, Todos y Sempertex ocupan todo el alto con su buscador, pestañas y filtros (así era antes del selector): se sube la hoja, como lo haría la persona.
  await page.getByRole("button", { name: "Agrandar el panel" }).tap();
  const esperado = await anadirUnoDeCada(page, (l) => l.tap());
  assert.deepEqual(await escena(page), esperado);
  await capturar(page, "08-movil-tres-piezas");
  const deshacer = page.getByRole("button", { name: "Deshacer" });
  for (const quedan of [2, 1, 0]) {
    await deshacer.tap();
    await page.waitForFunction((n) => document.querySelector("[data-testid=cuantas]")?.textContent === String(n), quedan);
    assert.deepEqual(await escena(page), esperado.slice(0, quedan), `un toque en «Deshacer» quita una sola pieza (quedan ${quedan})`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errores, []);
  await cerrar();
});

/**
 * Con el dedo, el clic de un toque llega del navegador unos píxeles corrido del punto donde se apretó (ajuste táctil: en la medición, apretado
 * en (73, 628) y clic en (77, 623), 6,4 px, tras elegir Sempertex) y `TarjetaNueva` lo leía como un arrastre al visor y no añadía nada. Con el dedo
 * no hay arrastre: la distancia no cuenta. Es el defecto que ya tenía `main`.
 */
test("teléfono 390 px: tocar una tarjeta «Nuevas · ajustables» la añade a la escena", async () => {
  const { page, cerrar } = await abrir({ movil: true });
  await page.getByRole("button", { name: "Agrandar el panel" }).tap();
  await elegir(page, "Sempertex", (l) => l.tap());
  await page.getByRole("region", { name: "Nuevas y ajustables" }).locator("button[title]").first().tap();
  await page.waitForFunction(() => document.querySelector("[data-testid=cuantas]")?.textContent === "1");
  await cerrar();
});

test("teléfono 390 px: en Mobiliario y Escenografía la hoja deja ver las tarjetas y no hay desborde de lado", async () => {
  const { page, errores, cerrar } = await abrir({ movil: true });
  for (const [nombre, tarjetas] of [["Mobiliario", 27], ["Escenografía", 25]] as const) {
    await opcion(page, nombre).tap();
    const seccion = page.getByRole("region", { name: nombre });
    await seccion.waitFor();
    assert.equal(await tarjetasDe(seccion).count(), tarjetas);
    const contenido = (await page.locator("#anadir-contenido").boundingBox())!;
    assert.ok(contenido.height >= 120, `${nombre}: el contenido tiene ${Math.round(contenido.height)} px de alto en la hoja media`);
    const desborde = await page.locator("#anadir-contenido").evaluate((el) => el.scrollWidth - el.clientWidth);
    assert.ok(desborde <= 1, `${nombre}: el contenido se desborda ${desborde} px de lado`);
    await capturar(page, `09-movil-${nombre}`);
  }
  assert.deepEqual(errores, []);
  await cerrar();
});
