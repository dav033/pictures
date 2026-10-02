/**
 * Offline checks for `POST /api/plan-armado-columna-organica` (ADR-0034): the preview of the column the
 * designer's engine builds. Transport and policy only — the column itself is Python's
 * (`services/ai-api/tests/test_plan_armado_columna_organica.py`). The route is checked for what it owns:
 * authentication, a strict body with deliberate 400, the request it sends to Python (scope, short deadline,
 * the tones that only paint), the validation of the answer (the engine's assembly comes back as it was sent),
 * the error bodies `peticion-armado-columna-organica.ts` reads, Python being down, and the cap on previews in
 * flight. `globalThis.fetch` is stubbed; there is no network and no database.
 *
 * The real answer of the engine is `scripts/fixtures/columna-organica-ui/vista-columna-organica.json`.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-armado-columna-organica-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-editar-columna-organica-secret-20261002";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json; headers: Headers };

const RUTA_PYTHON = "/internal/v1/plan/armado-columna-organica";

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

const FIXTURE = leer<{ peticion: { estructura_id: string; armado_columna_organica: Json; colores: string[] }; respuesta: Json }>("scripts/fixtures/columna-organica-ui/vista-columna-organica.json");
const PLAN = leer<{ plan: Json }>("scripts/fixtures/patron-color-ui/plan-con-patrones.json").plan;
const COLUMNA = FIXTURE.peticion.estructura_id;
const ARMADO = FIXTURE.peticion.armado_columna_organica;
const COLORES = FIXTURE.peticion.colores;

/** What Python answers: the engine's own output, with the version stamp of the operation. */
function resultado(llamada: Llamada, cambios: Json = {}): Response {
  return sobre(llamada, { operation_schema_version: "plan-armado-columna-organica-result.v1", ...FIXTURE.respuesta, ...cambios });
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
  const { POST } = await import("../../src/app/api/plan-armado-columna-organica/route");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { EDICION_PYTHON_DEADLINE_MS } = await import("../../src/lib/plan/edicion-python");
  const { SESSION_COOKIE, sessionToken } = await import("../../src/lib/auth/session");

  async function pedir(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-armado-columna-organica", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }
  const base = { plan: PLAN, estructura_id: COLUMNA, armado_columna_organica: ARMADO, colores: COLORES };

  await caso("petición plan-armado-columna-organica.v1 con su scope y deadline corto; devuelve lo que Python resolvió", async () => {
    const llamadas = instalarFetch((llamada) => resultado(llamada));
    const r = await pedir(base);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
    assert.deepEqual(Object.keys(r.cuerpo).sort(), ["armado", "columna", "grafica", "limites", "opciones"], "la columna con su dibujo, el armado, las herramientas y los rangos; nada más");
    assert.deepEqual(r.cuerpo.armado, ARMADO, "el armado dado vuelve tal cual");
    assert.deepEqual(r.cuerpo.grafica, FIXTURE.respuesta.grafica);
    assert.equal(llamadas.length, 1);
    const peticion = llamadas[0]!;
    assert.equal(peticion.path, RUTA_PYTHON);
    assert.equal(peticion.body.schema_version, "plan-armado-columna-organica.v1");
    assert.equal(peticion.body.estructura_id, COLUMNA);
    assert.deepEqual(peticion.body.armado_columna_organica, ARMADO);
    assert.deepEqual(peticion.body.colores, COLORES, "los tonos solo pintan: viajan tal cual");
    const contexto = peticion.body.context as Json;
    assert.deepEqual(contexto.scopes, ["plan.armado_columna_organica"]);
    assert.equal(peticion.headers.get("x-internal-scopes"), "plan.armado_columna_organica");
    assert.equal(contexto.deadline_ms, EDICION_PYTHON_DEADLINE_MS, "a short deadline: the decorator is waiting");
    // La receta (`null`) y sin tonos: Python nombra la pieza sin ellos.
    const receta = instalarFetch((llamada) => resultado(llamada, { armado: FIXTURE.respuesta.armado }));
    const sinTonos = await pedir({ plan: PLAN, estructura_id: COLUMNA, armado_columna_organica: null });
    assert.equal(sinTonos.status, 200);
    assert.equal(receta[0]!.body.armado_columna_organica, null);
    assert.equal("colores" in receta[0]!.body, false);
  });

  await caso("cuerpo estricto: 400 sin llamar a Python", async () => {
    const llamadas = instalarFetch(() => { throw new Error("un cuerpo inválido no debe llegar a Python"); });
    for (const [descripcion, cuerpo] of [
      ["un campo de más", { ...base, variante: "x" }],
      ["sin el campo armado_columna_organica", { plan: PLAN, estructura_id: COLUMNA }],
      ["armado fuera de armado-columna-organica.v1", { ...base, armado_columna_organica: { ...ARMADO, forma: "espiral" } }],
      ["un campo de más dentro del armado", { ...base, armado_columna_organica: { ...ARMADO, campo_nuevo: 1 } }],
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
      ["columna fuera del contrato", { columna: { ...(FIXTURE.respuesta.columna as Json), globos: "muchos" } }],
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
    const frase = "El armado nombra un color que la columna no lleva.";
    instalarFetch(() => rechazoPython("armado_invalido", 422, { estructura_id: COLUMNA, motivo: "material_fuera_de_rango", mensaje: frase }));
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

  await caso("/api/plan-editar: la acción armado_columna_organica está en la unión del cuerpo y llega a la comprobación de la aprobación", async () => {
    const { POST: editar } = await import("../../src/app/api/plan-editar/route");
    const resuelto = leer<Json>("scripts/fixtures/patron-color-ui/plan-con-patrones.json");
    const pedirEditar = async (edicion: unknown): Promise<{ status: number; cuerpo: Json }> => {
      const respuesta = await editar(new Request("http://127.0.0.1/api/plan-editar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modo: "aplicar", base: resuelto, edicion }) }));
      return { status: respuesta.status, cuerpo: (await respuesta.json()) as Json };
    };
    globalThis.fetch = (async () => { throw new Error("una edición con el token roto no debe llegar a Python"); }) as typeof fetch;
    const valida = await pedirEditar({ accion: "armado_columna_organica", estructura_id: COLUMNA, armado_columna_organica: ARMADO });
    assert.equal(valida.status, 409, JSON.stringify(valida.cuerpo).slice(0, 200));
    assert.match(String(valida.cuerpo.error), /aprobación base expiró/);
    const quitar = await pedirEditar({ accion: "armado_columna_organica", estructura_id: COLUMNA, armado_columna_organica: null });
    assert.equal(quitar.status, 409, "quitar el armado (null) también es una edición válida");
    for (const mala of [
      { accion: "armado_columna_organica", estructura_id: COLUMNA, armado_columna_organica: { ...ARMADO, forma: "espiral" } },
      { accion: "armado_columna_organica", estructura_id: COLUMNA, armado_columna_organica: { ...ARMADO, campo_nuevo: 1 } },
      { accion: "armado_columna_organica", estructura_id: COLUMNA },
      { accion: "armado_columna_organica", estructura_id: COLUMNA, armado_columna_organica: ARMADO, extra: true },
    ]) {
      assert.equal((await pedirEditar(mala)).status, 400, JSON.stringify(mala).slice(0, 80));
    }
  });

  await caso("sin cobertura de catálogo por el armado nuevo: se rechaza con la frase, y lo que ya faltaba antes no cuenta", async () => {
    const { faltaCoberturaPorElArmado } = await import("../../src/lib/plan/aplicar-edicion");
    type PlanResuelto = Parameters<typeof faltaCoberturaPorElArmado>[1];
    const resuelto = leer<Json>("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as unknown as PlanResuelto;
    const edicion = { accion: "armado_columna_organica" as const, estructura_id: COLUMNA, armado_columna_organica: ARMADO as never };
    const faltan = (sinCobertura: PlanResuelto["sin_cobertura"]): PlanResuelto => ({ ...resuelto, sin_cobertura: sinCobertura });
    const nueva = { estructura_id: COLUMNA, product_id: "prod-azul", tamano: "R-36" };
    const antes = faltan([]);
    assert.equal(faltaCoberturaPorElArmado(edicion, antes, antes), null, "todo cubierto: nada que decir");
    const frase = faltaCoberturaPorElArmado(edicion, antes, faltan([nueva]));
    assert.ok(frase && frase.includes("esa columna") && frase.includes("R-36") && frase.includes("Elige otro tamaño de globo"), frase ?? "sin frase");
    assert.equal(faltaCoberturaPorElArmado(edicion, faltan([nueva]), faltan([nueva])), null, "ya faltaba antes: no es culpa de este armado");
    assert.equal(faltaCoberturaPorElArmado(edicion, antes, faltan([{ ...nueva, estructura_id: "EST_09_OTRA" }])), null, "lo que falta en otra pieza no se le achaca a esta columna");
    assert.equal(faltaCoberturaPorElArmado({ ...edicion, armado_columna_organica: null }, antes, faltan([nueva])), null, "quitar el armado no se rechaza por cobertura");
  });

  await caso("tope de dibujos en vuelo: 429 con frase y Retry-After, y el cupo se libera al terminar", async () => {
    const liberar: Array<() => void> = [];
    let llamadas = 0;
    globalThis.fetch = (async () => {
      llamadas += 1;
      await new Promise<void>((listo) => liberar.push(listo));
      return new Response(JSON.stringify({ code: "PYTHON_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const nueva = () => POST(new Request("http://127.0.0.1/api/plan-armado-columna-organica", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) }));
    const enVuelo = Array.from({ length: 4 }, nueva);
    for (let intento = 0; intento < 200 && llamadas < 4; intento += 1) await new Promise((listo) => setTimeout(listo, 5));
    assert.equal(llamadas, 4, "las cuatro primeras llegan a Python");
    const quinta = await nueva();
    assert.equal(quinta.status, 429);
    assert.equal(quinta.headers.get("Retry-After"), "1");
    const datos = (await quinta.json()) as Json;
    assert.match(String(datos.error), /demasiados dibujos de la columna en curso/);
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
