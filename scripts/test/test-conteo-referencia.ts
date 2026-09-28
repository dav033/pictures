/**
 * Conteo de globos leído en la foto (ADR-0031, E1 y E2), del lado de Next.
 *
 * - `appearance.conteo` es opcional y tiene la forma de `conteo-referencia.v1`
 *   (el reparto por tamaño: cada clase una vez y proporciones que suman 1).
 * - Se cuentan todas las estructuras de globos aprobadas, con su tipo, la
 *   estructura oficial que les daría el chat y las piezas iguales que representan.
 * - El adaptador arma la petición firmada y solo acepta lecturas de los
 *   elementos pedidos que cumplen el contrato.
 * - La lectura se guarda en su elemento; un fallo deja el blueprint intacto (el
 *   mismo objeto) y queda en el registro con los ids de la petición.
 * - Con la bandera apagada no hay llamada y el blueprint es byte a byte el de
 *   siempre; encendida, se junta con el patrón y el armado por elemento.
 * - El chat ve el conteo solo con `CONTEO_REFERENCIA_V1` (E2); apagada, el prompt no cambia.
 * - E2: `pistas_conteo` al confirmar, su transporte, `conteos_referencia` y la
 *   re-resolución tras editar la mezcla.
 * - La ruta, con la bandera encendida, guarda el conteo y sigue sin él si Python falla.
 *
 * Qué NO se prueba aquí: cómo cuenta Python ni qué hará el plan con la lectura
 * (eso es de `conteo_referencia.py` y `conteo_foto.py`). Offline: Python lo responde un doble.
 * Run: npx tsx --conditions=react-server scripts/test/test-conteo-referencia.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Antes de cualquier import de la app: las banderas se leen al cargar el módulo.
process.env.CONTEO_REFERENCIA_PYTHON_ENABLED = "true";
// El análisis de la foto de galería no llama al proveedor; esto solo evita
// construir el chat directo de Gemini, que no se usa.
process.env.REFERENCE_ANALYSIS_PYTHON_ENABLED = "true";
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

function instalarPython(responder: (llamada: Llamada) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const llamada = { path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) as Json };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return llamadas;
}

function sobre(llamada: Llamada, payload: Json): Response {
  const contexto = llamada.body.context as Json;
  return Response.json({ schema_version: "operational.v1", request_id: contexto.request_id, correlation_id: contexto.correlation_id, payload });
}

/** Captura `console.warn` mientras corre `fn`. */
async function avisosDe<T>(fn: () => Promise<T>): Promise<{ valor: T; avisos: string[] }> {
  const original = console.warn;
  const avisos: string[] = [];
  console.warn = (...args: unknown[]) => { avisos.push(args.map(String).join(" ")); };
  try {
    return { valor: await fn(), avisos };
  } finally {
    console.warn = original;
  }
}

async function main(): Promise<void> {
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  const { LecturaConteoSchema } = await import("../../src/lib/plan/conteo-referencia");
  const { crearCacheLecturaConteo, conConteosDe, elementosConteo, leerConteosReferencia } = await import("../../src/lib/ia/amaterasu/conteo-referencia");
  const { leerLecturasDeFoto } = await import("../../src/lib/ia/amaterasu/lecturas-foto");
  const { llamarPythonConteoReferencia, PythonAdapterError } = await import("../../src/lib/ia/nucleo/python-adapter");
  const { sha256Body } = await import("../../src/lib/ia/contracts/operational-v1");
  const { serializeReferenceBlueprint } = await import("../../src/lib/ia/omoikane/prompt-sistema");
  const { ANALISIS_EJEMPLOS } = await import("../../src/lib/ia/amaterasu/analisis-ejemplos");
  type Blueprint = import("../../src/lib/ia/referencia/reference-blueprint").ReferenceBlueprintV2;

  const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
  const CORRELATION_ID = "44444444-4444-4444-8444-444444444444";
  const conteo = {
    globos_visibles: 58, exacto: false, estimado_total: 96, racimos: 24, globos_por_racimo: 4,
    por_tamano: [{ clase: "chico", proporcion: 0.333 }, { clase: "mediano", proporcion: 0.556 }, { clase: "grande", proporcion: 0.111 }],
    largo_relativo: null, alto_relativo: { referencia: "puerta", veces: 1.2 }, confianza: 0.8,
  };
  const exacto = {
    globos_visibles: 5, exacto: true, estimado_total: null, racimos: null, globos_por_racimo: null,
    por_tamano: [{ clase: "mediano", proporcion: 1 }], largo_relativo: null, alto_relativo: null, confianza: 0.9,
  };
  type Extra = { approved?: boolean; categoria?: string; tipo?: string; ubicacion?: string; forma?: string; piezas?: number; conteo?: Json; patron?: Json; armado?: Json; imagen?: string };
  const elemento = (id: string, extra: Extra = {}) => ({
    element_id: id, source_image_id: extra.imagen ?? "REF_01", name: `pieza ${id}`, category: extra.categoria ?? "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "pieza",
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved: extra.approved ?? true, source_type: "reference_only",
    quantity: { mode: "exact", min: extra.piezas ?? 1, max: extra.piezas ?? 1 },
    quantity_semantics: "physical_instances",
    ...(extra.tipo ? { visual_semantics: { structure_type: extra.tipo, placement: extra.ubicacion ?? "piso_frontal", design_role: "focal", repetition_group: id, density: "media" } } : {}),
    appearance: {
      observed_colors: ["white", "gold"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: extra.forma ?? "piece", composition: "mixed",
      ...(extra.patron ? { patron_color: extra.patron } : {}),
      ...(extra.armado ? { armado_bouquet: extra.armado } : {}),
      ...(extra.conteo ? { conteo: extra.conteo } : {}),
    },
    relationships: [], uncertainties: [],
  });
  const blueprintDe = (elementos: unknown[], imagenes = ["REF_01"]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: imagenes.map((image_id) => ({ image_id, approved_roles: ["composition_reference"] })),
    elements: elementos,
    composition: { focal_point: "pieza", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: ["white", "gold"], priority: ["white", "gold"] },
    unresolved_decisions: [],
  });

  // ---------------------------------------------------------------------------
  assert.deepEqual(blueprintDe([elemento("REF_01_E01", { tipo: "columna", conteo })]).elements[0]!.appearance.conteo, conteo);
  assert.equal(blueprintDe([elemento("REF_01_E01", { tipo: "columna" })]).elements[0]!.appearance.conteo, undefined, "sin lectura el blueprint sigue siendo válido");
  const invalidas: Json[] = [
    { ...conteo, por_tamano: [{ clase: "mediano", proporcion: 0.5 }] },
    { ...conteo, por_tamano: [{ clase: "mediano", proporcion: 0.5 }, { clase: "mediano", proporcion: 0.5 }] },
    { ...conteo, por_tamano: [{ clase: "enorme", proporcion: 1 }] },
    { ...conteo, exacto: "no" },
    { ...conteo, globos_visibles: 12.5 },
    { ...conteo, alto_relativo: { referencia: "silla", veces: 1 } },
    { ...conteo, element_id: "REF_01_E01" },
    Object.fromEntries(Object.entries(conteo).filter(([clave]) => clave !== "largo_relativo")),
  ];
  for (const invalida of invalidas) {
    assert.throws(() => blueprintDe([elemento("REF_01_E01", { tipo: "columna", conteo: invalida })]), JSON.stringify(invalida).slice(0, 120));
    assert.equal(LecturaConteoSchema.safeParse(invalida).success, false);
  }
  ok("appearance.conteo es opcional y tiene la forma de conteo-referencia.v1");

  // ---------------------------------------------------------------------------
  const mezcla = blueprintDe([
    elemento("REF_01_E01", { tipo: "kit", forma: "medium dense bouquet, on the center" }),
    elemento("REF_01_E02", { tipo: "columna", forma: "tall column, on the left", piezas: 2 }),
    elemento("REF_01_E03", { tipo: "guirnalda", ubicacion: "techo", forma: "ceiling installation" }),
    elemento("REF_01_E04", { tipo: "centro_mesa", approved: false }),
    elemento("REF_01_E05", { categoria: "floral" }),
    elemento("REF_01_E06", {}),
  ]);
  assert.deepEqual([...elementosConteo(mezcla).values()].flat(), [
    { elementId: "REF_01_E01", tipo: "kit", estructuraOficial: "bouquet", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 } },
    { elementId: "REF_01_E02", tipo: "columna", estructuraOficial: "columna", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, piezas: 2 },
    { elementId: "REF_01_E03", tipo: "guirnalda", estructuraOficial: "techo_globos", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 } },
    { elementId: "REF_01_E06", tipo: "desconocido", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 } },
  ]);
  ok("se cuentan todas las estructuras de globos aprobadas, con su estructura oficial y sus piezas");

  // ---------------------------------------------------------------------------
  // Adaptador: petición firmada, forma de la respuesta y errores.
  const BASE_ENV = { PYTHON_BACKEND_URL: "http://python.test", INTERNAL_HMAC_SECRET: "local-only-secret-0123456789abcdef" };
  const payload = (overrides: Json = {}): Json => ({
    operation_schema_version: "conteo-referencia-result.v1",
    lecturas: [{ element_id: "REF_01_E01", ...exacto }, { element_id: "REF_01_E02", ...conteo }],
    modelo: "gemini-3.6-flash",
    prompt_version: "conteo-referencia.v1:test",
    usage: { prompt_token_count: 1100, candidates_token_count: 140 },
    ...overrides,
  });
  const entrada = {
    imagen: { mimeType: "image/jpeg" as const, dataBase64: "A".repeat(200_000) },
    elementos: [...elementosConteo(mezcla).values()].flat().slice(0, 2),
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
  };
  const capturadas: Array<{ url: string; body: Json }> = [];
  const resultado = await llamarPythonConteoReferencia({
    ...entrada,
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Json;
      capturadas.push({ url: String(input), body });
      return Response.json({ schema_version: "operational.v1", request_id: REQUEST_ID, correlation_id: CORRELATION_ID, payload: payload() });
    },
  });
  assert.equal(new URL(capturadas[0]!.url).pathname, "/internal/v1/ia/conteo-referencia");
  const operationBody = {
    schema_version: "conteo-referencia.v1",
    imagen: { mime_type: "image/jpeg", data_base64: "A".repeat(200_000) },
    elementos: [
      { element_id: "REF_01_E01", tipo: "kit", estructura_oficial: "bouquet", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 } },
      { element_id: "REF_01_E02", tipo: "columna", estructura_oficial: "columna", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, piezas: 2 },
    ],
  };
  const cuerpo = capturadas[0]!.body as Json & { context: { scopes: string[]; body_sha256: string } };
  assert.deepEqual({ schema_version: cuerpo.schema_version, imagen: cuerpo.imagen, elementos: cuerpo.elementos }, operationBody);
  assert.deepEqual(cuerpo.context.scopes, ["ia.conteo_referencia"]);
  assert.equal(cuerpo.context.body_sha256, sha256Body(JSON.stringify(operationBody)));
  assert.deepEqual(resultado.lecturas, payload().lecturas);
  assert.equal(resultado.promptVersion, "conteo-referencia.v1:test");
  assert.equal(resultado.usage?.prompt_token_count, 1100);

  const lecturas = payload().lecturas as Json[];
  const respuestasInvalidas: Json[] = [
    payload({ lecturas: [{ ...lecturas[0], element_id: "REF_09_E09" }] }),
    payload({ lecturas: [lecturas[0], lecturas[0]] }),
    payload({ lecturas: [{ ...lecturas[1], por_tamano: [{ clase: "mediano", proporcion: 0.4 }] }] }),
    payload({ lecturas: [{ ...lecturas[1], estimado_total: undefined }] }),
    payload({ lecturas: [{ ...lecturas[1], confianza: 1.5 }] }),
    payload({ operation_schema_version: "conteo-referencia-result.v2" }),
    payload({ extra: true }),
  ];
  for (const invalida of respuestasInvalidas) {
    await assert.rejects(
      () => llamarPythonConteoReferencia({ ...entrada, fetchImpl: async () => Response.json({ schema_version: "operational.v1", request_id: REQUEST_ID, correlation_id: CORRELATION_ID, payload: invalida }) }),
      (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
      JSON.stringify(invalida).slice(0, 200),
    );
  }
  await assert.rejects(
    () => llamarPythonConteoReferencia({ ...entrada, fetchImpl: async () => Response.json({ detail: { code: "conteo_referencia_empty_response", provider_detail: "finish_reason=SAFETY" } }, { status: 502 }) }),
    (error: unknown) => error instanceof PythonAdapterError && error.domainCode === "conteo_referencia_empty_response" && error.providerDetail === "finish_reason=SAFETY",
  );
  ok("el adaptador firma la petición y solo acepta lecturas de los elementos pedidos que cumplen el contrato");

  // ---------------------------------------------------------------------------
  const foto = { id: "REF_01", mime: "image/png", base64: Buffer.from("foto-conteo").toString("base64"), descripcion: "x" };
  const contexto = (extra: { cache?: ReturnType<typeof crearCacheLecturaConteo> } = {}) => ({ requestId: REQUEST_ID, correlationId: CORRELATION_ID, cache: extra.cache ?? crearCacheLecturaConteo() });
  const resultadoConteo = (lecturasPython: Json[]): Json => ({ operation_schema_version: "conteo-referencia-result.v1", lecturas: lecturasPython, modelo: "gemini-3.6-flash", prompt_version: "conteo-referencia.v1:test", usage: { prompt_token_count: 10 } });
  const cache = crearCacheLecturaConteo();
  const llamadas = instalarPython((llamada) => sobre(llamada, resultadoConteo([{ element_id: "REF_01_E02", ...conteo }])));
  const leido = await leerConteosReferencia(mezcla, [foto], contexto({ cache }));
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]!.path, "/internal/v1/ia/conteo-referencia");
  assert.deepEqual(leido.elements.find((e) => e.element_id === "REF_01_E02")!.appearance.conteo, conteo);
  assert.equal(leido.elements.find((e) => e.element_id === "REF_01_E01")!.appearance.conteo, undefined, "sin lectura, sin conteo");
  assert.equal(mezcla.elements[1]!.appearance.conteo, undefined, "el blueprint recibido no se modifica");
  await leerConteosReferencia(mezcla, [foto], contexto({ cache }));
  assert.equal(llamadas.length, 1, "la misma foto con las mismas piezas no se vuelve a pagar");
  ok("la lectura se guarda en su elemento y se reutiliza");

  // ---------------------------------------------------------------------------
  const caida = instalarPython(() => Response.json({ detail: { code: "conteo_referencia_provider_error" } }, { status: 502 }));
  const { valor: sinLectura, avisos } = await avisosDe(() => leerConteosReferencia(mezcla, [foto], contexto()));
  assert.equal(caida.length, 1);
  assert.equal(sinLectura, mezcla, "un fallo deja el blueprint tal cual (el mismo objeto)");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /conteo de globos omitido/);
  assert.match(avisos[0]!, new RegExp(`"request_id":"${REQUEST_ID}".*"correlation_id":"${CORRELATION_ID}"`));
  assert.match(avisos[0]!, /"domain_code":"conteo_referencia_provider_error"/);
  const sinEstructuras = blueprintDe([elemento("REF_01_E05", { categoria: "floral" })]);
  const nadie = instalarPython(() => { throw new Error("no debía llamar"); });
  assert.equal(await leerConteosReferencia(sinEstructuras, [foto], contexto()), sinEstructuras);
  assert.equal(nadie.length, 0);
  ok("un fallo nunca rompe el análisis, queda en el registro con los ids, y sin estructuras no se llama");

  // ---------------------------------------------------------------------------
  // Las tres lecturas juntas, con y sin la bandera del conteo.
  const patron = { modo: "espiral", colores: ["blanco", "dorado", "blanco", "dorado"], globos_por_racimo: 4, confianza: 0.8 };
  const armado = { variante: "helio_apilado", niveles: [{ unidad: "trio", colores: ["blanco", "dorado", "blanco"] }], confianza: 0.8 };
  let fotoNumero = 0;
  const otraFoto = () => ({ ...foto, base64: Buffer.from(`foto-${(fotoNumero += 1)}`).toString("base64") });
  const responderLecturas = (conteoFalla: boolean) => instalarPython((llamada) => {
    if (llamada.path === "/internal/v1/ia/patron-referencia") return sobre(llamada, { operation_schema_version: "patron-referencia-result.v1", pistas: [{ element_id: "REF_01_E02", ...patron }], modelo: "gemini-3.6-flash", prompt_version: "p", usage: null });
    if (llamada.path === "/internal/v1/ia/bouquet-referencia") return sobre(llamada, { operation_schema_version: "bouquet-referencia-result.v1", lecturas: [{ element_id: "REF_01_E01", ...armado }], modelo: "gemini-3.6-flash", prompt_version: "b", usage: null });
    if (llamada.path === "/internal/v1/ia/conteo-referencia") {
      return conteoFalla
        ? Response.json({ detail: { code: "conteo_referencia_unavailable" } }, { status: 503 })
        : sobre(llamada, resultadoConteo([{ element_id: "REF_01_E01", ...exacto }, { element_id: "REF_01_E02", ...conteo }]));
    }
    throw new Error(`ruta inesperada ${llamada.path}`);
  });
  const ctx = { requestId: REQUEST_ID, correlationId: CORRELATION_ID, sinCache: true };

  const todasApagadas = instalarPython(() => { throw new Error("con todo apagado no se llama"); });
  assert.equal(await leerLecturasDeFoto(mezcla, [otraFoto()], ctx, { patron: false, bouquet: false, conteo: false }), mezcla);
  assert.equal(todasApagadas.length, 0);

  const fotoSinConteo = otraFoto();
  const sinConteoLlamadas = responderLecturas(false);
  const sinConteo = await leerLecturasDeFoto(mezcla, [fotoSinConteo], ctx, { patron: true, bouquet: true, conteo: false });
  assert.deepEqual(sinConteoLlamadas.map((l) => l.path).sort(), ["/internal/v1/ia/bouquet-referencia", "/internal/v1/ia/patron-referencia"], "apagada, el conteo no llama");
  assert.ok(sinConteo.elements.every((e) => e.appearance.conteo === undefined));

  const conConteoLlamadas = responderLecturas(false);
  const conTodo = await leerLecturasDeFoto(mezcla, [fotoSinConteo], ctx, { patron: true, bouquet: true, conteo: true });
  assert.equal(conConteoLlamadas.length, 3);
  const e01 = conTodo.elements.find((e) => e.element_id === "REF_01_E01")!;
  const e02 = conTodo.elements.find((e) => e.element_id === "REF_01_E02")!;
  assert.deepEqual(e01.appearance.armado_bouquet, armado);
  assert.deepEqual(e01.appearance.conteo, exacto);
  assert.deepEqual(e02.appearance.patron_color, patron);
  assert.deepEqual(e02.appearance.conteo, conteo);
  // Sin el conteo, lo demás es idéntico a lo de la bandera apagada.
  const sinElConteo = {
    ...conTodo,
    elements: conTodo.elements.map((elemento) => {
      const appearance = { ...elemento.appearance };
      delete appearance.conteo;
      return { ...elemento, appearance };
    }),
  };
  assert.equal(JSON.stringify(sinElConteo), JSON.stringify(sinConteo));

  const falla = responderLecturas(true);
  const { valor: conFallo, avisos: avisosFallo } = await avisosDe(() => leerLecturasDeFoto(mezcla, [fotoSinConteo], ctx, { patron: true, bouquet: true, conteo: true }));
  assert.equal(falla.length, 3);
  assert.equal(JSON.stringify(conFallo), JSON.stringify(sinConteo), "si el conteo falla, byte a byte lo de la bandera apagada");
  assert.equal(avisosFallo.filter((aviso) => aviso.includes("conteo de globos omitido")).length, 1);
  assert.equal(conConteosDe(sinConteo, sinConteo), sinConteo, "sin conteos que juntar, el mismo objeto");
  ok("las tres lecturas se juntan por elemento; apagada o caída, el conteo no cambia nada");

  // ---------------------------------------------------------------------------
  // El chat ve el conteo solo con CONTEO_REFERENCIA_V1 (E2); apagada, byte a byte igual.
  delete process.env.CONTEO_REFERENCIA_V1;
  assert.equal(serializeReferenceBlueprint(conTodo), serializeReferenceBlueprint(sinConteo));
  process.env.CONTEO_REFERENCIA_V1 = "true";
  const conTexto = serializeReferenceBlueprint(conTodo).split("\n");
  const lineaDe = (id: string) => conTexto.find((linea) => linea.includes(id)) ?? "";
  assert.match(lineaDe("REF_01_E01"), /conteo leído en la foto: 5 globos \(cuenta exacta\)\. Si la pieza es un kit/);
  assert.match(lineaDe("REF_01_E02"), /conteo leído en la foto: unos 96 globos \(aproximado; 58 visibles\), 24 racimos de 4\./);
  assert.match(lineaDe("REF_01_E02"), /Python ajusta densidad y medidas a esa cuenta/);
  assert.equal(serializeReferenceBlueprint(sinConteo), serializeReferenceBlueprint(conConteosDe(sinConteo, sinConteo)), "sin conteo, la línea de siempre");
  const pocaConfianza = conConteosDe(sinConteo, blueprintDe([elemento("REF_01_E02", { tipo: "columna", conteo: { ...conteo, confianza: 0.3 } })]));
  assert.doesNotMatch(serializeReferenceBlueprint(pocaConfianza), /conteo leído/, "una lectura poco confiable no se le cuenta al modelo");
  // Un bouquet con armado leído (total que publicó Python) y conteo: manda el conteo;
  // sin conteo que mande, el total de Python. Nunca una cuenta hecha aquí.
  const armadoConTotal = { variante: "base_aire", niveles: [{ unidad: "cuarteto", colores: ["blanco", "rosado", "blanco", "rosado"] }], remate: { clase: "metalizado", color: "dorado" }, numeros: [{ digito: "3", clase_tamano: "grande" }, { digito: "5", clase_tamano: "grande" }], confianza: 0.85, total_globos: 11 };
  const bouquetOnce = (extra: Json = {}) => blueprintDe([elemento("REF_01_E01", { tipo: "kit", forma: "medium dense bouquet", armado: armadoConTotal, ...extra })]);
  const lineaConteo = serializeReferenceBlueprint(bouquetOnce({ conteo: { ...conteo, globos_visibles: 26, estimado_total: 35, racimos: null, globos_por_racimo: null } }));
  assert.doesNotMatch(lineaConteo, /total 11 globos|unidades_declaradas 11/, lineaConteo);
  assert.match(lineaConteo, /declara unidades_declaradas unos 35 por pieza/);
  assert.match(lineaConteo, /Busca cada dígito como globo metalizado número/, "los números del armado siguen");
  const soloRacimos = serializeReferenceBlueprint(bouquetOnce({ conteo: { ...conteo, estimado_total: null } }));
  assert.match(soloRacimos, /total 11 globos\. Declara unidades_declaradas 11 por pieza/, "sin cifra leída el conteo no manda: el total de Python");
  assert.doesNotMatch(soloRacimos, /declara unidades_declaradas unos/);
  delete process.env.CONTEO_REFERENCIA_V1;
  assert.match(serializeReferenceBlueprint(bouquetOnce({ conteo: { ...conteo, estimado_total: 35 } })), /total 11 globos/, "sin la bandera, el armado como siempre");
  ok("el prompt del chat cuenta el conteo leído solo con CONTEO_REFERENCIA_V1 y lectura confiable, y ahí manda sobre el total del armado");

  // ---------------------------------------------------------------------------
  // E2: pistas al confirmar, transporte a Python, resultado y edición.
  const { pistasConteoDelPlan } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const planPistas = { estructuras: [{ referencia_element_id: "REF_01_E02" }, { referencia_element_id: "REF_01_E02" }, { referencia_element_id: "REF_01_E03" }, {}] } as never;
  assert.deepEqual(pistasConteoDelPlan(planPistas, conTodo), [{ referencia_element_id: "REF_01_E02", ...conteo }], "una por elemento, solo con conteo");
  assert.deepEqual(pistasConteoDelPlan(planPistas, undefined), []);

  const { llamarPythonPlanResolution } = await import("../../src/lib/ia/nucleo/python-adapter");
  const cuerpos = instalarPython(() => new Response("sin respuesta", { status: 503 }));
  const peticion = { plan: {} as never, allowlist: [], catalogSnapshotId: "s", requestId: REQUEST_ID, correlationId: CORRELATION_ID };
  await assert.rejects(llamarPythonPlanResolution(peticion));
  await assert.rejects(llamarPythonPlanResolution({ ...peticion, completarConteos: true, pistasConteo: [{ referencia_element_id: "REF_01_E02", ...conteo } as never], completarConteosDe: ["EST_01"] }));
  assert.ok(!Object.keys(cuerpos[0]!.body).some((clave) => clave.includes("conteo")), "sin pedirlo la petición es la de siempre");
  assert.equal(cuerpos[1]!.body.completar_conteos, true);
  assert.equal((cuerpos[1]!.body.pistas_conteo as Json[]).length, 1);
  assert.deepEqual(cuerpos[1]!.body.completar_conteos_de, ["EST_01"]);

  const { PlanResueltoV1Schema } = await import("../../src/lib/ia/contracts/domain-v1");
  const { planResueltoDesdePython } = await import("../../src/lib/plan/python-mapper");
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "domain", "v1", "fixtures", "plan-resuelto-ok.json"), "utf8")) as Json;
  const aplicado = { estructura_id: "EST_01", referencia_element_id: "REF_01_E02", decision: "ajustado", lectura: conteo, globos_foto: 96, globos_antes: 80, globos_despues: 96, cambios: [{ campo: "densidad", antes: "media", despues: "lujosa" }], motivo: "Densidad y tamaños ajustados con las medidas del plan." };
  const resuelto = planResueltoDesdePython(PlanResueltoV1Schema.parse({ ...fixture, conteos_referencia: [aplicado] }));
  assert.deepEqual(resuelto.conteos_referencia, [aplicado]);
  assert.equal("conteos_referencia" in planResueltoDesdePython(PlanResueltoV1Schema.parse(fixture)), false);
  assert.equal(PlanResueltoV1Schema.safeParse({ ...fixture, conteos_referencia: [{ ...aplicado, decision: "aplazado" }] }).success, false);

  const { conteosDeLaEdicion } = await import("../../src/lib/plan/aplicar-edicion");
  const baseConConteos = { ...fixture, conteos_referencia: [aplicado, { ...aplicado, estructura_id: "EST_02", referencia_element_id: "REF_01_E03", decision: "coincide" }] } as never;
  const mezclaDe = (estructuraId: string) => ({ accion: "mezcla", estructura_id: estructuraId, mezcla: "clasica" }) as never;
  assert.equal(conteosDeLaEdicion(baseConConteos, mezclaDe("EST_01")), undefined, "sin la bandera, la edición es la de siempre");
  process.env.CONTEO_REFERENCIA_V1 = "true";
  const deMezcla = conteosDeLaEdicion(baseConConteos, mezclaDe("EST_01"));
  assert.deepEqual(deMezcla?.ajustar, ["EST_01"]);
  assert.deepEqual(deMezcla?.pistas.map((pista) => pista.referencia_element_id), ["REF_01_E02", "REF_01_E03"], "todas viajan para no perderse");
  assert.deepEqual(conteosDeLaEdicion(baseConConteos, { accion: "repartir", estructura_id: "EST_01", participaciones: [1] } as never)?.ajustar, [], "otra edición no ajusta nada");
  assert.equal(conteosDeLaEdicion(fixture as never, mezclaDe("EST_01")), undefined, "sin conteos en el plan base, nada");
  delete process.env.CONTEO_REFERENCIA_V1;
  ok("E2: pistas_conteo al confirmar, transporte, conteos_referencia y la edición de la mezcla");

  // ---------------------------------------------------------------------------
  // La ruta con la bandera encendida: foto de la galería (análisis guardado, sin proveedor).
  const { POST } = await import("../../src/app/api/references/analyze/route");
  const ejemplo = ANALISIS_EJEMPLOS.ejemplos.find((item) => item.id === "ejemplo-01")!;
  const globos = ejemplo.resultado.blueprint.elements.filter((e) => e.approved && e.category === "balloon_structure").map((e) => e.element_id);
  assert.ok(globos.length >= 2, "la foto de ejemplo tiene al menos dos estructuras de globos");
  const fotoEjemplo = readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", "ejemplo-01.jpg")).toString("base64");
  const analizar = () => POST(new Request("http://127.0.0.1/api/references/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify({ images: [{ mime: "image/jpeg", base64: fotoEjemplo }] }),
  }));
  // Primero Python caído (un fallo no se guarda en la caché), luego la lectura.
  const rutaCaida = instalarPython(() => Response.json({ detail: { code: "conteo_referencia_unavailable" } }, { status: 503 }));
  const { valor: respuestaCaida, avisos: avisosRuta } = await avisosDe(analizar);
  assert.equal(respuestaCaida.status, 200, "un fallo del conteo no rompe el análisis");
  const blueprintCaida = ReferenceBlueprintV2Schema.parse((await respuestaCaida.json() as { blueprint: unknown }).blueprint);
  assert.ok(blueprintCaida.elements.every((e) => e.appearance.conteo === undefined));
  assert.equal(rutaCaida.length, 1);
  assert.ok(avisosRuta.some((aviso) => aviso.includes("conteo de globos omitido") && aviso.includes(CORRELATION_ID)), "el fallo queda en el registro con la correlación");

  const ruta = instalarPython((llamada) => sobre(llamada, resultadoConteo([{ element_id: globos[0]!, ...conteo }])));
  const respuesta = await analizar();
  assert.equal(respuesta.status, 200);
  const blueprintRuta = ReferenceBlueprintV2Schema.parse((await respuesta.json() as { blueprint: unknown }).blueprint);
  assert.equal(ruta.length, 1);
  assert.equal(ruta[0]!.path, "/internal/v1/ia/conteo-referencia");
  assert.deepEqual((ruta[0]!.body.elementos as Array<{ element_id: string }>).map((e) => e.element_id), globos);
  assert.deepEqual(blueprintRuta.elements.find((e) => e.element_id === globos[0])!.appearance.conteo, conteo);
  assert.equal(blueprintRuta.elements.find((e) => e.element_id === globos[1])!.appearance.conteo, undefined);
  assert.ok(ejemplo.resultado.blueprint.elements.every((e) => e.appearance.conteo === undefined), "el análisis guardado no se modifica");
  ok("/api/references/analyze guarda el conteo en su elemento y sigue sin él si Python falla");

  console.log(`\n${casos} casos OK (conteo de globos de la foto)`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[FAIL]", error);
    process.exit(1);
  },
);
