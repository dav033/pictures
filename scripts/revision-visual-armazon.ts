/**
 * Iteración 4: revisión visual SIN gasto del armazón de la app (inicio con
 * galería, chat con pasos en vivo, propuesta y estados de error) a 1440 y
 * 400 px, en claro y oscuro. Todo lo pagado se simula:
 * - /api/chat: stream SSE simulado en el navegador (eventos `herramienta`
 *   espaciados y `fin` con `eval/ui/plan-resuelto-arco-columnas.json`);
 * - /api/references/analyze y /api/generate: respuestas simuladas (incluido
 *   el error de la vista previa sin saldo);
 * - cualquier otro POST salvo /api/login se aborta.
 * Comprueba además que no haya scroll horizontal a 400 px.
 *
 * Uso: APP_PASSWORD=… npx tsx scripts/revision-visual-armazon.ts --base http://localhost:3010 --out <carpeta>
 * Sin el Chromium de Playwright: PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { ReferenceBlueprintV2Schema } from "../src/lib/ia/reference-blueprint";

const argumento = (nombre: string) => {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
};
const BASE = argumento("--base") ?? "http://localhost:3010";
const OUT = argumento("--out") ?? path.join(process.cwd(), ".capturas-armazon");
const SOLO = argumento("--solo");
const PLAN: unknown = JSON.parse(readFileSync(path.join(process.cwd(), "eval", "ui", "plan-resuelto-arco-columnas.json"), "utf8"));
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const REQUEST_ID = "4b6a3c38-5a59-4a57-9d8e-2f4f3c0a1b2c";

function elemento(id: string, nombre: string, x: number, width: number) {
  return {
    element_id: id, source_image_id: "REF_01", name: nombre, category: "balloon_structure",
    scene_role: "backdrop", detection_confidence: 0.9, visible_evidence: "globos rosa, blanco y plata",
    reference_bbox: { x, y: 0.05, width, height: 0.75 }, depth_layer: 1,
    include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "approximate", min: 60, max: 90 },
    appearance: { observed_colors: ["rosa", "blanco", "plateado"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "semiarco", composition: "mezcla de tamaños" },
    relationships: [], uncertainties: [],
    model_decision: { action: "include", match_type: "none", reason: "pieza principal", adaptation: "catálogo" },
  };
}

const BLUEPRINT = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [elemento("REF_01_E01", "Left organic half arch", 0.02, 0.3), elemento("REF_01_E02", "Right organic half arch", 0.68, 0.3)],
  composition: { focal_point: "mesa de postres", density: "moderate", symmetry: "symmetric", negative_space: [] },
  palette: { observed: ["rosa", "blanco", "plateado"], priority: ["rosa", "plateado"] },
  unresolved_decisions: [],
});

function uiError(code: string, mensaje: string, retryable: boolean, accion: string | null) {
  return { schema_version: "ui-error.v1", code, mensaje_usuario: mensaje, accion_sugerida: accion, acciones_alternativas: [], retryable, detalles_dev: { mensaje: "simulado en la revisión visual" } };
}

type Escenario = { chat: "plan" | "error"; analisis: "ok" | "error"; generacion: "ok" | "sin-saldo" };

async function cookieDeSesion(): Promise<{ name: string; value: string }> {
  const password = process.env.APP_PASSWORD;
  if (!password) throw new Error("Falta APP_PASSWORD en el entorno.");
  const respuesta = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ password }), redirect: "manual" });
  const [primera] = respuesta.headers.getSetCookie();
  const [name, ...resto] = (primera ?? "").split(";")[0]!.split("=");
  if (!name || resto.length === 0) throw new Error(`Login sin cookie de sesión (HTTP ${respuesta.status}).`);
  return { name, value: resto.join("=") };
}

async function nuevoContexto(browser: Browser, cookie: { name: string; value: string }, ancho: number, tema: "light" | "dark", escenario: Escenario, dev = false): Promise<{ context: BrowserContext; page: Page; errores: string[] }> {
  const context = await browser.newContext({ viewport: { width: ancho, height: ancho < 600 ? 860 : 900 }, colorScheme: tema, deviceScaleFactor: 1 });
  await context.addCookies([{ ...cookie, url: BASE }]);
  await context.addInitScript(({ tema: temaInicial, dev: modoDev }) => {
    try {
      window.localStorage.setItem("demo-decoracion:tema", temaInicial);
      window.localStorage.setItem("demo-decoracion:modo-vista", modoDev ? "dev" : "usuario");
    } catch {
      // sin almacenamiento
    }
  }, { tema, dev });
  // /api/chat simulado dentro del navegador para poder espaciar los eventos del stream.
  await context.addInitScript(({ plan, requestId, modo }) => {
    const original = window.fetch.bind(window);
    const base = { schema_version: "chat.sse.v1", request_id: requestId, correlation_id: requestId };
    window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (!url.includes("/api/chat")) return original(entrada, init);
      const eventos: Array<[number, Record<string, unknown>]> = modo === "error"
        ? [[600, { ...base, type: "herramienta", nombre: "guardar_brief", estado: "ejecutando" }], [1400, { ...base, type: "error", error: "simulado", code: "AI_NETWORK", retryable: true }]]
        : [
            [300, { ...base, type: "herramienta", nombre: "guardar_brief", estado: "ejecutando" }],
            [700, { ...base, type: "herramienta", nombre: "guardar_brief", estado: "lista" }],
            [800, { ...base, type: "herramienta", nombre: "buscar_catalogo_rag", estado: "ejecutando" }],
            [1500, { ...base, type: "herramienta", nombre: "buscar_catalogo_rag", estado: "lista" }],
            [1600, { ...base, type: "herramienta", nombre: "confirmar_plan_decoracion", estado: "ejecutando" }],
            [3600, { ...base, type: "herramienta", nombre: "confirmar_plan_decoracion", estado: "lista" }],
            [3700, { ...base, type: "fin", reply: "Armé la propuesta con lo que vi: un arco al centro y dos columnas a los lados, con globos reales del catálogo en blanco y dorado.", brief: { tipo_evento: "XV años", colores: ["blanco", "dorado"], presupuesto: 1500000 }, proveedor: "gemini", modelo: "simulado", plan }],
          ];
      const codificador = new TextEncoder();
      const cuerpo = new ReadableStream<Uint8Array>({
        start(controlador) {
          let anterior = 0;
          let cadena = Promise.resolve();
          for (const [instante, evento] of eventos) {
            const espera = instante - anterior;
            anterior = instante;
            cadena = cadena.then(() => new Promise((resolver) => setTimeout(resolver, espera))).then(() => {
              controlador.enqueue(codificador.encode(`event: ${String(evento.type)}\ndata: ${JSON.stringify(evento)}\n\n`));
            });
          }
          void cadena.then(() => controlador.close());
        },
      });
      return new Response(cuerpo, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
  }, { plan: PLAN, requestId: REQUEST_ID, modo: escenario.chat });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(String(error)));
  await page.route("**/*", async (route) => {
    const peticion = route.request();
    if (peticion.method() !== "POST") return route.continue();
    const url = peticion.url();
    if (url.includes("/api/login")) return route.continue();
    if (url.includes("/api/references/analyze")) {
      await new Promise((resolver) => setTimeout(resolver, 2500));
      if (escenario.analisis === "error") {
        return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "simulado", ui_error: uiError("SERVICIO_NO_DISPONIBLE", "El servicio no respondió. Intenta de nuevo en un momento.", true, "reintentar") }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ blueprint: BLUEPRINT }) });
    }
    if (url.includes("/api/generate")) {
      await new Promise((resolver) => setTimeout(resolver, 1200));
      if (escenario.generacion === "sin-saldo") {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "simulado", ui_error: uiError("VISTA_PREVIA_NO_DISPONIBLE", "La vista previa de la imagen no está disponible por ahora. Tu propuesta y su precio quedan guardados.", false, null) }) });
      }
      const qa = { pass: true, confidence: "vision_assisted", retry_reasons: [], scene_spec_hash: "fixture", observed_instances: [] };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imagen: `data:image/png;base64,${PNG_1PX}`, modoImagen: "lora", prompts: {}, qa, plan: PLAN }) });
    }
    return route.abort();
  });
  return { context, page, errores };
}

const resultados: string[] = [];

async function capturar(page: Page, nombre: string, ancho: number, tema: string): Promise<void> {
  const archivo = path.join(OUT, `${nombre}-${ancho}-${tema}.png`);
  await page.screenshot({ path: archivo });
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  resultados.push(`${desborde > 0 ? "DESBORDE" : "ok"} ${path.basename(archivo)}${desborde > 0 ? ` (+${desborde}px)` : ""}`);
}

async function abrir(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("switch-modo-vista").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
}

async function enviar(page: Page, texto: string): Promise<void> {
  const entrada = page.getByRole("textbox", { name: "Escribe tu mensaje" });
  await entrada.fill(texto);
  await entrada.press("Enter");
}

async function flujoFoto(browser: Browser, cookie: { name: string; value: string }, ancho: number, tema: "light" | "dark"): Promise<void> {
  const { context, page, errores } = await nuevoContexto(browser, cookie, ancho, tema, { chat: "plan", analisis: "ok", generacion: "sin-saldo" });
  await abrir(page);
  await capturar(page, "01-inicio", ancho, tema);
  await page.getByTestId("galeria-ejemplos").scrollIntoViewIfNeeded();
  await capturar(page, "02-galeria", ancho, tema);
  await page.getByTestId("ejemplo-ejemplo-01").click();
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".app-main").evaluate((nodo) => nodo.scrollTo(0, 0));
  await capturar(page, "03-foto-elegida-analizando", ancho, tema);
  await page.waitForTimeout(2600);
  await capturar(page, "04-foto-analizada", ancho, tema);
  await enviar(page, "Quiero algo así para el cumpleaños de mi mamá");
  await page.waitForTimeout(2000);
  await capturar(page, "05-chat-pasos-en-vivo", ancho, tema);
  await page.getByTestId("plan-desglose").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.getByTestId("plan-desglose").evaluate((nodo) => nodo.scrollIntoView({ block: "start" }));
  await capturar(page, "06-propuesta", ancho, tema);
  const aprobar = page.getByTestId("aprobar-generar-plan");
  await aprobar.scrollIntoViewIfNeeded();
  await capturar(page, "07-propuesta-aprobar", ancho, tema);
  await aprobar.click();
  await page.getByTestId("aviso-error").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.getByTestId("aviso-error").scrollIntoViewIfNeeded();
  await capturar(page, "08-error-vista-previa-sin-saldo", ancho, tema);
  if (errores.length) resultados.push(`ERRORES runtime (${ancho}-${tema}): ${errores.join(" | ")}`);
  await context.close();
}

async function flujoErrores(browser: Browser, cookie: { name: string; value: string }, ancho: number, tema: "light" | "dark"): Promise<void> {
  const { context, page, errores } = await nuevoContexto(browser, cookie, ancho, tema, { chat: "error", analisis: "error", generacion: "ok" });
  await abrir(page);
  await page.getByTestId("ejemplo-ejemplo-03").click();
  await page.waitForTimeout(3500);
  await page.locator(".app-main").evaluate((nodo) => nodo.scrollTo(0, 0));
  await capturar(page, "09-error-analisis-foto", ancho, tema);
  // Sin foto: el turno no espera un análisis que ya falló.
  await page.locator("[data-adjunto='referencia'] button").first().click();
  await page.waitForTimeout(300);
  await enviar(page, "Quiero decorar los 40 de mi esposo en azul y plateado");
  await page.waitForTimeout(900);
  await capturar(page, "10-pensando", ancho, tema);
  await page.getByTestId("aviso-error").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await capturar(page, "11-error-chat", ancho, tema);
  if (errores.length) resultados.push(`ERRORES runtime (${ancho}-${tema}): ${errores.join(" | ")}`);
  await context.close();
}

async function flujoVisualizacion(browser: Browser, cookie: { name: string; value: string }, ancho: number, tema: "light" | "dark"): Promise<void> {
  const { context, page, errores } = await nuevoContexto(browser, cookie, ancho, tema, { chat: "plan", analisis: "ok", generacion: "ok" }, true);
  await abrir(page);
  await capturar(page, "12-dev-inicio", ancho, tema);
  await page.getByTestId("menu-app").click();
  await page.waitForTimeout(300);
  await capturar(page, "13-dev-menu", ancho, tema);
  await page.keyboard.press("Escape");
  await enviar(page, "Arco blanco y dorado con columnas para XV años");
  await page.getByTestId("plan-desglose").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const casilla = page.getByText("Validar visualmente");
  await casilla.click();
  await page.getByTestId("aprobar-generar-plan").click();
  await page.getByTestId("bloque-visualizacion").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1800);
  await page.getByTestId("bloque-visualizacion").scrollIntoViewIfNeeded();
  await capturar(page, "14-dev-visualizacion", ancho, tema);
  if (errores.length) resultados.push(`ERRORES runtime (${ancho}-${tema}): ${errores.join(" | ")}`);
  await context.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const cookie = await cookieDeSesion();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({ executablePath, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
  try {
    for (const tema of (argumento("--temas")?.split(",") ?? ["light", "dark"]) as Array<"light" | "dark">) {
      for (const ancho of (argumento("--anchos")?.split(",").map(Number) ?? [1440, 400])) {
        if (!SOLO || SOLO === "foto") await flujoFoto(browser, cookie, ancho, tema);
        if (!SOLO || SOLO === "errores") await flujoErrores(browser, cookie, ancho, tema);
        if (!SOLO || SOLO === "visualizacion") await flujoVisualizacion(browser, cookie, ancho, tema);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(resultados.join("\n"));
  process.exitCode = resultados.some((linea) => linea.startsWith("DESBORDE") || linea.startsWith("ERRORES")) ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 2;
});
