/**
 * Armado de los bouquets leído en la foto (ADR-0030), del lado de Next.
 *
 * - `appearance.armado_bouquet` es opcional y tiene la forma de la lectura.
 * - Solo se leen los elementos que el chat trataría como bouquet (la misma
 *   `identificarEstructuraOficial`), y la lectura se guarda en su elemento; un
 *   fallo deja el blueprint intacto y la misma foto no se vuelve a pagar.
 * - Las dos lecturas de la foto (patrón y armado) se juntan por elemento.
 * - Al confirmar, las lecturas viajan como `pistas_armado` con
 *   `completar_armados`; sin esos campos la petición es la de siempre.
 *
 * Qué NO se prueba aquí: qué armado elige Python (eso es de
 * `armado_bouquet.py` y sus pruebas). Offline: Python lo responde un doble.
 * Run: npx tsx --conditions=react-server scripts/test/test-bouquet-referencia.ts
 */
import assert from "node:assert/strict";

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

async function main(): Promise<void> {
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  const { conArmadosDe, crearCacheLecturaBouquet, elementosBouquet, leerArmadosReferencia } = await import("../../src/lib/ia/amaterasu/bouquet-referencia");
  const { pistasArmadoDelPlan } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const { llamarPythonPlanResolution } = await import("../../src/lib/ia/nucleo/python-adapter");
  type Blueprint = import("../../src/lib/ia/referencia/reference-blueprint").ReferenceBlueprintV2;

  const lectura = { variante: "helio_apilado", niveles: [{ unidad: "trio", colores: ["blanco", "rosado", "blanco"] }], remate: { clase: "metalizado", color: "dorado" }, confianza: 0.8 };
  const elemento = (id: string, forma: string, tipo: string, extra: { approved?: boolean; armado?: Json; patron?: Json } = {}) => ({
    element_id: id, source_image_id: "REF_01", name: `pieza ${id}`, category: "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "pieza",
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved: extra.approved ?? true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    visual_semantics: { structure_type: tipo, placement: "piso_frontal", design_role: "focal", repetition_group: id, density: "media" },
    appearance: {
      observed_colors: ["white", "gold"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: forma, composition: "mixed",
      ...(extra.armado ? { armado_bouquet: extra.armado } : {}),
      ...(extra.patron ? { patron_color: extra.patron } : {}),
    },
    relationships: [], uncertainties: [],
  });
  const blueprintDe = (elementos: unknown[]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: elementos,
    composition: { focal_point: "bouquet", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: ["white", "gold"], priority: ["white", "gold"] },
    unresolved_decisions: [],
  });
  const bouquet = "medium dense bouquet, on the center, standing on the floor";

  // ---------------------------------------------------------------------------
  assert.deepEqual(blueprintDe([elemento("REF_01_E01", bouquet, "kit", { armado: lectura })]).elements[0]!.appearance.armado_bouquet, lectura);
  assert.throws(() => blueprintDe([elemento("REF_01_E01", bouquet, "kit", { armado: { ...lectura, variante: "flotante" } })]));
  assert.throws(() => blueprintDe([elemento("REF_01_E01", bouquet, "kit", { armado: { ...lectura, referencia_element_id: "REF_01_E01" } })]));
  ok("appearance.armado_bouquet es opcional y tiene la forma de la lectura sin id");

  // ---------------------------------------------------------------------------
  const mezcla = blueprintDe([
    elemento("REF_01_E01", bouquet, "kit"),
    elemento("REF_01_E02", "tall column, on the left", "columna"),
    elemento("REF_01_E03", "small centerpiece", "centro_mesa"),
    elemento("REF_01_E04", bouquet, "kit", { approved: false }),
  ]);
  assert.deepEqual([...elementosBouquet(mezcla).values()].flat().map((e) => e.elementId), ["REF_01_E01"]);
  ok("solo se leen los bouquets aprobados, con la misma regla que usa el chat");

  // ---------------------------------------------------------------------------
  const foto = { id: "REF_01", mime: "image/png", base64: Buffer.from("foto-bouquet").toString("base64"), descripcion: "x" };
  const cache = crearCacheLecturaBouquet();
  const llamadas = instalarPython((llamada) => sobre(llamada, {
    operation_schema_version: "bouquet-referencia-result.v1",
    lecturas: [{ element_id: "REF_01_E01", ...lectura }],
    modelo: "gemini-3.6-flash",
    prompt_version: "bouquet-referencia.v1:test",
    usage: { prompt_token_count: 10 },
  }));
  const contexto = { requestId: "11111111-1111-4111-8111-111111111111", correlationId: "11111111-1111-4111-8111-111111111111", cache };
  const leido = await leerArmadosReferencia(mezcla, [foto], contexto);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]!.path, "/internal/v1/ia/bouquet-referencia");
  assert.deepEqual((llamadas[0]!.body.elementos as Json[]).map((e) => e.element_id), ["REF_01_E01"]);
  assert.deepEqual(leido.elements[0]!.appearance.armado_bouquet, lectura);
  assert.equal(mezcla.elements[0]!.appearance.armado_bouquet, undefined, "el blueprint recibido no se modifica");
  await leerArmadosReferencia(mezcla, [foto], contexto);
  assert.equal(llamadas.length, 1, "la misma foto con los mismos bouquets no se vuelve a pagar");
  ok("la lectura se guarda en su elemento y se reutiliza");

  // ---------------------------------------------------------------------------
  const fallos = instalarPython(() => new Response("caído", { status: 500 }));
  const sinLectura = await leerArmadosReferencia(mezcla, [{ ...foto, base64: Buffer.from("otra").toString("base64") }], { ...contexto, cache: crearCacheLecturaBouquet() });
  assert.equal(fallos.length, 1);
  assert.equal(sinLectura, mezcla, "un fallo deja el blueprint tal cual");
  const sinBouquets = blueprintDe([elemento("REF_01_E02", "tall column, on the left", "columna")]);
  const nadie = instalarPython(() => { throw new Error("no debía llamar"); });
  assert.equal(await leerArmadosReferencia(sinBouquets, [foto], contexto), sinBouquets);
  assert.equal(nadie.length, 0);
  ok("un fallo nunca rompe el análisis y sin bouquets no se llama");

  // ---------------------------------------------------------------------------
  const patron = { modo: "espiral", colores: ["blanco", "rosado", "blanco", "rosado"], globos_por_racimo: 4, confianza: 0.8 };
  const conPatron = blueprintDe([elemento("REF_01_E01", bouquet, "kit", { patron })]);
  const junto = conArmadosDe(conPatron, leido);
  assert.deepEqual(junto.elements[0]!.appearance.patron_color, patron);
  assert.deepEqual(junto.elements[0]!.appearance.armado_bouquet, lectura);
  assert.equal(conArmadosDe(conPatron, conPatron), conPatron);
  ok("las dos lecturas de la foto se juntan por elemento");

  // ---------------------------------------------------------------------------
  const plan = { estructuras: [{ referencia_element_id: "REF_01_E01" }, { referencia_element_id: "REF_01_E01" }, {}] } as never;
  assert.deepEqual(pistasArmadoDelPlan(plan, leido), [{ referencia_element_id: "REF_01_E01", ...lectura }]);
  assert.deepEqual(pistasArmadoDelPlan(plan, undefined), []);
  ok("pistas_armado: una por elemento de la referencia que el plan materializa");

  // ---------------------------------------------------------------------------
  const cuerpos = instalarPython(() => new Response("sin respuesta", { status: 503 }));
  const base = { plan: {} as never, allowlist: [], catalogSnapshotId: "s", requestId: "22222222-2222-4222-8222-222222222222", correlationId: "22222222-2222-4222-8222-222222222222" };
  await assert.rejects(llamarPythonPlanResolution(base));
  await assert.rejects(llamarPythonPlanResolution({ ...base, completarArmados: true, pistasArmado: [{ referencia_element_id: "REF_01_E01", ...lectura } as never] }));
  assert.ok(!("completar_armados" in cuerpos[0]!.body) && !("pistas_armado" in cuerpos[0]!.body), "sin la bandera la petición es la de siempre");
  assert.equal(cuerpos[1]!.body.completar_armados, true);
  assert.equal((cuerpos[1]!.body.pistas_armado as Json[]).length, 1);
  ok("completar_armados y pistas_armado solo viajan cuando se piden");

  console.log(`\n${casos} casos OK (armado de bouquets de la foto)`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
