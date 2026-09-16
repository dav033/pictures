/**
 * Offline checks for `/api/plan-editar` on plans produced by Python (design E2/E3):
 * editor admission through catalog selection, Python-owned recommendations,
 * snapshot-pinned search and fail-closed tokens. `globalThis.fetch` is stubbed;
 * there is no network, and no tested path queries PostgreSQL (the pool is created
 * lazily from a loopback URL but never used).
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

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
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
  const { crearTokenPlan, abrirContextoPlan } = await import("../src/lib/plan/aprobacion");
  const { POST } = await import("../src/app/api/plan-editar/route");
  const { ordenarRecomendacionesPorColor } = await import("../src/lib/plan/recomendaciones-orden");
  const { RECOMENDACIONES_MAX_PRODUCTOS } = await import("../src/lib/plan/edicion-python");
  const { AllowlistProductoVarianteError } = await import("../src/lib/plan/allowlist-producto-variante");
  const { UiErrorV1Schema } = await import("../src/lib/ia/contracts/ui-error-v1");
  const { getRagPool } = await import("../src/lib/rag/db");
  // Every tested path must stay off PostgreSQL: any query fails the test loudly.
  Object.defineProperty(getRagPool(), "query", {
    value: () => { throw new Error("la prueba no debe consultar la base"); },
  });

  const allowlistFirmada = [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }];
  const tokenPython = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist: allowlistFirmada });
  const base = { ...leerFixture("plan-resuelto-ok.json"), plan_hash: PLAN_HASH, request_id: REQUEST_ID, approval_token: tokenPython };

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
  // Invariante de las familias de neutros: dos colores de la misma familia
  // nunca puntúan como un color desconocido (0,7), tengan tono o no. El bloque
  // de arriba solo ejercía plateado/gris, los dos sin tono, así que la familia
  // dorado/champagne no la cubría nada: quien le quitara el tono a un miembro
  // de una familia no habría notado el cambio.
  const { puntuacionCromatica, FAMILIAS_NEUTRAS, PUNTUACION_FAMILIA } = await import("../src/lib/rag/catalog/similitud-color");
  for (const familia of FAMILIAS_NEUTRAS) {
    for (const uno of familia) {
      for (const otro of familia) {
        if (uno === otro) continue;
        assert.ok(
          puntuacionCromatica([uno], [otro]) <= PUNTUACION_FAMILIA,
          `${uno}/${otro} deben quedar dentro del techo de su familia (${PUNTUACION_FAMILIA})`,
        );
      }
    }
  }
  // La distancia de tono sigue mandando cuando los dos colores la tienen: el
  // techo de familia no puede alejar un par que el tono ya acerca.
  assert.ok(puntuacionCromatica(["dorado"], ["champagne"]) < PUNTUACION_FAMILIA);
  assert.equal(puntuacionCromatica(["plateado"], ["gris"]), PUNTUACION_FAMILIA);
  assert.equal(puntuacionCromatica(["gris"], ["dorado"]), 0.7, "familias distintas siguen siendo color desconocido");
  console.log("[PASS] ordenarRecomendacionesPorColor: coincidencia exacta primero y familias de neutros");

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
  const { candidatoDesdePython } = await import("../src/lib/rag/chat/candidato-python");
  const { CatalogRecommendationsResultV1Schema } = await import("../src/lib/ia/contracts/domain-v1");
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
  llamadas = instalarFetch((llamada) => sobre(llamada, payloadResolucion()));
  const requestIdCliente = "00000000-0000-4000-8000-0000000000d7";
  r = await editar({ modo: "aplicar", base, edicion: { accion: "quitar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12" } }, { "x-request-id": requestIdCliente });
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.causa, "UNICO_MATERIAL");
  const uiUnico = UiErrorV1Schema.parse(r.cuerpo.ui_error);
  assert.equal(uiUnico.code, "PIEZA_UNICO_MATERIAL");
  assert.equal(uiUnico.mensaje_usuario, "No se puede quitar el único globo de esta pieza; cámbialo por otro.");
  assert.equal(uiUnico.request_id, requestIdCliente);
  assert.equal(r.requestId, requestIdCliente, "the request id header is echoed");
  llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda(SNAPSHOT)));
  r = await editar({ modo: "buscar", consulta: "globo rojo", approval_token: tokenPython });
  assert.match(r.requestId ?? "", /^[0-9a-f-]{36}$/, "a generated request id when the client sends none");
  console.log("[PASS] quitar el único material → 400 UNICO_MATERIAL / PIEZA_UNICO_MATERIAL y X-Request-ID en las respuestas");

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
  let resoluciones = 0;
  llamadas = instalarFetch((llamada) => {
    if (llamada.path === "/internal/v1/plan/resolve") {
      resoluciones += 1;
      return sobre(llamada, resoluciones === 1 ? payloadResolucion() : resolucionConSerpentina());
    }
    return sobre(llamada, seleccionAdmitida({ product_id: "prod-serpentina", variant_id: "var-serpentina", size_code: null, shape: null, diameter_inches: null }));
  });
  r = await editar(reemplazo({ product_id: "prod-serpentina", variant_id: "var-serpentina" }));
  assert.equal(r.status, 422, JSON.stringify(r.cuerpo).slice(0, 400));
  assert.equal(r.cuerpo.causa, "REEMPLAZO_INCOMPATIBLE");
  assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "REEMPLAZO_NO_COMPATIBLE");
  console.log("[PASS] Modificar: la búsqueda filtra por la línea objetivo y aplicar rechaza un globo cambiado por una serpentina");

  // --- 6d. D9a: the edited quote carries the catalog photo of each purchase.
  const FOTO = "https://cdn.shopify.test/globo-rojo-12.jpg";
  const resolucionConFoto = (): Json => {
    const payload = payloadResolucion();
    const planResuelto = payload.plan_resuelto as Json;
    return { ...payload, plan_resuelto: { ...planResuelto, compras: (planResuelto.compras as Json[]).map((compra) => ({ ...compra, imagen: FOTO })) } };
  };
  llamadas = instalarFetch((llamada) => llamada.path === "/internal/v1/plan/resolve"
    ? sobre(llamada, resolucionConFoto())
    : sobre(llamada, seleccionAdmitida({})));
  r = await editar(reemplazo({ product_id: "prod-rojo", variant_id: "var-rojo-12" }));
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 400));
  const lineaCotizada = ((r.cuerpo.cotizacion as Json).lineas as Json[])[0]!;
  assert.equal(lineaCotizada.foto, FOTO, "photo from the consolidated purchase");
  console.log("[PASS] la cotización editada trae la foto de catálogo de cada compra");

  // --- 6e. W2.5 (D8): el color que escribe la edición.
  // El editor manda texto libre y llegaba al plan sin tocar: "azul rey" no
  // coincidía con ninguna variante del resolver geométrico (SIN_COBERTURA), y
  // la tarjeta conservaba el color de la pieza reemplazada, así que unos globos
  // azules se cotizaban como "rosado".
  const AZUL = { product_id: "prod-azul", variant_id: "var-azul-12", product_title: "Globo Latex Redondo Fashion Azul", colors: ["azul"] };
  const planEnviado = (registro: Llamada[]): Json => {
    const resueltas = registro.filter((llamada) => llamada.path === "/internal/v1/plan/resolve");
    assert.equal(resueltas.length, 2, "se resuelve el plan base y el editado");
    const plan = resueltas[1]!.body.plan;
    assert.ok(esObjeto(plan));
    return plan;
  };
  const colorDelOverride = (plan: Json): unknown => {
    const estructuras = plan.estructuras as Array<Json & { variant_overrides?: Json[] }>;
    const overrides = estructuras[0]!.variant_overrides ?? [];
    assert.equal(overrides.length, 1, JSON.stringify(overrides));
    return overrides[0]!.color;
  };
  const editarConColor = async (color: string | undefined): Promise<Llamada[]> => {
    const registro = instalarFetch((llamada) => llamada.path === "/internal/v1/plan/resolve"
      ? sobre(llamada, payloadResolucion())
      : sobre(llamada, seleccionAdmitida(AZUL)));
    const respuesta = await editar({
      modo: "aplicar",
      base: { ...base, approval_token: tokenPython },
      edicion: { accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: AZUL.product_id, variant_id: AZUL.variant_id, ...(color === undefined ? {} : { color }) } },
    });
    assert.equal(respuesta.status, 200, JSON.stringify(respuesta.cuerpo).slice(0, 300));
    return registro;
  };
  assert.equal(colorDelOverride(planEnviado(await editarConColor("rosado"))), "azul", "el color viejo de la tarjeta no puede etiquetar la variante nueva");
  assert.equal(colorDelOverride(planEnviado(await editarConColor("azul rey"))), "azul", "el texto libre pasa por el vocabulario del catálogo");
  assert.equal(colorDelOverride(planEnviado(await editarConColor(undefined))), "azul", "sin color se usa el único color de la variante");

  // Una variante con varios colores conserva lo que escribió el cliente,
  // canonizado: rechazarla bloquearía una edición que el catálogo sí permite.
  const llamadasVarios = instalarFetch((llamada) => llamada.path === "/internal/v1/plan/resolve"
    ? sobre(llamada, payloadResolucion())
    : sobre(llamada, seleccionAdmitida({ ...AZUL, colors: ["azul", "turquesa"] })));
  r = await editar({
    modo: "aplicar",
    base: { ...base, approval_token: tokenPython },
    edicion: { accion: "agregar", estructura_id: "EST_01_ARCO", participacion: 0.2, variante: { product_id: AZUL.product_id, variant_id: AZUL.variant_id, color: "azul rey" } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  const materialesAgregados = (planEnviado(llamadasVarios).estructuras as Array<Json & { materiales: Json[] }>)[0]!.materiales;
  assert.equal(materialesAgregados.at(-1)!.color, "azul", "agregar canoniza el color del cliente");
  console.log("[PASS] edición: el color sale del catálogo y de la variante elegida, nunca de la pieza anterior");

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
