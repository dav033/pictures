/**
 * Patrón de color leído en la foto (ADR-0028 §7 y §11), del lado de Next.
 *
 * - La ruta de análisis pide a Python el patrón de cada estructura de globos y
 *   lo guarda en su elemento; un fallo deja el análisis intacto.
 * - Con `PATRONES_COLOR_V1` encendida, confirmar un plan resuelve con
 *   `completar_patrones: true` y las pistas de los elementos que el plan
 *   materializa, también en el reintento de convergencia. Apagada (el default,
 *   hasta que la edición en Python del §9 salga con ella) la petición es la de
 *   siempre: la edición de hoy no sabe de patrones. Resolver desde otro lado
 *   (edición, generación) no manda nada.
 *
 * Qué NO se prueba aquí: qué patrón elige Python ni cómo cuenta (eso es de
 * `patron_color.py` y sus pruebas). Offline: Python lo responde un doble de
 * transporte y el análisis sale de una foto de la galería, sin proveedor.
 * Run: npx tsx --conditions=react-server scripts/test/test-patron-referencia.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

// Antes de cualquier import de la app: las banderas se leen al cargar el módulo.
process.env.PATRON_REFERENCIA_PYTHON_ENABLED = "true";
// El análisis de la foto de galería no llama al proveedor; esto solo evita
// construir el chat directo de Gemini, que no se usa.
process.env.REFERENCE_ANALYSIS_PYTHON_ENABLED = "true";
// La ruta exige una llave configurada antes de analizar; la foto de galería no la usa.
process.env.GEMINI_API_KEY ??= "llave-offline-sin-uso";
process.env.PYTHON_BACKEND_URL ??= "http://python.test";
process.env.INTERNAL_HMAC_SECRET ??= "local-only-secret-0123456789abcdef";

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json };

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Doble de Python para la detección: responde lo que `responder` decida por llamada. */
function instalarPythonPatron(responder: (llamada: Llamada) => Response): Llamada[] {
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
  const contexto = llamada.body.context;
  assert.ok(esObjeto(contexto));
  return Response.json({ schema_version: "operational.v1", request_id: contexto.request_id, correlation_id: contexto.correlation_id, payload });
}

function resultadoPatron(pistas: Json[]): Json {
  return { operation_schema_version: "patron-referencia-result.v1", pistas, modelo: "gemini-3.6-flash", prompt_version: "patron-referencia.v1:test", usage: { prompt_token_count: 10 } };
}

async function main(): Promise<void> {
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  const { PlanDecoracionSchema } = await import("../../src/lib/plan/tipos");
  const { crearEstadoConversacion, crearRegistroHerramientas, pistasPatronDelPlan } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const { RECHAZOS_PARA_CONVERGER } = await import("../../src/lib/ia/herramientas/convergencia-plan");
  const { resolverPlan } = await import("../../src/lib/plan/resolver-backend");
  const { crearCacheDeteccionPatron, detectarPatronesReferencia } = await import("../../src/lib/ia/amaterasu/patron-referencia");
  const { ANALISIS_EJEMPLOS } = await import("../../src/lib/ia/amaterasu/analisis-ejemplos");
  const { instalarResolutorPythonFalso, SNAPSHOT_FALSO } = await import("../lib/resolutor-python-falso");
  type Blueprint = import("../../src/lib/ia/referencia/reference-blueprint").ReferenceBlueprintV2;
  type ProductoCandidato = import("../../src/lib/rag/chat/buscar").ProductoCandidato;

  const espiral = { modo: "espiral", colores: ["blanco", "negro", "blanco", "negro"], globos_por_racimo: 4, confianza: 0.8 };
  const elemento = (id: string, imagen: string, category: string, extra: { approved?: boolean; patron?: Json; colores?: string[] } = {}) => ({
    element_id: id, source_image_id: imagen, name: `pieza ${id}`, category,
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "pieza",
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved: extra.approved ?? true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: {
      observed_colors: extra.colores ?? ["white", "black"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "columna", composition: "mixed",
      ...(extra.patron ? { patron_color: extra.patron } : {}),
    },
    relationships: [], uncertainties: [],
  });
  const blueprintDe = (imagenes: string[], elementos: unknown[]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: imagenes.map((image_id) => ({ image_id, approved_roles: ["composition_reference"] })),
    elements: elementos,
    composition: { focal_point: "columna", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: ["white", "black"], priority: ["white", "black"] },
    unresolved_decisions: [],
  });

  // ---------------------------------------------------------------------------
  // El contrato del blueprint acepta la pista y rechaza lo que no es una pista.
  const conPatron = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure", { patron: espiral })]);
  assert.deepEqual(conPatron.elements[0]!.appearance.patron_color, espiral);
  assert.throws(() => blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure", { patron: { ...espiral, modo: "ninguno" } })]));
  assert.throws(() => blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure", { patron: { ...espiral, colores: [] } })]));
  assert.throws(() => blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure", { patron: { ...espiral, referencia_element_id: "REF_01_E01" } })]));
  assert.equal(blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure")]).elements[0]!.appearance.patron_color, undefined, "un blueprint sin detección sigue siendo válido");
  ok("appearance.patron_color es opcional y tiene la forma de la pista sin id");

  // ---------------------------------------------------------------------------
  // Pistas del plan: el elemento aprobado que cada estructura materializa.
  const bloques = { modo: "bloques", colores: ["dorado", "blanco"], pesos: [70, 30], confianza: 0.6 };
  const varios = blueprintDe(["REF_01"], [
    elemento("REF_01_E01", "REF_01", "balloon_structure", { patron: espiral }),
    elemento("REF_01_E02", "REF_01", "balloon_structure", { patron: bloques, approved: false }),
    elemento("REF_01_E03", "REF_01", "balloon_structure"),
  ]);
  const estructuraRef = (id: string, referencia?: string) => ({ referencia_element_id: referencia, estructura_id: id });
  const planPistas = { estructuras: [estructuraRef("EST_01", "REF_01_E01"), estructuraRef("EST_02", "REF_01_E01"), estructuraRef("EST_03", "REF_01_E02"), estructuraRef("EST_04", "REF_01_E03"), estructuraRef("EST_05")] };
  assert.deepEqual(
    pistasPatronDelPlan(planPistas as unknown as Parameters<typeof pistasPatronDelPlan>[0], varios),
    [{ referencia_element_id: "REF_01_E01", ...espiral }],
    "una pista por elemento, solo de elementos aprobados y con patrón",
  );
  assert.deepEqual(pistasPatronDelPlan(planPistas as unknown as Parameters<typeof pistasPatronDelPlan>[0], undefined), []);
  ok("pistasPatronDelPlan lee la misma fuente que los colores de la foto");

  // ---------------------------------------------------------------------------
  // confirmar_plan_decoracion: completar_patrones y pistas_patron.
  const candidato = (productId: string, color: string): ProductoCandidato => ({
    productId, titulo: productId, categoria: "globo_latex", colores: [color], acabados: [], ocasiones: [], disponible: true, imagen: null,
    variantes: [{ variantId: `${productId}-12`, sku: null, titulo: null, precio: 5000, disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: [color] }],
  });
  const candidatos = [candidato("P-BLANCO", "blanco"), candidato("P-NEGRO", "negro")];
  const argsColumna = {
    concepto: { titulo: "Columna", descripcion: "Columna blanco y negro", paleta: ["blanco", "negro"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [{
      estructura_id: "EST_01_COLUMNA", nombre: "Columna blanco y negro", tipo: "columna", rol_escena: "focal", ubicacion: "lateral_izquierdo",
      medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", referencia_element_id: "REF_01_E01",
      materiales: [
        { product_id: "P-BLANCO", participacion: 0.6, rol_material: "principal", color: "blanco" },
        { product_id: "P-NEGRO", participacion: 0.4, rol_material: "secundario", color: "negro" },
      ],
      porque: "Prueba",
    }],
  };
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const confirmarCon = (blueprint: Blueprint, opciones: Parameters<typeof instalarResolutorPythonFalso>[0] = {}, rechazos = 0) => {
    const llamadas = instalarResolutorPythonFalso(opciones);
    const estado = crearEstadoConversacion({}, "Quiero una columna así para un cumpleaños", blueprint);
    estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estado.ragCandidatos = candidatos;
    estado.rechazosPlan = rechazos;
    for (const c of candidatos) {
      estado.ragIdsRecuperados.add(c.productId);
      estado.ragVariantIdsRecuperados.set(c.productId, new Set(c.variantes.map((v) => v.variantId)));
    }
    const registro = crearRegistroHerramientas(estado, { pool, creatividad: 0 });
    return { llamadas, confirmar: () => registro.confirmar_plan_decoracion!(argsColumna, llamada) as Promise<Json> };
  };

  // Bandera apagada (default): aunque la foto traiga pista, confirmar manda la
  // petición de antes del patrón, así agregar, quitar y repartir siguen como hoy.
  delete process.env.PATRONES_COLOR_V1;
  const apagada = confirmarCon(conPatron);
  const confirmadoSinPatrones = await apagada.confirmar();
  assert.equal(confirmadoSinPatrones.ok, true, JSON.stringify(confirmadoSinPatrones).slice(0, 400));
  assert.equal(apagada.llamadas.length, 1);
  assert.equal("completar_patrones" in apagada.llamadas[0]!.body, false, "sin la bandera Python no completa patrones");
  assert.equal("pistas_patron" in apagada.llamadas[0]!.body, false, "sin la bandera las pistas de la foto no viajan");
  process.env.PATRONES_COLOR_V1 = "false";
  const apagadaExplicita = confirmarCon(conPatron);
  assert.equal((await apagadaExplicita.confirmar()).ok, true);
  assert.equal("completar_patrones" in apagadaExplicita.llamadas[0]!.body, false);
  ok("con PATRONES_COLOR_V1 apagada confirmar no pide patrones");

  process.env.PATRONES_COLOR_V1 = "true";
  const conPista = confirmarCon(conPatron);
  const confirmado = await conPista.confirmar();
  assert.equal(confirmado.ok, true, JSON.stringify(confirmado).slice(0, 400));
  assert.equal(conPista.llamadas.length, 1);
  assert.equal(conPista.llamadas[0]!.path, "/internal/v1/plan/resolve");
  assert.equal(conPista.llamadas[0]!.body.completar_patrones, true);
  assert.deepEqual(conPista.llamadas[0]!.body.pistas_patron, [{ referencia_element_id: "REF_01_E01", ...espiral }]);

  const sinPista = confirmarCon(blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure")]));
  assert.equal((await sinPista.confirmar()).ok, true);
  assert.equal(sinPista.llamadas[0]!.body.completar_patrones, true, "sin pista Python completa con el preset");
  assert.equal("pistas_patron" in sinPista.llamadas[0]!.body, false, "sin pistas el campo no viaja");
  ok("confirmar_plan_decoracion resuelve con completar_patrones y las pistas de la foto");

  // Convergencia: el reintento sin el material sin cobertura lleva las mismas opciones.
  const convergencia = confirmarCon(conPatron, {
    veredicto: (_plan, numero) => (numero === 1 ? { sinCobertura: [{ estructura_id: "EST_01_COLUMNA", product_id: "P-NEGRO", tamano: "R-12" }] } : {}),
  }, RECHAZOS_PARA_CONVERGER);
  const convergido = await convergencia.confirmar();
  assert.equal(convergido.ok, true, JSON.stringify(convergido).slice(0, 400));
  assert.equal(convergencia.llamadas.length, 2, "resolvió, quitó el material sin cobertura y reintentó");
  for (const reintento of convergencia.llamadas) {
    assert.equal(reintento.body.completar_patrones, true);
    assert.deepEqual(reintento.body.pistas_patron, [{ referencia_element_id: "REF_01_E01", ...espiral }]);
  }
  ok("el reintento de convergencia pasa completar_patrones y pistas_patron");

  // Cualquier otro llamador de resolverPlan (edición, generación) no completa.
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "domain", "v1", "fixtures", "plan-resuelto-ok.json"), "utf8")) as { plan: unknown };
  const planFixture = PlanDecoracionSchema.parse(fixture.plan);
  const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
  const directas = instalarResolutorPythonFalso();
  await resolverPlan({ plan: planFixture, allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }], catalogSnapshotId: SNAPSHOT_FALSO, requestId: REQUEST_ID, correlationId: REQUEST_ID });
  assert.equal("completar_patrones" in directas[0]!.body, false);
  assert.equal("pistas_patron" in directas[0]!.body, false);
  ok("resolverPlan sin opciones manda la petición de siempre");

  // ---------------------------------------------------------------------------
  // Detección: una llamada por foto con estructuras de globos aprobadas.
  const dosFotos = blueprintDe(["REF_01", "REF_02"], [
    elemento("REF_01_E01", "REF_01", "balloon_structure"),
    elemento("REF_01_E02", "REF_01", "floral"),
    elemento("REF_01_E03", "REF_01", "balloon_structure", { approved: false }),
    elemento("REF_02_E01", "REF_02", "balloon_structure", { colores: ["gold"] }),
  ]);
  const referencias = [
    { id: "REF_01", mime: "image/png", base64: "aGVsbG8=", descripcion: "foto" },
    { id: "REF_02", mime: "image/jpeg", base64: "bXVuZG8=", descripcion: "foto" },
  ];
  // Cada caso con su propia caché de detecciones: la misma foto y los mismos elementos no vuelven a llamar.
  const contexto = () => ({ requestId: REQUEST_ID, correlationId: "00000000-0000-4000-8000-000000000002", cache: crearCacheDeteccionPatron() });
  const deteccion = instalarPythonPatron((l) => {
    const elementos = l.body.elementos as Array<{ element_id: string }>;
    if (elementos[0]!.element_id === "REF_02_E01") return Response.json({ detail: { code: "patron_referencia_provider_error" } }, { status: 502 });
    return sobre(l, resultadoPatron([{ element_id: "REF_01_E01", ...espiral }]));
  });
  const detectado = await detectarPatronesReferencia(dosFotos, referencias, contexto());
  assert.equal(deteccion.length, 2);
  assert.ok(deteccion.every((l) => l.path === "/internal/v1/ia/patron-referencia"));
  const primera = deteccion.find((l) => (l.body.imagen as Json).mime_type === "image/png")!;
  assert.deepEqual(primera.body.imagen, { mime_type: "image/png", data_base64: "aGVsbG8=" });
  assert.deepEqual(primera.body.elementos, [{
    element_id: "REF_01_E01", tipo: "desconocido", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, colores_observados: ["white", "black"],
  }], "solo estructuras de globos aprobadas de esa foto");
  assert.deepEqual((primera.body.context as Json).scopes, ["ia.patron_referencia"]);
  assert.deepEqual(detectado.elements.find((e) => e.element_id === "REF_01_E01")!.appearance.patron_color, espiral);
  assert.equal(detectado.elements.find((e) => e.element_id === "REF_02_E01")!.appearance.patron_color, undefined, "la foto que falló queda sin pista");
  assert.equal(dosFotos.elements[0]!.appearance.patron_color, undefined, "el blueprint recibido no se modifica");
  ok("la detección arma una petición por foto y un fallo solo deja esa foto sin pistas");

  const ninguno = instalarPythonPatron((l) => sobre(l, resultadoPatron([{ element_id: "REF_01_E01", modo: "ninguno", colores: [], confianza: 0.2 }])));
  const soloUna = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure")]);
  assert.equal(await detectarPatronesReferencia(soloUna, referencias, contexto()), soloUna, "\"ninguno\" no deja pista");
  assert.equal(ninguno.length, 1);
  const fueraDeContrato = instalarPythonPatron((l) => sobre(l, resultadoPatron([{ element_id: "REF_09_E09", ...espiral }])));
  assert.equal(await detectarPatronesReferencia(soloUna, referencias, contexto()), soloUna, "una pista de otro elemento es respuesta inválida");
  assert.equal(fueraDeContrato.length, 1);
  const sinTiempo = instalarPythonPatron(() => {
    throw new Error("sin tiempo no se llama");
  });
  assert.equal(await detectarPatronesReferencia(soloUna, referencias, { ...contexto(), vencimiento: Date.now() + 1_000 }), soloUna);
  assert.equal(sinTiempo.length, 0);
  const sinGlobos = instalarPythonPatron(() => {
    throw new Error("sin estructuras de globos no se llama");
  });
  const flores = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "floral")]);
  assert.equal(await detectarPatronesReferencia(flores, referencias, contexto()), flores);
  assert.equal(sinGlobos.length, 0);
  ok("sin pista útil, sin tiempo o sin estructuras de globos el blueprint sale igual");

  // ---------------------------------------------------------------------------
  // Costo: cada detección es una llamada de visión con la foto entera. La misma
  // foto con los mismos elementos (un análisis de la caché o de la galería) no
  // la vuelve a pagar; un fallo sí se reintenta; "Reintentar" (sinCache) pide
  // una nueva; dos peticiones a la vez comparten una sola llamada.
  const pistaDePython = (pista: Json) => instalarPythonPatron((l) => sobre(l, resultadoPatron([{ element_id: "REF_01_E01", ...pista }])));
  const unaFoto = [referencias[0]!];
  const propia = contexto();
  const fallida = instalarPythonPatron(() => Response.json({ detail: { code: "patron_referencia_unavailable" } }, { status: 503 }));
  assert.equal(await detectarPatronesReferencia(soloUna, unaFoto, propia), soloUna);
  assert.equal(fallida.length, 1);
  const pagando = pistaDePython(espiral);
  const pagada = await detectarPatronesReferencia(soloUna, unaFoto, propia);
  assert.equal(pagando.length, 1, "un fallo no se guarda: la petición siguiente vuelve a llamar");
  assert.deepEqual(pagada.elements[0]!.appearance.patron_color, espiral);
  const repetidas = pistaDePython(bloques);
  for (let vez = 0; vez < 3; vez += 1) {
    assert.deepEqual((await detectarPatronesReferencia(soloUna, unaFoto, propia)).elements[0]!.appearance.patron_color, espiral, "la detección guardada");
  }
  assert.equal(repetidas.length, 0, "la misma foto con los mismos elementos no vuelve a pagar la visión");
  const otrosElementos = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "balloon_structure", { colores: ["gold", "white"] })]);
  await detectarPatronesReferencia(otrosElementos, unaFoto, propia);
  assert.equal(repetidas.length, 1, "otra pregunta sobre la misma foto sí llama");
  const reintento = pistaDePython(bloques);
  assert.deepEqual((await detectarPatronesReferencia(soloUna, unaFoto, { ...propia, sinCache: true })).elements[0]!.appearance.patron_color, bloques);
  assert.equal(reintento.length, 1, "sinCache pide una detección nueva");
  assert.deepEqual((await detectarPatronesReferencia(soloUna, unaFoto, propia)).elements[0]!.appearance.patron_color, bloques, "y la nueva reemplaza a la guardada");
  assert.equal(reintento.length, 1);

  // En vuelo: dos peticiones iguales a la vez, una sola llamada. Si una se
  // cancela, la otra sigue recibiendo su respuesta; si se cancelan todas, la llamada se corta.
  let soltar: () => void = () => undefined;
  const lenta = (senales: AbortSignal[]) => {
    const llamadas: Llamada[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body: unknown = JSON.parse(String(init?.body));
      assert.ok(esObjeto(body));
      const llamada = { path: new URL(String(input)).pathname, body };
      llamadas.push(llamada);
      if (init?.signal) senales.push(init.signal);
      await new Promise<void>((resolve, reject) => {
        soltar = resolve;
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
      return sobre(llamada, resultadoPatron([{ element_id: "REF_01_E01", ...espiral }]));
    }) as typeof fetch;
    return llamadas;
  };
  const senales: AbortSignal[] = [];
  const compartida = lenta(senales);
  const juntas = contexto();
  const cancelada = new AbortController();
  const [a, b, c] = [
    detectarPatronesReferencia(soloUna, unaFoto, juntas),
    detectarPatronesReferencia(soloUna, unaFoto, { ...juntas, signal: cancelada.signal }),
    detectarPatronesReferencia(soloUna, unaFoto, juntas),
  ];
  await new Promise((resolve) => setTimeout(resolve, 20));
  cancelada.abort(new Error("CLIENT_CANCELLED"));
  assert.equal(await b, soloUna, "la petición cancelada sale sin pistas");
  soltar();
  for (const resultado of await Promise.all([a, c])) assert.deepEqual(resultado.elements[0]!.appearance.patron_color, espiral);
  assert.equal(compartida.length, 1, "tres peticiones iguales a la vez, una llamada");
  assert.equal(senales[0]!.aborted, false, "cancelar una no corta la llamada que otras esperan");
  const senalesSolas: AbortSignal[] = [];
  const sola = lenta(senalesSolas);
  const unica = new AbortController();
  const abandonada = detectarPatronesReferencia(soloUna, unaFoto, { ...contexto(), signal: unica.signal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  unica.abort(new Error("CLIENT_CANCELLED"));
  assert.equal(await abandonada, soloUna);
  assert.equal(sola.length, 1);
  assert.equal(senalesSolas[0]!.aborted, true, "sin nadie esperando, la llamada a Python se cancela");
  ok("la detección se paga una vez por foto y pregunta: guardada, compartida en vuelo y nueva con sinCache");

  // ---------------------------------------------------------------------------
  // La ruta: foto de la galería (análisis guardado, sin proveedor) + detección.
  const { POST } = await import("../../src/app/api/references/analyze/route");
  const ejemplo = ANALISIS_EJEMPLOS.ejemplos.find((item) => item.id === "ejemplo-01")!;
  const globos = ejemplo.resultado.blueprint.elements.filter((e) => e.approved && e.category === "balloon_structure").map((e) => e.element_id);
  assert.ok(globos.length >= 2, "la foto de ejemplo tiene al menos dos estructuras de globos");
  const foto = readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", "ejemplo-01.jpg")).toString("base64");
  const analizar = () => POST(new Request("http://127.0.0.1/api/references/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images: [{ mime: "image/jpeg", base64: foto }] }),
  }));
  const pistaRuta = { modo: "anillos", colores: ["plateado", "rosado"], confianza: 0.7 };
  // Python caído: el análisis sale igual, sin pistas, y el fallo no se guarda.
  const caida = instalarPythonPatron(() => Response.json({ detail: { code: "patron_referencia_unavailable" } }, { status: 503 }));
  const respuestaCaida = await analizar();
  assert.equal(respuestaCaida.status, 200, "un fallo de la detección no rompe el análisis");
  const blueprintCaida = ReferenceBlueprintV2Schema.parse((await respuestaCaida.json() as { blueprint: unknown }).blueprint);
  assert.ok(blueprintCaida.elements.every((e) => e.appearance.patron_color === undefined));
  assert.equal(caida.length, 1);

  const ruta = instalarPythonPatron((l) => sobre(l, resultadoPatron([{ element_id: globos[0]!, ...pistaRuta }, { element_id: globos[1]!, modo: "ninguno", colores: [], confianza: 0.3 }])));
  const respuesta = await analizar();
  assert.equal(respuesta.status, 200);
  const cuerpo = await respuesta.json() as { blueprint: unknown; metadata?: { cached?: boolean } };
  assert.equal(cuerpo.metadata?.cached, true, "la foto de la galería no llama al proveedor del análisis");
  const blueprintRuta = ReferenceBlueprintV2Schema.parse(cuerpo.blueprint);
  assert.equal(ruta.length, 1);
  assert.deepEqual((ruta[0]!.body.elementos as Array<{ element_id: string }>).map((e) => e.element_id), globos);
  assert.equal((ruta[0]!.body.imagen as Json).mime_type, "image/jpeg");
  assert.deepEqual(blueprintRuta.elements.find((e) => e.element_id === globos[0])!.appearance.patron_color, pistaRuta);
  assert.equal(blueprintRuta.elements.find((e) => e.element_id === globos[1])!.appearance.patron_color, undefined);
  assert.ok(ejemplo.resultado.blueprint.elements.every((e) => e.appearance.patron_color === undefined), "el análisis guardado no se modifica");

  // La misma foto otra vez: el análisis fijo tampoco paga la detección (antes, una llamada de visión por petición).
  const repetida = instalarPythonPatron(() => {
    throw new Error("la detección de esta foto ya se pagó");
  });
  for (let vez = 0; vez < 3; vez += 1) {
    const otra = await analizar();
    assert.equal(otra.status, 200);
    const blueprintOtra = ReferenceBlueprintV2Schema.parse((await otra.json() as { blueprint: unknown }).blueprint);
    assert.deepEqual(blueprintOtra.elements.find((e) => e.element_id === globos[0])!.appearance.patron_color, pistaRuta, "las mismas pistas, sin llamar");
  }
  assert.equal(repetida.length, 0);
  ok("/api/references/analyze guarda cada pista en su elemento, sigue sin ellas si Python falla y no repaga la detección de la misma foto");

  console.log(`\n${casos} casos OK (patrón de color de la foto)`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[FAIL]", error);
    process.exit(1);
  },
);
