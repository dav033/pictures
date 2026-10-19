/**
 * Offline checks for `POST /api/plan-dibujo-estructura`: the schematic drawing of a piece no engine builds
 * (the wall, the circular hoop, the balloon ceiling, the table centerpiece). Transport and policy only — the
 * drawing itself is Python's (`services/ai-api/tests/test_dibujo_estructura.py`, and its bytes are frozen
 * against the owner repo in `test_dibujos.py`). The route is checked for what it owns: authentication, a
 * strict body with deliberate 400, the request it sends to Python (scope, short deadline, the resolved size
 * mix handed over so nobody recomputes it), the validation of the answer, Python being down, and the cap on
 * drawings in flight. `globalThis.fetch` is stubbed; there is no network and no database.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-dibujo-estructura-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-dibujo-estructura-secret-20261004";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json; headers: Headers };

const RUTA_PYTHON = "/internal/v1/plan/dibujo-estructura";
/** Cuántas peticiones acepta la ruta a la vez: el tope de `estructuras` de plan-decoracion.v1. */
const EN_VUELO = 8;

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

const PLAN = leer<{ plan: Json }>("scripts/fixtures/patron-color-ui/plan-con-patrones.json").plan;
/** La pared del plan de prueba: `pared_densa` con su patrón en degradado. */
const PARED = "EST_03_PARED";
/** La mezcla real tal como la publica `plan_resuelto.estructuras[].mezcla_real`. */
const MEZCLA = [
  { diam_pulg: 12, forma: "redondo", unidades: 80, pct: 61.54 },
  { diam_pulg: 5, forma: "redondo", unidades: 40, pct: 30.77 },
  { diam_pulg: 18, forma: null, unidades: 10, pct: 7.69 },
];
/** El lienzo de la pared no es cuadrado: 600 × 560. Los bytes del SVG son de Python; aquí da igual cuáles. */
const GRAFICA: Json = { ancho: 600, alto: 560, svg: "<g data-f=\"0\"><circle r=\"3\"/></g>" };

function resultado(llamada: Llamada, cambios: Json = {}): Response {
  return sobre(llamada, { operation_schema_version: "plan-dibujo-estructura-result.v1", grafica: GRAFICA, ...cambios });
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
  const { POST } = await import("../../src/app/api/plan-dibujo-estructura/route");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { EDICION_PYTHON_DEADLINE_MS } = await import("../../src/lib/plan/edicion-python");
  const { SESSION_COOKIE, sessionToken } = await import("../../src/lib/auth/session");

  async function pedir(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-dibujo-estructura", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }
  const base = { plan: PLAN, estructura_id: PARED, mezcla_real: MEZCLA };

  await caso("petición plan-dibujo-estructura.v1 con su scope y deadline corto; devuelve solo la gráfica", async () => {
    const llamadas = instalarFetch((llamada) => resultado(llamada));
    const r = await pedir(base);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
    // Solo la gráfica: no hay pieza resuelta, ni armado, ni conteo, ni compra. Esta pieza no tiene motor.
    assert.deepEqual(Object.keys(r.cuerpo).sort(), ["grafica"]);
    assert.deepEqual(r.cuerpo.grafica, GRAFICA);
    assert.equal(llamadas.length, 1);
    const peticion = llamadas[0]!;
    assert.equal(peticion.path, RUTA_PYTHON);
    assert.equal(peticion.body.schema_version, "plan-dibujo-estructura.v1");
    assert.equal(peticion.body.estructura_id, PARED);
    assert.deepEqual(peticion.body.mezcla_real, MEZCLA, "la mezcla que ya resolvió el plan viaja tal cual");
    const contexto = peticion.body.context as Json;
    assert.deepEqual(contexto.scopes, ["plan.dibujo_estructura"]);
    assert.equal(peticion.headers.get("x-internal-scopes"), "plan.dibujo_estructura");
    assert.equal(contexto.deadline_ms, EDICION_PYTHON_DEADLINE_MS, "a short deadline: the decorator is waiting");
    // Sin mezcla: el campo no se inventa, y Python cae a su tamaño estándar.
    const sinMezcla = instalarFetch((llamada) => resultado(llamada));
    assert.equal((await pedir({ plan: PLAN, estructura_id: PARED })).status, 200);
    assert.equal("mezcla_real" in sinMezcla[0]!.body, false);
  });

  await caso("cuerpo estricto: 400 sin llamar a Python", async () => {
    const llamadas = instalarFetch(() => { throw new Error("un cuerpo inválido no debe llegar a Python"); });
    for (const [descripcion, cuerpo] of [
      ["un campo de más", { ...base, armado_arco: {} }],
      ["un campo de más dentro de la mezcla", { ...base, mezcla_real: [{ ...MEZCLA[0], sobra: 1 }] }],
      ["una línea de mezcla incompleta", { ...base, mezcla_real: [{ diam_pulg: 12 }] }],
      ["unidades que no son enteras", { ...base, mezcla_real: [{ ...MEZCLA[0], unidades: 1.5 }] }],
      ["más líneas de mezcla que la rejilla de la pieza", { ...base, mezcla_real: Array.from({ length: 37 }, () => MEZCLA[0]) }],
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

  await caso("la respuesta se valida: una gráfica fuera del contrato → 502", async () => {
    for (const [descripcion, cambios] of [
      ["sin el lienzo", { grafica: { svg: "<g/>" } }],
      ["un lado que no es entero", { grafica: { ...GRAFICA, ancho: 600.5 } }],
      ["svg vacío", { grafica: { ...GRAFICA, svg: "" } }],
      ["un campo de más", { grafica: { ...GRAFICA, nota: "x" } }],
      ["con una pieza resuelta que esta ruta no publica", { arco: {} }],
    ] as const) {
      instalarFetch((llamada) => resultado(llamada, cambios));
      const r = await pedir(base);
      assert.equal(r.status, 502, descripcion);
      assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE", descripcion);
      UiErrorV1Schema.parse(r.cuerpo.ui_error);
    }
  });

  await caso("rechazos de Python: 404 y los dos 422 conservan su estado", async () => {
    instalarFetch(() => rechazoPython("estructura_no_encontrada", 404));
    let r = await pedir(base);
    assert.equal(r.status, 404);
    instalarFetch(() => rechazoPython("invalid_plan", 422));
    r = await pedir(base);
    assert.equal(r.status, 422);
    // Una pieza que sí arma un motor no tiene dibujo esquemático: su bloque la dibuja colocando cada globo.
    instalarFetch(() => rechazoPython("estructura_sin_dibujo", 422, { estructura_id: PARED }));
    r = await pedir(base);
    assert.equal(r.status, 422);
    assert.ok(UiErrorV1Schema.parse(r.cuerpo.ui_error).mensaje_usuario.length > 0);
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
    const nueva = () => POST(new Request("http://127.0.0.1/api/plan-dibujo-estructura", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) }));
    const enVuelo = Array.from({ length: EN_VUELO }, nueva);
    for (let intento = 0; intento < 200 && llamadas < EN_VUELO; intento += 1) await new Promise((listo) => setTimeout(listo, 5));
    assert.equal(llamadas, EN_VUELO, "una propuesta llena cabe entera: ocho piezas, ocho dibujos");
    const extra = await nueva();
    assert.equal(extra.status, 429);
    assert.equal(extra.headers.get("Retry-After"), "1");
    const datos = (await extra.json()) as Json;
    assert.match(String(datos.error), /demasiados dibujos en curso/);
    // Lo que el cliente de verdad LEE es `ui_error.mensaje_usuario`, no `error`. Con el código de solicitud
    // inválida leería la frase de catálogo («Recarga la página e inténtalo de nuevo») y daría el error por no
    // reintentable, justo al revés del `Retry-After` de esta misma respuesta.
    const uiError = UiErrorV1Schema.parse(datos.ui_error);
    assert.equal(uiError.code, "SERVICIO_OCUPADO");
    assert.match(uiError.mensaje_usuario, /demasiados dibujos en curso/);
    assert.doesNotMatch(uiError.mensaje_usuario, /Recarga la p[áa]gina/i);
    assert.equal(uiError.retryable, true, "esperar y reintentar es exactamente lo que hay que hacer");
    assert.equal(llamadas, EN_VUELO, "la de más ni siquiera llega a Python");
    liberar.forEach((soltar) => soltar());
    const terminadas = await Promise.all(enVuelo);
    assert.ok(terminadas.every((r) => r.status !== 429), "las que estaban dentro terminan, aunque sea con error de Python");
    const siguiente = nueva();
    for (let intento = 0; intento < 200 && llamadas < EN_VUELO + 1; intento += 1) await new Promise((listo) => setTimeout(listo, 5));
    liberar.forEach((soltar) => soltar());
    assert.notEqual((await siguiente).status, 429, "se liberó el cupo de cada dibujo que terminó");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
