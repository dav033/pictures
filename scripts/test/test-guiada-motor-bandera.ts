import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { cookieDeAdministrador, esAdministrador as realEsAdministrador } from "../../src/lib/feedback-ia/acceso";
import { COOKIE_MOTOR, TTL_AJUSTE_MS, crearLectorBandera, type DependenciasBandera } from "../../src/lib/guiada-motor/bandera";

/** Precedencia de la bandera GUIADA_MOTOR (cookie de administrador > ajustes_runtime > env > python), sin Neon ni red. */

const CLAVE_APP = "clave-app-de-prueba";
const CLAVE_ADMIN = "clave-admin-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const COOKIE_ADMIN = cookieDeAdministrador(CLAVE_ADMIN).split(";")[0]!;

let appAnterior: string | undefined;
let adminAnterior: string | undefined;
beforeEach(() => {
  appAnterior = process.env.APP_PASSWORD;
  adminAnterior = process.env.ADMIN_PASSWORD;
  process.env.APP_PASSWORD = CLAVE_APP;
  process.env.ADMIN_PASSWORD = CLAVE_ADMIN;
});
afterEach(() => {
  if (appAnterior === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = appAnterior;
  if (adminAnterior === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = adminAnterior;
});

function peticion(cookies: string[] = [SESION]): Request {
  return new Request("https://app.test/api/guiada/motor", { headers: cookies.length ? { cookie: cookies.join("; ") } : {} });
}

function montar(extra: { ajuste?: string | null | (() => Promise<string | null>); env?: string; reloj?: { ms: number } } = {}) {
  const reloj = extra.reloj ?? { ms: 1_000 };
  const lecturas = { ajuste: 0 };
  const deps: DependenciasBandera = {
    // La comprobación real de acceso.ts, no un doble: la prueba cubre «la cookie se ignora sin administrador».
    esAdministrador: realEsAdministrador,
    leerAjuste: async () => {
      lecturas.ajuste += 1;
      const ajuste = extra.ajuste;
      return typeof ajuste === "function" ? ajuste() : ajuste ?? null;
    },
    env: () => extra.env,
    ahora: () => reloj.ms,
  };
  return { leer: crearLectorBandera(deps), lecturas, reloj };
}

test("sin nada configurado el motor es python (defecto)", async () => {
  assert.deepEqual(await montar().leer(peticion()), { motor: "python", fuente: "defecto" });
});

test("la variable de entorno gana al defecto; un valor inválido se ignora", async () => {
  assert.deepEqual(await montar({ env: "3d" }).leer(peticion()), { motor: "3d", fuente: "env" });
  assert.deepEqual(await montar({ env: " 3D " }).leer(peticion()), { motor: "3d", fuente: "env" });
  assert.deepEqual(await montar({ env: "tres-d" }).leer(peticion()), { motor: "python", fuente: "defecto" });
});

test("el ajuste de Neon gana a la variable de entorno", async () => {
  assert.deepEqual(await montar({ ajuste: "python", env: "3d" }).leer(peticion()), { motor: "python", fuente: "ajuste" });
  assert.deepEqual(await montar({ ajuste: "3d", env: "python" }).leer(peticion()), { motor: "3d", fuente: "ajuste" });
  assert.deepEqual(await montar({ ajuste: "basura", env: "3d" }).leer(peticion()), { motor: "3d", fuente: "env" }, "una fila inválida no manda");
});

test("la cookie de un administrador gana a todo y no consulta Neon", async () => {
  const { leer, lecturas } = montar({ ajuste: "python", env: "python" });
  assert.deepEqual(await leer(peticion([SESION, COOKIE_ADMIN, `${COOKIE_MOTOR}=3d`])), { motor: "3d", fuente: "cookie" });
  assert.equal(lecturas.ajuste, 0);
  assert.deepEqual(await montar({ ajuste: "3d" }).leer(peticion([SESION, COOKIE_ADMIN, `${COOKIE_MOTOR}=python`])), { motor: "python", fuente: "cookie" });
});

test("la cookie se ignora sin sesión de administrador, con la cookie de administrador mala o sin ADMIN_PASSWORD", async () => {
  const esperado = { motor: "python", fuente: "env" };
  assert.deepEqual(await montar({ env: "python" }).leer(peticion([SESION, `${COOKIE_MOTOR}=3d`])), esperado, "cliente normal");
  assert.deepEqual(await montar({ env: "python" }).leer(peticion([SESION, "feedback_admin=falsa", `${COOKIE_MOTOR}=3d`])), esperado, "cookie de administrador falsa");
  assert.deepEqual(await montar({ env: "python" }).leer(peticion([COOKIE_ADMIN, `${COOKIE_MOTOR}=3d`])), esperado, "sin la sesión de la app");
  delete process.env.ADMIN_PASSWORD;
  assert.deepEqual(await montar({ env: "python" }).leer(peticion([SESION, COOKIE_ADMIN, `${COOKIE_MOTOR}=3d`])), esperado, "ADMIN_PASSWORD sin configurar: cerrado");
});

test("una cookie inválida de administrador cae al siguiente nivel", async () => {
  assert.deepEqual(await montar({ ajuste: "3d" }).leer(peticion([SESION, COOKIE_ADMIN, `${COOKIE_MOTOR}=otro`])), { motor: "3d", fuente: "ajuste" });
});

test("el ajuste se cachea 30 s y después se vuelve a leer", async () => {
  let valor: string | null = "3d";
  const { leer, lecturas, reloj } = montar({ ajuste: async () => valor });
  assert.equal((await leer(peticion())).motor, "3d");
  valor = "python";
  reloj.ms += TTL_AJUSTE_MS - 1;
  assert.equal((await leer(peticion())).motor, "3d", "dentro del TTL no consulta");
  assert.equal(lecturas.ajuste, 1);
  reloj.ms += 1;
  assert.deepEqual(await leer(peticion()), { motor: "python", fuente: "ajuste" });
  assert.equal(lecturas.ajuste, 2);
});

test("lecturas simultáneas comparten una sola consulta a Neon", async () => {
  const { leer, lecturas } = montar({ ajuste: async () => "3d" });
  const todas = await Promise.all([leer(peticion()), leer(peticion()), leer(peticion())]);
  assert.ok(todas.every((lectura) => lectura.motor === "3d"));
  assert.equal(lecturas.ajuste, 1);
});

test("si Neon falla la bandera sigue con la variable de entorno y no reintenta dentro del TTL", async () => {
  const { leer, lecturas, reloj } = montar({ ajuste: async () => { throw new Error("relation \"ajustes_runtime\" does not exist"); }, env: "3d" });
  assert.deepEqual(await leer(peticion()), { motor: "3d", fuente: "env" });
  assert.deepEqual(await leer(peticion()), { motor: "3d", fuente: "env" });
  assert.equal(lecturas.ajuste, 1);
  reloj.ms += TTL_AJUSTE_MS;
  await leer(peticion());
  assert.equal(lecturas.ajuste, 2);
});
