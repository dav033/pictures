/**
 * Offline checks for loose balloons (granel) in the professional quote.
 * Python owns every number (`services/ai-api/tests/test_cotizacion_granel.py`:
 * exact units, price per balloon, leftovers, totals); here: which units of the
 * plan quote are sent, how the browser reads what the decorator typed (price
 * per balloon, extra balloons), the contract both ways, and the compatibility
 * with an OLDER Python (VPS commit e447cfe, `extra="forbid"`): it only ever
 * receives the request it always received, its answer still parses, and the
 * switch stays hidden. `globalThis.fetch` is stubbed; no network, no database.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-cotizacion-granel.ts
 */
import assert from "node:assert/strict";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { body: Json; headers: Headers };

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(esObjeto(body));
    const llamada = { body, headers: new Headers(init?.headers) };
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

/** Two variants of the plan quote, as Python resolved them (catalog prices). */
const COTIZACION = {
  lineas: [
    { id: "rosado-12", varianteId: "rosado-12", nombre: "Globo de látex 12\" Rosado", tamano: "R-12", cantidadNecesaria: 37, disponible: true, paquetes: 1, precioPaquete: 23_478, unidadesPaquete: 50, sobrante: 13 },
    { id: "metalizado", varianteId: "metalizado", nombre: "Globo metalizado 16\" Rosado", tamano: "16IN", cantidadNecesaria: 2, disponible: true, paquetes: 2, precioPaquete: 955, unidadesPaquete: 1, sobrante: 0 },
    { id: "sin", tamano: "R-12", color: "verde", cantidadNecesaria: 4, disponible: false, sinReferencia: true },
  ],
};

const MATERIALES = [
  { variant_id: "rosado-12", descripcion: "Globo de látex 12\" Rosado", paquetes: 1, precio_paquete_catalogo_cop: 23_478 },
  { variant_id: "metalizado", descripcion: "Globo metalizado 16\" Rosado", paquetes: 2, precio_paquete_catalogo_cop: 955 },
];
const ENTRADA = { materiales: MATERIALES, mano_de_obra: [], equipos_transporte: [], indirectos: [], utilidad_porcentaje: 30 };

/** What an OLD Python (e447cfe) answers: no `granel`, no `modo`, no `modos_materiales`. */
function respuestaVieja(): Json {
  return {
    operation_schema_version: "cotizacion-profesional-result.v1",
    currency: "COP",
    materiales: {
      lineas: [
        { variant_id: "rosado-12", descripcion: MATERIALES[0]!.descripcion, paquetes: 1, precio_paquete_catalogo_cop: 23_478, precio_paquete_cop: 23_478, precio_editado: false, subtotal_cop: 23_478 },
        { variant_id: "metalizado", descripcion: MATERIALES[1]!.descripcion, paquetes: 2, precio_paquete_catalogo_cop: 955, precio_paquete_cop: 955, precio_editado: false, subtotal_cop: 1_910 },
      ],
      total_cop: 25_388,
    },
    mano_de_obra: { lineas: [], total_cop: 0 },
    equipos_transporte: { lineas: [], total_cop: 0 },
    indirectos: { lineas: [], total_cop: 0 },
    total_costos_cop: 25_388,
    utilidad_porcentaje: 30,
    utilidad_cop: 7_616,
    precio_sugerido_cop: 33_004,
    margen_porcentaje: 23.08,
  };
}

/** What the NEW Python answers to the granel request (numbers checked by the Python suite). */
function respuestaGranel(modo: "paquete" | "granel" = "granel"): Json {
  const vieja = respuestaVieja();
  const materiales = vieja.materiales as { lineas: Json[]; total_cop: number };
  const granel = [
    { unidades_plan: 37, unidades_extra: 0, unidades: 37, unidades_paquete: 50, precio_unidad_base_cop: 470, precio_unidad_estimado: true, precio_unidad_cop: 470, precio_unidad_editado: false, subtotal_cop: 17_390, sobrante_paquetes: 13 },
    { unidades_plan: 2, unidades_extra: 0, unidades: 2, unidades_paquete: 1, precio_unidad_base_cop: 955, precio_unidad_estimado: false, precio_unidad_cop: 955, precio_unidad_editado: false, subtotal_cop: 1_910, sobrante_paquetes: 0 },
  ];
  return {
    ...vieja,
    materiales: {
      lineas: materiales.lineas.map((linea, indice) => ({ ...linea, granel: granel[indice] })),
      total_cop: modo === "granel" ? 19_300 : 25_388,
      modo,
      total_paquetes_cop: 25_388,
      granel: { unidades_plan: 39, unidades_extra: 0, unidades: 39, sobrante_paquetes: 13, total_cop: 19_300 },
    },
    modos_materiales: ["paquete", "granel"],
  };
}

async function probarLectura(): Promise<void> {
  const g = await import("../../src/lib/cotizacion/granel");
  const b = await import("../../src/lib/cotizacion/borrador-profesional");

  const { materiales } = b.materialesDesdeCotizacion(COTIZACION);
  assert.deepEqual(materiales, MATERIALES);
  const unidades = g.unidadesDesdeCotizacion(COTIZACION, materiales);
  assert.deepEqual(unidades, { "rosado-12": { unidades_plan: 37, unidades_paquete: 50 }, metalizado: { unidades_plan: 2, unidades_paquete: 1 } }, "exactly the plan's balloons, not the 50 of the bag");
  const repetida = { lineas: [...COTIZACION.lineas, { ...COTIZACION.lineas[0]!, id: "rosado-12b", cantidadNecesaria: 3 }] };
  assert.equal(g.unidadesDesdeCotizacion(repetida, b.materialesDesdeCotizacion(repetida).materiales)?.["rosado-12"]?.unidades_plan, 40, "one variant in two lines: units added, like the bags");
  const sinUnidades = { lineas: [{ ...COTIZACION.lineas[0]!, unidadesPaquete: undefined }, COTIZACION.lineas[1]!] };
  assert.equal(g.unidadesDesdeCotizacion(sinUnidades, b.materialesDesdeCotizacion(sinUnidades).materiales), null, "a material without units per bag: no half granel");
  console.log("[PASS] unidades: los globos exactos del plan por variante (de la cotización de Python); sin las unidades del paquete no se ofrece granel");

  assert.equal(g.leerGlobosExtra(""), 0);
  assert.equal(g.leerGlobosExtra("10"), 10);
  assert.equal(g.leerGlobosExtra("1.000"), 1000);
  for (const texto of ["-1", "2,5", "diez", "100001"]) assert.equal(g.leerGlobosExtra(texto), null, texto);
  assert.equal(g.estadoPrecioUnidad(undefined), "base");
  assert.equal(g.estadoPrecioUnidad(""), "vacio");
  assert.equal(g.estadoPrecioUnidad("4,5"), "ilegible");
  assert.equal(g.estadoPrecioUnidad("400"), "propio");
  console.log("[PASS] lectura: globos extra enteros (vacío es ninguno); el precio por globo vacío o ilegible no se da por bueno");

  assert.ok(unidades);
  const borrador = g.granelVacio();
  let leido = g.leerGranel(borrador, unidades, materiales);
  assert.deepEqual(leido.granel, { "rosado-12": { unidades_plan: 37, unidades_paquete: 50 }, metalizado: { unidades_plan: 2, unidades_paquete: 1 } }, "nothing typed: Python's price per balloon");
  borrador.preciosUnidad["rosado-12"] = "400";
  borrador.extras["rosado-12"] = "10";
  leido = g.leerGranel(borrador, unidades, materiales);
  assert.deepEqual(leido.granel?.["rosado-12"], { unidades_plan: 37, unidades_paquete: 50, unidades_extra: 10, precio_unidad_cop: 400 });
  const paquete = g.entradaConGranel(ENTRADA, leido, "paquete");
  const granel = g.entradaConGranel(ENTRADA, leido, "granel");
  assert.equal(paquete?.modo_materiales, "paquete", "by bag, the granel total still comes back to compare");
  assert.equal(granel?.modo_materiales, "granel");
  assert.ok(granel?.materiales.every((linea) => linea.granel));
  borrador.preciosUnidad.metalizado = "";
  leido = g.leerGranel(borrador, unidades, materiales);
  assert.equal(leido.granel, null);
  assert.ok(leido.erroresPrecio.metalizado);
  assert.equal(g.entradaConGranel(ENTRADA, leido, "granel"), null, "a granel price half typed sends nothing");
  assert.deepEqual(g.entradaConGranel(ENTRADA, leido, "paquete"), ENTRADA, "by bag it still calculates, as always");
  console.log("[PASS] entrada: a granel van las unidades del plan, los extra y el precio propio; algo ilegible a granel no envía nada");

  const conPrecioMalo = { ...b.borradorVacio(), precios: { "rosado-12": "veinte mil", metalizado: "900" } };
  assert.deepEqual(g.preciosLegibles(conPrecioMalo, materiales).precios, { metalizado: "900" }, "a bag price half typed (hidden in granel) does not block granel");
  assert.equal(g.anunciaGranel({ modos_materiales: ["paquete", "granel"] }), true);
  assert.equal(g.anunciaGranel({}), false, "an older Python announces nothing");
  assert.equal(g.anunciaGranel(null), false);
  assert.deepEqual(g.granelDesdeTexto('{"modo":"granel","preciosUnidad":{"a":"400","b":4},"extras":[]}'), { modo: "granel", preciosUnidad: { a: "400" }, extras: {} });
  assert.equal(g.granelDesdeTexto("{roto"), null);
  console.log("[PASS] borrador: lo guardado se lee con cuidado; solo un Python que anuncia granel lo recibe");
}

async function probarContrato(): Promise<void> {
  const p = await import("../../src/lib/cotizacion/profesional");
  assert.ok(p.EntradaCotizacionProfesionalSchema.safeParse(ENTRADA).success, "the old request is still valid");
  const conGranel = { ...ENTRADA, modo_materiales: "granel", materiales: MATERIALES.map((linea) => ({ ...linea, granel: { unidades_plan: 3, unidades_paquete: 50 } })) };
  assert.ok(p.EntradaCotizacionProfesionalSchema.safeParse(conGranel).success);
  for (const [caso, cuerpo] of [
    ["medio granel", { ...conGranel, materiales: [conGranel.materiales[0], MATERIALES[1]] }],
    ["granel sin globos sueltos", { ...ENTRADA, modo_materiales: "granel" }],
    ["un modo que no existe", { ...conGranel, modo_materiales: "suelto" }],
    ["cero globos del plan", { ...conGranel, materiales: [{ ...MATERIALES[0], granel: { unidades_plan: 0, unidades_paquete: 50 } }] }],
    ["extra negativo", { ...conGranel, materiales: [{ ...MATERIALES[0], granel: { unidades_plan: 3, unidades_paquete: 50, unidades_extra: -1 } }] }],
    ["campo de más en granel", { ...conGranel, materiales: [{ ...MATERIALES[0], granel: { unidades_plan: 3, unidades_paquete: 50, color: "rosado" } }] }],
  ] as const) {
    assert.equal(p.EntradaCotizacionProfesionalSchema.safeParse(cuerpo).success, false, caso);
  }
  assert.ok(p.CotizacionProfesionalResultadoSchema.safeParse(respuestaVieja()).success, "an older Python's answer still parses");
  assert.ok(p.CotizacionProfesionalResultadoSchema.safeParse(respuestaGranel()).success);
  assert.ok(p.CotizacionProfesionalResultadoSchema.safeParse({ ...respuestaGranel(), modos_materiales: ["paquete", "granel", "otro-futuro"] }).success, "a future mode does not break the quote");
  console.log("[PASS] contrato: la entrada y la respuesta de siempre siguen valiendo; granel en todos o en ninguno y solo con sus globos sueltos");
}

async function probarRuta(): Promise<void> {
  const { POST } = await import("../../src/app/api/cotizacion-profesional/route");
  async function pedir(cuerpo: unknown): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/cotizacion-profesional", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }

  // Old Python: the request is byte for byte the old one (no field it would reject), plus a header it ignores.
  let llamadas = instalarFetch((llamada) => sobre(llamada, respuestaVieja()));
  let r = await pedir(ENTRADA);
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(r.cuerpo, respuestaVieja());
  const cuerpo = llamadas[0]!.body;
  assert.deepEqual(Object.keys(cuerpo).sort(), ["context", "equipos_transporte", "indirectos", "mano_de_obra", "materiales", "schema_version", "utilidad_porcentaje"], "nothing an older Python would reject");
  for (const linea of cuerpo.materiales as Json[]) assert.deepEqual(Object.keys(linea).sort(), ["descripcion", "paquetes", "precio_paquete_catalogo_cop", "variant_id"]);
  assert.equal(llamadas[0]!.headers.get("x-cotizacion-modos"), "granel", "the question goes in a header, outside the signed body");
  const { anunciaGranel } = await import("../../src/lib/cotizacion/granel");
  assert.equal(anunciaGranel(r.cuerpo), false, "old Python: the switch stays hidden");
  console.log("[PASS] Python anterior: recibe exactamente la petición de siempre (más una cabecera que ignora) y su respuesta pasa; sin anuncio no hay conmutador");

  // New Python: granel is forwarded and its answer in that mode comes back.
  const conGranel = { ...ENTRADA, modo_materiales: "granel", materiales: MATERIALES.map((linea) => ({ ...linea, granel: { unidades_plan: linea.variant_id === "metalizado" ? 2 : 37, unidades_paquete: linea.variant_id === "metalizado" ? 1 : 50 } })) };
  llamadas = instalarFetch((llamada) => sobre(llamada, respuestaGranel()));
  r = await pedir(conGranel);
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.equal((r.cuerpo.materiales as Json).total_cop, 19_300);
  assert.equal(llamadas[0]!.body.modo_materiales, "granel");
  assert.deepEqual((llamadas[0]!.body.materiales as Json[])[0]!.granel, { unidades_plan: 37, unidades_paquete: 50 });
  assert.equal(anunciaGranel(r.cuerpo), true);

  // Asked for granel, answered by bag (or without granel lines): not shown as if it were granel.
  for (const respuesta of [respuestaGranel("paquete"), respuestaVieja()]) {
    instalarFetch((llamada) => sobre(llamada, respuesta));
    r = await pedir(conGranel);
    assert.equal(r.status, 502);
    assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE");
  }
  console.log("[PASS] Python nuevo: el granel llega a Python y vuelve en su modo; una respuesta en otro modo es 502, nunca un total de paquetes presentado como granel");
}

async function main(): Promise<void> {
  await probarLectura();
  await probarContrato();
  await probarRuta();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
