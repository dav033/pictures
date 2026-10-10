import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { cookieDeAdministrador, esAdministrador as realEsAdministrador } from "../../src/lib/feedback-ia/acceso";
import { COOKIE_MOTOR, TTL_AJUSTE_MS, crearLectorBandera, leerFilaAjuste, type ConsultaAjuste, type DependenciasBandera } from "../../src/lib/guiada-motor/bandera";

/**
 * Precedencia de la bandera GUIADA_MOTOR (cookie de administrador > corte del 3D > ajustes_runtime > env > python), sin Neon
 * ni red. El corte (`guiada_motor_corte` / `GUIADA_MOTOR_CORTE`, P-045) es aparte de la bandera: fuerza python también en los
 * planes del 3D ya abiertos, y lo dice con la fuente `corte`.
 */

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

type Lectura = string | null | (() => Promise<string | null>);
const valorDe = (lectura: Lectura | undefined): Promise<string | null> => (typeof lectura === "function" ? lectura() : Promise.resolve(lectura ?? null));

function montar(extra: { ajuste?: Lectura; env?: string; corte?: Lectura; envCorte?: string; reloj?: { ms: number } } = {}) {
  const reloj = extra.reloj ?? { ms: 1_000 };
  const lecturas = { ajuste: 0, corte: 0 };
  const deps: DependenciasBandera = {
    // La comprobación real de acceso.ts, no un doble: la prueba cubre «la cookie se ignora sin administrador».
    esAdministrador: realEsAdministrador,
    leerAjuste: async () => {
      lecturas.ajuste += 1;
      return valorDe(extra.ajuste);
    },
    env: () => extra.env,
    leerCorte: async () => {
      lecturas.corte += 1;
      return valorDe(extra.corte);
    },
    envCorte: () => extra.envCorte,
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

test("el corte del 3D (fila o variable de entorno) gana a la bandera y lo dice con la fuente «corte»", async () => {
  const cortado = { motor: "python", fuente: "corte" };
  assert.deepEqual(await montar({ corte: "activo", ajuste: "3d", env: "3d" }).leer(peticion()), cortado, "la fila del corte gana a la fila y a la variable de la bandera");
  assert.deepEqual(await montar({ envCorte: " ACTIVO ", ajuste: "3d" }).leer(peticion()), cortado, "la variable del corte también");
  assert.deepEqual(await montar({ corte: "inactivo", envCorte: "activo", ajuste: "3d" }).leer(peticion()), { motor: "3d", fuente: "ajuste" }, "la fila «inactivo» manda sobre la variable");
  assert.deepEqual(await montar({ corte: "si", envCorte: "activo", ajuste: "3d" }).leer(peticion()), cortado, "una fila inválida no manda: decide la variable");
  assert.deepEqual(await montar({ corte: "true", ajuste: "3d" }).leer(peticion()), { motor: "3d", fuente: "ajuste" }, "solo «activo» corta: un valor inventado no");
  assert.deepEqual(await montar({ ajuste: "3d" }).leer(peticion()), { motor: "3d", fuente: "ajuste" }, "sin corte, la bandera sigue igual");
});

test("la cookie del administrador gana también al corte (el dueño prueba un arreglo en su navegador) y no consulta Neon", async () => {
  const { leer, lecturas } = montar({ corte: "activo" });
  assert.deepEqual(await leer(peticion([SESION, COOKIE_ADMIN, `${COOKIE_MOTOR}=3d`])), { motor: "3d", fuente: "cookie" });
  assert.deepEqual(lecturas, { ajuste: 0, corte: 0 });
  assert.deepEqual(await leer(peticion([SESION, `${COOKIE_MOTOR}=3d`])), { motor: "python", fuente: "corte" }, "un cliente con la cookie sigue cortado");
});

test("el corte se cachea 30 s como la bandera, y si Neon falla decide la variable de entorno", async () => {
  let valor: string | null = "activo";
  const { leer, lecturas, reloj } = montar({ corte: async () => valor, ajuste: "3d" });
  assert.equal((await leer(peticion())).fuente, "corte");
  valor = "inactivo";
  reloj.ms += TTL_AJUSTE_MS - 1;
  assert.equal((await leer(peticion())).fuente, "corte", "dentro del TTL no consulta");
  reloj.ms += 1;
  assert.deepEqual(await leer(peticion()), { motor: "3d", fuente: "ajuste" });
  assert.equal(lecturas.corte, 2);
  const caido = montar({ corte: async () => { throw new Error("sin base"); }, envCorte: "activo", ajuste: "3d" });
  assert.deepEqual(await caido.leer(peticion()), { motor: "python", fuente: "corte" });
});

test("si Neon falla DESPUÉS de leer el corte, el corte sigue puesto (un error de red no lo suelta) y se reintenta al vencer el caché", async () => {
  const neon = { caido: false };
  const leerFila = (valor: string) => async () => { if (neon.caido) throw new Error("ECONNRESET"); return valor; };
  const { leer, lecturas, reloj } = montar({ corte: leerFila("activo"), ajuste: leerFila("3d") });
  assert.equal((await leer(peticion())).fuente, "corte");
  neon.caido = true;
  reloj.ms += TTL_AJUSTE_MS;
  assert.deepEqual(await leer(peticion()), { motor: "python", fuente: "corte" }, "sigue la última lectura buena, no la variable de entorno");
  assert.deepEqual(await leer(peticion()), { motor: "python", fuente: "corte" });
  assert.equal(lecturas.corte, 2, "dentro del caché no se reintenta");
  reloj.ms += TTL_AJUSTE_MS;
  await leer(peticion());
  assert.equal(lecturas.corte, 3, "vencido el caché, se reintenta");
});

test("la bandera también sigue con su última lectura buena si Neon falla", async () => {
  const neon = { caido: false };
  const { leer, reloj } = montar({ ajuste: async () => { if (neon.caido) throw new Error("timeout"); return "3d"; }, env: "python" });
  assert.deepEqual(await leer(peticion()), { motor: "3d", fuente: "ajuste" });
  neon.caido = true;
  reloj.ms += TTL_AJUSTE_MS;
  assert.deepEqual(await leer(peticion()), { motor: "3d", fuente: "ajuste" });
});

test("leerFilaAjuste: la fila, sin fila, sin tabla (migración 032 sin aplicar) es «sin fila», y un fallo de la base se lanza", async () => {
  const consulta = (filas: Array<{ valor: string }>): ConsultaAjuste => async (sql, valores) => {
    assert.match(sql, /FROM ajustes_runtime WHERE clave = \$1/);
    assert.deepEqual(valores, ["guiada_motor_corte"]);
    return { rows: filas };
  };
  assert.equal(await leerFilaAjuste(consulta([{ valor: "activo" }]), "guiada_motor_corte"), "activo");
  assert.equal(await leerFilaAjuste(consulta([]), "guiada_motor_corte"), null);
  const sinTabla = Object.assign(new Error("relation \"ajustes_runtime\" does not exist"), { code: "42P01" });
  assert.equal(await leerFilaAjuste(async () => { throw sinTabla; }, "guiada_motor_corte"), null);
  const avisos = console.warn;
  console.warn = () => undefined;
  try {
    await assert.rejects(() => leerFilaAjuste(async () => { throw Object.assign(new Error("Connection terminated"), { code: "57P01" }); }, "guiada_motor_corte"), /Connection terminated/);
  } finally {
    console.warn = avisos;
  }
});
