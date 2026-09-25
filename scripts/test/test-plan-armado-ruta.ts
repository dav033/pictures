/**
 * Offline checks for `POST /api/plan-armado-bouquet` (ADR-0030, second
 * delivery): the bouquet editor's preview. Transport only — Python arranges,
 * resolves and writes the texts (`services/ai-api/tests/test_plan_armado_preview.py`);
 * here the route is checked for what it owns: authentication, a strict body
 * with deliberate 400, the request it sends to Python (scope, short deadline,
 * only the contract fields of each balloon), the validation of the answer and
 * the error bodies `peticion-armado.ts` reads. `globalThis.fetch` is stubbed;
 * there is no network and no database.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-armado-ruta.ts
 */
import assert from "node:assert/strict";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json; headers: Headers };

const RUTA_PYTHON = "/internal/v1/plan/armado-bouquet";
const BOUQUET = "EST_01_BOUQUET";

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

/** The same bouquet the Python tests resolve: 3 white R-12, 3 pink R-12 and a gold foil heart. */
const MATERIALES = [
  ["r12-blanco", "blanco", 0.428571],
  ["r12-rosado", "rosado", 0.428571],
  ["foil-dorado", "dorado", 0.142858],
] as const;

const PLAN = {
  plan_version: "1.0",
  plan_id: "30303030-3030-4303-8303-303030303030",
  concepto: { titulo: "Prueba", descripcion: "Bouquets.", paleta: ["blanco"] },
  espacio: { tipo: "salon", fuente: "cliente" },
  estructuras: [{
    estructura_id: BOUQUET,
    nombre: "Bouquet de globos",
    tipo: "kit",
    estructura_oficial: "bouquet",
    rol_escena: "focal",
    ubicacion: "sobre_mesa_principal",
    medidas: {},
    repeticiones: 1,
    densidad: "media",
    mezcla: "clasica",
    unidades_declaradas: 7,
    materiales: MATERIALES.map(([clave, color, participacion], indice) => ({ product_id: `prod-${clave}`, variant_id: `var-${clave}`, color, participacion, rol_material: indice === 0 ? "principal" : "secundario" })),
    porque: "Bouquet de prueba.",
  }],
  supuestos: [],
  referencia_omitida: [],
};

/** A resolved line as the browser holds it: more fields than the contract takes. */
const GLOBOS = MATERIALES.map(([clave, color]) => ({
  origen: "plan",
  product_id: `prod-${clave}`,
  variant_id: `var-${clave}`,
  sku: clave.toUpperCase(),
  titulo: clave.startsWith("r12") ? `Globo látex ${color} — R-12` : "B2b Globo Metalizado Corazon Dorado Mate — 18 IN / PAQUETE X 1",
  color,
  tamano_codigo: clave.startsWith("r12") ? "R-12" : "18 IN",
  diam_pulg: clave.startsWith("r12") ? 12 : null,
  diam_cm: null,
  forma: clave.startsWith("r12") ? "redondo" : null,
  acabado: null,
  unidades: clave === "foil-dorado" ? 1 : 3,
  sustitucion: null,
}));
const GLOBOS_CONTRATO = GLOBOS.map(({ product_id, variant_id, titulo, forma, diam_pulg, tamano_codigo, color, acabado }) => ({ product_id, variant_id, titulo, forma, diam_pulg, tamano_codigo, color, acabado }));

const APILADO = {
  version: "armado-bouquet.v1",
  origen: "decorador",
  variante: "helio_apilado",
  niveles: [
    { rol: "capa", unidad: "trio", cantidad: 1, posiciones: [1, 0, 1] },
    { rol: "capa", unidad: "trio", cantidad: 1, posiciones: [0, 1, 0] },
  ],
  remate: [2],
};

/** A small, valid ArmadoBouquetResuelto as Python writes it. */
function armadoResuelto(armado: Json = APILADO, estructuraId = BOUQUET): Json {
  return {
    estructura_id: estructuraId,
    armado,
    grupos: 1,
    repeticiones: 1,
    leyenda: [
      { codigo: 1, material: 1, product_id: "prod-r12-rosado", variant_id: "var-r12-rosado", descripcion: "R-12 rosado", tipo_globo: "latex", color: "rosado", acabado: null, tamano_pulg: 12, digito: null, unidades_por_grupo: 3, unidades_total: 3 },
      { codigo: 2, material: 0, product_id: "prod-r12-blanco", variant_id: "var-r12-blanco", descripcion: "R-12 blanco", tipo_globo: "latex", color: "blanco", acabado: null, tamano_pulg: 12, digito: null, unidades_por_grupo: 3, unidades_total: 3 },
      { codigo: 3, material: 2, product_id: "prod-foil-dorado", variant_id: "var-foil-dorado", descripcion: 'Globo Metalizado Corazon Dorado Mate 18"', tipo_globo: "metalizado", color: "dorado", acabado: null, tamano_pulg: 18, digito: null, unidades_por_grupo: 1, unidades_total: 1 },
    ],
    niveles: [
      { rol: "capa", unidad: "trio", cantidad: 1, codigos: [1, 2, 1] },
      { rol: "capa", unidad: "trio", cantidad: 1, codigos: [2, 1, 2] },
    ],
    remate: [3],
    numero: null,
    insumos: [{ insumo: "pesa", cantidad: 1, unidad: "pesas", detalle: "de 80 g o más cada una", estimado: false }],
    duracion_estimada: { horas_min: 18, horas_max: 24 },
    nombre: "Bouquet de helio apilado",
    descripcion: "Capas de globos con helio a la misma altura.",
    pasos: ["Nivel 1 (capa): 1 trío de R-12 rosado (1), R-12 blanco (2)."],
    avisos: [],
    prompt_gemini: "BOUQUET ASSEMBLY — a helium balloon bouquet.",
    prompt_lora: "a helium balloon bouquet stacked in level layers of pink and white balloons topped by gold foil heart",
  };
}

const OPCIONES = { variantes_admitidas: ["base_aire", "helio_apilado", "helio_escalonado"], disposiciones_admitidas: [] };

function resultado(llamada: Llamada, armado: Json): Response {
  return sobre(llamada, { operation_schema_version: "plan-armado-bouquet-result.v1", armado, ...OPCIONES });
}

async function main(): Promise<void> {
  const { POST } = await import("../../src/app/api/plan-armado-bouquet/route");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { EDICION_PYTHON_DEADLINE_MS } = await import("../../src/lib/plan/edicion-python");
  const { SESSION_COOKIE, sessionToken } = await import("../../src/lib/auth/session");
  const { EdicionArmadoSchema } = await import("../../src/lib/plan/edicion-esquemas");

  async function pedir(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-armado-bouquet", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }

  // --- 1. Suggestion (`null`) and a given assembly: the request to Python and the answer.
  let llamadas = instalarFetch((llamada) => resultado(llamada, armadoResuelto(llamada.body.armado_bouquet === null ? { ...APILADO, origen: "sugerido" } : (llamada.body.armado_bouquet as Json))));
  let r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: GLOBOS_CONTRATO });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(r.cuerpo, { armado: armadoResuelto({ ...APILADO, origen: "sugerido" }), ...OPCIONES }, "the assembly and the options Python admits: nothing signed, nothing else");
  assert.equal(llamadas.length, 1);
  const peticion = llamadas[0]!;
  assert.equal(peticion.path, RUTA_PYTHON);
  assert.equal(peticion.body.schema_version, "plan-armado-bouquet.v1");
  assert.equal(peticion.body.estructura_id, BOUQUET);
  assert.equal(peticion.body.armado_bouquet, null);
  assert.deepEqual(peticion.body.globos, GLOBOS_CONTRATO, "exactly the contract fields of each balloon");
  const contexto = peticion.body.context as Json;
  assert.deepEqual(contexto.scopes, ["plan.armado_bouquet"]);
  assert.equal(peticion.headers.get("x-internal-scopes"), "plan.armado_bouquet");
  assert.equal(contexto.deadline_ms, EDICION_PYTHON_DEADLINE_MS, "a short deadline: the decorator is waiting");
  assert.equal("variante" in peticion.body, false, "no style unless asked");
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: APILADO, globos: GLOBOS_CONTRATO });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual((r.cuerpo.armado as Json).armado, APILADO);
  console.log("[PASS] vista previa: petición plan-armado-bouquet.v1 con scope plan.armado_bouquet, deadline corto y solo los campos del contrato de cada globo");

  // --- 1b. The style and the number placement the decorator chose travel only with `null`.
  llamadas = instalarFetch((llamada) => resultado(llamada, armadoResuelto({ ...APILADO, origen: "sugerido", variante: "helio_escalonado" })));
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: GLOBOS_CONTRATO, variante: "helio_escalonado", disposicion: "centro" });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual([llamadas[0]!.body.variante, llamadas[0]!.body.disposicion], ["helio_escalonado", "centro"]);
  llamadas = instalarFetch(() => { throw new Error("un cuerpo inválido no debe llegar a Python"); });
  for (const [caso, cuerpo] of [
    ["variante con un armado dado", { plan: PLAN, estructura_id: BOUQUET, armado_bouquet: APILADO, globos: GLOBOS_CONTRATO, variante: "base_aire" }],
    ["variante desconocida", { plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: GLOBOS_CONTRATO, variante: "flotante" }],
    ["sin globos", { plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: [] }],
    ["un globo con un campo de más", { plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: GLOBOS }],
    ["armado fuera de armado-bouquet.v1", { plan: PLAN, estructura_id: BOUQUET, armado_bouquet: { ...APILADO, variante: "flotante" }, globos: GLOBOS_CONTRATO }],
    ["sin el campo armado_bouquet", { plan: PLAN, estructura_id: BOUQUET, globos: GLOBOS_CONTRATO }],
    ["más de 12 globos", { plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: Array.from({ length: 13 }, () => GLOBOS_CONTRATO[0]) }],
  ] as const) {
    r = await pedir(cuerpo);
    assert.equal(r.status, 400, caso);
    assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "SOLICITUD_INVALIDA", caso);
  }
  r = await pedir("{no json");
  assert.equal(r.status, 400);
  assert.equal(llamadas.length, 0);
  console.log("[PASS] cuerpo estricto: estilo y disposición solo con null; globos con los campos justos y hasta 12; si no, 400 sin llamar a Python");

  // --- 2. The answer is validated: another structure, an assembly other than the one sent, or off-contract → 502.
  for (const armado of [armadoResuelto(APILADO, "EST_09_OTRA"), armadoResuelto({ ...APILADO, variante: "base_aire" }), { ...armadoResuelto(), leyenda: "x" }]) {
    instalarFetch((llamada) => resultado(llamada, armado));
    r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: APILADO, globos: GLOBOS_CONTRATO });
    assert.equal(r.status, 502, JSON.stringify(armado).slice(0, 80));
    assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE");
    UiErrorV1Schema.parse(r.cuerpo.ui_error);
  }
  console.log("[PASS] vista previa: una respuesta de otra estructura, con otro armado o fuera del contrato → 502 PYTHON_INVALID_RESPONSE");

  // --- 3. Python's rejections: `armado_invalido` keeps its rule, sentence and the options; the rest their status.
  instalarFetch(() => rechazoPython("armado_invalido", 422, { estructura_id: BOUQUET, motivo: "unidades_no_coinciden", mensaje: "El armado no usa exactamente los globos que el plan compra.", ...OPCIONES }));
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: APILADO, globos: GLOBOS_CONTRATO });
  assert.equal(r.status, 422);
  assert.equal(r.cuerpo.causa, "ARMADO_INVALIDO");
  assert.equal(r.cuerpo.motivo, "unidades_no_coinciden");
  assert.equal(r.cuerpo.mensaje, "El armado no usa exactamente los globos que el plan compra.");
  assert.deepEqual(r.cuerpo.variantes_admitidas, OPCIONES.variantes_admitidas);
  assert.deepEqual(r.cuerpo.disposiciones_admitidas, []);
  const uiError = UiErrorV1Schema.parse(r.cuerpo.ui_error);
  assert.equal(uiError.code, "PROPUESTA_INCOMPLETA");
  assert.equal(uiError.detalles_dev.codigo_origen, "ARMADO_INVALIDO:unidades_no_coinciden");
  instalarFetch(() => rechazoPython("armado_invalido", 422, { estructura_id: BOUQUET, motivo: "sin_armado_posible", mensaje: "Con estos globos no se puede armar el bouquet.", variantes_admitidas: ["flotante"] }));
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: GLOBOS_CONTRATO });
  assert.equal(r.status, 422);
  assert.equal("variantes_admitidas" in r.cuerpo, false, "options outside the contract are dropped whole");
  instalarFetch(() => rechazoPython("estructura_no_encontrada", 404));
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: GLOBOS_CONTRATO });
  assert.equal(r.status, 404);
  instalarFetch(() => rechazoPython("invalid_plan", 422));
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: null, globos: GLOBOS_CONTRATO });
  assert.equal(r.status, 422);
  console.log("[PASS] rechazos: armado_invalido llega con motivo, mensaje de Python y las opciones válidas; 404 y 422 conservan su estado");

  // --- 4. Authentication: with APP_PASSWORD only the session cookie gets in.
  process.env.APP_PASSWORD = "clave-de-prueba";
  llamadas = instalarFetch((llamada) => resultado(llamada, armadoResuelto()));
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: APILADO, globos: GLOBOS_CONTRATO });
  assert.equal(r.status, 401);
  assert.equal(llamadas.length, 0);
  r = await pedir({ plan: PLAN, estructura_id: BOUQUET, armado_bouquet: APILADO, globos: GLOBOS_CONTRATO }, { cookie: `${SESSION_COOKIE}=${sessionToken("clave-de-prueba")}` });
  assert.equal(r.status, 200);
  delete process.env.APP_PASSWORD;
  console.log("[PASS] autenticación: sin sesión 401 y nada llega a Python; con la cookie de sesión 200");

  // --- 5. The edit that saves an assembly has the same shape (`accion: "armado"`).
  EdicionArmadoSchema.parse({ accion: "armado", estructura_id: BOUQUET, armado_bouquet: APILADO });
  EdicionArmadoSchema.parse({ accion: "armado", estructura_id: BOUQUET, armado_bouquet: null });
  assert.throws(() => EdicionArmadoSchema.parse({ accion: "armado", estructura_id: BOUQUET, armado_bouquet: { ...APILADO, niveles: [] , remate: [] } }));
  console.log("[PASS] edición: la acción armado acepta un armado del contrato o null, y nada más");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
