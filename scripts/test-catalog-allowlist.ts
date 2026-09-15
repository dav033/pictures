/**
 * Offline checks for the product→variant association of `CatalogAllowlist`
 * (design E3). No network and no database: `globalThis.fetch` is stubbed and
 * the pool double throws if any path tries to query it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

process.env.PYTHON_BACKEND_ENABLED = "true";
process.env.PYTHON_BACKEND_KILL_SWITCH = "false";
process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-catalog-allowlist-secret-20260914";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";

type Llamada = { url: string; body: Record<string, unknown> };

function poolSinConsultas(): Pool {
  // Test double: these paths must never reach PostgreSQL.
  return { query: async () => { throw new Error("la prueba no debe consultar la base"); } } as unknown as Pool;
}

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const parsed: unknown = JSON.parse(String(init?.body));
    assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed));
    const llamada = { url: String(input), body: parsed as Record<string, unknown> };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return llamadas;
}

function contexto(body: Record<string, unknown>): { request_id: string; correlation_id: string } {
  const ctx = body.context;
  assert.ok(typeof ctx === "object" && ctx !== null);
  const { request_id, correlation_id } = ctx as Record<string, unknown>;
  assert.ok(typeof request_id === "string" && typeof correlation_id === "string");
  return { request_id, correlation_id };
}

async function main(): Promise<void> {
  const { crearCatalogAllowlist } = await import("../src/lib/rag/retrieval/allowlist");
  const { buscarCatalogoRag } = await import("../src/lib/rag/chat/buscar");
  const { resolverPlanConBackend } = await import("../src/lib/plan/resolver-backend");
  const { AllowlistProductoVarianteError, CAUSA_ALLOWLIST_PRODUCTO_VARIANTE } = await import("../src/lib/plan/allowlist-producto-variante");
  const { PlanDecoracionSchema } = await import("../src/lib/plan/tipos");

  // --- crearCatalogAllowlist: grouping, derivation, product-only rule, determinism.
  const filas = [
    { productId: "prod-b", variantId: "var-b-2" },
    { productId: "prod-a", variantId: "var-a-1" },
    { productId: "prod-b", variantId: "var-b-1" },
    { productId: "prod-a", variantId: "var-a-1" },
    { productId: "prod-a", variantId: null },
    { productId: "prod-c", variantId: null },
  ];
  const allowlist = crearCatalogAllowlist(filas);
  assert.deepEqual(allowlist.entries, [
    { productId: "prod-a", variantIds: ["var-a-1"] },
    { productId: "prod-b", variantIds: ["var-b-1", "var-b-2"] },
    { productId: "prod-c", variantIds: [] },
  ]);
  assert.deepEqual(allowlist.productIds, ["prod-a", "prod-b", "prod-c"]);
  assert.deepEqual(allowlist.variantIds, ["var-a-1", "var-b-1", "var-b-2"]);
  assert.deepEqual(crearCatalogAllowlist([...filas].reverse()), allowlist, "el orden de entrada no cambia el resultado");
  assert.deepEqual(crearCatalogAllowlist([]), { entries: [], productIds: [], variantIds: [] });
  assert.throws(
    () => crearCatalogAllowlist([{ productId: "prod-a", variantId: "var-x" }, { productId: "prod-b", variantId: "var-x" }]),
    /CATALOG_ALLOWLIST_INVALID/,
    "una variante bajo dos productos es entrada corrupta",
  );
  assert.throws(() => crearCatalogAllowlist([{ productId: "", variantId: "var-x" }]), /CATALOG_ALLOWLIST_INVALID/);
  console.log("[PASS] crearCatalogAllowlist agrupa por producto, deriva arreglos, respeta producto-sin-variantes y es determinista");

  // --- buscarCatalogoRag (Python selected) sends the real entries.
  const loraDosProductos = crearCatalogAllowlist([
    { productId: "prod-a", variantId: "var-a-1" },
    { productId: "prod-a", variantId: "var-a-2" },
    { productId: "prod-b", variantId: "var-b-1" },
  ]);
  const llamadasBusqueda = instalarFetch((llamada) => Response.json({
    schema_version: "operational.v1",
    ...contexto(llamada.body),
    payload: {
      operation_schema_version: "catalog-search-result.v1",
      status: "NO_MATCH",
      sku_status: "not_sku",
      candidates: [],
      whitelist: [],
      catalog_snapshot_id: "products_catalog:test",
      latency_parse_ms: 1,
      latency_retrieval_ms: 1,
    },
  }));
  const resultado = await buscarCatalogoRag(poolSinConsultas(), "globo redondo", {
    allowlist: loraDosProductos,
    rerankRequestId: REQUEST_ID,
    rerankCorrelationId: CORRELATION_ID,
  });
  assert.equal(resultado.status, "NO_MATCH");
  assert.equal(llamadasBusqueda.length, 1);
  assert.equal(new URL(llamadasBusqueda[0]!.url).pathname, "/internal/v1/catalog/search");
  assert.deepEqual(llamadasBusqueda[0]!.body.allowlist, [
    { product_id: "prod-a", variant_ids: ["var-a-1", "var-a-2"] },
    { product_id: "prod-b", variant_ids: ["var-b-1"] },
  ]);
  console.log("[PASS] búsqueda Python envía una entrada real por producto (sin product_id ficticio)");

  const soloProductos = crearCatalogAllowlist([{ productId: "prod-c", variantId: null }]);
  const llamadasProductos = instalarFetch((llamada) => Response.json({
    schema_version: "operational.v1",
    ...contexto(llamada.body),
    payload: {
      operation_schema_version: "catalog-search-result.v1",
      status: "NO_MATCH",
      sku_status: "not_sku",
      candidates: [],
      whitelist: [],
      catalog_snapshot_id: "products_catalog:test",
      latency_parse_ms: 1,
      latency_retrieval_ms: 1,
    },
  }));
  await buscarCatalogoRag(poolSinConsultas(), "globo redondo", { allowlist: soloProductos, rerankRequestId: REQUEST_ID, rerankCorrelationId: CORRELATION_ID });
  assert.deepEqual(llamadasProductos[0]?.body.allowlist, [{ product_id: "prod-c", variant_ids: [] }]);
  console.log("[PASS] búsqueda Python conserva entradas de solo producto");

  // --- Python search follows the relaxation ladder (plan de tamaños §6):
  // occasion first, then color; size/shape/finish never.
  const { extraerFiltrosDurosBusqueda } = await import("../src/lib/rag/query-parser/hard-filters");
  const candidatoGlobo = {
    product_id: "prod-a",
    title: "Globo Latex Redondo Dorado",
    category: "globo_latex",
    colors: ["dorado"],
    finishes: ["reflex"],
    occasions: [],
    available: true,
    image: null,
    score: 0.5,
    variants: [{ variant_id: "var-a-1", sku: "SKU-A-1", title: "R-12", price: 1000, available: true, size_code: "R-12", diameter_inches: 12, shape: "redondo", colors: ["dorado"] }],
  };
  const respuestaBusqueda = (llamada: Llamada, conCandidatos: boolean) => Response.json({
    schema_version: "operational.v1",
    ...contexto(llamada.body),
    payload: {
      operation_schema_version: "catalog-search-result.v1",
      status: conCandidatos ? "OK" : "NO_MATCH",
      sku_status: "not_sku",
      candidates: conCandidatos ? [candidatoGlobo] : [],
      whitelist: conCandidatos ? [{ product_id: "prod-a", variant_ids: ["var-a-1"] }] : [],
      catalog_snapshot_id: "products_catalog:test",
      latency_parse_ms: 1,
      latency_retrieval_ms: 1,
    },
  });
  const filtrosDe = (llamada: Llamada): Record<string, unknown> => {
    const filters = llamada.body.filters;
    assert.ok(typeof filters === "object" && filters !== null);
    return filters as Record<string, unknown>;
  };

  // "globos para XV años": zero balloons carry the xv_anos tag; occasion relaxes.
  const filtrosXv = extraerFiltrosDurosBusqueda("globos para XV años", {});
  assert.deepEqual(filtrosXv.ocasiones, ["xv_anos"]);
  const llamadasXv = instalarFetch((llamada) => respuestaBusqueda(llamada, filtrosDe(llamada).occasions === undefined));
  const xv = await buscarCatalogoRag(poolSinConsultas(), "globos", { filtrosDuros: filtrosXv, allowlist: loraDosProductos, rerankRequestId: REQUEST_ID, rerankCorrelationId: CORRELATION_ID });
  assert.equal(xv.status, "OK");
  assert.equal(xv.candidatos.length, 1);
  assert.equal(xv.filtroRelajado, "ocasiones");
  assert.deepEqual(xv.observabilidad.relaxations, ["ocasiones pasó de filtro duro a señal de ranking"]);
  assert.equal(llamadasXv.length, 2);
  assert.deepEqual(filtrosDe(llamadasXv[0]!).occasions, ["xv_anos"]);
  assert.deepEqual(llamadasXv[1]!.body.allowlist, llamadasXv[0]!.body.allowlist, "relajar no amplía la allowlist");

  // Occasion and color both absent from the pool: color relaxes second, while
  // size, shape and finish stay hard on every call.
  const filtrosCumple = extraerFiltrosDurosBusqueda("globos reflex dorados R-12 para un cumpleaños", {});
  const llamadasCumple = instalarFetch((llamada) => respuestaBusqueda(llamada, filtrosDe(llamada).colors === undefined));
  const cumple = await buscarCatalogoRag(poolSinConsultas(), "globos reflex dorados R-12 para un cumpleaños", { filtrosDuros: filtrosCumple, rerankRequestId: REQUEST_ID, rerankCorrelationId: CORRELATION_ID });
  assert.equal(cumple.filtroRelajado, "colores");
  assert.equal(llamadasCumple.length, 3);
  assert.deepEqual(llamadasCumple.map((llamada) => [filtrosDe(llamada).occasions, filtrosDe(llamada).colors]), [
    [["cumpleanos"], ["dorado"]],
    [undefined, ["dorado"]],
    [undefined, undefined],
  ]);
  for (const llamada of llamadasCumple) {
    assert.deepEqual(filtrosDe(llamada).diameters_inches, [12]);
    assert.deepEqual(filtrosDe(llamada).shapes, ["redondo"]);
    assert.deepEqual(filtrosDe(llamada).finishes, ["reflex"]);
  }

  // A first-step hit does not relax; an exhausted ladder stays NO_MATCH.
  const llamadasDirecta = instalarFetch((llamada) => respuestaBusqueda(llamada, true));
  const directa = await buscarCatalogoRag(poolSinConsultas(), "globos", { filtrosDuros: filtrosCumple, rerankRequestId: REQUEST_ID, rerankCorrelationId: CORRELATION_ID });
  assert.equal(directa.filtroRelajado, null);
  assert.equal(llamadasDirecta.length, 1);
  const llamadasAgotada = instalarFetch((llamada) => respuestaBusqueda(llamada, false));
  const agotada = await buscarCatalogoRag(poolSinConsultas(), "globos", { filtrosDuros: filtrosCumple, rerankRequestId: REQUEST_ID, rerankCorrelationId: CORRELATION_ID });
  assert.equal(agotada.status, "NO_MATCH");
  assert.equal(agotada.filtroRelajado, null);
  assert.equal(llamadasAgotada.length, 3);
  console.log("[PASS] búsqueda Python relaja ocasión y luego color como la ruta TS; tamaño/forma/acabado nunca");

  // Regresión: "azul, blanco y dorado para un cumpleaños" en el pool LoRA solo
  // encontraba un globo estampado "Happy Birthday" dorado (el único con la
  // etiqueta de ocasión) y el plan no podía cubrir azul ni blanco. La ocasión
  // se relaja también cuando deja colores pedidos sin cubrir; el color no.
  const globoColor = (productId: string, color: string) => ({ ...candidatoGlobo, product_id: productId, title: `Globo ${color}`, colors: [color], variants: [{ ...candidatoGlobo.variants[0]!, variant_id: `${productId}-v`, colors: [color] }] });
  const respuestaColores = (llamada: Llamada, colores: string[]) => Response.json({
    schema_version: "operational.v1",
    ...contexto(llamada.body),
    payload: {
      operation_schema_version: "catalog-search-result.v1",
      status: colores.length ? "OK" : "NO_MATCH",
      sku_status: "not_sku",
      candidates: colores.map((color) => globoColor(`prod-${color}`, color)),
      whitelist: colores.map((color) => ({ product_id: `prod-${color}`, variant_ids: [`prod-${color}-v`] })),
      catalog_snapshot_id: "products_catalog:test",
      latency_parse_ms: 1,
      latency_retrieval_ms: 1,
    },
  });
  // E2E 2026-09-14 (photo "Semiarcos rosa y plata"): "transparente" in the
  // palette is a color, not a mandatory finish. As a finish it is a hard filter
  // that never relaxes, and every search of the turn returned only the clear
  // balloon, so the plan came out 100 % transparent.
  const filtrosFoto = extraerFiltrosDurosBusqueda("Quiero algo así para un cumpleaños", { colores: ["rosado", "plateado", "gris", "transparente"] });
  assert.deepEqual([...filtrosFoto.colores].sort(), ["plateado", "rosado", "transparente"]);
  assert.deepEqual(filtrosFoto.acabados, [], "a palette color never becomes a finish filter");
  assert.deepEqual(extraerFiltrosDurosBusqueda("globos crystal y dorados", {}).acabados, [], "crystal names the clear color too");
  assert.deepEqual(extraerFiltrosDurosBusqueda("globos satin transparentes", {}).acabados, ["satin"], "other finishes stay hard");
  const filtrosPaleta = extraerFiltrosDurosBusqueda("Quiero esta decoración para un cumpleaños en azul, blanco y dorado", {});
  assert.deepEqual([filtrosPaleta.ocasiones, [...filtrosPaleta.colores].sort()], [["cumpleanos"], ["azul", "blanco", "dorado"]]);
  const llamadasPaleta = instalarFetch((llamada) => respuestaColores(llamada, filtrosDe(llamada).occasions ? ["dorado"] : ["azul", "blanco", "dorado"]));
  const paleta = await buscarCatalogoRag(poolSinConsultas(), "globos azul y blanco", { filtrosDuros: filtrosPaleta, allowlist: loraDosProductos, rerankRequestId: REQUEST_ID, rerankCorrelationId: CORRELATION_ID });
  assert.equal(paleta.filtroRelajado, "ocasiones");
  assert.deepEqual(paleta.candidatos.map((candidato) => candidato.colores[0]).sort(), ["azul", "blanco", "dorado"]);
  assert.equal(llamadasPaleta.length, 2, "nunca relaja el color solo por cobertura");
  const llamadasSinColor = instalarFetch((llamada) => respuestaColores(llamada, filtrosDe(llamada).occasions ? ["dorado"] : []));
  const sinColor = await buscarCatalogoRag(poolSinConsultas(), "globos", { filtrosDuros: filtrosPaleta, allowlist: loraDosProductos, rerankRequestId: REQUEST_ID, rerankCorrelationId: CORRELATION_ID });
  assert.deepEqual(sinColor.candidatos.map((candidato) => candidato.colores[0]), ["dorado"], "si relajar la ocasión no encuentra nada, conserva lo que sí había");
  assert.equal(sinColor.filtroRelajado, null);
  assert.equal(llamadasSinColor.length, 2);
  console.log("[PASS] la ocasión se relaja cuando deja colores pedidos sin cubrir; el color nunca por cobertura");

  const llamadasVacia = instalarFetch(() => {
    throw new Error("no debe llamar a Python con una allowlist vacía");
  });
  const vacia = await buscarCatalogoRag(poolSinConsultas(), "globo redondo", { allowlist: crearCatalogAllowlist([]) });
  assert.equal(vacia.status, "NO_MATCH");
  assert.equal(vacia.candidatos.length, 0);
  assert.equal(llamadasVacia.length, 0);
  console.log("[PASS] allowlist sin entradas falla cerrado con NO_MATCH y 0 llamadas a Python");

  // --- resolverPlanConBackend: LoRA without variants fails closed before fetch.
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "contracts", "domain", "v1", "fixtures", "plan-resuelto-ok.json"), "utf8")) as { plan: unknown };
  const plan = PlanDecoracionSchema.parse(fixture.plan);
  const llamadasLora = instalarFetch(() => {
    throw new Error("no debe llamar a Python con un modo LoRA sin variantes");
  });
  await assert.rejects(
    resolverPlanConBackend({
      backend: "python",
      plan,
      allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
      catalogSnapshotId: "products_catalog:test",
      loraAllowlist: soloProductos,
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    }),
    /^Error: LORA_DATASET_ALLOWLIST_REJECTED/,
  );
  assert.equal(llamadasLora.length, 0);
  console.log("[PASS] resolución Python con LoRA sin variantes lanza LORA_DATASET_ALLOWLIST_REJECTED antes de llamar");

  // --- resolverPlanConBackend: Python allowlist_product_mismatch becomes the stable error.
  const llamadasMismatch = instalarFetch(() => Response.json({ detail: { code: "allowlist_product_mismatch" } }, { status: 422 }));
  await assert.rejects(
    resolverPlanConBackend({
      backend: "python",
      plan,
      allowlist: [{ product_id: "prod-azul", variant_ids: ["var-rojo-12"] }],
      catalogSnapshotId: "products_catalog:test",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    }),
    (error: unknown) => error instanceof AllowlistProductoVarianteError && error.causa === CAUSA_ALLOWLIST_PRODUCTO_VARIANTE,
  );
  assert.equal(llamadasMismatch.length, 1);

  const llamadasOtro = instalarFetch(() => Response.json({ detail: { code: "invalid_plan" } }, { status: 422 }));
  await assert.rejects(
    resolverPlanConBackend({
      backend: "python",
      plan,
      allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
      catalogSnapshotId: "products_catalog:test",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    }),
    (error: unknown) => !(error instanceof AllowlistProductoVarianteError) && error instanceof Error && "domainCode" in error && error.domainCode === "invalid_plan",
  );
  assert.equal(llamadasOtro.length, 1);
  console.log("[PASS] allowlist_product_mismatch de Python se traduce a AllowlistProductoVarianteError; otros códigos pasan intactos");

  // --- /api/plan-editar maps the stable error to 422 with its cause.
  const { crearTokenPlan } = await import("../src/lib/plan/aprobacion");
  const { POST: editar } = await import("../src/app/api/plan-editar/route");
  const planHash = "a".repeat(64);
  const base = {
    ...(fixture as Record<string, unknown>),
    plan_hash: planHash,
    approval_token: crearTokenPlan({
      planHash,
      requestId: REQUEST_ID,
      backend: "python",
      catalogSnapshotId: "products_catalog:test",
      allowlist: [{ product_id: "prod-azul", variant_ids: ["var-rojo-12"] }],
    }),
  };
  const llamadasRuta = instalarFetch(() => Response.json({ detail: { code: "allowlist_product_mismatch" } }, { status: 422 }));
  const respuesta = await editar(new Request("http://127.0.0.1/api/plan-editar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modo: "aplicar", base, edicion: { accion: "quitar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12" } }),
  }));
  const cuerpo: unknown = await respuesta.json();
  assert.equal(respuesta.status, 422);
  assert.ok(typeof cuerpo === "object" && cuerpo !== null);
  // Campos legacy exactos, más el sobre ui-error.v1 que muestra la interfaz.
  const { ui_error: uiErrorRuta, ...legacyRuta } = cuerpo as Record<string, unknown>;
  assert.deepEqual(legacyRuta, { error: new AllowlistProductoVarianteError().message, causa: CAUSA_ALLOWLIST_PRODUCTO_VARIANTE });
  const { UiErrorV1Schema } = await import("../src/lib/ia/contracts/ui-error-v1");
  assert.equal(UiErrorV1Schema.parse(uiErrorRuta).detalles_dev.causa, CAUSA_ALLOWLIST_PRODUCTO_VARIANTE);
  assert.equal(llamadasRuta.length, 1);
  assert.equal(new URL(llamadasRuta[0]!.url).pathname, "/internal/v1/plan/resolve");
  console.log("[PASS] /api/plan-editar responde 422 causa=ALLOWLIST_PRODUCTO_VARIANTE ante allowlist_product_mismatch");

  // --- Chat with an unusable LoRA pool: conversation continues, catalog tools fail closed.
  const { causaCatalogoLora, STATUS_CATALOGO_LORA_NO_DISPONIBLE } = await import("../src/lib/lora/catalogo-no-disponible");
  const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../src/lib/ia/registro-herramientas");
  const { construirSistema } = await import("../src/lib/ia/prompt-sistema");
  assert.equal(causaCatalogoLora(new Error("LORA_VOCABULARY_ALLOWLIST_EMPTY: ninguna variante")), "LORA_VOCABULARY_ALLOWLIST_EMPTY");
  assert.equal(causaCatalogoLora(new Error("LORA_MODE_NOT_CONFIGURED: training_2")), "LORA_MODE_NOT_CONFIGURED");
  assert.equal(causaCatalogoLora(new Error("connect ECONNREFUSED 127.0.0.1:5432")), null, "un fallo de base de datos no se degrada");
  assert.equal(causaCatalogoLora("LORA_MODE_NOT_CONFIGURED"), null);

  const llamadasBloqueado = instalarFetch(() => {
    throw new Error("un catálogo LoRA bloqueado no debe llamar a Python");
  });
  const registro = crearRegistroHerramientas(crearEstadoConversacion({}, "quiero un arco de globos"), {
    pool: poolSinConsultas(),
    catalogoLoraNoDisponible: "LORA_VOCABULARY_ALLOWLIST_EMPTY",
  });
  for (const herramienta of ["buscar_catalogo_rag", "confirmar_seleccion_rag", "confirmar_plan_decoracion"] as const) {
    const args = { mensaje: "globos", seleccion: [] };
    const salida: unknown = await registro[herramienta]!(args, { nombre: herramienta, args });
    assert.ok(typeof salida === "object" && salida !== null);
    assert.equal((salida as Record<string, unknown>).ok, false, herramienta);
    assert.equal((salida as Record<string, unknown>).status, STATUS_CATALOGO_LORA_NO_DISPONIBLE, herramienta);
    assert.equal((salida as Record<string, unknown>).causa, "LORA_VOCABULARY_ALLOWLIST_EMPTY", herramienta);
  }
  assert.equal(llamadasBloqueado.length, 0);
  const briefArgs = { tipoEvento: "cumpleaños" };
  const brief = await registro.guardar_brief!(briefArgs, { nombre: "guardar_brief", args: briefArgs });
  // guardar_brief stores only chat.v1 brief fields (brief-herramienta.ts): the camelCase key maps to tipo_evento.
  assert.deepEqual(brief, { ok: true, brief: { tipo_evento: "cumpleaños" } }, "las herramientas sin catálogo siguen funcionando");
  assert.match(construirSistema({ ragEnabled: true, franjasEnabled: false, catalogoLoraNoDisponible: true }), /CATÁLOGO NO DISPONIBLE EN ESTE MODO/);
  assert.doesNotMatch(construirSistema({ ragEnabled: true, franjasEnabled: false }), /CATÁLOGO NO DISPONIBLE EN ESTE MODO/);
  console.log("[PASS] con el pool LoRA no disponible, las herramientas de catálogo fallan cerrado sin tocar base ni Python y el chat sigue");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[FAIL]", error);
    process.exit(1);
  },
);
