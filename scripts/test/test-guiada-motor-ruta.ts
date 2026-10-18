import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "../../src/lib/ia/guiado/widgets";
import { atenderFijarMotor, atenderLecturaMotor, type DependenciasMotor } from "../../src/lib/guiada-motor/manejadores";
import { GET, POST } from "../../src/app/api/guiada/motor/route";
import { reportarFalloBandera } from "../../src/components/guiado/reportar-fallo-bandera";
import { TIMEOUT_BANDERA_MS, pedirMotorGuiada } from "../../src/components/guiado/usarMotorGuiada";

/** /api/guiada/motor (GET y POST), el cliente que la lee y el upcast del widget del plan, sin red ni Neon. */

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR, GUIADA_MOTOR_CORTE: process.env.GUIADA_MOTOR_CORTE };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
  delete process.env.GUIADA_MOTOR_CORTE;
});
afterEach(() => {
  for (const [clave, valor] of Object.entries(anterior)) {
    if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor;
  }
});

function dependencias(motor: "3d" | "python" = "python", fuente: "cookie" | "ajuste" | "env" | "defecto" = "defecto") {
  const auditorias: Array<{ quien: string; que: string; resultado: unknown; entrada: unknown }> = [];
  const deps: DependenciasMotor = {
    leer: async () => ({ motor, fuente }),
    auditar: (quien, que, resultado, extra) => { auditorias.push({ quien, que, resultado, entrada: extra?.entrada }); },
  };
  return { deps, auditorias };
}

const get = (ruta = "/api/guiada/motor", cookies: string[] = [SESION]) => new Request(`https://app.test${ruta}`, { headers: cookies.length ? { cookie: cookies.join("; ") } : {} });
const post = (cuerpo: unknown, cookies: string[] = [SESION], cabeceras: Record<string, string> = {}) =>
  new Request("https://app.test/api/guiada/motor", { method: "POST", headers: { "content-type": "application/json", cookie: cookies.join("; "), ...cabeceras }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });

test("GET devuelve {motor, fuente} sin caché", async () => {
  const { deps, auditorias } = dependencias("3d", "ajuste");
  const respuesta = await atenderLecturaMotor(get(), deps);
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.deepEqual(await respuesta.json(), { motor: "3d", fuente: "ajuste" });
  assert.equal(auditorias.length, 0, "una lectura sin ?para=plan_nuevo no llena la auditoría");
});

test("GET ?para=plan_nuevo deja decidir(regla:motor_guiada) con la bandera leída y el motor con que se intentará el plan", async () => {
  const { deps, auditorias } = dependencias("3d", "cookie");
  await atenderLecturaMotor(get("/api/guiada/motor?para=plan_nuevo"), deps);
  assert.equal(auditorias.length, 1);
  assert.equal(auditorias[0]!.quien, "regla:motor_guiada");
  assert.deepEqual(auditorias[0]!.resultado, { bandera: "3d", fuente: "cookie", efectivo: "3d" }, "desde la fase 2 el plan se intenta con el motor que dice la bandera");
  assert.deepEqual(auditorias[0]!.entrada, { para: "plan_nuevo" });
});

test("GET sin sesión de la app: 401 y no lee la bandera", async () => {
  const { deps, auditorias } = dependencias();
  let lecturas = 0;
  const respuesta = await atenderLecturaMotor(get("/api/guiada/motor?para=plan_nuevo", []), { ...deps, leer: async () => { lecturas += 1; return { motor: "python", fuente: "defecto" }; } });
  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.equal(lecturas, 0);
  assert.equal(auditorias.length, 0);
});

test("POST fija la cookie solo para un administrador", async () => {
  const respuesta = await atenderFijarMotor(post({ motor: "3d" }));
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { ok: true, cookie: "3d" });
  const cookie = respuesta.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^guiada_motor=3d;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=604800/);
  assert.match((await atenderFijarMotor(post({ motor: "python" }))).headers.get("set-cookie") ?? "", /^guiada_motor=python;/);
});

test("POST defecto borra la cookie", async () => {
  const respuesta = await atenderFijarMotor(post({ motor: "defecto" }));
  assert.deepEqual(await respuesta.json(), { ok: true, cookie: null });
  assert.match(respuesta.headers.get("set-cookie") ?? "", /^guiada_motor=;.*Max-Age=0/);
});

test("POST rechaza: sin sesión (401) y otro origen (403)", async () => {
  assert.equal((await atenderFijarMotor(post({ motor: "3d" }, []))).status, 401);
  assert.equal((await atenderFijarMotor(post({ motor: "3d" }, [SESION], { origin: "https://otro.test" }))).status, 403);
});

test("POST valida el cuerpo", async () => {
  for (const cuerpo of [{ motor: "cuatro-d" }, { motor: "3d", extra: 1 }, {}, "no es json", "", JSON.stringify({ motor: "3d", relleno: "x".repeat(600) })]) {
    const respuesta = await atenderFijarMotor(post(cuerpo));
    assert.equal(respuesta.status, 400, JSON.stringify(cuerpo).slice(0, 60));
    assert.equal(respuesta.headers.get("set-cookie"), null);
  }
});

test("la ruta real: GET responde python por defecto y con la variable de entorno; POST sin sesión no fija nada", async () => {
  let respuesta = await GET(get());
  assert.deepEqual(await respuesta.json(), { motor: "python", fuente: "defecto" });
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  process.env.GUIADA_MOTOR = "3d";
  respuesta = await GET(get());
  assert.deepEqual(await respuesta.json(), { motor: "3d", fuente: "env" });
  respuesta = await GET(get("/api/guiada/motor", [SESION, "guiada_motor=python"]));
  assert.deepEqual(await respuesta.json(), { motor: "python", fuente: "cookie" });
  respuesta = await GET(get("/api/guiada/motor", ["guiada_motor=python"]));
  assert.equal(((await respuesta.json()) as { codigo?: string }).codigo, "SESION_REQUERIDA", "sin la sesión de la app no se lee nada");
  // El corte del 3D (P-045) se comprueba con la misma lectura: el paso «Verificar» de la marcha atrás de emergencia.
  process.env.GUIADA_MOTOR_CORTE = "activo";
  respuesta = await GET(get());
  assert.deepEqual(await respuesta.json(), { motor: "python", fuente: "corte" });
  delete process.env.GUIADA_MOTOR_CORTE;
  assert.equal((await POST(post({ motor: "3d" }, []))).status, 401);
  assert.equal((await POST(post({ motor: "3d" }))).status, 200);
});

test("el cliente cae a python ante cualquier fallo y pide ?para=plan_nuevo al crear un plan", async () => {
  const pedidos: string[] = [];
  const responder = (cuerpo: unknown, estado = 200) => async (entrada: string, init?: RequestInit) => {
    pedidos.push(entrada);
    assert.equal(init?.cache, "no-store");
    return Response.json(cuerpo, { status: estado });
  };
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder({ motor: "3d", fuente: "env" }) }), { motor: "3d", fuente: "env", detenido: false });
  assert.deepEqual(await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: responder({ motor: "3d", fuente: "cookie" }) }), { motor: "3d", fuente: "cookie", detenido: false });
  assert.deepEqual(pedidos, ["/api/guiada/motor", "/api/guiada/motor?para=plan_nuevo"]);
  const python = { motor: "python", fuente: null, detenido: false };
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder({ error: "x" }, 401) }), python);
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder({ motor: "cuatro-d", fuente: "env" }) }), python);
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder("texto") }), python);
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: async () => { throw new TypeError("NetworkError"); } }), python);
});

/** Una lectura de la bandera que nunca responde: solo termina cuando se aborta su señal (el tiempo o «Detener»). */
const colgada = (async (_entrada: string, init?: RequestInit) => new Promise<Response>((_resolver, rechazar) => {
  init?.signal?.addEventListener("abort", () => rechazar(new DOMException("abortado", "AbortError")));
})) as typeof fetch;

test("la bandera que no llega en el plazo manda el plan a Python y deja el motivo `bandera_timeout`, una sola vez", async () => {
  const vivo = setInterval(() => undefined, 20);
  try {
    const razones: string[] = [];
    const lectura = await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: colgada, timeoutMs: 30, reportar: (razon) => razones.push(razon) });
    assert.deepEqual({ motor: lectura.motor, detenido: lectura.detenido }, { motor: "python", detenido: false });
    assert.deepEqual(razones, ["bandera_timeout"]);
  } finally { clearInterval(vivo); }
});

test("la bandera que falla (red, 401, respuesta rara) deja `bandera_error`; la que responde a tiempo no deja nada", async () => {
  const razones: string[] = [];
  const reportar = (razon: string) => razones.push(razon);
  const responder = (cuerpo: unknown, estado = 200) => (async () => Response.json(cuerpo, { status: estado })) as unknown as typeof fetch;
  await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: responder({ motor: "3d", fuente: "cookie" }), reportar });
  assert.deepEqual(razones, [], "una bandera leída a tiempo no se reporta");
  await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: responder({ error: "x" }, 401), reportar });
  await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: responder({ motor: "cuatro-d", fuente: "env" }), reportar });
  await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: (async () => { throw new TypeError("NetworkError"); }) as typeof fetch, reportar });
  assert.deepEqual(razones, ["bandera_error", "bandera_error", "bandera_error"]);
});

test("no se reporta lo que no crea un plan nuevo: «Detener», rehacer un plan de Python ni la lectura al cargar", async () => {
  const razones: string[] = [];
  const reportar = (razon: string) => razones.push(razon);
  const fallida = (async () => { throw new TypeError("NetworkError"); }) as typeof fetch;
  const control = new AbortController();
  control.abort();
  assert.equal((await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: fallida, signal: control.signal, reportar })).detenido, true);
  const enCurso = new AbortController();
  const detenida = pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: colgada, signal: enCurso.signal, reportar });
  setTimeout(() => enCurso.abort(), 5);
  assert.equal((await detenida).detenido, true, "«Detener» durante la lectura");
  await pedirMotorGuiada({ para: "plan_python", fetchImpl: fallida, reportar });
  await pedirMotorGuiada({ fetchImpl: fallida, reportar });
  assert.deepEqual(razones, []);
});

test("el aviso va a /api/guiada/motor/plan con la razón, sobrevive a la página (keepalive) y nunca lanza aunque la red falle", async () => {
  const pedidos: Array<{ url: string; init: RequestInit | undefined }> = [];
  reportarFalloBandera("bandera_timeout", (async (url: string, init?: RequestInit) => { pedidos.push({ url, init }); return Response.json({ ok: true }); }) as unknown as typeof fetch);
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0]!.url, "/api/guiada/motor/plan");
  assert.equal(pedidos[0]!.init?.method, "POST");
  assert.equal(pedidos[0]!.init?.keepalive, true);
  assert.deepEqual(JSON.parse(String(pedidos[0]!.init?.body)), { desde: "bandera_fallida", razon: "bandera_timeout" });
  assert.doesNotThrow(() => reportarFalloBandera("bandera_error", (async () => { throw new TypeError("NetworkError"); }) as typeof fetch));
  assert.doesNotThrow(() => reportarFalloBandera("bandera_error", (() => { throw new TypeError("síncrono"); }) as typeof fetch));
  await new Promise((resolver) => setTimeout(resolver, 5));
});

test("el plazo por defecto de la bandera es 2,5 s: una lectura lenta de 1,3 s (servidor en frío) todavía cuenta", async () => {
  assert.equal(TIMEOUT_BANDERA_MS, 2500);
  const razones: string[] = [];
  const lenta = (async () => { await new Promise((resolver) => setTimeout(resolver, 1300)); return Response.json({ motor: "3d", fuente: "cookie" }); }) as unknown as typeof fetch;
  const lectura = await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: lenta, reportar: (razon) => razones.push(razon) });
  assert.deepEqual({ motor: lectura.motor, fuente: lectura.fuente }, { motor: "3d", fuente: "cookie" });
  assert.deepEqual(razones, []);
});

/* ---------- Upcast del widget del plan en la sesión guardada (demo_guiado_v2) ---------- */

const plan = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));

function motorDelWidget(crudo: unknown): string | undefined {
  const widget = WidgetGuiadoSchema.parse(crudo);
  return widget.tipo === "plan" ? widget.motor : undefined;
}

test("un widget de plan guardado antes de la bandera (sin motor) se lee como python", () => {
  const viejo = JSON.parse(JSON.stringify({ tipo: "plan", plan, ideas: ["deco-columnas"], ajustes: ["más azul"], hechas: ["ver"], fotoInspiracion: true })) as Record<string, unknown>;
  assert.equal("motor" in viejo, false);
  assert.equal(motorDelWidget(viejo), "python");
  const leido = WidgetGuiadoSchema.parse(viejo);
  assert.equal(leido.tipo === "plan" && leido.ideas?.[0], "deco-columnas", "el resto del widget se conserva");
});

test("el motor guardado se respeta y un valor extraño vuelve a python", () => {
  assert.equal(motorDelWidget({ tipo: "plan", plan, motor: "3d" }), "3d");
  assert.equal(motorDelWidget({ tipo: "plan", plan, motor: "python" }), "python");
  assert.equal(motorDelWidget({ tipo: "plan", plan, motor: "cuatro-d" }), "python");
});

test("los demás widgets guardados no ganan campo motor", () => {
  const propuesta = WidgetGuiadoSchema.safeParse({ tipo: "pregunta-propuesta", alcance: "tipo" });
  assert.ok(propuesta.success);
  assert.equal("motor" in propuesta.data, false);
});

test("GET ?para=plan_python (P-045): rehacer un plan de Python deja en la auditoría que conserva Python, diga lo que diga la bandera", async () => {
  const { deps, auditorias } = dependencias("3d", "ajuste");
  const respuesta = await atenderLecturaMotor(get("/api/guiada/motor?para=plan_python"), deps);
  assert.deepEqual(await respuesta.json(), { motor: "3d", fuente: "ajuste" }, "la respuesta no cambia: la bandera sigue diciendo lo suyo");
  assert.equal(auditorias.length, 1);
  assert.equal(auditorias[0]!.quien, "regla:motor_guiada");
  assert.deepEqual(auditorias[0]!.resultado, { bandera: "3d", fuente: "ajuste", efectivo: "python", conserva_motor: "plan_python_abierto" });
  assert.deepEqual(auditorias[0]!.entrada, { para: "plan_python" });
});
