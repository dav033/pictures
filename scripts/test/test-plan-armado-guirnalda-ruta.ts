/**
 * Offline checks for `POST /api/plan-armado-guirnalda` (ADR-0032, E6): the
 * garland editor's preview. Transport only — Python arranges, resolves and
 * writes the texts (`services/ai-api/tests/test_plan_guirnalda.py`); here the
 * route is checked for what it owns: authentication, a strict body with
 * deliberate 400, the request it sends to Python (scope, short deadline, only
 * the contract fields of each line), the validation of the answer, the error
 * bodies `peticion-armado-guirnalda.ts` reads, and Python being down. Also the
 * edit's rule that "Quitar armado" is not suggested again. `globalThis.fetch`
 * is stubbed; there is no network and no database.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-armado-guirnalda-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json; headers: Headers };

const RUTA_PYTHON = "/internal/v1/plan/armado-guirnalda";

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leer<T>(ruta: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), ruta), "utf8")) as T;
}

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(esObjeto(body));
    const llamada = { path: new URL(String(input)).pathname, body, headers: new Headers(init?.headers) };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return llamadas;
}

function sobre(llamada: Llamada, payload: Json): Response {
  const ctx = llamada.body.context;
  assert.ok(esObjeto(ctx));
  return Response.json({ schema_version: "operational.v1", request_id: ctx.request_id, correlation_id: ctx.correlation_id, payload });
}

function rechazoPython(code: string, status: number, detalles: Json = {}): Response {
  return Response.json({ detail: { code, request_id: "00000000-0000-4000-8000-00000000f000", correlation_id: "00000000-0000-4000-8000-00000000f001", ...detalles } }, { status });
}

type Caso = { armado: Json; opciones: Json };
const vistas = leer<{ estructura_id: string; casos: Record<string, Caso> }>("scripts/fixtures/guirnalda-ui/vistas-guirnalda.json");
const GUIRNALDA = vistas.estructura_id;
const RECETA = vistas.casos.receta!;
const COLGADA = vistas.casos.colgada_arco_caido!;
const planResuelto = leer<{ plan: Json; estructuras: Array<{ estructura_id: string; lineas: Json[] }> }>("scripts/fixtures/patron-color-ui/plan-con-patrones.json");
const PLAN = planResuelto.plan;
/** The garland's resolved lines as the browser holds them: more fields than the contract takes. */
const LINEAS_NAVEGADOR = planResuelto.estructuras.find((item) => item.estructura_id === GUIRNALDA)!.lineas;
const LINEAS = LINEAS_NAVEGADOR.map(({ product_id, variant_id, color, acabado, unidades, diam_pulg, tamano_codigo }) => ({ product_id, variant_id, color, acabado, unidades, diam_pulg, tamano_codigo }));
const DADO = (COLGADA.armado as { armado: Json }).armado;

function resultado(llamada: Llamada, caso: Caso, cambios: { armado?: Json; opciones?: Json } = {}): Response {
  return sobre(llamada, { operation_schema_version: "plan-armado-guirnalda-result.v1", armado: { ...caso.armado, ...cambios.armado }, opciones: cambios.opciones ?? caso.opciones });
}

async function main(): Promise<void> {
  const { POST } = await import("../../src/app/api/plan-armado-guirnalda/route");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { EDICION_PYTHON_DEADLINE_MS } = await import("../../src/lib/plan/edicion-python");
  const { SESSION_COOKIE, sessionToken } = await import("../../src/lib/auth/session");

  async function pedir(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-armado-guirnalda", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }

  // --- 1. The recipe (`null`) and a given assembly: the request to Python and the answer.
  let llamadas = instalarFetch((llamada) => resultado(llamada, llamada.body.armado_guirnalda === null ? RECETA : COLGADA));
  let r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null, lineas: LINEAS });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(r.cuerpo, { armado: RECETA.armado, opciones: RECETA.opciones }, "the assembly and the options Python admits: nothing signed, nothing else");
  assert.equal(llamadas.length, 1);
  const peticion = llamadas[0]!;
  assert.equal(peticion.path, RUTA_PYTHON);
  assert.equal(peticion.body.schema_version, "plan-armado-guirnalda.v1");
  assert.equal(peticion.body.estructura_id, GUIRNALDA);
  assert.equal(peticion.body.armado_guirnalda, null);
  assert.deepEqual(peticion.body.lineas, LINEAS, "exactly the contract fields of each line");
  const contexto = peticion.body.context as Json;
  assert.deepEqual(contexto.scopes, ["plan.armado_guirnalda"]);
  assert.equal(peticion.headers.get("x-internal-scopes"), "plan.armado_guirnalda");
  assert.equal(contexto.deadline_ms, EDICION_PYTHON_DEADLINE_MS, "a short deadline: the decorator is waiting");
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: DADO, lineas: LINEAS });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual((r.cuerpo.armado as Json).armado, DADO);
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null });
  assert.equal(r.status, 200, "the lines are optional (Python names without them)");
  assert.equal("lineas" in llamadas[2]!.body, false);
  console.log("[PASS] vista previa: petición plan-armado-guirnalda.v1 con scope plan.armado_guirnalda, deadline corto y solo los campos del contrato de cada línea");

  // --- 2. Strict body: 400 without calling Python.
  llamadas = instalarFetch(() => { throw new Error("un cuerpo inválido no debe llegar a Python"); });
  for (const [caso, cuerpo] of [
    ["una línea con campos de más", { plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null, lineas: LINEAS_NAVEGADOR }],
    ["armado fuera de armado-guirnalda.v1", { plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: { ...DADO, forma: "espiral" }, lineas: LINEAS }],
    ["caída fuera del contrato", { plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: { ...DADO, caida_m: 7 }, lineas: LINEAS }],
    ["sin el campo armado_guirnalda", { plan: PLAN, estructura_id: GUIRNALDA, lineas: LINEAS }],
    ["un campo de más", { plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null, variante: "helio_apilado" }],
    ["más de 256 líneas", { plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null, lineas: Array.from({ length: 257 }, () => LINEAS[0]) }],
    ["plan inválido", { plan: { ...PLAN, estructuras: [] }, estructura_id: GUIRNALDA, armado_guirnalda: null }],
  ] as const) {
    r = await pedir(cuerpo);
    assert.equal(r.status, 400, caso);
    assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "SOLICITUD_INVALIDA", caso);
  }
  r = await pedir("{no json");
  assert.equal(r.status, 400);
  assert.equal(llamadas.length, 0);
  console.log("[PASS] cuerpo estricto: armado del contrato o null, líneas con los campos justos y hasta 256; si no, 400 sin llamar a Python");

  // --- 3. The answer is validated: another structure, an assembly other than the one sent, bad options or off-contract → 502.
  for (const [caso, cambios] of [
    ["otra estructura", { armado: { estructura_id: "EST_02_ARCO" } }],
    ["otro armado", { armado: { armado: { ...DADO, forma: "recta" } } }],
    ["opciones fuera del contrato", { opciones: { ...(COLGADA.opciones as Json), soportes: ["techo"] } }],
    ["fuera del contrato", { armado: { racimos: [] } }],
  ] as const) {
    instalarFetch((llamada) => resultado(llamada, COLGADA, cambios as { armado?: Json; opciones?: Json }));
    r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: DADO, lineas: LINEAS });
    assert.equal(r.status, 502, caso);
    assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE", caso);
    UiErrorV1Schema.parse(r.cuerpo.ui_error);
  }
  console.log("[PASS] vista previa: una respuesta de otra estructura, con otro armado, con opciones fuera del contrato o fuera del esquema → 502 PYTHON_INVALID_RESPONSE");

  // --- 4. Python's rejections: `armado_invalido` keeps its rule and sentence; the rest their status.
  const frase = "Una guirnalda que cuelga necesita la pared o puntos de anclaje de donde colgar.";
  instalarFetch(() => rechazoPython("armado_invalido", 422, { estructura_id: GUIRNALDA, motivo: "forma_no_admitida", mensaje: frase }));
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: { ...DADO, soporte: "piso", forma: "u_invertida" }, lineas: LINEAS });
  assert.equal(r.status, 422);
  assert.equal(r.cuerpo.causa, "ARMADO_INVALIDO");
  assert.equal(r.cuerpo.motivo, "forma_no_admitida");
  assert.equal(r.cuerpo.mensaje, frase);
  const uiError = UiErrorV1Schema.parse(r.cuerpo.ui_error);
  assert.equal(uiError.code, "PROPUESTA_INCOMPLETA");
  assert.equal(uiError.detalles_dev.codigo_origen, "ARMADO_INVALIDO:forma_no_admitida");
  instalarFetch(() => rechazoPython("estructura_no_encontrada", 404));
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null });
  assert.equal(r.status, 404);
  instalarFetch(() => rechazoPython("invalid_plan", 422));
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null });
  assert.equal(r.status, 422);
  console.log("[PASS] rechazos: armado_invalido llega con motivo y mensaje de Python; 404 y 422 conservan su estado");

  // --- 5. Python down: a 5xx with the operational body, no internals for the decorator.
  instalarFetch(() => { throw new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:8000"); });
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null });
  assert.equal(r.status, 502);
  assert.equal(r.cuerpo.code, "PYTHON_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(r.cuerpo), /ECONNREFUSED/, "no internal detail reaches the browser");
  const caido = UiErrorV1Schema.parse(r.cuerpo.ui_error);
  assert.ok(caido.mensaje_usuario.length > 0);
  instalarFetch(() => Response.json({ detail: "Service Unavailable" }, { status: 503 }));
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: null });
  assert.ok(r.status >= 500, `Python 503 → ${r.status}`);
  UiErrorV1Schema.parse(r.cuerpo.ui_error);
  console.log("[PASS] Python caído: 502/5xx con cuerpo operacional y ui_error, sin detalles internos");

  // --- 6. Authentication: with APP_PASSWORD only the session cookie gets in.
  process.env.APP_PASSWORD = "clave-de-prueba";
  llamadas = instalarFetch((llamada) => resultado(llamada, COLGADA));
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: DADO, lineas: LINEAS });
  assert.equal(r.status, 401);
  assert.equal(llamadas.length, 0);
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: DADO, lineas: LINEAS }, { cookie: `${SESSION_COOKIE}=${sessionToken("clave-de-prueba")}` });
  assert.equal(r.status, 200);
  delete process.env.APP_PASSWORD;
  console.log("[PASS] autenticación: sin sesión 401 y nada llega a Python; con la cookie de sesión 200");

  // --- 7. The edit that saves it, and "Quitar armado" is not suggested again.
  const { EdicionArmadoGuirnaldaSchema } = await import("../../src/lib/plan/edicion-esquemas");
  EdicionArmadoGuirnaldaSchema.parse({ accion: "armado_guirnalda", estructura_id: GUIRNALDA, armado_guirnalda: DADO });
  EdicionArmadoGuirnaldaSchema.parse({ accion: "armado_guirnalda", estructura_id: GUIRNALDA, armado_guirnalda: null });
  const { resugerirArmadoGuirnalda } = await import("../../src/lib/plan/aplicar-edicion");
  const con = { estructuras: [{ estructura_id: GUIRNALDA, armado_guirnalda: DADO }] };
  const sin = { estructuras: [{ estructura_id: GUIRNALDA }] };
  assert.equal(resugerirArmadoGuirnalda({ accion: "armado_guirnalda", estructura_id: GUIRNALDA }, con, sin), false, "quitado a propósito en el editor: queda sin armado");
  assert.equal(resugerirArmadoGuirnalda({ accion: "repartir", estructura_id: GUIRNALDA }, con, sin), true, "perdido por otra edición: se vuelve a sugerir");
  assert.equal(resugerirArmadoGuirnalda({ accion: "mezcla", estructura_id: GUIRNALDA }, con, con), false);
  console.log("[PASS] edición: la acción armado_guirnalda guarda el armado o lo quita, y lo quitado a propósito no se vuelve a sugerir");

  // --- 8. Decision 27: the tilt travels as the contract says, and Python owns its rule.
  const DESNIVEL = vistas.casos.colgada_arco_caido_desnivel!;
  const CON_DESNIVEL = (DESNIVEL.armado as { armado: Json }).armado;
  assert.equal(CON_DESNIVEL.desnivel_m, -0.6);
  llamadas = instalarFetch((llamada) => resultado(llamada, DESNIVEL));
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: CON_DESNIVEL, lineas: LINEAS });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(llamadas[0]!.body.armado_guirnalda, CON_DESNIVEL, "the tilt reaches Python as it was drafted");
  assert.deepEqual((r.cuerpo.armado as Json).armado, CON_DESNIVEL, "and comes back echoed, with the cord Python measured");
  assert.equal((r.cuerpo.armado as Json).largo_cuerda_m, 3.66);
  llamadas = instalarFetch(() => { throw new Error("un desnivel fuera del contrato no debe llegar a Python"); });
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: { ...CON_DESNIVEL, desnivel_m: -5.5 }, lineas: LINEAS });
  assert.equal(r.status, 400, "desnivel fuera del contrato");
  assert.equal(llamadas.length, 0);
  const sinSoporte = vistas.casos.mesa_con_desnivel as unknown as { error: string; detalles: Json };
  assert.equal(sinSoporte.detalles.motivo, "desnivel_sin_soporte", "Python's own rule and sentence (real output)");
  instalarFetch(() => rechazoPython("armado_invalido", 422, sinSoporte.detalles));
  r = await pedir({ plan: PLAN, estructura_id: GUIRNALDA, armado_guirnalda: { ...CON_DESNIVEL, soporte: "mesa", forma: "recta", caida_m: undefined }, lineas: LINEAS });
  assert.equal(r.status, 422);
  assert.equal(r.cuerpo.motivo, "desnivel_sin_soporte");
  assert.equal(r.cuerpo.mensaje, sinSoporte.detalles.mensaje);
  EdicionArmadoGuirnaldaSchema.parse({ accion: "armado_guirnalda", estructura_id: GUIRNALDA, armado_guirnalda: CON_DESNIVEL });
  console.log("[PASS] desnivel: viaja tal cual a Python y vuelve con su cuerda; fuera del contrato 400; desnivel_sin_soporte llega con la frase de Python; la edición lo guarda");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
