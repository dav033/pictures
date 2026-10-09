import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { cookieDeAdministrador } from "../../src/lib/feedback-ia/acceso";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "../../src/lib/ia/guiado/widgets";
import { atenderFijarMotor, atenderLecturaMotor, type DependenciasMotor } from "../../src/lib/guiada-motor/manejadores";
import { GET, POST } from "../../src/app/api/guiada/motor/route";
import { pedirMotorGuiada } from "../../src/components/guiado/usarMotorGuiada";

/** /api/guiada/motor (GET y POST), el cliente que la lee y el upcast del widget del plan, sin red ni Neon. */

const CLAVE_APP = "clave-app-de-prueba";
const CLAVE_ADMIN = "clave-admin-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const COOKIE_ADMIN = cookieDeAdministrador(CLAVE_ADMIN).split(";")[0]!;

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR };
  process.env.APP_PASSWORD = CLAVE_APP;
  process.env.ADMIN_PASSWORD = CLAVE_ADMIN;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
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
const post = (cuerpo: unknown, cookies: string[] = [SESION, COOKIE_ADMIN], cabeceras: Record<string, string> = {}) =>
  new Request("https://app.test/api/guiada/motor", { method: "POST", headers: { "content-type": "application/json", cookie: cookies.join("; "), ...cabeceras }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });

test("GET devuelve {motor, fuente} sin caché", async () => {
  const { deps, auditorias } = dependencias("3d", "ajuste");
  const respuesta = await atenderLecturaMotor(get(), deps);
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.deepEqual(await respuesta.json(), { motor: "3d", fuente: "ajuste" });
  assert.equal(auditorias.length, 0, "una lectura sin ?para=plan_nuevo no llena la auditoría");
});

test("GET ?para=plan_nuevo deja decidir(regla:motor_guiada) con la bandera leída y el motor efectivo (python)", async () => {
  const { deps, auditorias } = dependencias("3d", "cookie");
  await atenderLecturaMotor(get("/api/guiada/motor?para=plan_nuevo"), deps);
  assert.equal(auditorias.length, 1);
  assert.equal(auditorias[0]!.quien, "regla:motor_guiada");
  assert.deepEqual(auditorias[0]!.resultado, { bandera: "3d", fuente: "cookie", efectivo: "python" }, "en la fase 0 el plan sale de Python aunque la bandera diga 3d");
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

test("POST rechaza: sin sesión (401), cliente normal (401), otro origen (403), ADMIN_PASSWORD ausente (403)", async () => {
  assert.equal((await atenderFijarMotor(post({ motor: "3d" }, []))).status, 401);
  const normal = await atenderFijarMotor(post({ motor: "3d" }, [SESION]));
  assert.equal(normal.status, 401);
  assert.equal(normal.headers.get("set-cookie"), null, "un cliente normal no recibe la cookie");
  assert.equal((await atenderFijarMotor(post({ motor: "3d" }, [SESION, COOKIE_ADMIN], { origin: "https://otro.test" }))).status, 403);
  delete process.env.ADMIN_PASSWORD;
  assert.equal((await atenderFijarMotor(post({ motor: "3d" }))).status, 403);
});

test("POST valida el cuerpo", async () => {
  for (const cuerpo of [{ motor: "cuatro-d" }, { motor: "3d", extra: 1 }, {}, "no es json", "", JSON.stringify({ motor: "3d", relleno: "x".repeat(600) })]) {
    const respuesta = await atenderFijarMotor(post(cuerpo));
    assert.equal(respuesta.status, 400, JSON.stringify(cuerpo).slice(0, 60));
    assert.equal(respuesta.headers.get("set-cookie"), null);
  }
});

test("la ruta real: GET responde python por defecto y con la variable de entorno; POST sin administrador no fija nada", async () => {
  let respuesta = await GET(get());
  assert.deepEqual(await respuesta.json(), { motor: "python", fuente: "defecto" });
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  process.env.GUIADA_MOTOR = "3d";
  respuesta = await GET(get());
  assert.deepEqual(await respuesta.json(), { motor: "3d", fuente: "env" });
  respuesta = await GET(get("/api/guiada/motor", [SESION, COOKIE_ADMIN, "guiada_motor=python"]));
  assert.deepEqual(await respuesta.json(), { motor: "python", fuente: "cookie" });
  respuesta = await GET(get("/api/guiada/motor", [SESION, "guiada_motor=python"]));
  assert.deepEqual(await respuesta.json(), { motor: "3d", fuente: "env" }, "la cookie de un cliente no cuenta");
  assert.equal((await POST(post({ motor: "3d" }, [SESION]))).status, 401);
  assert.equal((await POST(post({ motor: "3d" }))).status, 200);
});

test("el cliente cae a python ante cualquier fallo y pide ?para=plan_nuevo al crear un plan", async () => {
  const pedidos: string[] = [];
  const responder = (cuerpo: unknown, estado = 200) => async (entrada: string, init?: RequestInit) => {
    pedidos.push(entrada);
    assert.equal(init?.cache, "no-store");
    return Response.json(cuerpo, { status: estado });
  };
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder({ motor: "3d", fuente: "env" }) }), { motor: "3d", fuente: "env" });
  assert.deepEqual(await pedirMotorGuiada({ para: "plan_nuevo", fetchImpl: responder({ motor: "3d", fuente: "cookie" }) }), { motor: "3d", fuente: "cookie" });
  assert.deepEqual(pedidos, ["/api/guiada/motor", "/api/guiada/motor?para=plan_nuevo"]);
  const python = { motor: "python", fuente: null };
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder({ error: "x" }, 401) }), python);
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder({ motor: "cuatro-d", fuente: "env" }) }), python);
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: responder("texto") }), python);
  assert.deepEqual(await pedirMotorGuiada({ fetchImpl: async () => { throw new TypeError("NetworkError"); } }), python);
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
