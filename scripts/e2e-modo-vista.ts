/**
 * B3 (docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md): e2e del modo usuario/dev en la
 * pantalla principal, con la librería `playwright` (sin dependencias nuevas).
 *
 * Requiere el servidor en marcha y APP_PASSWORD en el entorno. /api/chat y
 * /api/generate se simulan con `eval/ui/plan-resuelto-arco-columnas.json`:
 * no hay llamadas pagadas. No forma parte de las pruebas rápidas.
 *
 * Uso: npx tsx scripts/e2e-modo-vista.ts [--base http://127.0.0.1:3100]
 * Sin el Chromium de Playwright instalado, apunta a otro navegador con
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const argumento = (nombre: string) => {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
};
const BASE = argumento("--base") ?? "http://127.0.0.1:3100";
const PLAN: unknown = JSON.parse(readFileSync(path.join(process.cwd(), "eval", "ui", "plan-resuelto-arco-columnas.json"), "utf8"));
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const REQUEST_ID = "4b6a3c38-5a59-4a57-9d8e-2f4f3c0a1b2c";

let pasan = 0;
const fallos: string[] = [];
function check(nombre: string, ok: boolean, detalle = ""): void {
  if (ok) pasan += 1;
  else fallos.push(nombre);
  console.log(`${ok ? "PASS" : "FAIL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

async function cookieDeSesion(): Promise<{ name: string; value: string }> {
  const password = process.env.APP_PASSWORD;
  if (!password) throw new Error("Falta APP_PASSWORD en el entorno.");
  const respuesta = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ password }), redirect: "manual" });
  const [primera] = respuesta.headers.getSetCookie();
  const [name, ...resto] = (primera ?? "").split(";")[0]!.split("=");
  if (!name || resto.length === 0) throw new Error(`Login sin cookie de sesión (HTTP ${respuesta.status}).`);
  return { name, value: resto.join("=") };
}

async function nuevaPagina(browser: Browser, cookie: { name: string; value: string }): Promise<{ page: Page; errores: string[]; cuerposGenerate: unknown[]; cerrar: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ ...cookie, url: BASE }]);
  const page = await context.newPage();
  // Playwright no pone límite a las acciones por defecto: un botón tapado colgaría la prueba.
  page.setDefaultTimeout(20_000);
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(String(error)));
  const cuerposGenerate: unknown[] = [];
  await page.route("**/api/chat", async (route) => {
    const fin = {
      schema_version: "chat.sse.v1", type: "fin", request_id: REQUEST_ID, correlation_id: REQUEST_ID,
      reply: "Te armé la propuesta.", brief: {}, proveedor: "gemini", modelo: "simulado", plan: PLAN,
      ragRechazados: [{ productId: "P-DESCARTADO", variantId: "46594221277479", motivo: "variant_id no existe en la whitelist" }],
    };
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: fin\ndata: ${JSON.stringify(fin)}\n\n` });
  });
  await page.route("**/api/generate", async (route) => {
    cuerposGenerate.push(JSON.parse(route.request().postData() ?? "{}"));
    const qa = { pass: false, confidence: "vision_assisted", retry_reasons: ["placement failure EST_02_COLUMNAS#2"], scene_spec_hash: "fixture", observed_instances: [] };
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ imagen: `data:image/png;base64,${PNG_1PX}`, modoImagen: "lora", prompts: { "LoRA Sempertex": "prompt técnico" }, prompt: "prompt técnico", qa, plan: PLAN }) });
  });
  return { page, errores, cuerposGenerate, cerrar: () => context.close() };
}

async function abrir(page: Page, query = ""): Promise<void> {
  await page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("switch-modo-vista").waitFor({ timeout: 60_000 });
  // La preferencia guardada se aplica al hidratar.
  await page.waitForTimeout(800);
}

const ariaSwitch = (page: Page) => page.getByTestId("switch-modo-vista").getAttribute("aria-checked");

async function switchYPersistencia(browser: Browser, cookie: { name: string; value: string }): Promise<void> {
  const { page, errores, cerrar } = await nuevaPagina(browser, cookie);
  await abrir(page);
  check("switch: modo usuario por defecto", (await ariaSwitch(page)) === "false");
  check("switch: role=switch con nombre accesible", (await page.getByRole("switch", { name: "Modo dev" }).count()) === 1);
  await page.getByTestId("switch-modo-vista").click();
  check("switch: clic activa modo dev", (await ariaSwitch(page)) === "true");
  await abrir(page);
  check("switch: modo dev persiste al recargar", (await ariaSwitch(page)) === "true");
  await page.getByTestId("switch-modo-vista").focus();
  await page.keyboard.press("Space");
  check("switch: Espacio con foco vuelve a usuario", (await ariaSwitch(page)) === "false");
  await abrir(page, "?dev=1");
  check("switch: ?dev=1 activa dev", (await ariaSwitch(page)) === "true");
  await abrir(page, "?dev=0");
  check("switch: ?dev=0 vuelve a usuario", (await ariaSwitch(page)) === "false");
  check("switch: sin errores de runtime", errores.length === 0, errores.join(" | "));
  await cerrar();
}

async function contenidoPorModo(browser: Browser, cookie: { name: string; value: string }, modo: "usuario" | "dev"): Promise<void> {
  const esDev = modo === "dev";
  const t = (nombre: string) => `[${modo}] ${nombre}`;
  const { page, errores, cuerposGenerate, cerrar } = await nuevaPagina(browser, cookie);
  await abrir(page, `?dev=${esDev ? 1 : 0}`);
  const hay = async (locator: ReturnType<Page["locator"]>) => (await locator.count()) > 0;

  check(t("selector de modelo solo en dev"), (await hay(page.locator("#selector-modelo"))) === esDev);
  check(t("casilla de validación visual solo en dev"), (await hay(page.getByText("Validar visualmente"))) === esDev);
  check(t("Estadísticas, Laboratorio JSON y Configuración LoRA solo en dev"), (await hay(page.getByRole("link", { name: "Estadísticas" }))) === esDev && (await hay(page.getByRole("link", { name: "Laboratorio JSON" }))) === esDev && (await hay(page.getByRole("link", { name: "Configuración LoRA" }))) === esDev);
  check(t("Explorar catálogo en ambos modos"), (await page.getByRole("link", { name: "Explorar catálogo" }).count()) === 1);

  const entrada = page.getByRole("textbox").first();
  await entrada.fill("Arco blanco y dorado con columnas");
  await entrada.press("Enter");
  await page.getByTestId("plan-desglose").waitFor({ timeout: 30_000 });
  check(t("niveles de coincidencia solo en dev"), (await hay(page.getByTestId("plan-match-levels"))) === esDev);
  check(t("ajustes declarados solo en dev"), (await hay(page.getByTestId("plan-event-relaxations"))) === esDev);
  check(t("id de pieza descartada solo en dev"), (await hay(page.getByText("46594221277479"))) === esDev);
  if (!esDev) check(t("aviso humano de pieza descartada"), await hay(page.getByText("Una pieza que te propuse ya no está disponible")));
  const textoAprobar = (await page.getByTestId("aprobar-generar-plan").innerText()).trim();
  check(t("aprobar: dev exige la casilla, usuario no"), esDev ? textoAprobar === "Activa la validación visual" : textoAprobar === "Aprobar y generar imagen", textoAprobar);

  if (!esDev) {
    await page.getByTestId("aprobar-generar-plan-sticky").click();
    await page.locator("img[alt^='Visualización']").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const cuerpo = (cuerposGenerate[0] ?? {}) as { imageQaRequested?: unknown; usarLora?: unknown; loraMode?: unknown };
    check(t("aprobar envía revisión visual obligatoria"), cuerpo.imageQaRequested === true);
    check(t("sin adjuntos usa LoRA con modo"), cuerpo.usarLora === true && typeof cuerpo.loraMode === "string");
    check(t("el modal del prompt no se abre solo"), (await page.getByRole("dialog").count()) === 0);
    check(t("sin 'Generada con' ni 'Ver prompt usado'"), !(await hay(page.getByText("Ver prompt usado"))) && !(await hay(page.getByText(/Generada con/))));
    check(t("sin razones técnicas del QA y con aviso humano"), !(await hay(page.getByText("placement failure"))) && (await hay(page.getByTestId("aviso-imagen-no-fiel"))));
  }
  check(t("sin errores de runtime"), errores.length === 0, errores.join(" | "));
  await cerrar();
}

async function main(): Promise<void> {
  const cookie = await cookieDeSesion();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({ executablePath, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
  try {
    await switchYPersistencia(browser, cookie);
    await contenidoPorModo(browser, cookie, "usuario");
    await contenidoPorModo(browser, cookie, "dev");
  } finally {
    await browser.close();
  }
  console.log(`\n${pasan} PASS, ${fallos.length} FAIL${fallos.length ? `: ${fallos.join("; ")}` : ""}`);
  process.exitCode = fallos.length ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 2;
});
