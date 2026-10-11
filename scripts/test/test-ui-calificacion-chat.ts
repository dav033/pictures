/**
 * La calificación de la IA en el chat guiado (`/asistente`) en un navegador de verdad (Chromium de Playwright, o Chrome con
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE), con las filas REALES de `CalificacionGuiada` y un servidor falso de `/api/feedback-ia`. Sin
 * servidor, sin red ni coste. Corre sin `--conditions`:
 *
 *   npx tsx scripts/test/test-ui-calificacion-chat.ts      (no va en CI: necesita Chrome)
 *
 * Lo que cuida (NC-5): una fila de calificación por respuesta de la IA y UNA sola escala abierta; cada turno producido se registra
 * una sola vez con lo que tiene (nunca un POST vacío ni una segunda petición pegada, tampoco con StrictMode); calificar manda un
 * POST por gesto; y al recargar la página la nota guardada se ve marcada con una sola consulta, sin POST.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const RAIZ = path.resolve(__dirname, "..", "..");
const ORIGEN = "http://arnes.test";
const RUTA = "/api/feedback-ia";

type Peticion = { metodo: string; consulta: string; cuerpo: Record<string, unknown> | null };
type Fila = { turnoId: string; calificacion: number | null; motivos: string[]; comentario: string; deshecho: boolean };

let navegador: Browser;
let bundle = "";

before(async () => {
  const resultado = await build({
    entryPoints: [path.join(__dirname, "fixtures", "calificacion-chat-ui", "arnes.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    alias: { "@": path.join(RAIZ, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  bundle = resultado.outputFiles[0]!.text;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  navegador = await chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
});

after(async () => {
  await navegador?.close();
});

type Chat = { page: Page; peticiones: Peticion[]; errores: string[]; cerrar: () => Promise<void> };

/** Las peticiones a la API que siguen en vuelo en cada página (se cuentan al salir y al terminar o fallar). */
const enVuelo = new WeakMap<Page, { n: number }>();

/** El servidor falso guarda lo que recibe por turno (como el real: lo que una petición no manda se conserva) y lo devuelve en el GET. */
async function abrirChat(estricto: boolean): Promise<Chat> {
  const contexto: BrowserContext = await navegador.newContext({ viewport: { width: 420, height: 900 } });
  const page = await contexto.newPage();
  page.setDefaultTimeout(10_000);
  const peticiones: Peticion[] = [];
  const errores: string[] = [];
  const guardadas = new Map<string, Fila>();
  page.on("pageerror", (error) => errores.push(String(error)));
  const pendientes = { n: 0 };
  enVuelo.set(page, pendientes);
  const esApi = (url: string) => new URL(url).pathname.startsWith("/api/");
  page.on("request", (r) => { if (esApi(r.url())) pendientes.n += 1; });
  page.on("requestfinished", (r) => { if (esApi(r.url())) pendientes.n -= 1; });
  page.on("requestfailed", (r) => { if (esApi(r.url())) pendientes.n -= 1; });
  await page.route(`${ORIGEN}/**`, (ruta) => {
    const peticion = ruta.request();
    const url = new URL(peticion.url());
    if (url.pathname === "/arnes.js") return ruta.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === RUTA) {
      const cuerpo = peticion.method() === "POST" ? (JSON.parse(peticion.postData() ?? "null") as Record<string, unknown> | null) : null;
      peticiones.push({ metodo: peticion.method(), consulta: url.search, cuerpo });
      if (peticion.method() === "GET") {
        const turnos = url.searchParams.get("turnos")?.split(",") ?? [];
        return ruta.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, calificaciones: turnos.flatMap((id) => guardadas.get(id) ?? []) }) });
      }
      const turnoId = String(cuerpo?.turnoId);
      const previa = guardadas.get(turnoId);
      const fila: Fila = {
        turnoId,
        calificacion: typeof cuerpo?.calificacion === "number" ? cuerpo.calificacion : previa?.calificacion ?? null,
        motivos: previa?.motivos ?? [],
        comentario: previa?.comentario ?? "",
        deshecho: previa?.deshecho ?? false,
      };
      guardadas.set(turnoId, fila);
      return ruta.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, turnoId, producto: "cliente", calificacion: fila.calificacion, creado: previa === undefined, escenasGuardadas: false, actualizadoEn: "2026-10-10T00:00:00Z" }) });
    }
    if (url.pathname.startsWith("/api/")) return ruta.fulfill({ status: 204, body: "" });
    return ruta.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body><div id="raiz"></div><script src="/arnes.js"></script></body></html>' });
  });
  await page.goto(`${ORIGEN}/`);
  await montar(page, estricto);
  return { page, peticiones, errores, cerrar: () => contexto.close() };
}

const montar = (page: Page, estricto: boolean) => page.evaluate((e) => window.__montarChat(e), estricto);

/** Espera a que React pinte, sus efectos corran y no quede ninguna petición a la API en vuelo (tres fotogramas seguidos en calma). */
async function asentar(page: Page): Promise<void> {
  const pendientes = enVuelo.get(page)!;
  for (let calmas = 0; calmas < 3;) {
    await page.evaluate(() => new Promise<void>((listo) => requestAnimationFrame(() => setTimeout(listo, 25))));
    calmas = pendientes.n === 0 ? calmas + 1 : 0;
  }
}

async function turno(page: Page, pedido: string, respuesta: string): Promise<void> {
  await page.evaluate(([p, r]) => window.__turno(p!, r!), [pedido, respuesta] as const);
  await asentar(page);
}

const POSTS = (peticiones: Peticion[]) => peticiones.filter((p) => p.metodo === "POST");
const GETS = (peticiones: Peticion[]) => peticiones.filter((p) => p.metodo === "GET");
const escalas = (page: Page) => page.getByRole("radiogroup");
const lineasCalificar = (page: Page) => page.getByRole("button", { name: "Calificar", exact: true });

for (const estricto of [false, true]) {
  const modo = estricto ? "con StrictMode (como next dev)" : "sin StrictMode";

  test(`${modo}: tres turnos → una escala abierta, dos líneas «Calificar» y un registro por turno, cada uno con su contenido y sin consultas`, async () => {
    const { page, peticiones, errores, cerrar } = await abrirChat(estricto);
    await turno(page, "Quiero algo para un cumple de 7 años", "Te muestro cuatro ideas.");
    await turno(page, "Me gusta la guirnalda", "Excelente elección.");
    await turno(page, "Arma mi plan", "Tu plan está listo.");

    const registros = POSTS(peticiones);
    assert.equal(registros.length, 3, `POST: ${JSON.stringify(registros.map((r) => r.cuerpo))}`);
    assert.equal(new Set(registros.map((r) => r.cuerpo?.turnoId)).size, 3, "un registro por turno, ninguno repetido");
    for (const registro of registros) {
      assert.ok(registro.cuerpo?.pedido && registro.cuerpo.respuesta, `el registro lleva el pedido y la respuesta: ${JSON.stringify(registro.cuerpo)}`);
      assert.equal(registro.cuerpo.calificacion, undefined, "registrar no califica");
    }
    assert.equal(GETS(peticiones).length, 0, "un turno producido aquí no tiene nada guardado que consultar");
    assert.equal(await escalas(page).count(), 1, "una sola escala abierta");
    assert.equal(await lineasCalificar(page).count(), 2, "los turnos anteriores, en una línea");
    assert.deepEqual(errores, []);
    await cerrar();
  });
}

test("calificar manda un POST por gesto; un turno anterior se abre desde su línea y se califica sin tocar los demás", async () => {
  const { page, peticiones, cerrar } = await abrirChat(false);
  await turno(page, "Uno", "Respuesta uno.");
  await turno(page, "Dos", "Respuesta dos.");
  await turno(page, "Tres", "Respuesta tres.");

  await page.getByRole("radio", { name: "8 de 10" }).click();
  await asentar(page);
  let posts = POSTS(peticiones);
  assert.equal(posts.length, 4);
  assert.equal(posts[3]!.cuerpo?.calificacion, 8);
  assert.ok(posts[3]!.cuerpo?.respuesta, "la nota lleva el contenido del turno");
  assert.equal(await page.getByRole("radio", { name: "8 de 10" }).getAttribute("aria-checked"), "true");

  await lineasCalificar(page).first().click();
  assert.equal(await escalas(page).count(), 2, "la línea del turno anterior se abrió");
  assert.equal(POSTS(peticiones).length, 4, "abrir la línea no manda nada");
  await escalas(page).first().getByRole("radio", { name: "5 de 10" }).click();
  await asentar(page);
  posts = POSTS(peticiones);
  assert.equal(posts.length, 5);
  assert.equal(posts[4]!.cuerpo?.turnoId, posts[0]!.cuerpo?.turnoId, "la nota va al primer turno");
  assert.equal(posts[4]!.cuerpo?.calificacion, 5);
  assert.equal(GETS(peticiones).length, 0);
  await cerrar();
});

test("al recargar la página, la nota guardada se ve marcada con UNA consulta agrupada y ningún POST", async () => {
  const { page, peticiones, cerrar } = await abrirChat(false);
  await turno(page, "Uno", "Respuesta uno.");
  await turno(page, "Dos", "Respuesta dos.");
  await page.getByRole("radio", { name: "9 de 10" }).click();
  await asentar(page);
  const antes = peticiones.length;

  await page.reload();
  await montar(page, false);
  await asentar(page);

  const nuevas = peticiones.slice(antes);
  assert.equal(POSTS(nuevas).length, 0, "lo restaurado no se registra");
  assert.equal(GETS(nuevas).length, 1, `una sola consulta: ${JSON.stringify(GETS(nuevas))}`);
  assert.equal(new URL(`${ORIGEN}/x${GETS(nuevas)[0]!.consulta}`).searchParams.get("turnos")?.split(",").length, 2, "los dos turnos en la misma petición");
  assert.equal(await page.getByRole("radio", { name: "9 de 10" }).getAttribute("aria-checked"), "true", "la nota sobrevive a F5");
  assert.equal(await escalas(page).count(), 1);
  await cerrar();
});

for (const estricto of [false, true]) {
  test(`${estricto ? "con StrictMode" : "sin StrictMode"}: un turno sin nada que registrar (sin pedido ni texto) no manda un POST vacío ni consulta nada, pero se puede calificar`, async () => {
    const { page, peticiones, cerrar } = await abrirChat(estricto);
    await page.evaluate(() => window.__turno("", "", [{ tipo: "plan" }]));
    await asentar(page);
    assert.deepEqual(POSTS(peticiones).map((p) => p.cuerpo), [], "ningún POST sin contenido");
    assert.equal(GETS(peticiones).length, 0, "tampoco una consulta por un turno que no tiene nada guardado");
    await page.getByRole("radio", { name: "7 de 10" }).click();
    await asentar(page);
    const posts = POSTS(peticiones);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.cuerpo?.calificacion, 7);
    await cerrar();
  });
}

test("dos respuestas seguidas de la IA (sin mensaje de la persona en medio) llevan una fila cada una y una sola escala abierta", async () => {
  const { page, peticiones, cerrar } = await abrirChat(false);
  await turno(page, "Arma mi plan", "Tu plan está listo.");
  await page.evaluate(() => window.__respuestaSuelta("Recalculé tu plan.", [{ tipo: "plan" }]));
  await asentar(page);
  assert.equal(await escalas(page).count(), 1);
  assert.equal(await lineasCalificar(page).count(), 1);
  assert.equal(POSTS(peticiones).length, 2, "un registro por respuesta");
  await cerrar();
});
