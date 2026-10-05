/**
 * Offline checks for `POST /api/plan-armado-arco-organico` (ADR-0034): the preview of the arch the designer's
 * organic engine builds. Transport and policy only — the arch itself is Python's
 * (`services/ai-api/tests/test_plan_armado_arco_organico.py`). The route is checked for what it owns:
 * authentication, a strict body with deliberate 400, the request it sends to Python (scope, short deadline,
 * the tones that only paint), the validation of the answer (the engine's assembly comes back as it was sent),
 * Python being down, and the cap on previews in flight. `globalThis.fetch` is stubbed; there is no network and
 * no database.
 *
 * The real answer of the engine is `scripts/fixtures/arco-organico-ui/vista-arco-organico.json`.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-armado-arco-organico-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-editar-arco-organico-secret-20261004";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json; headers: Headers };

const RUTA_PYTHON = "/internal/v1/plan/armado-arco-organico";

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leer<T>(ruta: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), ruta), "utf8")) as T;
}

function instalarFetch(responder: (llamada: Llamada) => Response | Promise<Response>): Llamada[] {
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

const FIXTURE = leer<{ peticion: { estructura_id: string; armado_arco_organico: Json; colores: string[] }; respuesta: Json }>("scripts/fixtures/arco-organico-ui/vista-arco-organico.json");
const PLAN = leer<{ plan: Json }>("scripts/fixtures/patron-color-ui/plan-con-patrones.json").plan;
const ARCO = FIXTURE.peticion.estructura_id;
const ARMADO = FIXTURE.peticion.armado_arco_organico;
const COLORES = FIXTURE.peticion.colores;

/** What Python answers: the engine's own output, with the version stamp of the operation. */
function resultado(llamada: Llamada, cambios: Json = {}): Response {
  return sobre(llamada, { operation_schema_version: "plan-armado-arco-organico-result.v1", ...FIXTURE.respuesta, ...cambios });
}

let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try {
    await prueba();
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

async function main(): Promise<void> {
  const { POST } = await import("../../src/app/api/plan-armado-arco-organico/route");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { EDICION_PYTHON_DEADLINE_MS } = await import("../../src/lib/plan/edicion-python");
  const { SESSION_COOKIE, sessionToken } = await import("../../src/lib/auth/session");

  async function pedir(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-armado-arco-organico", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }
  const base = { plan: PLAN, estructura_id: ARCO, armado_arco_organico: ARMADO, colores: COLORES };

  await caso("petición plan-armado-arco-organico.v1 con su scope y deadline corto; devuelve lo que Python resolvió", async () => {
    const llamadas = instalarFetch((llamada) => resultado(llamada));
    const r = await pedir(base);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
    assert.deepEqual(Object.keys(r.cuerpo).sort(), ["arco", "armado", "grafica", "limites", "opciones"], "el arco con su dibujo, el armado, las herramientas y los rangos; nada más");
    assert.deepEqual(r.cuerpo.armado, ARMADO, "el armado dado vuelve tal cual");
    assert.deepEqual(r.cuerpo.grafica, FIXTURE.respuesta.grafica);
    // El lienzo de este motor es cuadrado, y aun así viajan sus dos lados: son los dos que Python publica.
    const grafica = r.cuerpo.grafica as Json;
    assert.equal(grafica.ancho, grafica.alto);
    assert.equal(llamadas.length, 1);
    const peticion = llamadas[0]!;
    assert.equal(peticion.path, RUTA_PYTHON);
    assert.equal(peticion.body.schema_version, "plan-armado-arco-organico.v1");
    assert.equal(peticion.body.estructura_id, ARCO);
    assert.deepEqual(peticion.body.armado_arco_organico, ARMADO);
    assert.deepEqual(peticion.body.colores, COLORES, "los tonos solo pintan: viajan tal cual");
    const contexto = peticion.body.context as Json;
    assert.deepEqual(contexto.scopes, ["plan.armado_arco_organico"]);
    assert.equal(peticion.headers.get("x-internal-scopes"), "plan.armado_arco_organico");
    assert.equal(contexto.deadline_ms, EDICION_PYTHON_DEADLINE_MS, "a short deadline: the decorator is waiting");
    // La receta (`null`) y sin tonos: Python nombra la pieza sin ellos.
    const receta = instalarFetch((llamada) => resultado(llamada, { armado: FIXTURE.respuesta.armado }));
    const sinTonos = await pedir({ plan: PLAN, estructura_id: ARCO, armado_arco_organico: null });
    assert.equal(sinTonos.status, 200);
    assert.equal(receta[0]!.body.armado_arco_organico, null);
    assert.equal("colores" in receta[0]!.body, false);
  });

  await caso("cuerpo estricto: 400 sin llamar a Python", async () => {
    const llamadas = instalarFetch(() => { throw new Error("un cuerpo inválido no debe llegar a Python"); });
    for (const [descripcion, cuerpo] of [
      ["un campo de más", { ...base, variante: "x" }],
      ["sin el campo armado_arco_organico", { plan: PLAN, estructura_id: ARCO }],
      ["armado fuera de armado-arco-organico.v1", { ...base, armado_arco_organico: { ...ARMADO, forma: "espiral" } }],
      ["un campo de más dentro del armado", { ...base, armado_arco_organico: { ...ARMADO, campo_nuevo: 1 } }],
      ["un tono que no es #rrggbb", { ...base, colores: ["rosado"] }],
      ["más de seis tonos", { ...base, colores: Array.from({ length: 7 }, () => "#ffffff") }],
      ["plan inválido", { ...base, plan: { ...PLAN, estructuras: [] } }],
      ["estructura vacía", { ...base, estructura_id: "" }],
    ] as const) {
      const r = await pedir(cuerpo);
      assert.equal(r.status, 400, descripcion);
      assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "SOLICITUD_INVALIDA", descripcion);
    }
    const roto = await pedir("{no json");
    assert.equal(roto.status, 400);
    assert.equal(llamadas.length, 0);
  });

  await caso("la respuesta se valida: otro armado o fuera del contrato → 502", async () => {
    for (const [descripcion, cambios] of [
      ["otro armado", { armado: { ...ARMADO, forma: { ...(ARMADO.forma as Json), altoM: 5.5 } } }],
      ["arco fuera del contrato", { arco: { ...(FIXTURE.respuesta.arco as Json), globos: "muchos" } }],
      ["opciones fuera del contrato", { opciones: {} }],
      ["sin gráfica", { grafica: { ancho: 600 } }],
    ] as const) {
      instalarFetch((llamada) => resultado(llamada, cambios));
      const r = await pedir(base);
      assert.equal(r.status, 502, descripcion);
      assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE", descripcion);
      UiErrorV1Schema.parse(r.cuerpo.ui_error);
    }
  });

  await caso("rechazos de Python: armado_invalido conserva su motivo y su frase; 404 y 422 su estado", async () => {
    const frase = "El armado nombra un color que el arco no lleva.";
    instalarFetch(() => rechazoPython("armado_invalido", 422, { estructura_id: ARCO, motivo: "material_fuera_de_rango", mensaje: frase }));
    let r = await pedir(base);
    assert.equal(r.status, 422);
    assert.equal(r.cuerpo.causa, "ARMADO_INVALIDO");
    assert.equal(r.cuerpo.motivo, "material_fuera_de_rango");
    assert.equal(r.cuerpo.mensaje, frase);
    UiErrorV1Schema.parse(r.cuerpo.ui_error);
    instalarFetch(() => rechazoPython("estructura_no_encontrada", 404));
    r = await pedir(base);
    assert.equal(r.status, 404);
    instalarFetch(() => rechazoPython("invalid_plan", 422));
    r = await pedir(base);
    assert.equal(r.status, 422);
  });

  await caso("Python caído: 502 con cuerpo operacional y ui_error, sin detalles internos", async () => {
    instalarFetch(() => { throw new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:8000"); });
    const r = await pedir(base);
    assert.equal(r.status, 502);
    assert.equal(r.cuerpo.code, "PYTHON_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(r.cuerpo), /ECONNREFUSED/, "no internal detail reaches the browser");
    assert.ok(UiErrorV1Schema.parse(r.cuerpo.ui_error).mensaje_usuario.length > 0);
  });

  await caso("autenticación: sin sesión 401 y nada llega a Python; con la cookie de sesión 200", async () => {
    process.env.APP_PASSWORD = "clave-de-prueba";
    const llamadas = instalarFetch((llamada) => resultado(llamada));
    let r = await pedir(base);
    assert.equal(r.status, 401);
    assert.equal(llamadas.length, 0);
    r = await pedir(base, { cookie: `${SESSION_COOKIE}=${sessionToken("clave-de-prueba")}` });
    assert.equal(r.status, 200);
    delete process.env.APP_PASSWORD;
  });

  await caso("tope de dibujos en vuelo: 429 con frase y Retry-After, y el cupo se libera al terminar", async () => {
    const liberar: Array<() => void> = [];
    let llamadas = 0;
    globalThis.fetch = (async () => {
      llamadas += 1;
      await new Promise<void>((listo) => liberar.push(listo));
      return new Response(JSON.stringify({ code: "PYTHON_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const nueva = () => POST(new Request("http://127.0.0.1/api/plan-armado-arco-organico", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) }));
    const enVuelo = Array.from({ length: 4 }, nueva);
    for (let intento = 0; intento < 200 && llamadas < 4; intento += 1) await new Promise((listo) => setTimeout(listo, 5));
    assert.equal(llamadas, 4, "las cuatro primeras llegan a Python");
    const quinta = await nueva();
    assert.equal(quinta.status, 429);
    assert.equal(quinta.headers.get("Retry-After"), "1");
    const datos = (await quinta.json()) as Json;
    assert.match(String(datos.error), /demasiados dibujos del arco en curso/);
    // Lo que el cliente de verdad LEE es `ui_error.mensaje_usuario`, no `error`. Con el código de
    // solicitud inválida leía la frase de catálogo («Recarga la página e inténtalo de nuevo») y daba el
    // error por no reintentable, justo al revés del `Retry-After` de esta misma respuesta (2026-10-04).
    const uiError = UiErrorV1Schema.parse(datos.ui_error);
    assert.equal(uiError.code, "SERVICIO_OCUPADO");
    assert.match(uiError.mensaje_usuario, /demasiados dibujos del arco en curso/);
    assert.doesNotMatch(uiError.mensaje_usuario, /Recarga la p[áa]gina/i);
    assert.equal(uiError.retryable, true, "esperar y reintentar es exactamente lo que hay que hacer");
    assert.equal(llamadas, 4, "la quinta ni siquiera llega a Python");
    liberar.forEach((soltar) => soltar());
    const terminadas = await Promise.all(enVuelo);
    assert.ok(terminadas.every((r) => r.status !== 429), "las que estaban dentro terminan, aunque sea con error de Python");
    const siguiente = nueva();
    for (let intento = 0; intento < 200 && llamadas < 5; intento += 1) await new Promise((listo) => setTimeout(listo, 5));
    liberar.forEach((soltar) => soltar());
    assert.notEqual((await siguiente).status, 429, "se liberó el cupo de cada dibujo que terminó");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
