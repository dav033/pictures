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
// D3 (E2E real 2): PlanResuelto real con el mismo globo comprado en dos tamaños de paquete.
const PLAN_D3: unknown = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "fixtures", "plan-d3-paquetes-combinados.json"), "utf8"));
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
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ imagen: `data:image/png;base64,${PNG_1PX}`, modoImagen: "lora", prompts: { "LoRA Sempertex": "prompt técnico" }, prompt: "prompt técnico", plan: PLAN }) });
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
  // Iteración 4: los enlaces viven en el menú "⋯" de la cabecera de una sola línea.
  await page.getByTestId("menu-app").click();
  await page.getByRole("menu").waitFor();
  check(t("Estadísticas, Laboratorio JSON y Configuración LoRA solo en dev"), (await hay(page.getByRole("menuitem", { name: "Estadísticas" }))) === esDev && (await hay(page.getByRole("menuitem", { name: "Laboratorio JSON" }))) === esDev && (await hay(page.getByRole("menuitem", { name: "Configuración LoRA" }))) === esDev);
  check(t("Explorar catálogo en ambos modos"), (await page.getByRole("menuitem", { name: "Explorar catálogo" }).count()) === 1);
  await page.keyboard.press("Escape");
  check(t("Escape cierra el menú y devuelve el foco"), (await page.getByRole("menu").count()) === 0 && (await page.getByTestId("menu-app").evaluate((boton) => boton === document.activeElement)));

  const entrada = page.getByRole("textbox").first();
  await entrada.fill("Arco blanco y dorado con columnas");
  await entrada.press("Enter");
  await page.getByTestId("plan-desglose").waitFor({ timeout: 30_000 });
  check(t("niveles de coincidencia solo en dev"), (await hay(page.getByTestId("plan-match-levels"))) === esDev);
  check(t("ajustes declarados solo en dev"), (await hay(page.getByTestId("plan-event-relaxations"))) === esDev);
  check(t("id de pieza descartada solo en dev"), (await hay(page.getByText("46594221277479"))) === esDev);
  if (!esDev) check(t("aviso humano de pieza descartada"), await hay(page.getByText("Una pieza que te propuse ya no está disponible")));
  const textoAprobar = (await page.getByTestId("aprobar-generar-plan").innerText()).trim();
  check(t("aprobar: mismo texto en ambos modos, sin QA obligatorio"), textoAprobar === "Aprobar y ver cómo queda", textoAprobar);

  if (!esDev) {
    // Sin dock duplicado: aprobar vive dentro de la tarjeta de la propuesta.
    check(t("sin botón de aprobar duplicado fuera de la tarjeta"), (await page.getByTestId("aprobar-generar-plan-sticky").count()) === 0 && (await page.getByTestId("aprobar-generar-plan").count()) === 1);
    await page.getByTestId("aprobar-generar-plan").click();
    await page.locator("img[alt^='Visualización']").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const cuerpo = (cuerposGenerate[0] ?? {}) as { usarLora?: unknown; loraMode?: unknown };
    check(t("sin adjuntos usa LoRA con modo"), cuerpo.usarLora === true && typeof cuerpo.loraMode === "string");
    check(t("el modal del prompt no se abre solo"), (await page.getByRole("dialog").count()) === 0);
    check(t("sin 'Generada con' ni 'Ver prompt usado'"), !(await hay(page.getByText("Ver prompt usado"))) && !(await hay(page.getByText(/Generada con/))));
  }
  check(t("sin errores de runtime"), errores.length === 0, errores.join(" | "));
  await cerrar();
}

/** Iteración 4: interruptor de tema persistente y foto de ejemplo adjunta al compositor. */
async function temaYGaleria(browser: Browser, cookie: { name: string; value: string }): Promise<void> {
  const { page, errores, cuerposGenerate, cerrar } = await nuevaPagina(browser, cookie);
  await page.route("**/api/references/analyze", (route) => route.fulfill({ status: 503, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "simulado" }) }));
  await page.emulateMedia({ colorScheme: "light" });
  await abrir(page);
  const tema = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  check("tema: sin elección sigue al sistema (sin data-theme)", (await tema()) === null);
  await page.getByTestId("interruptor-tema").click();
  check("tema: el interruptor pasa a oscuro", (await tema()) === "dark");
  await abrir(page);
  check("tema: la elección persiste al recargar (script antes de pintar)", (await tema()) === "dark");
  await page.getByTestId("interruptor-tema").click();
  check("tema: volver a claro", (await tema()) === "light");
  // D10: el menú ⋯ permite volver a seguir al sistema sin romper el cambio rápido.
  await page.getByTestId("menu-app").click();
  await page.getByRole("menuitemradio", { name: "Claro" }).waitFor();
  check("tema: el menú marca Claro como elección actual", (await page.getByRole("menuitemradio", { name: "Claro" }).getAttribute("aria-checked")) === "true" && (await page.getByRole("menuitemradio", { name: "Sistema" }).getAttribute("aria-checked")) === "false");
  await page.getByRole("menuitemradio", { name: "Sistema" }).click();
  const guardadoTema = await page.evaluate(() => localStorage.getItem("demo-decoracion:tema"));
  check("tema: «Sistema» quita la elección y vuelve a seguir al sistema", (await tema()) === null && guardadoTema === null, String(guardadoTema));
  check("tema: al elegir, el foco vuelve al botón del menú", await page.getByTestId("menu-app").evaluate((boton) => boton === document.activeElement));
  await page.emulateMedia({ colorScheme: "dark" });
  const fondoOscuro = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  check("tema: con «Sistema» sigue al esquema del sistema", fondoOscuro !== (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)), fondoOscuro);
  check("galería: 10 fotos de ejemplo con crédito", (await page.locator("[data-testid^='ejemplo-ejemplo-']").count()) === 10 && (await page.getByText("Fotos de ejemplo · Pexels").count()) === 1);
  await page.getByTestId("ejemplo-ejemplo-01").click();
  await page.locator("[data-adjunto='referencia']").first().waitFor({ timeout: 20_000 });
  check("galería: la foto elegida queda adjunta como chip", (await page.locator("[data-adjunto='referencia']").count()) === 1 && (await page.getByTestId("ejemplo-ejemplo-01").getAttribute("aria-pressed")) === "true");
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("sin desborde horizontal a 1280 px", desborde <= 0, String(desborde));
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(400);
  const desbordeMovil = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("sin desborde horizontal a 400 px", desbordeMovil <= 0, String(desbordeMovil));

  // El análisis de la foto falló (503): el turno sale enseguida, sin agotar el
  // límite de espera, y aprobar la propuesta sí crea la imagen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Reintentar" }).first().waitFor({ timeout: 20_000 });
  let chatEnviadoEn = 0;
  page.on("request", (peticion) => {
    if (!chatEnviadoEn && new URL(peticion.url()).pathname === "/api/chat") chatEnviadoEn = Date.now();
  });
  const envioEn = Date.now();
  const entrada = page.getByRole("textbox", { name: "Escribe tu mensaje" });
  await entrada.fill("Quiero algo así");
  await entrada.press("Enter");
  await page.getByTestId("plan-desglose").waitFor({ timeout: 60_000 });
  check("análisis fallido: el turno no espera el límite", chatEnviadoEn > 0 && chatEnviadoEn - envioEn < 5_000, `${chatEnviadoEn - envioEn} ms`);
  await page.getByTestId("aprobar-generar-plan").click();
  const hayImagen = await page.locator("img[alt^='Visualización']").first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("análisis fallido: aprobar la propuesta crea la imagen", hayImagen && cuerposGenerate.length === 1, `${cuerposGenerate.length} llamadas a /api/generate`);
  // Recargar conserva la miniatura de la foto del turno (guardada liviana en sessionStorage).
  await page.waitForTimeout(1_000);
  await abrir(page);
  await page.locator(".msg-usuario-foto").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  const miniaturaTrasRecargar = await page.locator(".msg-usuario-foto").first().getAttribute("src").catch(() => null);
  const guardado = await page.evaluate(() => sessionStorage.getItem("demo_chat_v4")?.length ?? 0);
  check("recargar conserva la miniatura de la foto del turno", Boolean(miniaturaTrasRecargar?.startsWith("data:image/jpeg")) && guardado < 400_000, `${guardado} caracteres guardados`);
  // D5: la imagen aprobada y la aprobación sobreviven a la recarga; no se ofrece aprobar (pagar) otra vez.
  const imagenTrasRecargar = await page.locator("img[alt^='Visualización']").first().getAttribute("src", { timeout: 10_000 }).catch(() => null);
  check("recargar conserva la imagen aprobada (versión reducida)", Boolean(imagenTrasRecargar?.startsWith("data:image/jpeg")), imagenTrasRecargar?.slice(0, 30) ?? "sin imagen");
  const aprobarTrasRecargar = page.getByTestId("aprobar-generar-plan");
  check("recargar no vuelve a ofrecer «Aprobar»", (await aprobarTrasRecargar.innerText()).trim() === "Aprobación registrada" && await aprobarTrasRecargar.isDisabled(), (await aprobarTrasRecargar.innerText()).trim());
  // Sin espacio para la imagen: aviso «Ya generaste esta imagen» con opción explícita de volver a crearla.
  await page.evaluate(() => {
    const clave = "demo_generaciones_v1";
    const datos = JSON.parse(sessionStorage.getItem(clave) ?? "{}") as { generaciones?: Array<{ imagen: string | null }> };
    sessionStorage.setItem(clave, JSON.stringify({ ...datos, generaciones: (datos.generaciones ?? []).map((generacion) => ({ ...generacion, imagen: null })) }));
  });
  await abrir(page);
  await page.getByTestId("aviso-imagen-ya-generada").waitFor({ timeout: 20_000 }).catch(() => undefined);
  check("sin imagen guardada: «Ya generaste esta imagen» y «Volver a crear la imagen»", (await page.getByText("Ya generaste esta imagen").count()) === 1 && (await page.getByRole("button", { name: "Volver a crear la imagen" }).count()) === 1);
  check("sin imagen guardada: tampoco se ofrece «Aprobar»", (await page.getByTestId("aprobar-generar-plan").innerText()).trim() === "Aprobación registrada" && cuerposGenerate.length === 1, `${cuerposGenerate.length} llamadas a /api/generate`);
  check("tema y galería: sin errores de runtime", errores.length === 0, errores.join(" | "));
  await cerrar();
}

/**
 * Segunda E2E real: la cotización agrupa paquetes combinados (D3), la
 * creatividad sobrevive a la recarga y una aprobación sin vista previa (fal sin
 * saldo, 400 VISTA_PREVIA_NO_DISPONIBLE) queda registrada con su aviso.
 */
async function creatividadYVistaPrevia(browser: Browser, cookie: { name: string; value: string }): Promise<void> {
  const { page, errores, cerrar } = await nuevaPagina(browser, cookie);
  const cuerposChat: Array<{ creatividad?: unknown }> = [];
  const llamadasGenerate: number[] = [];
  await page.route("**/api/chat", async (route) => {
    cuerposChat.push(JSON.parse(route.request().postData() ?? "{}"));
    const fin = { schema_version: "chat.sse.v1", type: "fin", request_id: REQUEST_ID, correlation_id: REQUEST_ID, reply: "Te armé la propuesta.", brief: {}, proveedor: "gemini", modelo: "simulado", plan: PLAN_D3 };
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: fin\ndata: ${JSON.stringify(fin)}\n\n` });
  });
  await page.route("**/api/generate", async (route) => {
    llamadasGenerate.push(Date.now());
    const uiError = { schema_version: "ui-error.v1", code: "VISTA_PREVIA_NO_DISPONIBLE", mensaje_usuario: "La vista previa de la imagen no está disponible por ahora. Tu propuesta y su precio quedan guardados.", accion_sugerida: null, acciones_alternativas: [], retryable: false, detalles_dev: { mensaje: "fal 403 simulado" } };
    await route.fulfill({ status: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "fal 403 simulado", ui_error: uiError }) });
  });
  await abrir(page, "?dev=0");
  await page.getByTestId("selector-creatividad").click();
  await page.getByRole("option", { name: /^Fiel/ }).click();
  const entrada = page.getByRole("textbox", { name: "Escribe tu mensaje" });
  await entrada.fill("Decoración de gala para 40 años en azul y plata");
  await entrada.press("Enter");
  await page.getByTestId("plan-desglose").waitFor({ timeout: 30_000 });
  check("creatividad: el turno va con «Fiel» (0)", cuerposChat[0]?.creatividad === 0, String(cuerposChat[0]?.creatividad));

  // D3: una fila por producto + tamaño + color en el diálogo de la cotización.
  await page.getByRole("button", { name: "Ver cotización" }).first().click();
  const dialogo = page.getByRole("dialog");
  await dialogo.waitFor();
  const filas = dialogo.getByRole("row");
  await page.waitForTimeout(2_000);
  const textoDialogo = await dialogo.innerText();
  check("D3: cotización con una fila por producto, tamaño y color", (await filas.count()) === 6, `${await filas.count()} filas (con cabecera)`);
  check("D3: paquetes combinados en una fila", textoDialogo.includes("1 paquete de 50 + 2 paquetes de 20") && textoDialogo.includes("1 paquete de 50 + 1 paquete de 12"));
  check("D3: el total no cambia", /95\.309/.test(textoDialogo));
  await page.keyboard.press("Escape");

  await page.getByTestId("aprobar-generar-plan").click();
  await page.getByText("La vista previa de la imagen no está disponible por ahora").first().waitFor({ timeout: 20_000 });
  check("D5 sin foto: la aprobación queda registrada en la sesión", (await page.getByTestId("aprobar-generar-plan").innerText()).trim() === "Aprobación registrada");
  await page.waitForTimeout(800);
  await abrir(page);
  await page.getByTestId("plan-desglose").waitFor({ timeout: 20_000 });
  check("creatividad: tras recargar sigue «Fiel»", (await page.getByTestId("selector-creatividad").getAttribute("aria-label")) === "Creatividad: Fiel", String(await page.getByTestId("selector-creatividad").getAttribute("aria-label")));
  const aviso = page.getByTestId("aviso-vista-previa-no-disponible");
  await aviso.waitFor({ timeout: 10_000 }).catch(() => undefined);
  check("D5 sin foto: tras recargar muestra el aviso de vista previa no disponible", (await aviso.count()) === 1 && (await aviso.innerText()).includes("La vista previa de la imagen no está disponible por ahora"));
  check("D5 sin foto: tras recargar no vuelve «Aprobar y ver cómo queda»", (await page.getByTestId("aprobar-generar-plan").innerText()).trim() === "Aprobación registrada" && llamadasGenerate.length === 1, `${llamadasGenerate.length} llamadas a /api/generate`);
  check("D5 sin foto: opción explícita de volver a intentar la imagen", (await aviso.getByRole("button", { name: "Volver a intentar la imagen" }).count()) === 1);
  await aviso.getByRole("button", { name: "Volver a intentar la imagen" }).click().catch(() => undefined);
  await page.waitForTimeout(1_500);
  check("D5 sin foto: «Volver a intentar la imagen» pide la imagen otra vez", llamadasGenerate.length === 2, `${llamadasGenerate.length} llamadas a /api/generate`);
  await entrada.fill("Cambia el plateado por blanco");
  await entrada.press("Enter");
  await page.waitForTimeout(1_500);
  check("creatividad: el turno tras recargar se valida con «Fiel»", cuerposChat.length === 2 && cuerposChat[1]?.creatividad === 0, String(cuerposChat[1]?.creatividad));
  check("creatividad y vista previa: sin errores de runtime", errores.length === 0, errores.join(" | "));
  await cerrar();
}

async function main(): Promise<void> {
  const cookie = await cookieDeSesion();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({ executablePath, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
  try {
    await switchYPersistencia(browser, cookie);
    await temaYGaleria(browser, cookie);
    await creatividadYVistaPrevia(browser, cookie);
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
