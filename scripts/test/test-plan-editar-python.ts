/**
 * Offline checks for `/api/plan-editar` on plans produced by Python (design E2/E3):
 * editor admission through catalog selection, Python-owned recommendations,
 * snapshot-pinned search and fail-closed tokens. `globalThis.fetch` is stubbed;
 * there is no network, and no tested path queries PostgreSQL (the pool is created
 * lazily from a loopback URL; only the audit INSERT is recorded, never sent).
 *
 * ADR-0028 §9: the edit itself (agregar, quitar, repartir, patrón…) is
 * Python's (POST /internal/v1/plan/edit), and its semantics are tested in
 * `services/ai-api/tests/test_plan_edicion.py`. The stub answers that route
 * with canned plans; here only Next's orchestration is asserted: tokens,
 * re-resolution, the edit request, code → status mapping, re-signing, audit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-plan-editar-python-secret-20260914";

const SNAPSHOT = "products_catalog:test";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const PLAN_HASH = "a".repeat(64);

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json };

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leerFixture(nombre: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), "contracts", "domain", "v1", "fixtures", nombre), "utf8"));
  assert.ok(esObjeto(parsed));
  return parsed;
}

/** Set in main(): each case starts without resolutions remembered from the previous one. */
let olvidarResoluciones: () => void = () => {};

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
  olvidarResoluciones();
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(esObjeto(body));
    const llamada = { path: new URL(String(input)).pathname, body };
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

function payloadResolucion(): Json {
  const resolved = leerFixture("plan-resuelto-ok.json");
  const quote = leerFixture("quote-ok.json");
  assert.ok(esObjeto(resolved.totales));
  return {
    operation_schema_version: "plan-resolution-result.v1",
    catalog_snapshot_id: SNAPSHOT,
    plan_resuelto: { ...resolved, plan_hash: PLAN_HASH, totales: { ...resolved.totales, merma_porcentaje: 8 } },
    material_estimate: leerFixture("material-estimate-ok.json"),
    quote: { ...quote, waste_percentage: 8, plan_hash: PLAN_HASH },
  };
}

const RUTA_EDICION = "/internal/v1/plan/edit";
const RUTA_RESOLUCION = "/internal/v1/plan/resolve";

/** Canned plan-edit-result.v1: the plan Next sent, changed as the test says (Python's job). */
function sobreEdicion(llamada: Llamada, cambiar: (plan: Json) => Json = (plan) => plan, avisos: string[] = []): Response {
  const plan = llamada.body.plan;
  assert.ok(esObjeto(plan));
  return sobre(llamada, { operation_schema_version: "plan-edit-result.v1", plan: cambiar(structuredClone(plan)), avisos });
}

/** A domain rejection as Python's boundary writes it (`_error(code, status, details)`). */
function rechazoPython(code: string, status: number, detalles: Json = {}): Response {
  return Response.json({ detail: { code, request_id: "00000000-0000-4000-8000-00000000e000", correlation_id: "00000000-0000-4000-8000-00000000e001", ...detalles } }, { status });
}

/** Changes the first structure of a plan. */
function conPrimeraEstructura(plan: Json, cambiar: (estructura: Json) => Json): Json {
  const estructuras = plan.estructuras as Json[];
  return { ...plan, estructuras: [cambiar(estructuras[0]!), ...estructuras.slice(1)] };
}

function payloadBusqueda(snapshot: string): Json {
  return {
    operation_schema_version: "catalog-search-result.v1",
    status: "NO_MATCH",
    sku_status: "not_sku",
    candidates: [],
    whitelist: [],
    catalog_snapshot_id: snapshot,
    latency_parse_ms: 1,
    latency_retrieval_ms: 1,
  };
}

type VarianteRec = { variant_id: string; price: number; colors: string[] };

function payloadRecomendaciones(productos: Array<{ product_id: string; title: string; variants: VarianteRec[] }>, referencia = "var-rojo-12"): Json {
  return {
    operation_schema_version: "catalog-recommendations-result.v1",
    catalog_snapshot_id: SNAPSHOT,
    reference: { product_id: "prod-rojo", variant_id: referencia, size_code: "R-12", diameter_inches: 12, shape: "redondo", category: "globo_latex", colors: ["rojo"] },
    candidates: productos.map((producto) => ({
      product_id: producto.product_id,
      title: producto.title,
      category: "globo_latex",
      colors: [],
      finishes: [],
      occasions: [],
      available: true,
      image: null,
      variants: producto.variants.map((variant) => ({
        variant_id: variant.variant_id,
        sku: null,
        title: null,
        price: variant.price,
        available: true,
        size_code: "R-12",
        diameter_inches: 12,
        shape: "redondo",
        colors: variant.colors,
      })),
    })),
  };
}

async function main(): Promise<void> {
  const { crearTokenPlan, abrirContextoPlan, verificarTokenAprobacion } = await import("../../src/lib/plan/aprobacion");
  const { POST } = await import("../../src/app/api/plan-editar/route");
  const { PlanDecoracionSchema } = await import("../../src/lib/plan/tipos");
  const { mensajeErrorRespuesta } = await import("../../src/lib/plan/peticion-plan-editar");
  const { ordenarRecomendacionesPorColor } = await import("../../src/lib/plan/recomendaciones-orden");
  const { RECOMENDACIONES_MAX_PRODUCTOS } = await import("../../src/lib/plan/edicion-python");
  const { AllowlistProductoVarianteError } = await import("../../src/lib/plan/allowlist-producto-variante");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { getRagPool } = await import("../../src/lib/rag/db");
  const { esperarObservabilidadPendiente } = await import("../../src/lib/rag/observability/log");
  olvidarResoluciones = (await import("../../src/lib/plan/cache-resoluciones")).olvidarResoluciones;
  // Every tested path must stay off PostgreSQL: any query fails the test
  // loudly, except the audit INSERT of an applied edit, which is recorded
  // (never sent) so its content can be checked.
  const auditorias: unknown[][] = [];
  Object.defineProperty(getRagPool(), "query", {
    value: (sql: unknown, parametros: unknown) => {
      if (typeof sql === "string" && sql.trim().startsWith("INSERT INTO plan_audit_log") && Array.isArray(parametros)) {
        auditorias.push(parametros);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error("la prueba no debe consultar la base");
    },
  });

  const allowlistFirmada = [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }];
  const tokenPython = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist: allowlistFirmada });
  const base: Json = { ...leerFixture("plan-resuelto-ok.json"), plan_hash: PLAN_HASH, request_id: REQUEST_ID, approval_token: tokenPython };

  async function editar(body: Json, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json; requestId: string | null }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-editar", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: JSON.stringify(body),
    }));
    const cuerpo: unknown = await respuesta.json();
    assert.ok(esObjeto(cuerpo));
    return { status: respuesta.status, cuerpo, requestId: respuesta.headers.get("x-request-id") };
  }

  const reemplazo = (variante: { product_id: string; variant_id: string }, approval_token = tokenPython) => ({
    modo: "aplicar",
    base: { ...base, approval_token },
    edicion: { accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante },
  });

  // --- ordenarRecomendacionesPorColor: presentation-only, stable permutation.
  const variante = (variantId: string, precio: number, colores: string[]) => ({
    variantId, sku: null, titulo: null, precio, disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores,
  });
  const producto = (productId: string, titulo: string, variantes: ReturnType<typeof variante>[]) => ({
    productId, titulo, categoria: "globo_latex", colores: [], acabados: [], ocasiones: [], disponible: true, imagen: null, variantes,
  });
  const entrada = [
    producto("prod-b", "B globo", [variante("vb-azul", 10, ["azul"]), variante("vb-naranja", 5, ["naranja"])]),
    producto("prod-rojo", "Z rojo", [variante("vr-coral", 9, ["coral"]), variante("vr-sin", 3, [])]),
    producto("prod-a", "A globo", [variante("va-coral", 9, ["coral"])]),
  ];
  const copia = JSON.parse(JSON.stringify(entrada)) as typeof entrada;
  const ordenado = ordenarRecomendacionesPorColor(entrada, { productId: "prod-rojo", colores: ["rojo"] });
  // coral (0.067) before naranja (0.167) before sin color (0.7) before azul (0.778);
  // ties on color: reference product first, then title.
  assert.deepEqual(ordenado.map((p) => [p.productId, p.variantes.map((v) => v.variantId)]), [
    ["prod-rojo", ["vr-coral", "vr-sin"]],
    ["prod-a", ["va-coral"]],
    ["prod-b", ["vb-naranja", "vb-azul"]],
  ]);
  assert.deepEqual(entrada, copia, "no muta la entrada");
  const empate = [producto("p1", "Igual", [variante("v1", 1, ["verde"])]), producto("p2", "Igual", [variante("v2", 1, ["verde"])])];
  assert.deepEqual(ordenarRecomendacionesPorColor(empate, { productId: "ref", colores: [] }).map((p) => p.productId), ["p1", "p2"], "empate total conserva el orden de entrada");
  assert.deepEqual(ordenarRecomendacionesPorColor([], { productId: "ref", colores: ["rojo"] }), []);
  console.log("[PASS] ordenarRecomendacionesPorColor: comparador color→familia→título→precio, estable y sin mutar");

  // --- W2.3 (D8): el mismo color es el más cercano, no el más lejano.
  // puntuacionCromatica devolvía 1 (la peor nota) con coincidencia exacta, así
  // que un Reflex Rojo quedaba detrás de coral, naranja y azul para un Fashion
  // Rojo y se caía de los 12 productos que muestra la tarjeta.
  const mismoColor = [
    producto("prod-azul", "A azul", [variante("va-azul", 10, ["azul"])]),
    producto("prod-rojo-2", "B rojo", [variante("vr2-rojo", 10, ["rojo"])]),
    producto("prod-coral", "C coral", [variante("vc-coral", 10, ["coral"])]),
  ];
  assert.deepEqual(
    ordenarRecomendacionesPorColor(mismoColor, { productId: "prod-rojo", colores: ["rojo"] }).map((p) => p.productId),
    ["prod-rojo-2", "prod-coral", "prod-azul"],
    "rojo exacto primero, luego coral, luego azul",
  );
  // Familias de neutros: gris es plata apagada, dorado no.
  assert.deepEqual(
    ordenarRecomendacionesPorColor(
      [producto("prod-dorado", "A dorado", [variante("vd", 10, ["dorado"])]), producto("prod-gris", "B gris", [variante("vg", 10, ["gris"])])],
      { productId: "prod-plata", colores: ["plateado"] },
    ).map((p) => p.productId),
    ["prod-gris", "prod-dorado"],
  );
  // Con más candidatos que el tope de la tarjeta, la alternativa del mismo
  // color tiene que seguir dentro de los 12 que se muestran.
  const tonos = ["azul", "verde", "turquesa", "menta", "morado", "lila", "violeta", "amarillo", "naranja", "beige", "cafe", "crema", "nude", "champagne"];
  const muchos = [
    ...tonos.map((tono, indice) => producto(`prod-${tono}`, `${String(indice).padStart(2, "0")} ${tono}`, [variante(`v-${tono}`, 10, [tono])])),
    producto("prod-reflex-rojo", "Z Reflex Rojo", [variante("v-reflex-rojo", 10, ["rojo"])]),
  ];
  const doce = ordenarRecomendacionesPorColor(muchos, { productId: "prod-rojo", colores: ["rojo"] }).slice(0, RECOMENDACIONES_MAX_PRODUCTOS);
  assert.equal(doce[0]!.productId, "prod-reflex-rojo", "el mismo color encabeza las recomendaciones");
  assert.ok(doce.length === RECOMENDACIONES_MAX_PRODUCTOS && doce.some((p) => p.productId === "prod-reflex-rojo"));
  // Invariantes de la distancia perceptual. Sustituyen a las que fijaban las
  // familias de neutros: con ΔE sobre CIELAB no hacen falta familias, porque la
  // luminosidad ya separa lo que el tono solo no separaba. Lo que sigue
  // importando es el ORDEN, no el número.
  const { puntuacionCromatica, colorCatalogoMasCercano, PUNTUACION_DESCONOCIDA } = await import("../../src/lib/rag/catalog/similitud-color");
  assert.equal(puntuacionCromatica(["rojo"], ["rojo"]), 0, "una coincidencia exacta es la mejor nota posible");
  // Un neutro está mucho más cerca de otro neutro que de un color con tono.
  assert.ok(
    puntuacionCromatica(["plateado"], ["gris"]) < puntuacionCromatica(["gris"], ["dorado"]),
    "plateado/gris deben quedar más cerca que gris/dorado",
  );
  // El defecto que motivó el cambio: gris empataba con negro y plateado en 0,35
  // y el desempate alfabético mandaba el gris a negro. Una foto gris mate
  // compraba globos negros.
  assert.equal(
    colorCatalogoMasCercano("gris", ["negro", "plateado", "blanco", "dorado"]),
    "plateado",
    "el gris resuelve a plateado, no a negro",
  );
  // Pares que el modelo de solo tono daba por casi idénticos y no lo son.
  for (const [uno, otro] of [["naranja", "cafe"], ["dorado", "crema"], ["fucsia", "rosado"]] as const) {
    assert.ok(
      puntuacionCromatica([uno], [otro]) >= PUNTUACION_DESCONOCIDA,
      `${uno}/${otro} no pueden contar como sustitución: el tono los confundía, la luminosidad no`,
    );
  }
  // Y los que sí son parecidos siguen siéndolo.
  assert.ok(puntuacionCromatica(["violeta"], ["morado"]) < PUNTUACION_DESCONOCIDA, "violeta y morado siguen siendo intercambiables");
  console.log("[PASS] ordenarRecomendacionesPorColor: coincidencia exacta primero y distancia perceptual");

  // --- 1. aplicar: Python rejects a variant paired with a product that does not own it.
  let llamadas = instalarFetch((llamada) => llamada.path === "/internal/v1/plan/resolve"
    ? sobre(llamada, payloadResolucion())
    : Response.json({ detail: { code: "allowlist_product_mismatch" } }, { status: 422 }));
  let r = await editar(reemplazo({ product_id: "prod-azul", variant_id: "var-rojo-12" }));
  assert.equal(r.status, 422);
  // Campos legacy exactos, más el sobre ui-error.v1 que muestra la interfaz.
  const { ui_error: uiErrorMismatch, ...legacyMismatch } = r.cuerpo;
  assert.deepEqual(legacyMismatch, { error: new AllowlistProductoVarianteError().message, causa: "ALLOWLIST_PRODUCTO_VARIANTE" });
  const uiMismatch = UiErrorV1Schema.parse(uiErrorMismatch);
  assert.equal(uiMismatch.code, "PROPUESTA_DESACTUALIZADA");
  assert.equal(uiMismatch.detalles_dev.causa, "ALLOWLIST_PRODUCTO_VARIANTE");
  assert.deepEqual(llamadas.map((l) => l.path), ["/internal/v1/plan/resolve", "/internal/v1/catalog/selection"]);
  const seleccion = llamadas[1]!.body;
  assert.equal(seleccion.catalog_snapshot_id, SNAPSHOT);
  assert.deepEqual(seleccion.items, [{ product_id: "prod-azul", variant_id: "var-rojo-12", quantity: 1 }]);
  assert.deepEqual(seleccion.allowlist, [{ product_id: "prod-azul", variant_ids: ["var-rojo-12"] }]);
  console.log("[PASS] aplicar Python: selección fijada al snapshot con allowlist de un solo par; mismatch → 422 ALLOWLIST_PRODUCTO_VARIANTE");

  // --- 2. aplicar: selection does not admit the pair → 409 VARIANTE_NO_ADMITIDA, no resolution of the edit.
  llamadas = instalarFetch((llamada) => llamada.path === "/internal/v1/plan/resolve"
    ? sobre(llamada, payloadResolucion())
    : sobre(llamada, {
        operation_schema_version: "catalog-selection-result.v1",
        status: "empty",
        catalog_snapshot_id: SNAPSHOT,
        validados: [],
        rechazados: [{ product_id: "prod-azul", variant_id: "var-fuera", reason: "no existe en el snapshot publicado" }],
        total_cop: 0,
      }));
  r = await editar(reemplazo({ product_id: "prod-azul", variant_id: "var-fuera" }));
  assert.equal(r.status, 409);
  assert.equal(r.cuerpo.causa, "VARIANTE_NO_ADMITIDA");
  assert.equal(llamadas.length, 2, "no se re-resuelve el plan editado");
  console.log("[PASS] aplicar Python: variante no admitida por Python → 409 VARIANTE_NO_ADMITIDA sin tercera llamada");

  // --- 3. Tampered token: the signed allowlist cannot be widened.
  const [payloadB64, firma] = tokenPython.split(".");
  const decodificado: unknown = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8"));
  assert.ok(esObjeto(decodificado) && Array.isArray(decodificado.allowlist));
  const tokenManipulado = `${Buffer.from(JSON.stringify({ ...decodificado, allowlist: [...decodificado.allowlist, { product_id: "prod-rojo", variant_ids: ["var-extra"] }] })).toString("base64url")}.${firma}`;
  llamadas = instalarFetch(() => { throw new Error("un token manipulado no debe llegar a Python"); });
  for (const cuerpo of [
    reemplazo({ product_id: "prod-rojo", variant_id: "var-extra" }, tokenManipulado),
    { modo: "recomendadas", variant_id: "var-extra", approval_token: tokenManipulado },
    { modo: "buscar", consulta: "globo rojo", approval_token: tokenManipulado },
  ]) {
    r = await editar(cuerpo);
    assert.equal(r.status, 409, `modo ${String(cuerpo.modo)}`);
  }
  assert.equal(llamadas.length, 0);
  console.log("[PASS] token manipulado → 409 en aplicar, recomendadas y buscar con 0 llamadas");

  // --- 4. recomendadas through Python.
  const productosRec = [
    { product_id: "prod-azul", title: "Azul", variants: [{ variant_id: "var-azul-12", price: 8800, colors: ["azul"] }] },
    { product_id: "prod-rojo", title: "Rojo", variants: [{ variant_id: "var-rojo-12-x50", price: 29000, colors: ["coral"] }, { variant_id: "var-rojo-12-sin", price: 9000, colors: [] }] },
    ...Array.from({ length: 12 }, (_, i) => ({ product_id: `prod-n${String(i).padStart(2, "0")}`, title: `Naranja ${i}`, variants: [{ variant_id: `var-n${i}`, price: 1000 + i, colors: ["naranja"] }] })),
  ];
  llamadas = instalarFetch((llamada) => sobre(llamada, payloadRecomendaciones(productosRec)));
  r = await editar({ modo: "recomendadas", variant_id: "var-rojo-12", approval_token: tokenPython });
  assert.equal(r.status, 200);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]!.path, "/internal/v1/catalog/recommendations");
  assert.equal(llamadas[0]!.body.catalog_snapshot_id, SNAPSHOT);
  assert.equal(llamadas[0]!.body.reference_variant_id, "var-rojo-12");
  assert.equal(llamadas[0]!.body.limit, 100);
  assert.equal("lora_variant_ids" in llamadas[0]!.body, false);
  assert.ok(Array.isArray(r.cuerpo.candidatos));
  const recibidos = r.cuerpo.candidatos as Array<{ productId: string; variantes: Array<{ variantId: string }> }>;
  assert.equal(recibidos.length, 12, "se acota a 12 productos para presentación");
  assert.equal(recibidos[0]!.productId, "prod-rojo", "coral es el color más cercano a rojo");
  const { candidatoDesdePython } = await import("../../src/lib/rag/chat/candidato-python");
  const { CatalogRecommendationsResultV1Schema } = await import("../../src/lib/ia/contracts/domain-v1");
  const esperado = ordenarRecomendacionesPorColor(
    CatalogRecommendationsResultV1Schema.parse(payloadRecomendaciones(productosRec)).candidates.map(candidatoDesdePython),
    { productId: "prod-rojo", colores: ["rojo"] },
  ).slice(0, 12);
  assert.deepEqual(r.cuerpo.candidatos, JSON.parse(JSON.stringify(esperado)));
  const autorizados = new Set(productosRec.flatMap((p) => p.variants.map((v) => v.variant_id)));
  assert.ok(recibidos.every((p) => p.variantes.every((v) => autorizados.has(v.variantId))), "Next nunca agrega variantes");
  console.log("[PASS] recomendadas Python: snapshot firmado, orden por color como permutación y corte a 12");

  llamadas = instalarFetch((llamada) => sobre(llamada, payloadRecomendaciones([{ product_id: "prod-rojo", title: "Rojo", variants: [{ variant_id: "var-rojo-12", price: 1, colors: [] }] }])));
  r = await editar({ modo: "recomendadas", variant_id: "var-rojo-12", approval_token: tokenPython });
  assert.equal(r.status, 502);
  assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE");
  console.log("[PASS] recomendadas Python: referencia dentro de los candidatos → 502 PYTHON_INVALID_RESPONSE");

  llamadas = instalarFetch(() => { throw new Error("una referencia fuera de la allowlist firmada no debe llegar a Python"); });
  r = await editar({ modo: "recomendadas", variant_id: "var-otra", approval_token: tokenPython });
  assert.equal(r.status, 404);
  assert.equal(r.cuerpo.causa, "VARIANTE_REFERENCIA_NO_ENCONTRADA");
  assert.equal(llamadas.length, 0);
  console.log("[PASS] recomendadas Python: referencia fuera de la allowlist firmada → 404 sin llamar a Python");

  llamadas = instalarFetch(() => Response.json({ detail: { code: "reference_variant_not_found" } }, { status: 422 }));
  r = await editar({ modo: "recomendadas", variant_id: "var-rojo-12", approval_token: tokenPython });
  assert.equal(r.status, 404);
  assert.equal(r.cuerpo.causa, "VARIANTE_REFERENCIA_NO_ENCONTRADA");
  llamadas = instalarFetch(() => Response.json({ detail: { code: "catalog_snapshot_not_found" } }, { status: 422 }));
  r = await editar({ modo: "recomendadas", variant_id: "var-rojo-12", approval_token: tokenPython });
  assert.equal(r.status, 409);
  assert.equal(r.cuerpo.causa, "SIN_SNAPSHOT_CATALOGO");
  console.log("[PASS] recomendadas Python: reference_variant_not_found → 404; catalog_snapshot_not_found → 409 SIN_SNAPSHOT_CATALOGO");

  // --- 5. buscar pins the signed snapshot only for Python plans.
  llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda(SNAPSHOT)));
  r = await editar({ modo: "buscar", consulta: "globo rojo", approval_token: tokenPython });
  assert.equal(r.status, 200);
  assert.equal(llamadas[0]?.body.catalog_snapshot_id, SNAPSHOT);
  llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda("products_catalog:latest")));
  r = await editar({ modo: "buscar", consulta: "globo rojo" });
  assert.equal(r.status, 200);
  assert.equal(llamadas.length, 1);
  assert.equal("catalog_snapshot_id" in llamadas[0]!.body, false);
  const tokenNext = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "next", catalogSnapshotId: null, allowlist: [] });
  llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda("products_catalog:latest")));
  r = await editar({ modo: "buscar", consulta: "globo rojo", approval_token: tokenNext });
  assert.equal(r.status, 200);
  assert.equal("catalog_snapshot_id" in llamadas[0]!.body, false);
  console.log("[PASS] buscar: token Python fija catalog_snapshot_id; sin token o con token Next no");

  // --- 6. base re-resolution mismatch → 422 with cause.
  llamadas = instalarFetch(() => Response.json({ detail: { code: "allowlist_product_mismatch" } }, { status: 422 }));
  r = await editar({ modo: "aplicar", base, edicion: { accion: "quitar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12" } });
  assert.equal(r.status, 422);
  assert.equal(r.cuerpo.causa, "ALLOWLIST_PRODUCTO_VARIANTE");
  assert.equal(llamadas.length, 1);
  console.log("[PASS] aplicar Python: mismatch en la re-resolución base → 422 ALLOWLIST_PRODUCTO_VARIANTE");

  // --- 6b. E2E 2026-09-14 (D7): "Quitar" on the only material has its own code and every response has X-Request-ID.
  // Python rejects it (`unico_material`, 400); Next keeps the cause and the
  // customer sentence. The base the browser echoes carries made-up lines: the
  // edit request must carry the lines of the re-resolved (verified) plan.
  llamadas = instalarFetch((llamada) => llamada.path === RUTA_EDICION
    ? rechazoPython("unico_material", 400)
    : sobre(llamada, payloadResolucion()));
  const requestIdCliente = "00000000-0000-4000-8000-0000000000d7";
  const baseConLineasAjenas = { ...base, estructuras: [{ estructura_id: "EST_01_ARCO", lineas: [{ product_id: "prod-x", variant_id: "var-falsa", color: "negro" }] }] };
  r = await editar({ modo: "aplicar", base: baseConLineasAjenas, edicion: { accion: "quitar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12" } }, { "x-request-id": requestIdCliente });
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.causa, "UNICO_MATERIAL");
  const uiUnico = UiErrorV1Schema.parse(r.cuerpo.ui_error);
  assert.equal(uiUnico.code, "PIEZA_UNICO_MATERIAL");
  assert.equal(uiUnico.mensaje_usuario, "No se puede quitar el único globo de esta pieza; cámbialo por otro.");
  assert.equal(uiUnico.request_id, requestIdCliente);
  assert.equal(r.requestId, requestIdCliente, "the request id header is echoed");
  assert.deepEqual(llamadas.map((l) => l.path), [RUTA_RESOLUCION, RUTA_EDICION], "nothing to admit, nothing to resolve after a rejection");
  const peticionQuitar = llamadas[1]!.body;
  assert.equal(peticionQuitar.schema_version, "plan-edit.v1");
  assert.deepEqual((peticionQuitar.context as Json).scopes, ["plan.edit"]);
  assert.deepEqual(peticionQuitar.plan, JSON.parse(JSON.stringify(PlanDecoracionSchema.parse(base.plan))), "Python edits the approved declarative plan");
  assert.deepEqual(peticionQuitar.edicion, { accion: "quitar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12" });
  assert.deepEqual(peticionQuitar.lineas_base, [{ estructura_id: "EST_01_ARCO", lineas: [{ product_id: "prod-rojo", variant_id: "var-rojo-12", color: "rojo" }] }], "verified lines, never the echoed ones");
  assert.deepEqual(peticionQuitar.colores_variante, []);
  assert.equal(peticionQuitar.completar_patrones, false, "PATRONES_COLOR_V1 is off by default");
  llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda(SNAPSHOT)));
  r = await editar({ modo: "buscar", consulta: "globo rojo", approval_token: tokenPython });
  assert.match(r.requestId ?? "", /^[0-9a-f-]{36}$/, "a generated request id when the client sends none");
  console.log("[PASS] quitar el único material → 400 UNICO_MATERIAL / PIEZA_UNICO_MATERIAL, petición de edición con líneas verificadas y X-Request-ID");

  // --- 6c. D9c: "Modificar" only offers balloons for a balloon line, and the editor refuses a streamer.
  const candidatoPython = (productId: string, category: string, variante: { variant_id: string; size_code: string | null; diameter_inches: number | null; shape: string | null }) => ({
    product_id: productId, title: productId, category, colors: ["rojo"], finishes: [], occasions: [], available: true, image: null, score: 1,
    variants: [{ ...variante, sku: null, title: null, price: 1000, available: true, colors: ["rojo"] }],
  });
  llamadas = instalarFetch((llamada) => sobre(llamada, {
    ...payloadBusqueda(SNAPSHOT),
    status: "OK",
    candidates: [
      candidatoPython("prod-serpentina", "complemento", { variant_id: "var-serpentina", size_code: null, diameter_inches: null, shape: null }),
      candidatoPython("prod-rojo-satin", "globo_latex", { variant_id: "var-satin-9", size_code: "R-9", diameter_inches: 9, shape: "redondo" }),
    ],
    whitelist: [{ product_id: "prod-serpentina", variant_ids: ["var-serpentina"] }, { product_id: "prod-rojo-satin", variant_ids: ["var-satin-9"] }],
  }));
  r = await editar({ modo: "buscar", consulta: "rojo", approval_token: tokenPython, linea_objetivo: { forma: "redondo", diam_pulg: 9 } });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual((r.cuerpo.candidatos as Array<{ productId: string }>).map((item) => item.productId), ["prod-rojo-satin"], "a streamer is not offered for a balloon");
  r = await editar({ modo: "buscar", consulta: "rojo", approval_token: tokenPython });
  assert.equal((r.cuerpo.candidatos as unknown[]).length, 2, "without a target line nothing is filtered");

  const seleccionAdmitida = (cambios: Json): Json => {
    const seleccionFixture = leerFixture("catalog-selection-result.json");
    const validado = { ...(seleccionFixture.validados as Json[])[0]!, ...cambios, quantity: 1, unit_price_cop: 12000, subtotal_cop: 12000 };
    return { ...seleccionFixture, status: "ok", catalog_snapshot_id: SNAPSHOT, rechazados: [], validados: [validado], total_cop: 12000 };
  };
  const resolucionConSerpentina = (): Json => {
    const payload = payloadResolucion();
    const planResuelto = payload.plan_resuelto as Json;
    const estructuras = planResuelto.estructuras as Array<Json & { lineas: Json[] }>;
    const serpentina = { product_id: "prod-serpentina", variant_id: "var-serpentina", diam_pulg: null, diam_cm: null, forma: null, tamano_codigo: null };
    return { ...payload, plan_resuelto: { ...planResuelto, estructuras: estructuras.map((estructura) => ({ ...estructura, lineas: estructura.lineas.map((linea) => ({ ...linea, ...serpentina })) })) } };
  };
  /** Python's answer to a "reemplazar" on the arch: the new variant as an override of the red line. */
  const conOverride = (variante: { product_id: string; variant_id: string }, color?: string) => (plan: Json): Json =>
    conPrimeraEstructura(plan, (estructura) => ({ ...estructura, variant_overrides: [{ objetivo_variant_id: "var-rojo-12", ...variante, ...(color ? { color } : {}) }] }));
  let resoluciones = 0;
  llamadas = instalarFetch((llamada) => {
    if (llamada.path === RUTA_RESOLUCION) {
      resoluciones += 1;
      return sobre(llamada, resoluciones === 1 ? payloadResolucion() : resolucionConSerpentina());
    }
    if (llamada.path === RUTA_EDICION) return sobreEdicion(llamada, conOverride({ product_id: "prod-serpentina", variant_id: "var-serpentina" }));
    return sobre(llamada, seleccionAdmitida({ product_id: "prod-serpentina", variant_id: "var-serpentina", size_code: null, shape: null, diameter_inches: null }));
  });
  r = await editar(reemplazo({ product_id: "prod-serpentina", variant_id: "var-serpentina" }));
  assert.equal(r.status, 422, JSON.stringify(r.cuerpo).slice(0, 400));
  assert.equal(r.cuerpo.causa, "REEMPLAZO_INCOMPATIBLE");
  assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "REEMPLAZO_NO_COMPATIBLE");
  assert.deepEqual(llamadas.map((l) => l.path), [RUTA_RESOLUCION, "/internal/v1/catalog/selection", RUTA_EDICION, RUTA_RESOLUCION], "admit, edit in Python, then resolve the edited plan");
  console.log("[PASS] Modificar: la búsqueda filtra por la línea objetivo y aplicar rechaza un globo cambiado por una serpentina");

  // --- 6d. D9a: the edited quote carries the catalog photo of each purchase.
  const FOTO = "https://cdn.shopify.test/globo-rojo-12.jpg";
  const resolucionConFoto = (): Json => {
    const payload = payloadResolucion();
    const planResuelto = payload.plan_resuelto as Json;
    return { ...payload, plan_resuelto: { ...planResuelto, compras: (planResuelto.compras as Json[]).map((compra) => ({ ...compra, imagen: FOTO })) } };
  };
  llamadas = instalarFetch((llamada) => {
    if (llamada.path === RUTA_RESOLUCION) return sobre(llamada, resolucionConFoto());
    if (llamada.path === RUTA_EDICION) return sobreEdicion(llamada, conOverride({ product_id: "prod-rojo", variant_id: "var-rojo-12" }, "rojo"));
    return sobre(llamada, seleccionAdmitida({}));
  });
  r = await editar(reemplazo({ product_id: "prod-rojo", variant_id: "var-rojo-12" }));
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 400));
  const lineaCotizada = ((r.cuerpo.cotizacion as Json).lineas as Json[])[0]!;
  assert.equal(lineaCotizada.foto, FOTO, "photo from the consolidated purchase");
  console.log("[PASS] la cotización editada trae la foto de catálogo de cada compra");

  // --- 6e. W2.5 (D8): el color que escribe la edición.
  // El editor manda texto libre y llegaba al plan sin tocar: "azul rey" no
  // coincidía con ninguna variante del resolver geométrico (SIN_COBERTURA), y
  // la tarjeta conservaba el color de la pieza reemplazada, así que unos globos
  // azules se cotizaban como "rosado". Qué color escribe la edición lo decide
  // Python con los colores reales de la variante admitida (test_plan_edicion.py);
  // Next se los pasa y canoniza el plan editado antes de resolverlo.
  const AZUL = { product_id: "prod-azul", variant_id: "var-azul-12", product_title: "Globo Latex Redondo Fashion Azul", colors: ["azul", "turquesa"] };
  const planEnviado = (registro: Llamada[]): Json => {
    const resueltas = registro.filter((llamada) => llamada.path === RUTA_RESOLUCION);
    assert.equal(resueltas.length, 2, "se resuelve el plan base y el editado");
    const plan = resueltas[1]!.body.plan;
    assert.ok(esObjeto(plan));
    return plan;
  };
  const edicionEnviada = (registro: Llamada[]): Json => {
    const ediciones = registro.filter((llamada) => llamada.path === RUTA_EDICION);
    assert.equal(ediciones.length, 1, "una sola edición en Python");
    return ediciones[0]!.body;
  };
  const colorDelOverride = (plan: Json): unknown => {
    const estructuras = plan.estructuras as Array<Json & { variant_overrides?: Json[] }>;
    const overrides = estructuras[0]!.variant_overrides ?? [];
    assert.equal(overrides.length, 1, JSON.stringify(overrides));
    return overrides[0]!.color;
  };
  const llamadasColor = instalarFetch((llamada) => {
    if (llamada.path === RUTA_RESOLUCION) return sobre(llamada, payloadResolucion());
    if (llamada.path === RUTA_EDICION) return sobreEdicion(llamada, conOverride({ product_id: AZUL.product_id, variant_id: AZUL.variant_id }, "azul rey"));
    return sobre(llamada, seleccionAdmitida(AZUL));
  });
  r = await editar({
    modo: "aplicar",
    base: { ...base, approval_token: tokenPython },
    edicion: { accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: AZUL.product_id, variant_id: AZUL.variant_id, color: "azul rey" } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(edicionEnviada(llamadasColor).colores_variante, ["azul", "turquesa"], "los colores reales de la variante admitida");
  assert.deepEqual((edicionEnviada(llamadasColor).edicion as Json).variante, { product_id: AZUL.product_id, variant_id: AZUL.variant_id, color: "azul rey" }, "la edición viaja como la pidió el cliente");
  assert.equal(colorDelOverride(planEnviado(llamadasColor)), "azul", "el texto libre pasa por el vocabulario del catálogo al resolver");

  const llamadasAgregar = instalarFetch((llamada) => {
    if (llamada.path === RUTA_RESOLUCION) return sobre(llamada, payloadResolucion());
    if (llamada.path === RUTA_EDICION) {
      return sobreEdicion(llamada, (plan) => conPrimeraEstructura(plan, (estructura) => ({
        ...estructura,
        materiales: [
          { ...(estructura.materiales as Json[])[0]!, participacion: 0.8 },
          { product_id: AZUL.product_id, variant_id: AZUL.variant_id, color: "azul rey", participacion: 0.2, rol_material: "acento" },
        ],
      })));
    }
    return sobre(llamada, seleccionAdmitida(AZUL));
  });
  r = await editar({
    modo: "aplicar",
    base: { ...base, approval_token: tokenPython },
    edicion: { accion: "agregar", estructura_id: "EST_01_ARCO", participacion: 0.2, variante: { product_id: AZUL.product_id, variant_id: AZUL.variant_id, color: "azul rey" } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual((edicionEnviada(llamadasAgregar).edicion as Json).participacion, 0.2);
  const materialesAgregados = (planEnviado(llamadasAgregar).estructuras as Array<Json & { materiales: Json[] }>)[0]!.materiales;
  assert.equal(materialesAgregados.at(-1)!.color, "azul", "agregar canoniza el color del cliente al resolver");
  console.log("[PASS] edición: Python recibe los colores reales de la variante y Next canoniza el plan editado al resolverlo");

  // --- 6f. 2026-09-24: the card's sliders. "mezcla" and "repartir" bring no
  // new variant: nothing is admitted and the edited plan resolved is exactly
  // the one Python returned. Python rejects a split that does not match the
  // piece; Zod rejects a color under 5 % before anything is called.
  const llamadasMezcla = instalarFetch((llamada) => llamada.path === RUTA_EDICION
    ? sobreEdicion(llamada, (plan) => conPrimeraEstructura(plan, (estructura) => ({ ...estructura, mezcla: "solo_grandes" })))
    : sobre(llamada, payloadResolucion()));
  r = await editar({ modo: "aplicar", base: { ...base, approval_token: tokenPython }, edicion: { accion: "mezcla", estructura_id: "EST_01_ARCO", mezcla: "solo_grandes" } });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(llamadasMezcla.map((llamada) => llamada.path), [RUTA_RESOLUCION, RUTA_EDICION, RUTA_RESOLUCION], "sin variante nueva no se admite nada");
  assert.deepEqual(edicionEnviada(llamadasMezcla).edicion, { accion: "mezcla", estructura_id: "EST_01_ARCO", mezcla: "solo_grandes" });
  assert.equal(((planEnviado(llamadasMezcla).estructuras as Json[])[0]!).mezcla, "solo_grandes", "se resuelve el plan que editó Python");

  llamadas = instalarFetch((llamada) => llamada.path === RUTA_EDICION
    ? rechazoPython("reparto_no_corresponde", 409)
    : sobre(llamada, payloadResolucion()));
  r = await editar({ modo: "aplicar", base: { ...base, approval_token: tokenPython }, edicion: { accion: "repartir", estructura_id: "EST_01_ARCO", participaciones: [0.5, 0.5] } });
  assert.equal(r.status, 409, "one share per color of the piece (it has one material)");
  assert.equal(r.cuerpo.error, "La distribución no corresponde a los colores actuales de la pieza. Vuelve a abrirla e inténtalo otra vez.");
  assert.deepEqual(edicionEnviada(llamadas).edicion, { accion: "repartir", estructura_id: "EST_01_ARCO", participaciones: [0.5, 0.5] });
  llamadas = instalarFetch(() => { throw new Error("un reparto inválido no debe llegar a Python"); });
  r = await editar({ modo: "aplicar", base: { ...base, approval_token: tokenPython }, edicion: { accion: "repartir", estructura_id: "EST_01_ARCO", participaciones: [0.97, 0.03] } });
  assert.equal(r.status, 400, "a color under 5 % is a removal, not a split");
  assert.equal(llamadas.length, 0);
  console.log("[PASS] edición desde los deslizadores: mezcla y reparto de colores");

  // --- 6g. Every domain rejection of the Python edit keeps the status and the
  // customer sentence the TypeScript edit had (ADR-0028 §9).
  const rechazos: Array<[string, number, number, string, string | undefined]> = [
    ["estructura_no_encontrada", 404, 404, "No se encontró la estructura seleccionada.", undefined],
    ["variante_objetivo_no_encontrada", 404, 404, "No se encontró la variante objetivo en la estructura.", undefined],
    ["material_no_editable", 409, 409, "La variante visible no corresponde a un material editable.", undefined],
    ["sin_participacion", 400, 400, "La estructura quedó sin participación de materiales.", undefined],
    ["patron_activo", 409, 409, "Esta pieza usa un patrón de color: cambia sus colores desde el patrón.", "PATRON_ACTIVO"],
    ["invalid_plan", 422, 400, "La edición del plan no tiene un formato válido.", undefined],
  ];
  for (const [codigo, statusPython, statusRuta, mensaje, causa] of rechazos) {
    instalarFetch((llamada) => llamada.path === RUTA_EDICION ? rechazoPython(codigo, statusPython) : sobre(llamada, payloadResolucion()));
    r = await editar({ modo: "aplicar", base, edicion: { accion: "quitar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12" } });
    assert.equal(r.status, statusRuta, codigo);
    assert.equal(r.cuerpo.error, mensaje, codigo);
    assert.equal(r.cuerpo.causa, causa, codigo);
    UiErrorV1Schema.parse(r.cuerpo.ui_error);
  }
  instalarFetch((llamada) => llamada.path === RUTA_EDICION ? rechazoPython("patron_activo", 409) : sobre(llamada, payloadResolucion()));
  r = await editar({ modo: "aplicar", base, edicion: { accion: "repartir", estructura_id: "EST_01_ARCO", participaciones: [0.5, 0.5] } });
  const uiActivo = UiErrorV1Schema.parse(r.cuerpo.ui_error);
  assert.equal(uiActivo.code, "PROPUESTA_INCOMPLETA", "a pattern is fixed in the pattern editor, not by asking for a new proposal");
  assert.equal(uiActivo.mensaje_usuario, "Esta pieza usa un patrón de color: cambia sus colores desde el patrón.");
  console.log("[PASS] rechazos de la edición en Python → mismos status y mensajes de siempre; patron_activo → 409 con su texto");

  // --- 6h. accion "patron" (ADR-0028 §9): the pattern editor applies a pattern.
  const ESPIRAL = { version: "patron-color.v1", origen: "decorador", base: { modo: "espiral", racimo: [0, 1, 0, 1], trazo: "espiral" } };
  const AVISO = "El patrón se rehízo porque quitaste un color.";
  process.env.PATRONES_COLOR_V1 = "true";
  auditorias.length = 0;
  llamadas = instalarFetch((llamada) => llamada.path === RUTA_EDICION
    ? sobreEdicion(llamada, (plan) => conPrimeraEstructura(plan, (estructura) => ({ ...estructura, patron_color: ESPIRAL })), [AVISO])
    : sobre(llamada, payloadResolucion()));
  r = await editar({ modo: "aplicar", base, edicion: { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: ESPIRAL } });
  delete process.env.PATRONES_COLOR_V1;
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 400));
  assert.deepEqual(llamadas.map((l) => l.path), [RUTA_RESOLUCION, RUTA_EDICION, RUTA_RESOLUCION]);
  assert.deepEqual(edicionEnviada(llamadas).edicion, { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: ESPIRAL });
  assert.equal(edicionEnviada(llamadas).completar_patrones, true, "the flag travels as completar_patrones");
  assert.deepEqual(((planEnviado(llamadas).estructuras as Json[])[0]!).patron_color, ESPIRAL, "the edited plan Python returned is what gets resolved");
  assert.deepEqual(r.cuerpo.avisos, [AVISO], "Python's notices reach the card");
  const planRespuesta = r.cuerpo.plan as Json;
  assert.equal(planRespuesta.request_id, REQUEST_ID);
  assert.ok(verificarTokenAprobacion(String(planRespuesta.approval_token), String(planRespuesta.plan_hash)), "re-signed for the new plan_hash");
  // The audit is observability: it is queued, not awaited by the answer.
  await esperarObservabilidadPendiente();
  assert.equal(auditorias.length, 1, "one audit row per applied edit");
  assert.equal(auditorias[0]![15], "PLAN_EDITED");
  assert.deepEqual(JSON.parse(String(auditorias[0]![8])), { accion: "patron", estructura_id: "EST_01_ARCO", modo: "espiral" });

  // Removing it: `patron_color: null` is a valid edit; a missing field or an extra one is not.
  llamadas = instalarFetch((llamada) => llamada.path === RUTA_EDICION ? sobreEdicion(llamada) : sobre(llamada, payloadResolucion()));
  r = await editar({ modo: "aplicar", base, edicion: { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: null } });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 400));
  assert.equal("avisos" in r.cuerpo, false, "no notices, no field");
  await esperarObservabilidadPendiente();
  assert.equal(JSON.parse(String(auditorias.at(-1)![8])).modo, null);
  llamadas = instalarFetch(() => { throw new Error("una edición de patrón mal formada no debe llegar a Python"); });
  for (const edicion of [
    { accion: "patron", estructura_id: "EST_01_ARCO" },
    { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: { ...ESPIRAL, extra: true } },
    { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: null, variante: { product_id: "p", variant_id: "v" } },
  ]) {
    r = await editar({ modo: "aplicar", base, edicion });
    assert.equal(r.status, 400, JSON.stringify(edicion));
  }
  assert.equal(llamadas.length, 0);

  // Python rejects the pattern: its `motivo` and `mensaje` reach the editor as is.
  const MENSAJE_PATRON = "Azul (3) no aparece en el patrón: agrégalo al racimo o quítalo de la pieza.";
  llamadas = instalarFetch((llamada) => llamada.path === RUTA_EDICION
    ? rechazoPython("patron_invalido", 422, { estructura_id: "EST_01_ARCO", motivo: "material_sin_uso", mensaje: MENSAJE_PATRON })
    : sobre(llamada, payloadResolucion()));
  r = await editar({ modo: "aplicar", base, edicion: { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: ESPIRAL } });
  assert.equal(r.status, 422);
  const { ui_error: uiPatron, ...legacyPatron } = r.cuerpo;
  assert.deepEqual(legacyPatron, { error: MENSAJE_PATRON, causa: "PATRON_INVALIDO", motivo: "material_sin_uso", mensaje: MENSAJE_PATRON });
  const uiPatronParsed = UiErrorV1Schema.parse(uiPatron);
  assert.equal(uiPatronParsed.code, "PROPUESTA_INCOMPLETA");
  assert.equal(uiPatronParsed.mensaje_usuario, MENSAJE_PATRON);
  assert.equal(uiPatronParsed.detalles_dev.codigo_origen, "PATRON_INVALIDO:material_sin_uso");
  assert.equal(mensajeErrorRespuesta(r.cuerpo, "No se pudo actualizar la pieza."), MENSAJE_PATRON, "the card shows Python's sentence");
  assert.deepEqual(llamadas.map((l) => l.path), [RUTA_RESOLUCION, RUTA_EDICION]);
  console.log("[PASS] acción patron: petición a Python, bandera, re-firma, auditoría {accion, estructura_id, modo}, avisos y patron_invalido con motivo/mensaje");

  // --- 6i. Autosave: consecutive saves. The base of the second save is the plan
  // the first one just resolved and signed here, so it is not resolved again;
  // any other plan under the same hash (a tampered echo) is.
  llamadas = instalarFetch((llamada) => llamada.path === RUTA_EDICION
    ? sobreEdicion(llamada, (plan) => conPrimeraEstructura(plan, (estructura) => ({ ...estructura, patron_color: ESPIRAL })))
    : sobre(llamada, payloadResolucion()));
  r = await editar({ modo: "aplicar", base, edicion: { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: ESPIRAL } });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 400));
  const primeraGuardada = r.cuerpo.plan as Json;
  llamadas.length = 0;
  r = await editar({ modo: "aplicar", base: primeraGuardada, edicion: { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: null } });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 400));
  assert.deepEqual(llamadas.map((l) => l.path), [RUTA_EDICION, RUTA_RESOLUCION], "the signed base is reused: one resolution per save");
  llamadas.length = 0;
  const alterada = { ...primeraGuardada, plan: { ...(primeraGuardada.plan as Json), supuestos: ["otro plan bajo el mismo hash"] } };
  r = await editar({ modo: "aplicar", base: alterada, edicion: { accion: "patron", estructura_id: "EST_01_ARCO", patron_color: null } });
  assert.deepEqual(llamadas.map((l) => l.path).slice(0, 1), [RUTA_RESOLUCION], "a plan that is not the signed one is resolved again");
  console.log("[PASS] guardado automático: la base recién firmada no se re-resuelve; otro plan bajo el mismo hash sí");

  // --- 6i. The edited plan is checked at the boundary: another plan, or shares
  // that do not add up to 1, is an invalid Python response, never signed.
  for (const cambiar of [
    (plan: Json): Json => ({ ...plan, plan_id: "99999999-9999-4999-8999-999999999999" }),
    (plan: Json): Json => conPrimeraEstructura(plan, (estructura) => ({ ...estructura, materiales: [{ ...(estructura.materiales as Json[])[0]!, participacion: 0.5 }] })),
  ]) {
    llamadas = instalarFetch((llamada) => llamada.path === RUTA_EDICION ? sobreEdicion(llamada, cambiar) : sobre(llamada, payloadResolucion()));
    r = await editar({ modo: "aplicar", base, edicion: { accion: "mezcla", estructura_id: "EST_01_ARCO", mezcla: "clasica" } });
    assert.equal(r.status, 502, JSON.stringify(r.cuerpo).slice(0, 300));
    assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE");
    assert.deepEqual(llamadas.map((l) => l.path), [RUTA_RESOLUCION, RUTA_EDICION], "an invalid edit is never resolved");
  }
  console.log("[PASS] un plan editado que no corresponde o no suma 1 → 502 PYTHON_INVALID_RESPONSE sin resolverlo");

  // --- 6j. A malformed body is the client's error (400), not a 500.
  llamadas = instalarFetch(() => { throw new Error("un cuerpo mal formado no debe llegar a Python"); });
  const malformado = await POST(new Request("http://127.0.0.1/api/plan-editar", { method: "POST", headers: { "content-type": "application/json" }, body: "{\"modo\":" }));
  const cuerpoMalformado = await malformado.json() as Json;
  assert.equal(malformado.status, 400);
  assert.equal(UiErrorV1Schema.parse(cuerpoMalformado.ui_error).code, "SOLICITUD_INVALIDA");
  assert.equal(llamadas.length, 0);
  console.log("[PASS] JSON mal formado → 400 SOLICITUD_INVALIDA sin llamar a Python");

  // El bloque 7 probaba el kill switch: con `PYTHON_BACKEND_KILL_SWITCH=true`
  // un token Python daba 409 PYTHON_NO_SELECCIONADO en los tres modos sin
  // caer a TypeScript. El paso 5 del ADR-0023 retiró el switch y con él esa
  // causa, así que la rama no existe y no hay nada que afirmar.

  assert.deepEqual(abrirContextoPlan(tokenPython)?.allowlist, allowlistFirmada, "el token original sigue intacto");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[FAIL]", error);
    process.exit(1);
  },
);
