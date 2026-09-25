/**
 * Offline checks for `POST /api/plan-patron` (ADR-0028 §10): the pattern
 * editor's preview. Transport only — Python expands, counts and writes the
 * texts (`services/ai-api/tests/test_plan_patron_preview.py`); here the route
 * is checked for what it owns: authentication, a strict body with deliberate
 * 400/413, the request it sends to Python (scope, short deadline), the
 * validation of the answer and the error bodies `peticion-patron.ts` reads.
 * `globalThis.fetch` is stubbed; there is no network and no database.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-patron-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json; headers: Headers };

const RUTA_PYTHON = "/internal/v1/plan/patron";
const ESTRUCTURA = "EST_01_ARCO";

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

const ESPIRAL = { version: "patron-color.v1", origen: "decorador", base: { modo: "espiral", racimo: [0, 1, 0, 1], trazo: "espiral" } };

/** A small, valid PatronColorResuelto as Python writes it: 2 clusters of 4 balloons. */
function patronResuelto(aplicado: boolean, estructuraId = ESTRUCTURA): Json {
  return {
    estructura_id: estructuraId,
    aplicado,
    patron: aplicado ? ESPIRAL : { ...ESPIRAL, origen: "sugerido" },
    geometria: "racimos",
    filas: 2,
    columnas: 4,
    repeticiones: 1,
    globos_por_instancia: 8,
    celdas: [[0, 1, 0, 1], [0, 1, 0, 1]],
    extras: [],
    conteo: [
      { material: 0, color: "rojo", acabado: null, unidades_por_instancia: 4, unidades_total: 4 },
      { material: 1, color: "blanco", acabado: null, unidades_por_instancia: 4, unidades_total: 4 },
    ],
    pasos: [{ desde: 1, hasta: 2, celdas: [0, 1, 0, 1], extras: [] }],
    nombre: "Espiral",
    descripcion: "Cuartetos rojo-blanco que giran.",
    instrucciones: ["Sigue la gráfica numerada: cada número es un color de la leyenda."],
    prompt_gemini: "COLOR PATTERN — spiral.",
    prompt_lora: "wrapped in a spiral of red and white stripes",
    avisos: [],
  };
}

/** What Python answers for the column: the styles the editor may offer (decided in Python). */
const MODOS_ADMITIDOS = ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"].map((modo) => ({ modo, direcciones: ["longitudinal"], espejo: false }));

function resultado(llamada: Llamada, patron: Json): Response {
  return sobre(llamada, { operation_schema_version: "plan-patron-result.v1", patron, modos_admitidos: MODOS_ADMITIDOS });
}

async function main(): Promise<void> {
  const { POST } = await import("../../src/app/api/plan-patron/route");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { PlanDecoracionSchema } = await import("../../src/lib/plan/tipos");
  const { pedirVistaPatron, FalloPlanPatron, RESPALDO_VISTA_PATRON } = await import("../../src/lib/plan/peticion-patron");
  const { EDICION_PYTHON_DEADLINE_MS } = await import("../../src/lib/plan/edicion-python");
  const { SESSION_COOKIE, sessionToken } = await import("../../src/lib/auth/session");
  const { PatronColorV1Schema } = await import("../../src/lib/plan/patron-color");
  const espiral = PatronColorV1Schema.parse(ESPIRAL);

  const fixture: unknown = JSON.parse(readFileSync(join(process.cwd(), "contracts", "domain", "v1", "fixtures", "plan-decoracion-ok.json"), "utf8"));
  assert.ok(esObjeto(fixture));
  const plan = fixture;

  async function pedir(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-patron", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }

  // --- 1. Suggestion (`null`) and a given pattern: the request to Python and the answer.
  let llamadas = instalarFetch((llamada) => resultado(llamada, patronResuelto(llamada.body.patron_color !== null)));
  let r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(r.cuerpo, { patron: patronResuelto(false), modos_admitidos: MODOS_ADMITIDOS }, "the pattern and the styles Python admits: nothing signed, nothing else");
  assert.equal(llamadas.length, 1);
  const peticion = llamadas[0]!;
  assert.equal(peticion.path, RUTA_PYTHON);
  assert.equal(peticion.body.schema_version, "plan-patron.v1");
  assert.deepEqual(peticion.body.plan, JSON.parse(JSON.stringify(PlanDecoracionSchema.parse(plan))));
  assert.equal(peticion.body.estructura_id, ESTRUCTURA);
  assert.equal(peticion.body.patron_color, null);
  const contexto = peticion.body.context as Json;
  assert.deepEqual(contexto.scopes, ["plan.patron"]);
  assert.equal(peticion.headers.get("x-internal-scopes"), "plan.patron");
  assert.equal(contexto.deadline_ms, EDICION_PYTHON_DEADLINE_MS, "a short deadline: the decorator is waiting");
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: ESPIRAL });
  assert.equal(r.status, 200);
  assert.equal((r.cuerpo.patron as Json).aplicado, true);
  assert.deepEqual(llamadas[1]!.body.patron_color, ESPIRAL);
  assert.equal("participaciones" in peticion.body, false, "no slider preview unless asked");
  console.log("[PASS] vista previa: petición plan-patron.v1 con scope plan.patron y deadline corto; respuesta {patron}");

  // --- 1b. Colors slider over a confeti while dragging: `participaciones` reach
  // Python with patron_color null, and its answer is the structure's own pattern.
  llamadas = instalarFetch((llamada) => resultado(llamada, patronResuelto(true)));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null, participaciones: [0.5, 0.25, 0.25] });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.equal((r.cuerpo.patron as Json).aplicado, true);
  assert.deepEqual(llamadas[0]!.body.participaciones, [0.5, 0.25, 0.25]);
  assert.equal(llamadas[0]!.body.patron_color, null);
  llamadas = instalarFetch(() => { throw new Error("un reparto con patrón no debe llegar a Python"); });
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: ESPIRAL, participaciones: [0.5, 0.25, 0.25] });
  assert.equal(r.status, 400);
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null, participaciones: [0.99, 0.01] });
  assert.equal(r.status, 400, "each share keeps the slider's 5 % floor");
  assert.equal(llamadas.length, 0);
  instalarFetch(() => rechazoPython("sin_patron", 409));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null, participaciones: [0.5, 0.5] });
  assert.equal(r.status, 409);
  console.log("[PASS] vista previa del deslizador: participaciones llegan a Python; con patrón o bajo el 5 % → 400; sin patrón → 409");

  // --- 1c. The starting point of a style (`modo`, with patron_color null).
  llamadas = instalarFetch((llamada) => resultado(llamada, patronResuelto(false)));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null, modo: "anillos" });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.equal(llamadas[0]!.body.modo, "anillos");
  llamadas = instalarFetch(() => { throw new Error("modo con patrón no debe llegar a Python"); });
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: ESPIRAL, modo: "anillos" });
  assert.equal(r.status, 400);
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null, modo: "rayas" });
  assert.equal(r.status, 400);
  assert.equal(llamadas.length, 0);
  // The editor's draft (`desde`) travels with `modo`; Python decides what the new style keeps.
  const BORRADOR = { ...ESPIRAL, globos_por_racimo: 4, simetria: "espejo", acentos: [{ material: 1, cada: 2, desde: 1, posiciones: [0] }] };
  llamadas = instalarFetch((llamada) => resultado(llamada, patronResuelto(false)));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null, modo: "anillos", desde: BORRADOR });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual([llamadas[0]!.body.modo, llamadas[0]!.body.desde], ["anillos", BORRADOR]);
  llamadas = instalarFetch(() => { throw new Error("un desde inválido no debe llegar a Python"); });
  for (const [caso, cuerpo] of [
    ["desde sin modo", { plan, estructura_id: ESTRUCTURA, patron_color: null, desde: BORRADOR }],
    ["desde con un patrón aplicado", { plan, estructura_id: ESTRUCTURA, patron_color: ESPIRAL, modo: "anillos", desde: BORRADOR }],
    ["desde fuera de patron-color.v1", { plan, estructura_id: ESTRUCTURA, patron_color: null, modo: "anillos", desde: { ...BORRADOR, color: "rojo" } }],
  ] as const) {
    r = await pedir(cuerpo);
    assert.equal(r.status, 400, caso);
  }
  assert.equal(llamadas.length, 0);
  console.log("[PASS] punto de partida de un estilo: modo y el borrador (desde) llegan a Python; con patrón, desconocido o desde suelto → 400");

  // --- 1d. A wide wall: Python draws up to 4000 cells, so a 10 m × 2.4 m wall
  // comes out 18 × 76 and one row can be 4000 balloons long. Every balloon the
  // chart draws can be painted: the brush, the accents and the draft sent with
  // a style change reach Python whatever their column (it ignores, with a
  // warning, what falls outside the piece). Beyond any possible grid is still 400.
  const PARED_ANCHA = {
    version: "patron-color.v1",
    origen: "decorador",
    base: { modo: "damero", secuencia: [0, 1], tamano: 1 },
    acentos: [{ material: 1, cada: 3, desde: 2, posiciones: [0, 75, 3999] }],
    pintados: [{ fila: 17, columna: 75, material: 1 }, { fila: 3999, material: 0 }, { fila: 0, columna: 3999, material: 1 }],
  };
  assert.deepEqual(PatronColorV1Schema.parse(PARED_ANCHA), PARED_ANCHA);
  const { EdicionPatronSchema } = await import("../../src/lib/plan/edicion-esquemas");
  EdicionPatronSchema.parse({ accion: "patron", estructura_id: ESTRUCTURA, patron_color: PARED_ANCHA });
  llamadas = instalarFetch((llamada) => resultado(llamada, patronResuelto(llamada.body.patron_color !== null)));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: PARED_ANCHA });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null, modo: "anillos", desde: PARED_ANCHA });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(llamadas.map((llamada) => llamada.body.patron_color ?? llamada.body.desde), [PARED_ANCHA, PARED_ANCHA], "the painted balloon in column 76 reaches Python untouched");
  llamadas = instalarFetch(() => { throw new Error("an index beyond any grid must not reach Python"); });
  for (const fuera of [
    { ...PARED_ANCHA, pintados: [{ fila: 0, columna: 4000, material: 1 }] },
    { ...PARED_ANCHA, pintados: [{ fila: 4000, material: 1 }] },
    { ...PARED_ANCHA, acentos: [{ material: 1, cada: 3, desde: 2, posiciones: [4000] }] },
  ]) {
    r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: fuera });
    assert.equal(r.status, 400, JSON.stringify(fuera.pintados ?? fuera.acentos));
    assert.throws(() => EdicionPatronSchema.parse({ accion: "patron", estructura_id: ESTRUCTURA, patron_color: fuera }));
  }
  assert.equal(llamadas.length, 0);
  console.log("[PASS] pared ancha: pintar el globo de la columna 76 (o cualquier posición de una rejilla de 4000) llega a Python en la vista previa, el cambio de estilo y el autoguardado; más allá → 400");

  // --- 2. The answer is validated: another structure, or a suggestion marked as applied, is not drawn.
  for (const patron of [patronResuelto(false, "EST_09_OTRA"), patronResuelto(true), { ...patronResuelto(false), celdas: "x" }]) {
    instalarFetch((llamada) => resultado(llamada, patron));
    r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null });
    assert.equal(r.status, 502, JSON.stringify(patron).slice(0, 80));
    assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE");
    UiErrorV1Schema.parse(r.cuerpo.ui_error);
  }
  console.log("[PASS] vista previa: una respuesta de otra estructura, mal marcada o fuera del contrato → 502 PYTHON_INVALID_RESPONSE");

  // --- 3. Domain rejections keep Python's status; patron_invalido carries motivo and mensaje.
  const MENSAJE = "Blanco (2) no aparece en el patrón: agrégalo al racimo o quítalo de la pieza.";
  instalarFetch(() => rechazoPython("patron_invalido", 422, { estructura_id: ESTRUCTURA, motivo: "material_sin_uso", mensaje: MENSAJE }));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: ESPIRAL });
  assert.equal(r.status, 422);
  const { ui_error: uiInvalido, ...legacyInvalido } = r.cuerpo;
  assert.deepEqual(legacyInvalido, { error: MENSAJE, causa: "PATRON_INVALIDO", motivo: "material_sin_uso", mensaje: MENSAJE });
  const uiPatron = UiErrorV1Schema.parse(uiInvalido);
  assert.equal(uiPatron.code, "PROPUESTA_INCOMPLETA");
  assert.equal(uiPatron.mensaje_usuario, MENSAJE);

  // The preview's rejection carries the styles Python admits for the piece (no suggestion needed).
  instalarFetch(() => rechazoPython("patron_invalido", 422, { estructura_id: ESTRUCTURA, motivo: "material_sin_uso", mensaje: MENSAJE, modos_admitidos: MODOS_ADMITIDOS }));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null });
  assert.equal(r.status, 422);
  assert.deepEqual(r.cuerpo.modos_admitidos, MODOS_ADMITIDOS);
  assert.equal(r.cuerpo.motivo, "material_sin_uso");
  // Styles outside the contract (unknown, repeated, extra keys) never reach the browser.
  for (const modos of [[{ modo: "rombos", direcciones: ["longitudinal"], espejo: false }], [...MODOS_ADMITIDOS, MODOS_ADMITIDOS[0]], [{ ...MODOS_ADMITIDOS[0], extra: 1 }], "espiral"]) {
    instalarFetch(() => rechazoPython("patron_invalido", 422, { estructura_id: ESTRUCTURA, motivo: "material_sin_uso", mensaje: MENSAJE, modos_admitidos: modos }));
    r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null });
    assert.equal(r.status, 422);
    assert.equal("modos_admitidos" in r.cuerpo, false, JSON.stringify(modos));
    assert.equal(r.cuerpo.mensaje, MENSAJE, "the rest of the rejection still arrives");
  }

  instalarFetch(() => rechazoPython("estructura_no_encontrada", 404));
  r = await pedir({ plan, estructura_id: "EST_09_OTRA", patron_color: null });
  assert.equal(r.status, 404);
  assert.equal("modos_admitidos" in r.cuerpo, false);
  assert.equal(r.cuerpo.error, "No se encontró la estructura seleccionada.");
  assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "PROPUESTA_DESACTUALIZADA");

  instalarFetch(() => rechazoPython("invalid_plan", 422));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: ESPIRAL });
  assert.equal(r.status, 422);
  assert.equal(r.cuerpo.error, "El patrón de color no tiene un formato válido.");
  console.log("[PASS] vista previa: patron_invalido 422 con motivo/mensaje y los estilos de la pieza, estructura_no_encontrada 404, invalid_plan 422");

  // --- 4. Transport failures: Python unreachable is retryable, never a success.
  globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null });
  assert.equal(r.status, 502);
  assert.equal(r.cuerpo.code, "PYTHON_UNAVAILABLE");
  assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "SERVICIO_NO_DISPONIBLE");
  console.log("[PASS] vista previa: Python caído → 502 PYTHON_UNAVAILABLE / SERVICIO_NO_DISPONIBLE");

  // --- 5. Deliberate client errors, before any call to Python.
  llamadas = instalarFetch(() => { throw new Error("un cuerpo inválido no debe llegar a Python"); });
  const invalidos: Array<[string, unknown, number]> = [
    ["JSON mal formado", "{\"plan\":", 400],
    ["campo desconocido", { plan, estructura_id: ESTRUCTURA, patron_color: null, extra: 1 }, 400],
    ["sin patron_color (null pide la sugerencia; omitirlo no)", { plan, estructura_id: ESTRUCTURA }, 400],
    ["patrón fuera de patron-color.v1", { plan, estructura_id: ESTRUCTURA, patron_color: { ...ESPIRAL, base: { modo: "espiral", racimo: [], trazo: "espiral" } } }, 400],
    ["plan fuera de plan-decoracion.v1", { plan: { ...plan, estructuras: [] }, estructura_id: ESTRUCTURA, patron_color: null }, 400],
    ["cuerpo demasiado grande", { plan, estructura_id: ESTRUCTURA, patron_color: null, relleno: "x".repeat(70 * 1024) }, 413],
  ];
  for (const [caso, cuerpo, status] of invalidos) {
    r = await pedir(cuerpo);
    assert.equal(r.status, status, caso);
    assert.equal(typeof r.cuerpo.error, "string", caso);
    assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "SOLICITUD_INVALIDA", caso);
  }
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null }, { "content-length": String(1024 * 1024) });
  assert.equal(r.status, 413, "a declared size over the limit is rejected before reading");
  assert.equal(llamadas.length, 0);
  console.log("[PASS] vista previa: 400 por JSON o cuerpo inválido y 413 por tamaño, sin llamar a Python");

  // --- 6. Same authentication as /api/plan-editar: the session cookie.
  process.env.APP_PASSWORD = "clave-local-de-prueba";
  llamadas = instalarFetch((llamada) => resultado(llamada, patronResuelto(false)));
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null });
  assert.equal(r.status, 401);
  assert.equal(llamadas.length, 0, "no session, no call");
  r = await pedir({ plan, estructura_id: ESTRUCTURA, patron_color: null }, { cookie: `${SESSION_COOKIE}=${sessionToken("clave-local-de-prueba")}` });
  assert.equal(r.status, 200);
  delete process.env.APP_PASSWORD;
  console.log("[PASS] vista previa: sin sesión válida → 401 sin llamar a Python; con sesión → 200");

  // --- 7. The browser helper (peticion-patron.ts) reads exactly what the route answers.
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => POST(new Request(new URL(String(url), "http://127.0.0.1"), init))) as typeof fetch;
  instalarFetch((llamada) => resultado(llamada, patronResuelto(true)));
  const dibujado = await pedirVistaPatron({ plan: PlanDecoracionSchema.parse(plan), estructura_id: ESTRUCTURA, patron_color: espiral }, { fetcher });
  assert.equal(dibujado.estructura_id, ESTRUCTURA);
  instalarFetch(() => rechazoPython("patron_invalido", 422, { estructura_id: ESTRUCTURA, motivo: "material_sin_uso", mensaje: MENSAJE }));
  await assert.rejects(
    pedirVistaPatron({ plan: PlanDecoracionSchema.parse(plan), estructura_id: ESTRUCTURA, patron_color: espiral }, { fetcher }),
    (error: unknown) => error instanceof FalloPlanPatron && error.message === MENSAJE && error.motivo === "material_sin_uso" && error.modosAdmitidos === null,
  );
  instalarFetch(() => rechazoPython("patron_invalido", 422, { estructura_id: ESTRUCTURA, motivo: "material_sin_uso", mensaje: MENSAJE, modos_admitidos: MODOS_ADMITIDOS }));
  await assert.rejects(
    pedirVistaPatron({ plan: PlanDecoracionSchema.parse(plan), estructura_id: ESTRUCTURA, patron_color: null }, { fetcher }),
    (error: unknown) => error instanceof FalloPlanPatron && error.patronInvalido && JSON.stringify(error.modosAdmitidos) === JSON.stringify(MODOS_ADMITIDOS),
  );
  instalarFetch(() => rechazoPython("estructura_no_encontrada", 404));
  await assert.rejects(
    pedirVistaPatron({ plan: PlanDecoracionSchema.parse(plan), estructura_id: ESTRUCTURA, patron_color: null }, { fetcher }),
    (error: unknown) => error instanceof FalloPlanPatron && error.motivo === null && error.message !== RESPALDO_VISTA_PATRON,
  );
  console.log("[PASS] peticion-patron.ts: dibuja el {patron} de la ruta, muestra el mensaje de Python con su motivo y lee los estilos del rechazo");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[FAIL]", error);
    process.exit(1);
  },
);
