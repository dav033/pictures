/**
 * `GET /api/catalogo/repositorios` (REQ-013 fase 5, T23) y la bandera de la interfaz por repositorio (`catalogo_ui_repositorios`).
 * - la bandera nace ENCENDIDA (beta, D-039); manda la fila de `ajustes_runtime`, luego la variable `CATALOGO_UI_REPOSITORIOS`;
 *   «apagada» es la marcha atrás y acepta los dos vocabularios del proyecto; un valor no vacío que no se entiende APAGA (se avisa como error);
 *   la fila se cachea 30 s y, con Neon caído, vale la última lectura buena;
 * - la respuesta: los manifiestos en su orden, `visible` según la superficie `taller` (fila, variable o manifiesto), `ui`, y
 *   nada de rutas del servidor (el archivo de una lista de alquiler);
 * - la ruta pide sesión y mismo origen, no se cachea y dice lo mismo que el constructor puro.
 * Sin coste, sin red ni base.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-api.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { GET } from "../../src/app/api/catalogo/repositorios/route";
import { SESSION_COOKIE, sessionToken } from "../../src/lib/auth/session";
import { TTL_AJUSTE_MS } from "../../src/lib/ajustes/ajustes-runtime";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { construirRespuestaRepositorios } from "../../src/lib/catalogo/repositorios-publicos";
import { interpretarRespuestaRepositorios, RespuestaRepositoriosSchema, RUTA_REPOSITORIOS } from "../../src/lib/catalogo/repositorios-api-tipos";
import type { ManifiestoRepositorio } from "../../src/lib/catalogo/tipos";
import { CLAVE_AJUSTE_UI_REPOSITORIOS, crearLectorUiRepositorios, estadoDeUi, VARIABLE_UI_REPOSITORIOS } from "../../src/lib/catalogo/ui-repositorios";

type Lectura = string | null | (() => Promise<string | null>);

function montar(extra: { ajuste?: Lectura; env?: string; reloj?: { ms: number } } = {}) {
  const reloj = extra.reloj ?? { ms: 1_000 };
  const lecturas = { ajuste: 0 };
  const leer = crearLectorUiRepositorios({
    leerAjuste: async () => {
      lecturas.ajuste += 1;
      return typeof extra.ajuste === "function" ? extra.ajuste() : (extra.ajuste ?? null);
    },
    env: () => extra.env,
    ahora: () => reloj.ms,
  });
  return { leer, lecturas, reloj };
}

async function conAvisos<T>(fn: () => Promise<T>): Promise<{ valor: T; errores: string[] }> {
  const errores: string[] = [];
  const original = console.error;
  console.error = (...partes: unknown[]) => { errores.push(partes.map(String).join(" ")); };
  try {
    return { valor: await fn(), errores };
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// La bandera
// ---------------------------------------------------------------------------------------------------------------------

test("sin nada configurado la interfaz por repositorio está ENCENDIDA (beta)", async () => {
  assert.deepEqual(await montar().leer(), { activa: true, fuente: "defecto" });
});

test("la variable de entorno la apaga (marcha atrás) o la enciende, con los dos vocabularios", async () => {
  for (const valor of ["inactivo", "false", "off", "0", " FALSE ", "Inactivo"]) assert.deepEqual(await montar({ env: valor }).leer(), { activa: false, fuente: "env" }, valor);
  for (const valor of ["activo", "true", "on", "1"]) assert.deepEqual(await montar({ env: valor }).leer(), { activa: true, fuente: "env" }, valor);
});

test("la fila de ajustes_runtime manda sobre la variable", async () => {
  assert.deepEqual(await montar({ ajuste: "inactivo", env: "true" }).leer(), { activa: false, fuente: "ajuste" });
  assert.deepEqual(await montar({ ajuste: "activo", env: "false" }).leer(), { activa: true, fuente: "ajuste" });
});

test("la marcha atrás nunca falla en silencio: lo que no se entiende APAGA (el panel de siempre) y se avisa como error, una vez", async () => {
  const { valor, errores } = await conAvisos(async () => {
    const { leer } = montar({ ajuste: "desacticado", env: "true" });
    return [await leer(), await leer()];
  });
  assert.deepEqual(valor, [{ activa: false, fuente: "ajuste" }, { activa: false, fuente: "ajuste" }], "la fila con errata apaga, aunque la variable diga true");
  assert.equal(errores.length, 1, "un aviso, no uno por lectura");
  assert.match(errores[0]!, /catalogo_ui_repositorios \(ajustes_runtime\) = «desacticado» no se entiende.*APAGADO/);
  assert.deepEqual((await conAvisos(() => montar({ env: "ni idea" }).leer())).valor, { activa: false, fuente: "env" });
  for (const apagar of ["inactiva", "apagada", "desactivado", "inactive", "disabled", "no", "NO"]) assert.equal(estadoDeUi(apagar, "x"), false, apagar);
  for (const encender of ["activa", "si", "sí", "yes", "enabled", "encendido"]) assert.equal(estadoDeUi(encender, "x"), true, encender);
});

test("vacío es «sin configurar»: pasa al siguiente nivel, sin aviso", async () => {
  const { valor, errores } = await conAvisos(async () => [estadoDeUi("", "x"), estadoDeUi("  ", "x"), estadoDeUi(null, "x"), estadoDeUi(undefined, "x"), await montar({ ajuste: "", env: "" }).leer()]);
  assert.deepEqual(valor, [null, null, null, null, { activa: true, fuente: "defecto" }]);
  assert.deepEqual(errores, []);
});

test("la fila y la variable son las que documenta la marcha atrás", () => {
  assert.equal(CLAVE_AJUSTE_UI_REPOSITORIOS, "catalogo_ui_repositorios");
  assert.equal(VARIABLE_UI_REPOSITORIOS, "CATALOGO_UI_REPOSITORIOS");
});

test("la fila se lee una vez cada 30 s y, con Neon caído, sigue la última lectura buena", async () => {
  let valor: string | null = "inactivo";
  let falla = false;
  const { leer, lecturas, reloj } = montar({ env: "activo", ajuste: async () => { if (falla) throw new Error("Neon caído"); return valor; } });
  assert.equal((await leer()).activa, false);
  valor = "activo";
  assert.equal((await leer()).activa, false, "dentro del caché no se vuelve a leer");
  assert.equal(lecturas.ajuste, 1);
  falla = true;
  reloj.ms += TTL_AJUSTE_MS + 1;
  assert.deepEqual(await leer(), { activa: false, fuente: "ajuste" }, "Neon caído: vale la última lectura buena");
  falla = false;
  reloj.ms += TTL_AJUSTE_MS + 1;
  assert.deepEqual(await leer(), { activa: true, fuente: "ajuste" });
  valor = null;
  reloj.ms += TTL_AJUSTE_MS + 1;
  assert.deepEqual(await leer(), { activa: true, fuente: "env" }, "borrar la fila vuelve a la variable");
});

// ---------------------------------------------------------------------------------------------------------------------
// La respuesta
// ---------------------------------------------------------------------------------------------------------------------

test("el constructor lista los manifiestos en su orden, con su visibilidad y la bandera", () => {
  const todos = Object.values(MANIFIESTOS);
  const respuesta = construirRespuestaRepositorios({ manifiestos: todos, visibles: ["sempertex", "mobiliario"], ui: true });
  assert.deepEqual(respuesta.repositorios.map((r) => [r.id, r.visible]), [["sempertex", true], ["mobiliario", true], ["escenografia", false]]);
  assert.equal(respuesta.ui, true);
  const sempertex = respuesta.repositorios[0]!;
  assert.equal(sempertex.nombre, "Sempertex");
  assert.equal(sempertex.version, MANIFIESTOS.sempertex.version);
  assert.equal(sempertex.licencia.regimen, "marca-socio");
  assert.equal(sempertex.licencia.url, "https://sempertex.com");
  assert.deepEqual(sempertex.precio, { tipo: "crosswalk-tienda" });
  assert.deepEqual(respuesta.repositorios[1]!.precio.tipo, "sin-precio");
  assert.match(respuesta.repositorios[1]!.precio.motivo ?? "", /lista de alquiler/);
  assert.equal(RespuestaRepositoriosSchema.safeParse(respuesta).success, true, "el navegador la valida con el mismo esquema");
});

test("no sale al navegador nada del servidor: el archivo de una lista de alquiler se queda", () => {
  const conLista: ManifiestoRepositorio = {
    ...MANIFIESTOS.mobiliario,
    precio: { tipo: "lista-alquiler", archivo: "data/catalogos/mobiliario/precios-alquiler-2026.json", moneda: "COP", vigencia: "2026" },
  };
  const texto = JSON.stringify(construirRespuestaRepositorios({ manifiestos: [conLista], visibles: ["mobiliario"], ui: true }));
  assert.ok(!texto.includes("precios-alquiler"), texto);
  assert.ok(!texto.includes("data/"), texto);
  assert.ok(!texto.includes("idsLocales") && !texto.includes("datos\""), texto);
});

test("el esquema rechaza un repositorio que no existe", () => {
  const buena = construirRespuestaRepositorios({ manifiestos: [MANIFIESTOS.mobiliario], visibles: [], ui: false });
  assert.equal(RespuestaRepositoriosSchema.safeParse({ ...buena, repositorios: [{ ...buena.repositorios[0], id: "inventado" }] }).success, false);
  assert.equal(RespuestaRepositoriosSchema.safeParse({ repositorios: buena.repositorios }).success, false, "falta ui");
});

test("el navegador es tolerante: un repositorio con un id o un régimen que no conoce se descarta y el resto sigue, con la bandera", () => {
  const buena = construirRespuestaRepositorios({ manifiestos: Object.values(MANIFIESTOS), visibles: ["sempertex", "mobiliario", "escenografia"], ui: true });
  const [sempertex, mobiliario, escenografia] = buena.repositorios;
  const futuro = {
    repositorios: [sempertex, { ...mobiliario, id: "terceros/acme" }, { ...escenografia, licencia: { ...escenografia!.licencia, regimen: "regimen-nuevo" } }, { ...mobiliario, id: "no-es-un-repositorio" }, "basura", mobiliario],
    ui: true,
  };
  const lectura = interpretarRespuestaRepositorios(futuro);
  assert.ok(lectura.ok);
  assert.deepEqual(lectura.respuesta.repositorios.map((r) => r.id), ["sempertex", "terceros/acme", "mobiliario"], "se queda lo que se entiende, en su orden");
  assert.equal(lectura.respuesta.ui, true);
  assert.equal(lectura.descartados.length, 3, lectura.descartados.join(" | "));
  assert.match(lectura.descartados.join(" | "), /regimen/i, "dice por qué se descartó el del régimen");
  assert.match(lectura.descartados.join(" | "), /no-es-un-repositorio/, "y cuál era el id");
  assert.equal(RespuestaRepositoriosSchema.safeParse(futuro).success, false, "el esquema estricto (el del servidor) sigue sin dejarlo pasar");
  const igual = interpretarRespuestaRepositorios(buena);
  assert.ok(igual.ok && igual.descartados.length === 0);
  assert.deepEqual(igual.ok && igual.respuesta, buena, "una respuesta buena pasa entera");
});

test("el navegador dice cuándo la respuesta no es ni { repositorios, ui } (y entonces no hay lectura)", () => {
  for (const mala of [null, "texto", [], { ui: true }, { repositorios: [] }, { repositorios: "x", ui: true }, { repositorios: [], ui: "si" }]) {
    const lectura = interpretarRespuestaRepositorios(mala);
    assert.equal(lectura.ok, false, JSON.stringify(mala));
    assert.match(!lectura.ok ? lectura.error : "", /no es \{ repositorios, ui \}/);
  }
  assert.equal(interpretarRespuestaRepositorios({ repositorios: [], ui: false }).ok, true, "vacía pero bien formada");
});

// ---------------------------------------------------------------------------------------------------------------------
// La ruta
// ---------------------------------------------------------------------------------------------------------------------

const CLAVE_APP = "clave-app-de-prueba";
const guardadas: Record<string, string | undefined> = {};
const VARIABLES = ["APP_PASSWORD", "CATALOGO_UI_REPOSITORIOS", "CATALOGO_REPOS_TALLER", "DATABASE_URL"] as const;
beforeEach(() => {
  for (const v of VARIABLES) guardadas[v] = process.env[v];
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.CATALOGO_UI_REPOSITORIOS;
  delete process.env.CATALOGO_REPOS_TALLER;
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  for (const v of VARIABLES) if (guardadas[v] === undefined) delete process.env[v]; else process.env[v] = guardadas[v];
});

const peticion = (opciones: { sesion?: boolean; origen?: string } = {}) => new Request(`https://app.test${RUTA_REPOSITORIOS}`, {
  headers: {
    ...(opciones.sesion === false ? {} : { cookie: `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}` }),
    ...(opciones.origen ? { origin: opciones.origen } : {}),
  },
});

test("la ruta pide sesión y mismo origen, y no se cachea", async () => {
  const sinSesion = await GET(peticion({ sesion: false }));
  assert.equal(sinSesion.status, 401);
  assert.equal(sinSesion.headers.get("cache-control"), "no-store");
  assert.equal((await GET(peticion({ origen: "https://otro.test" }))).status, 401, "otro origen");
  const buena = await GET(peticion({ origen: "https://app.test" }));
  assert.equal(buena.status, 200);
  assert.equal(buena.headers.get("cache-control"), "no-store");
});

test("por defecto: tres repositorios visibles para el Taller y la interfaz encendida, y la ruta dice lo mismo que el constructor puro", async () => {
  const respuesta = RespuestaRepositoriosSchema.parse(await (await GET(peticion())).json());
  assert.deepEqual(respuesta.repositorios.map((r) => [r.id, r.visible]), [["sempertex", true], ["mobiliario", true], ["escenografia", true]]);
  assert.equal(respuesta.ui, true);
  assert.deepEqual(respuesta, construirRespuestaRepositorios({ manifiestos: Object.values(MANIFIESTOS), visibles: ["sempertex", "mobiliario", "escenografia"], ui: true }));
});

test("CATALOGO_UI_REPOSITORIOS=false apaga la interfaz (marcha atrás) y CATALOGO_REPOS_TALLER acota lo visible", async () => {
  process.env.CATALOGO_UI_REPOSITORIOS = "false";
  process.env.CATALOGO_REPOS_TALLER = "sempertex,escenografia";
  const respuesta = RespuestaRepositoriosSchema.parse(await (await GET(peticion())).json());
  assert.equal(respuesta.ui, false);
  assert.deepEqual(respuesta.repositorios.map((r) => [r.id, r.visible]), [["sempertex", true], ["mobiliario", false], ["escenografia", true]]);
  assert.deepEqual(respuesta, construirRespuestaRepositorios({ manifiestos: Object.values(MANIFIESTOS), visibles: ["sempertex", "escenografia"], ui: false }));
});

test("una errata en la variable de la marcha atrás también apaga la interfaz", async () => {
  process.env.CATALOGO_UI_REPOSITORIOS = "apagarla";
  const { valor } = await conAvisos(async () => RespuestaRepositoriosSchema.parse(await (await GET(peticion())).json()));
  assert.equal(valor.ui, false);
});
