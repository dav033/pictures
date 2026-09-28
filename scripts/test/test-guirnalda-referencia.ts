/**
 * Lectura de las guirnaldas en la foto (ADR-0032, E4), del lado de Next.
 *
 * - `appearance.armado_guirnalda` es opcional y tiene la forma de
 *   `LecturaGuirnaldaSchema` (dueño Zod `src/lib/plan/armado-guirnalda.ts`).
 * - Se leen las guirnaldas, arcos y semiarcos aprobados; las demás piezas de
 *   globos de la foto viajan como posibles anfitrionas; un techo no se lee.
 * - El adaptador solo acepta lecturas de los elementos pedidos y anfitrionas de
 *   la misma foto; un fallo deja el blueprint intacto (el mismo objeto).
 * - Con la bandera apagada no hay llamada ni reubicación: el blueprint es el de
 *   siempre. Encendida, la ubicación de cada guirnalda se refina con su lectura
 *   y los muebles (`refinarPlacementGuirnalda`), sin tocar el prompt v16.
 * - Al confirmar, las lecturas viajan como `pistas_guirnalda` solo cuando se piden.
 *
 * Qué NO se prueba aquí: qué lee Python ni qué armado elige (eso es de
 * `estructuras/guirnalda.py` y `armado_guirnalda.py`). Offline.
 * Run: npx tsx --conditions=react-server scripts/test/test-guirnalda-referencia.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

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

async function silencioso<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.warn;
  console.warn = () => undefined;
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

async function main(): Promise<void> {
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  const { LecturaGuirnaldaSchema } = await import("../../src/lib/plan/armado-guirnalda");
  const { crearCacheLecturaGuirnalda, conGuirnaldasDe, elementosGuirnalda, leerGuirnaldasReferencia } = await import("../../src/lib/ia/amaterasu/guirnalda-referencia");
  const { leerLecturasDeFoto } = await import("../../src/lib/ia/amaterasu/lecturas-foto");
  const { refinarPlacementGuirnalda, reubicarGuirnaldas } = await import("../../src/lib/ia/referencia/reference-structure");
  const { llamarPythonPlanResolution } = await import("../../src/lib/ia/nucleo/python-adapter");
  const { pistasGuirnaldaDelPlan } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  type Blueprint = import("../../src/lib/ia/referencia/reference-blueprint").ReferenceBlueprintV2;

  const lectura = {
    soporte: "mesa", forma: "ondulada", racimos_visibles: 12, unidad_racimo: "cuarteto",
    colores_por_racimo: ["rosado", "blanco"], relleno: { color: "blanco", proporcion: 0.2 },
    remates: [{ clase: "latex", color: "dorado", posicion: "extremo_izq" }], confianza: 0.8,
  } as const;
  type Extra = { tipo?: string; ubicacion?: string; categoria?: string; nombre?: string; bbox?: Json; lectura?: Json; imagen?: string; approved?: boolean };
  const elemento = (id: string, extra: Extra = {}) => ({
    element_id: id, source_image_id: extra.imagen ?? "REF_01", name: extra.nombre ?? `pieza ${id}`, category: extra.categoria ?? "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "pieza",
    reference_bbox: extra.bbox ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }, depth_layer: 1,
    include_policy: "include", approved: extra.approved ?? true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    ...(extra.tipo ? { visual_semantics: { structure_type: extra.tipo, placement: extra.ubicacion ?? "fondo_pared", design_role: "focal", repetition_group: id, density: "media" } } : {}),
    appearance: {
      observed_colors: ["pink", "white"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "piece", composition: "mixed",
      ...(extra.lectura ? { armado_guirnalda: extra.lectura } : {}),
    },
    relationships: [], uncertainties: [],
  });
  const blueprintDe = (elementos: unknown[], imagenes = ["REF_01"]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: imagenes.map((image_id) => ({ image_id, approved_roles: ["composition_reference"] })),
    elements: elementos,
    composition: { focal_point: "pieza", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: ["pink", "white"], priority: ["pink", "white"] },
    unresolved_decisions: [],
  });

  // ---------------------------------------------------------------------------
  assert.deepEqual(LecturaGuirnaldaSchema.parse(lectura), lectura);
  for (const malo of [{ ...lectura, soporte: "techo" }, { ...lectura, caida_m: 0.4 }, { ...lectura, relleno: { color: "blanco", proporcion: 0.7 } }, { ...lectura, colores_por_racimo: ["a", "b", "c", "d", "e", "f"] }]) {
    assert.equal(LecturaGuirnaldaSchema.safeParse(malo).success, false, JSON.stringify(malo));
  }
  assert.deepEqual(blueprintDe([elemento("REF_01_E01", { tipo: "guirnalda", lectura })]).elements[0]!.appearance.armado_guirnalda, lectura);
  const contrato = JSON.parse(readFileSync(path.join(process.cwd(), "contracts/domain/v1/reference-blueprint.schema.json"), "utf8")) as Json;
  assert.match(JSON.stringify(contrato), /"armado_guirnalda"/, "la forma viaja en reference-blueprint.v2 para Python");
  ok("lectura-guirnalda: forma propia, sin caída, opcional en el blueprint y exportada");

  // ---------------------------------------------------------------------------
  const mezcla = blueprintDe([
    elemento("REF_01_E01", { tipo: "guirnalda" }),
    elemento("REF_01_E02", { tipo: "arco", ubicacion: "arco_central" }),
    elemento("REF_01_E03", { tipo: "columna", ubicacion: "lateral_izquierdo" }),
    elemento("REF_01_E04", { tipo: "guirnalda", ubicacion: "techo" }),
    elemento("REF_01_E05", { tipo: "guirnalda", approved: false }),
    elemento("REF_02_E01", { tipo: "columna", imagen: "REF_02" }),
  ], ["REF_01", "REF_02"]);
  const porFoto = elementosGuirnalda(mezcla);
  assert.deepEqual([...porFoto.keys()], ["REF_01"], "una foto sin guirnaldas, arcos ni semiarcos no se lee");
  assert.deepEqual(porFoto.get("REF_01")!.elementos.map((e) => e.elementId), ["REF_01_E01", "REF_01_E02"]);
  assert.deepEqual(porFoto.get("REF_01")!.otras.map((o) => [o.elementId, o.tipo]), [["REF_01_E03", "columna"], ["REF_01_E04", "guirnalda"]]);
  ok("se leen guirnaldas, arcos y semiarcos; el resto viaja como posible anfitriona; un techo no se lee");

  // ---------------------------------------------------------------------------
  const foto = { id: "REF_01", mime: "image/png", base64: Buffer.from("foto").toString("base64") } as never;
  const contexto = { requestId: "33333333-3333-4333-8333-333333333333", correlationId: "44444444-4444-4444-8444-444444444444", cache: crearCacheLecturaGuirnalda() };
  const llamadas = instalarPython((llamada) => sobre(llamada, {
    operation_schema_version: "guirnalda-referencia-result.v1",
    lecturas: [{ element_id: "REF_01_E01", ...lectura }],
    modelo: "gemini-test", prompt_version: "guirnalda-referencia.v1:test", usage: null,
  }));
  const leido = await leerGuirnaldasReferencia(mezcla, [foto], contexto);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]!.path, "/internal/v1/ia/guirnalda-referencia");
  assert.deepEqual((llamadas[0]!.body.otras as Json[]).map((o) => o.element_id), ["REF_01_E03", "REF_01_E04"]);
  assert.deepEqual(leido.elements[0]!.appearance.armado_guirnalda, lectura);
  assert.equal(mezcla.elements[0]!.appearance.armado_guirnalda, undefined, "el blueprint recibido no se modifica");
  await leerGuirnaldasReferencia(mezcla, [foto], contexto);
  assert.equal(llamadas.length, 1, "la misma foto con las mismas piezas no se vuelve a pagar");
  ok("la lectura se guarda en su elemento y se reutiliza");

  // ---------------------------------------------------------------------------
  instalarPython((llamada) => sobre(llamada, {
    operation_schema_version: "guirnalda-referencia-result.v1",
    lecturas: [{ element_id: "REF_01_E01", ...lectura, soporte: "sobre_estructura", anfitriona_element_id: "REF_09_E09" }],
    modelo: "gemini-test", prompt_version: "guirnalda-referencia.v1:test", usage: null,
  }));
  const ajena = await silencioso(() => leerGuirnaldasReferencia(mezcla, [foto], { ...contexto, cache: crearCacheLecturaGuirnalda() }));
  assert.equal(ajena, mezcla, "una anfitriona que no es de la foto invalida la respuesta y el blueprint sale tal cual");
  // Revisión 6/13: un arco que también se lee (va en elementos, no en otras) puede ser la anfitriona; la propia guirnalda, no.
  instalarPython((llamada) => sobre(llamada, {
    operation_schema_version: "guirnalda-referencia-result.v1",
    lecturas: [{ element_id: "REF_01_E01", ...lectura, soporte: "sobre_estructura", anfitriona_element_id: "REF_01_E02" }],
    modelo: "gemini-test", prompt_version: "guirnalda-referencia.v1:test", usage: null,
  }));
  const sobreArco = await silencioso(() => leerGuirnaldasReferencia(mezcla, [foto], { ...contexto, cache: crearCacheLecturaGuirnalda() }));
  assert.equal(sobreArco.elements[0]!.appearance.armado_guirnalda?.anfitriona_element_id, "REF_01_E02", "el arco de elementos es una anfitriona válida");
  instalarPython((llamada) => sobre(llamada, {
    operation_schema_version: "guirnalda-referencia-result.v1",
    lecturas: [{ element_id: "REF_01_E01", ...lectura, soporte: "sobre_estructura", anfitriona_element_id: "REF_01_E01" }],
    modelo: "gemini-test", prompt_version: "guirnalda-referencia.v1:test", usage: null,
  }));
  assert.equal(await silencioso(() => leerGuirnaldasReferencia(mezcla, [foto], { ...contexto, cache: crearCacheLecturaGuirnalda() })), mezcla, "la propia guirnalda no es su anfitriona");
  const fallos = instalarPython(() => new Response("caído", { status: 500 }));
  assert.equal(await silencioso(() => leerGuirnaldasReferencia(mezcla, [foto], { ...contexto, cache: crearCacheLecturaGuirnalda() })), mezcla);
  assert.equal(fallos.length, 1);
  const nadie = instalarPython(() => { throw new Error("no debía llamar"); });
  const sinGuirnaldas = blueprintDe([elemento("REF_01_E03", { tipo: "columna" })]);
  assert.equal(await leerGuirnaldasReferencia(sinGuirnaldas, [foto], contexto), sinGuirnaldas);
  assert.equal(nadie.length, 0);
  ok("un fallo o una respuesta ajena nunca rompen el análisis y sin guirnaldas no se llama");

  // ---------------------------------------------------------------------------
  const apagada = instalarPython(() => { throw new Error("no debía llamar"); });
  const banderasApagadas = { patron: false, bouquet: false, conteo: false };
  assert.equal(await leerLecturasDeFoto(mezcla, [foto], contexto, banderasApagadas), mezcla, "apagada: el mismo objeto");
  assert.equal(await leerLecturasDeFoto(mezcla, [foto], contexto, { ...banderasApagadas, guirnalda: false }), mezcla);
  assert.equal(apagada.length, 0);
  instalarPython((llamada) => sobre(llamada, {
    operation_schema_version: "guirnalda-referencia-result.v1",
    lecturas: [{ element_id: "REF_01_E01", ...lectura }],
    modelo: "gemini-test", prompt_version: "guirnalda-referencia.v1:test", usage: null,
  }));
  const encendida = await leerLecturasDeFoto(mezcla, [foto], { ...contexto, sinCache: true }, { ...banderasApagadas, guirnalda: true });
  assert.deepEqual(encendida.elements[0]!.appearance.armado_guirnalda, lectura);
  assert.equal(encendida.elements[0]!.visual_semantics?.placement, "sobre_mesa_principal", "la lectura dice mesa");
  assert.equal(encendida.elements[1]!.visual_semantics?.placement, "arco_central", "un arco no se reubica");
  assert.deepEqual(conGuirnaldasDe(mezcla, encendida).elements[0]!.appearance.armado_guirnalda, lectura);
  ok("apagada no llama ni reubica; encendida guarda la lectura y refina la ubicación de las guirnaldas");

  // ---------------------------------------------------------------------------
  const abajo = { x: 0.1, y: 0.8, width: 0.8, height: 0.15 };
  const pasillo = { x: 0.3, y: 0.4, width: 0.3, height: 0.6 };
  const mesa = { bbox: { x: 0.2, y: 0.6, width: 0.6, height: 0.3 }, mesa: true };
  const sofa = { bbox: { x: 0.1, y: 0.4, width: 0.5, height: 0.4 }, mesa: false };
  assert.equal(refinarPlacementGuirnalda("fondo_pared", abajo, [], "mesa"), "sobre_mesa_principal");
  assert.equal(refinarPlacementGuirnalda("fondo_pared", abajo, [], "piso"), "piso_frontal");
  assert.equal(refinarPlacementGuirnalda("arco_central", pasillo, [], "piso"), "recorrido_suelo");
  assert.equal(refinarPlacementGuirnalda("recorrido_suelo", abajo, [], "piso"), "recorrido_suelo");
  assert.equal(refinarPlacementGuirnalda("piso_frontal", abajo, [], "pared"), "fondo_pared");
  assert.equal(refinarPlacementGuirnalda("lateral_izquierdo", abajo, [], "pared"), "lateral_izquierdo");
  assert.equal(refinarPlacementGuirnalda("fondo_pared", { x: 0.25, y: 0.5, width: 0.5, height: 0.15 }, [mesa]), "sobre_mesa_principal", "sobre una mesa detectada");
  assert.equal(refinarPlacementGuirnalda("fondo_pared", { x: 0.1, y: 0.45, width: 0.4, height: 0.3 }, [sofa]), "alrededor_mobiliario");
  assert.equal(refinarPlacementGuirnalda("fondo_pared", { x: 0.1, y: 0.05, width: 0.8, height: 0.2 }, [mesa, sofa]), "fondo_pared", "lejos de los muebles no cambia");
  assert.equal(refinarPlacementGuirnalda("techo", abajo, [mesa], "mesa"), "techo");
  const conMuebles = blueprintDe([
    elemento("REF_01_E01", { tipo: "guirnalda", bbox: { x: 0.25, y: 0.5, width: 0.5, height: 0.15 } }),
    elemento("REF_01_E02", { categoria: "furniture", nombre: "dessert table", bbox: mesa.bbox }),
    elemento("REF_01_E03", { tipo: "guirnalda", lectura: { ...lectura, soporte: "piso", confianza: 0.3 } }),
  ]);
  const reubicado = reubicarGuirnaldas(conMuebles);
  assert.equal(reubicado.elements[0]!.visual_semantics?.placement, "sobre_mesa_principal");
  assert.equal(reubicado.elements[2]!.visual_semantics?.placement, "fondo_pared", "una lectura dudosa no manda");
  const quieto = blueprintDe([elemento("REF_01_E01", { tipo: "guirnalda" })]);
  assert.equal(reubicarGuirnaldas(quieto), quieto, "sin cambios, el mismo objeto");
  ok("placement de guirnaldas: soporte leído, mesa detectada, muebles, recorrido de piso");

  // ---------------------------------------------------------------------------
  const plan = { estructuras: [{ referencia_element_id: "REF_01_E01" }, { referencia_element_id: "REF_01_E01" }, { referencia_element_id: "REF_01_E03" }, {}] } as never;
  assert.deepEqual(pistasGuirnaldaDelPlan(plan, leido), [{ referencia_element_id: "REF_01_E01", ...lectura }]);
  assert.deepEqual(pistasGuirnaldaDelPlan(plan, undefined), []);
  const cuerpos = instalarPython(() => new Response("sin respuesta", { status: 503 }));
  const base = { plan: {} as never, allowlist: [], catalogSnapshotId: "s", requestId: "22222222-2222-4222-8222-222222222222", correlationId: "22222222-2222-4222-8222-222222222222" };
  await assert.rejects(llamarPythonPlanResolution(base));
  await assert.rejects(llamarPythonPlanResolution({ ...base, completarArmadosGuirnalda: true, pistasGuirnalda: [{ referencia_element_id: "REF_01_E01", ...lectura }] as never }));
  assert.ok(!("pistas_guirnalda" in cuerpos[0]!.body), "sin la bandera la petición es la de siempre");
  assert.equal((cuerpos[1]!.body.pistas_guirnalda as Json[]).length, 1);
  ok("pistas_guirnalda: una por elemento que el plan materializa, y solo viaja cuando se pide");

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
