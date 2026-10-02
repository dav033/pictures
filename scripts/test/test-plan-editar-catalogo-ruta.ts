/**
 * Offline checks for what the "Ajusta la propuesta" catalog explorer asks of `/api/plan-editar`
 * (modes `buscar` with filters and `colores`). Transport and policy only: which candidates are
 * sellable, their colors and counts are Python's (`services/ai-api/tests/test_catalog.py`).
 * `globalThis.fetch` is stubbed; there is no network and no database query.
 *
 * - `buscar` with filters reaches Python as `filters.colors/shapes/finishes/diameters_inches` plus
 *   `limit`, pinned to the signed snapshot; with no text it is a `browse` search, and a click is never
 *   relaxed by the ladder (one call, even when it finds nothing).
 * - `limite` is respected; without it the answer keeps the 8 candidates the inline editor always got.
 * - Empty text with no filter, and every out-of-bound field, is a deliberate 400 that never reaches Python.
 * - `colores` returns `{colores:[{valor,total}]}` for the signed snapshot, fails closed on a bad token
 *   (409), on a restricted allowlist with no entries (empty list) and on an answer for another snapshot.
 * - The explorer's repeated reads are remembered (colors per snapshot, a LoRA mode's allowlist) and never shared
 *   across snapshots or allowlists; applying an edit never reads from that memory.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-editar-catalogo-ruta.ts
 */
import assert from "node:assert/strict";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-editar-catalogo-ruta-secret-20261002";
delete process.env.APP_PASSWORD;

const SNAPSHOT = "products_catalog:test";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const PLAN_HASH = "a".repeat(64);

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json };

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let casos = 0;
/** Set in main(): cada caso parte sin nada recordado por las cachés de exploración. */
let olvidarCaches: () => void = () => {};
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  olvidarCaches();
  try {
    await prueba();
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
  casos += 1;
  console.log(`[PASS] ${nombre}`);
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

function sinFetch(): Llamada[] {
  return instalarFetch(() => { throw new Error("esta petición no debe llegar a Python"); });
}

/** `n` candidates, each with one 12-inch round variant (and one 9-inch heart when `conCorazon`). */
function payloadBusqueda(n: number, snapshot = SNAPSHOT, conCorazon = false): Json {
  const candidates = Array.from({ length: n }, (_, i) => ({
    product_id: `prod-${i}`,
    title: `Globo ${i}`,
    category: "globo_latex",
    colors: ["rojo"],
    finishes: [],
    occasions: [],
    available: true,
    image: `https://cdn.example/${i}.jpg`,
    score: 1 / (i + 1),
    variants: [
      { variant_id: `var-${i}-12`, sku: null, title: null, price: 1000 + i, available: true, size_code: "R-12", diameter_inches: 12, shape: "redondo", colors: ["rojo"] },
      ...(conCorazon ? [{ variant_id: `var-${i}-c`, sku: null, title: null, price: 900, available: true, size_code: "C-9", diameter_inches: 9, shape: "corazon", colors: ["rojo"] }] : []),
    ],
  }));
  return {
    operation_schema_version: "catalog-search-result.v1",
    status: n > 0 ? "OK" : "NO_MATCH",
    sku_status: "not_sku",
    candidates,
    whitelist: candidates.map((candidate) => ({ product_id: candidate.product_id, variant_ids: candidate.variants.map((variant) => variant.variant_id) })),
    catalog_snapshot_id: snapshot,
    latency_parse_ms: 1,
    latency_retrieval_ms: 1,
  };
}

function payloadColores(colores: Array<{ value: string; total: number }>, snapshot: string | null = SNAPSHOT): Json {
  return { operation_schema_version: "catalog-colors-result.v1", catalog_snapshot_id: snapshot, colors: colores };
}

async function main(): Promise<void> {
  const { crearTokenPlan } = await import("../../src/lib/plan/aprobacion");
  const { POST } = await import("../../src/app/api/plan-editar/route");
  const { getRagPool } = await import("../../src/lib/rag/db");
  const { listarColoresCatalogo } = await import("../../src/lib/rag/chat/colores-catalogo");
  const { buscarCatalogoRag } = await import("../../src/lib/rag/chat/buscar");
  const { crearCatalogAllowlist } = await import("../../src/lib/rag/retrieval/allowlist");
  const { allowlistParaExplorar, claveColores, olvidarCachesExploracion } = await import("../../src/lib/rag/chat/cache-exploracion");
  olvidarCaches = olvidarCachesExploracion;
  Object.defineProperty(getRagPool(), "query", {
    value: () => { throw new Error("la prueba no debe consultar la base"); },
  });

  const tokenPython = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist: [] });

  async function pedir(body: Json): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-editar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    const cuerpo: unknown = await respuesta.json();
    assert.ok(esObjeto(cuerpo));
    return { status: respuesta.status, cuerpo };
  }

  const FILTROS = { colores: ["rojo", "azul"], tamanos_pulgadas: [12], formas: ["redondo"], acabados: ["metalizado"] };

  await caso("buscar con filtros y sin texto llega a Python como búsqueda por filtros, fijada al snapshot y sin relajar", async () => {
    const llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda(0)));
    const { status, cuerpo } = await pedir({ modo: "buscar", consulta: "", approval_token: tokenPython, filtros: FILTROS, limite: 20 });
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.equal(llamadas.length, 1, "un clic es un requisito explícito: no se relaja ni se repite sin colores");
    const [llamada] = llamadas;
    assert.equal(llamada!.path, "/internal/v1/catalog/search");
    assert.deepEqual(llamada!.body.filters, { colors: ["rojo", "azul"], shapes: ["redondo"], finishes: ["metalizado"], diameters_inches: [12], available: true });
    assert.equal(llamada!.body.limit, 20);
    assert.equal(llamada!.body.browse, true);
    assert.equal(llamada!.body.catalog_snapshot_id, SNAPSHOT);
    assert.deepEqual(cuerpo.candidatos, []);
    assert.equal(cuerpo.filtroRelajado, null);
    assert.equal(cuerpo.hayMas, false);
  });

  await caso("con texto y filtros es una búsqueda de texto (sin browse) y con el límite pedido", async () => {
    const llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda(3)));
    const { status, cuerpo } = await pedir({ modo: "buscar", consulta: "  globo metalizado ", filtros: { colores: ["rojo"] }, limite: 10 });
    assert.equal(status, 200, JSON.stringify(cuerpo));
    const [llamada] = llamadas;
    assert.equal(llamada!.body.message, "globo metalizado");
    assert.equal("browse" in llamada!.body, false);
    assert.equal(llamada!.body.limit, 10);
    assert.equal("catalog_snapshot_id" in llamada!.body, false, "sin token no hay snapshot fijado, como siempre");
    assert.equal((cuerpo.candidatos as unknown[]).length, 3);
    assert.equal(cuerpo.hayMas, false, "Python devolvió menos de lo pedido: no hay más");
  });

  await caso("el límite se respeta y avisa si hay más; sin límite se conservan los 8 de siempre", async () => {
    instalarFetch((llamada) => sobre(llamada, payloadBusqueda(Number(llamada.body.limit ?? 15))));
    const con = await pedir({ modo: "buscar", consulta: "", filtros: { colores: ["rojo"] }, limite: 24 });
    assert.equal((con.cuerpo.candidatos as unknown[]).length, 24);
    assert.equal(con.cuerpo.hayMas, true, "Python llenó la página: puede haber más");
    const maximo = await pedir({ modo: "buscar", consulta: "", filtros: { colores: ["rojo"] }, limite: 40 });
    assert.equal((maximo.cuerpo.candidatos as unknown[]).length, 40);
    const sin = await pedir({ modo: "buscar", consulta: "globos rojos" });
    assert.equal(sin.status, 200);
    assert.equal((sin.cuerpo.candidatos as unknown[]).length, 8, "quien ya llamaba sin límite sigue recibiendo 8");
    assert.equal(sin.cuerpo.hayMas, true, "Python devolvió sus 15 y solo se muestran 8");
  });

  await caso("con línea objetivo se pide a Python todo el tope, se filtran los compatibles y el límite se aplica después", async () => {
    const llamadas = instalarFetch((llamada) => sobre(llamada, payloadBusqueda(12, SNAPSHOT, true)));
    const { status, cuerpo } = await pedir({ modo: "buscar", consulta: "", filtros: { colores: ["rojo"] }, limite: 5, linea_objetivo: { forma: "redondo", diam_pulg: 12 } });
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.equal(llamadas[0]!.body.limit, 50, "el filtro de compatibilidad no debe dejar la página corta");
    const candidatos = cuerpo.candidatos as Array<{ variantes: Array<{ forma: string }> }>;
    assert.equal(candidatos.length, 5);
    assert.ok(candidatos.every((candidato) => candidato.variantes.every((variante) => variante.forma === "redondo")), "un globo redondo solo admite redondos");
    assert.equal(cuerpo.hayMas, true, "quedan 7 compatibles más allá de la página");
  });

  await caso("un producto con muchas variantes llega entero: el explorador junta paquetes y no puede perder tamaños ni colores", async () => {
    instalarFetch((llamada) => {
      const payload = payloadBusqueda(1);
      const candidato = (payload.candidates as Array<{ variants: Json[] }>)[0]!;
      candidato.variants = Array.from({ length: 20 }, (_, i) => ({ variant_id: `var-${i}`, sku: null, title: `R-12 / PAQUETE X ${i + 1}`, price: 100 + i, available: true, size_code: "R-12", diameter_inches: 12, shape: "redondo", colors: ["rojo"] }));
      payload.whitelist = [{ product_id: "prod-0", variant_ids: candidato.variants.map((v) => v.variant_id as string) }];
      return sobre(llamada, payload);
    });
    const { status, cuerpo } = await pedir({ modo: "buscar", consulta: "", filtros: { colores: ["rojo"] }, limite: 10 });
    assert.equal(status, 200, JSON.stringify(cuerpo).slice(0, 200));
    assert.equal(((cuerpo.candidatos as Array<{ variantes: unknown[] }>)[0]!).variantes.length, 20);
  });

  await caso("texto vacío sin filtros, y todo campo fuera de rango, es un 400 que no llega a Python", async () => {
    const llamadas = sinFetch();
    const malas: Json[] = [
      { modo: "buscar", consulta: "" },
      { modo: "buscar", consulta: "a" },
      { modo: "buscar", consulta: "", filtros: {} },
      { modo: "buscar", consulta: "", filtros: { colores: [] } },
      { modo: "buscar", consulta: "", filtros: { colores: Array.from({ length: 9 }, (_, i) => `c${i}`) } },
      { modo: "buscar", consulta: "", filtros: { tamanos_pulgadas: Array.from({ length: 9 }, (_, i) => i + 1) } },
      { modo: "buscar", consulta: "", filtros: { formas: ["a", "b", "c", "d", "e"] } },
      { modo: "buscar", consulta: "", filtros: { acabados: ["a", "b", "c", "d", "e"] } },
      { modo: "buscar", consulta: "", filtros: { colores: [" "] } },
      { modo: "buscar", consulta: "", filtros: { tamanos_pulgadas: [-1] } },
      { modo: "buscar", consulta: "", filtros: { colores: ["rojo"], precio_max: 5 } },
      { modo: "buscar", consulta: "globos", limite: 41 },
      { modo: "buscar", consulta: "globos", limite: 0 },
      { modo: "buscar", consulta: "globos", limite: 1.5 },
      { modo: "colores", approval_token: tokenPython, extra: true },
    ];
    for (const mala of malas) {
      const { status } = await pedir(mala);
      assert.equal(status, 400, JSON.stringify(mala).slice(0, 100));
    }
    assert.equal(llamadas.length, 0);
  });

  await caso("un token roto en buscar y en colores es un 409 y no llega a Python", async () => {
    const llamadas = sinFetch();
    const roto = `${tokenPython.slice(0, -4)}AAAA`;
    for (const body of [
      { modo: "buscar", consulta: "", approval_token: roto, filtros: { colores: ["rojo"] } },
      { modo: "colores", approval_token: roto },
    ]) {
      const { status, cuerpo } = await pedir(body);
      assert.equal(status, 409, JSON.stringify(cuerpo));
      assert.match(String(cuerpo.error), /aprobación base expiró/);
    }
    assert.equal(llamadas.length, 0);
  });

  await caso("colores devuelve la lista de Python (valor, total) para el snapshot firmado", async () => {
    const llamadas = instalarFetch((llamada) => sobre(llamada, payloadColores([{ value: "rojo", total: 40 }, { value: "azul", total: 12 }])));
    const { status, cuerpo } = await pedir({ modo: "colores", approval_token: tokenPython });
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.deepEqual(cuerpo.colores, [{ valor: "rojo", total: 40 }, { valor: "azul", total: 12 }]);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0]!.path, "/internal/v1/catalog/colors");
    assert.equal(llamadas[0]!.body.catalog_snapshot_id, SNAPSHOT);
    assert.deepEqual(llamadas[0]!.body.allowlist, []);
    assert.equal(llamadas[0]!.body.schema_version, "catalog-colors.v1");
    const sinToken = await pedir({ modo: "colores" });
    assert.equal(sinToken.status, 200);
    assert.equal("catalog_snapshot_id" in llamadas[1]!.body, false, "sin token no hay snapshot fijado (como buscar)");
  });

  await caso("colores falla cerrado: respuesta de otro snapshot, color repetido o forma inválida son un 502", async () => {
    for (const payload of [
      payloadColores([{ value: "rojo", total: 1 }], "products_catalog:otro"),
      payloadColores([{ value: "rojo", total: 1 }, { value: "rojo", total: 2 }]),
      payloadColores([{ value: "rojo", total: 0 }]),
      payloadColores([{ value: "rojo", total: 1 }], null),
    ]) {
      instalarFetch((llamada) => sobre(llamada, payload));
      const { status, cuerpo } = await pedir({ modo: "colores", approval_token: tokenPython });
      assert.equal(status, 502, JSON.stringify(cuerpo));
    }
  });

  await caso("una allowlist restringida sin entradas no ensancha nada: colores y búsqueda por filtros devuelven vacío sin llamar a Python", async () => {
    const llamadas = sinFetch();
    const vacia = crearCatalogAllowlist([]);
    assert.equal(vacia.entries.length, 0);
    assert.deepEqual(await listarColoresCatalogo({ allowlist: vacia, catalogSnapshotId: SNAPSHOT }), []);
    const busqueda = await buscarCatalogoRag(getRagPool(), "catalogo", { allowlist: vacia, exploracion: { colores: ["rojo"] }, sinTexto: true });
    assert.equal(busqueda.status, "NO_MATCH");
    assert.deepEqual(busqueda.candidatos, []);
    assert.equal(llamadas.length, 0);
  });

  await caso("una allowlist con entradas viaja a Python tal cual en colores y en la búsqueda", async () => {
    const llamadas = instalarFetch((llamada) => llamada.path.endsWith("/colors") ? sobre(llamada, payloadColores([{ value: "rojo", total: 2 }])) : sobre(llamada, payloadBusqueda(0)));
    const lista = crearCatalogAllowlist([{ productId: "prod-a", variantId: "var-a1" }, { productId: "prod-a", variantId: "var-a2" }]);
    await listarColoresCatalogo({ allowlist: lista, catalogSnapshotId: SNAPSHOT });
    await buscarCatalogoRag(getRagPool(), "catalogo", { allowlist: lista, exploracion: { colores: ["rojo"] }, sinTexto: true, catalogSnapshotId: SNAPSHOT });
    const esperada = [{ product_id: "prod-a", variant_ids: ["var-a1", "var-a2"] }];
    assert.deepEqual(llamadas.map((llamada) => llamada.body.allowlist), [esperada, esperada]);
  });

  await caso("la lista de colores se pide una vez por snapshot: repetirla o pedirla a la vez no vuelve a Python", async () => {
    const llamadas = instalarFetch((llamada) => sobre(llamada, payloadColores([{ value: "rojo", total: 40 }], llamada.body.catalog_snapshot_id as string)));
    const [a, b] = await Promise.all([pedir({ modo: "colores", approval_token: tokenPython }), pedir({ modo: "colores", approval_token: tokenPython })]);
    assert.deepEqual([a.status, b.status, a.cuerpo.colores], [200, 200, [{ valor: "rojo", total: 40 }]]);
    assert.equal(llamadas.length, 1, "dos aperturas simultáneas comparten una sola petición");
    await pedir({ modo: "colores", approval_token: tokenPython });
    assert.equal(llamadas.length, 1, "la siguiente sale de la memoria");
    const otroToken = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: "products_catalog:otro", allowlist: [] });
    const otro = await pedir({ modo: "colores", approval_token: otroToken });
    assert.equal(otro.status, 200);
    assert.equal(llamadas.length, 2, "otro snapshot nunca comparte respuesta");
    assert.equal(llamadas[1]!.body.catalog_snapshot_id, "products_catalog:otro");
    // Un token que cambió (se editó la propuesta) pero sigue en el mismo snapshot reutiliza lo recordado.
    const mismoSnapshot = crearTokenPlan({ planHash: "b".repeat(64), requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist: [] });
    await pedir({ modo: "colores", approval_token: mismoSnapshot });
    assert.equal(llamadas.length, 2);
  });

  await caso("un fallo de Python en colores no se recuerda", async () => {
    let n = 0;
    const llamadas = instalarFetch((llamada) => (++n === 1 ? new Response("{}", { status: 503, headers: { "content-type": "application/json" } }) : sobre(llamada, payloadColores([{ value: "rojo", total: 1 }]))));
    const fallo = await pedir({ modo: "colores", approval_token: tokenPython });
    assert.ok(fallo.status >= 500, `status ${fallo.status}`);
    const bien = await pedir({ modo: "colores", approval_token: tokenPython });
    assert.equal(bien.status, 200);
    assert.equal(llamadas.length, 2);
  });

  await caso("la allowlist de un modo se resuelve una vez para leer y la clave de colores distingue modos y allowlists", async () => {
    let resoluciones = 0;
    const lista = crearCatalogAllowlist([{ productId: "prod-a", variantId: "var-a1" }]);
    const resolver = async () => { resoluciones += 1; await new Promise((listo) => setTimeout(listo, 5)); return lista; };
    const [uno, dos] = await Promise.all([allowlistParaExplorar("training_1", resolver), allowlistParaExplorar("training_1", resolver)]);
    assert.equal(uno, dos);
    await allowlistParaExplorar("training_1", resolver);
    assert.equal(resoluciones, 1, "un modo se resuelve una vez, aunque lo pidan a la vez o después");
    await allowlistParaExplorar("training_2", resolver);
    assert.equal(resoluciones, 2, "otro modo es otra resolución");
    await allowlistParaExplorar(undefined, resolver);
    await allowlistParaExplorar(undefined, resolver);
    assert.equal(resoluciones, 4, "sin modo restringido no se recuerda nada: es la ruta sin allowlist");
    let fallos = 0;
    const falla = async (): Promise<null> => { fallos += 1; throw new Error("LORA_X"); };
    await assert.rejects(allowlistParaExplorar("training_9", falla));
    await assert.rejects(allowlistParaExplorar("training_9", falla));
    assert.equal(fallos, 2, "un fallo no se recuerda");
    const otra = crearCatalogAllowlist([{ productId: "prod-a", variantId: "var-a1" }, { productId: "prod-b", variantId: "var-b1" }]);
    assert.notEqual(claveColores(SNAPSHOT, "training_1", lista), claveColores(SNAPSHOT, "training_1", otra), "otra allowlist, otra clave");
    assert.notEqual(claveColores(SNAPSHOT, "training_1", lista), claveColores(SNAPSHOT, "training_2", lista), "otro modo, otra clave");
    assert.notEqual(claveColores(SNAPSHOT, undefined, null), claveColores("products_catalog:otro", undefined, null), "otro snapshot, otra clave");
    assert.equal(claveColores(SNAPSHOT, "training_1", lista), claveColores(SNAPSHOT, "training_1", crearCatalogAllowlist([{ productId: "prod-a", variantId: "var-a1" }])), "la misma allowlist, la misma clave");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
