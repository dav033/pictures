/**
 * La línea de la guirnalda que lee la foto llega entera al motor (ADR-0032, decisiones 27 a 29), del lado de Next.
 *
 * El caso que lo abrió: la foto del 2026-09-28 (`SEGUIMIENTO-guirnaldas.md`, «Lectura v4»), una guirnalda en la
 * pared arqueada hacia arriba 0,107 del largo y con el extremo derecho 0,335 del largo más bajo. `pistasCurvaDelPlan`
 * solo mandaba el sentido y la flecha, así que el desnivel no llegaba y la guirnalda salía nivelada.
 *
 * - `pistasCurvaDelPlan` manda la lectura con su forma, su soporte, sus anclajes, el sentido y la flecha, el desnivel
 *   y la confianza; lo que la lectura no distingue (`null`) no viaja, y la caída de una lectura v2 solo viaja sin
 *   sentido ni flecha.
 * - Una lectura sin curva también viaja: su soporte (piso, mesa) es lo que decide a qué altura arma el motor la línea.
 * - Solo los elementos aprobados, una por elemento, y nada sin blueprint.
 * - El adaptador (`llamarPythonOmoikaneCompletarArmados`) lleva cada campo tal cual en `curvas` del cuerpo.
 * - La guía de escena apoya en el piso la guirnalda que el plan tiende en el piso (antes la centraba en su caja).
 *
 * Qué NO se prueba aquí: cómo traduce Python la lectura a la línea del motor ni la altura de cada soporte; eso es de
 * `services/ai-api/tests/test_organico_posiciones.py`. Offline, sin proveedores.
 * Run: npx tsx --conditions=react-server scripts/test/test-pistas-curva-desnivel.ts
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
  const { pistasCurvaDelPlan } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const { llamarPythonOmoikaneCompletarArmados, PYTHON_OMOIKANE_ARMADO_PATH } = await import("../../src/lib/ia/nucleo/python-adapter");
  const { instanciasDeEscena } = await import("../../src/lib/ia/kagutsuchi/guia-escena");
  const { casoArcoPatron } = await import("../lib/escenas-guia-estructura");
  type Blueprint = import("../../src/lib/ia/referencia/reference-blueprint").ReferenceBlueprintV2;
  type EstructuraPlan = import("../../src/lib/plan/resuelto").PlanResuelto["plan"]["estructuras"][number];

  /** La lectura v4 de la foto del 2026-09-28, ya validada por Python (sentido, flecha y desnivel calculados). */
  const LECTURA_DE_LA_FOTO = {
    soporte: "pared", forma: "curva", puntos_de_anclaje: 3,
    sentido_curva: "arriba", flecha_relativa: 0.107, desnivel_relativo: -0.335,
    racimos_visibles: 12, unidad_racimo: "cuarteto", colores_por_racimo: ["blanco", "dorado"],
    relleno: null, remates: [], confianza: 0.92,
  };

  const elemento = (id: string, lectura: Json | undefined, approved = true) => ({
    element_id: id, source_image_id: "REF_01", name: `guirnalda ${id}`, category: "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "guirnalda",
    reference_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }, depth_layer: 1,
    include_policy: "include", approved, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    visual_semantics: { structure_type: "guirnalda", placement: "fondo_pared", design_role: "focal", repetition_group: id, density: "media" },
    appearance: {
      observed_colors: ["white", "gold"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "garland", composition: "mixed",
      ...(lectura ? { armado_guirnalda: lectura } : {}),
    },
    relationships: [], uncertainties: [],
  });
  const blueprintDe = (elementos: unknown[]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: elementos,
    composition: { focal_point: "guirnalda", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: ["white", "gold"], priority: ["white", "gold"] },
    unresolved_decisions: [],
  });
  // `pistasCurvaDelPlan` solo lee `referencia_element_id` de cada estructura.
  const planDe = (...ids: Array<string | undefined>) => ({ estructuras: ids.map((id) => (id ? { referencia_element_id: id } : {})) }) as never;

  // ---------------------------------------------------------------------------
  const conFoto = blueprintDe([elemento("REF_01_E01", LECTURA_DE_LA_FOTO)]);
  const [delCaso] = pistasCurvaDelPlan(planDe("REF_01_E01"), conFoto);
  assert.deepEqual(delCaso, {
    referencia_element_id: "REF_01_E01",
    soporte: "pared",
    forma: "curva",
    confianza: 0.92,
    puntos_de_anclaje: 3,
    sentido: "arriba",
    flecha: 0.107,
    desnivel: -0.335,
  });
  ok("el caso de la foto: viajan la forma, el soporte, los anclajes, la curva y el desnivel de los extremos");

  // ---------------------------------------------------------------------------
  const sinCurva = { ...LECTURA_DE_LA_FOTO, sentido_curva: null, flecha_relativa: null };
  assert.deepEqual(pistasCurvaDelPlan(planDe("REF_01_E01"), blueprintDe([elemento("REF_01_E01", sinCurva)])), [
    { referencia_element_id: "REF_01_E01", soporte: "pared", forma: "curva", confianza: 0.92, puntos_de_anclaje: 3, desnivel: -0.335 },
  ], "sin curva distinguible, el desnivel viaja solo");
  const delPiso = { ...LECTURA_DE_LA_FOTO, soporte: "piso", forma: "recta", sentido_curva: null, flecha_relativa: null, desnivel_relativo: null };
  assert.deepEqual(pistasCurvaDelPlan(planDe("REF_01_E01"), blueprintDe([elemento("REF_01_E01", delPiso)])), [
    { referencia_element_id: "REF_01_E01", soporte: "piso", forma: "recta", confianza: 0.92, puntos_de_anclaje: 3 },
  ], "una guirnalda del piso sin curva también viaja: su soporte decide la altura de la línea");
  // Una lectura v2: sin las claves del sentido y de la flecha (y sin anclajes), con su caída.
  const v2: Json = { ...LECTURA_DE_LA_FOTO, forma: "recta", caida_relativa: 0.2, desnivel_relativo: -0.25 };
  for (const clave of ["sentido_curva", "flecha_relativa", "puntos_de_anclaje"]) delete v2[clave];
  assert.deepEqual(pistasCurvaDelPlan(planDe("REF_01_E01"), blueprintDe([elemento("REF_01_E01", v2)])), [
    { referencia_element_id: "REF_01_E01", soporte: "pared", forma: "recta", confianza: 0.92, desnivel: -0.25, caida: 0.2 },
  ], "una lectura v2 (sin las claves del sentido ni de la flecha) manda su caída");
  const v3ConCaida = { ...LECTURA_DE_LA_FOTO, caida_relativa: 0.2 };
  assert.ok(!("caida" in pistasCurvaDelPlan(planDe("REF_01_E01"), blueprintDe([elemento("REF_01_E01", v3ConCaida)]))[0]!), "con sentido y flecha, la caída vieja no viaja");
  ok("lo que la lectura no distingue no viaja; la caída de una v2 nunca va con el sentido ni la flecha");

  // ---------------------------------------------------------------------------
  const mezcla = blueprintDe([elemento("REF_01_E01", LECTURA_DE_LA_FOTO), elemento("REF_01_E02", LECTURA_DE_LA_FOTO, false), elemento("REF_01_E03", undefined)]);
  assert.deepEqual(pistasCurvaDelPlan(planDe("REF_01_E01", "REF_01_E01", "REF_01_E02", "REF_01_E03", undefined), mezcla).map((pista) => pista.referencia_element_id), ["REF_01_E01"]);
  assert.deepEqual(pistasCurvaDelPlan(planDe("REF_01_E01"), undefined), []);
  ok("una pista por elemento aprobado con lectura, y ninguna sin blueprint");

  // ---------------------------------------------------------------------------
  const llamadas = instalarPython((llamada) => sobre(llamada, { operation_schema_version: "omoikane-armado-estructura-result.v1", accion: "completar", armados: [] }));
  const curvas = pistasCurvaDelPlan(planDe("REF_01_E01"), conFoto);
  const respuesta = await llamarPythonOmoikaneCompletarArmados({
    plan: { estructuras: [] } as never,
    curvas,
    requestId: "11111111-1111-4111-8111-111111111111",
    correlationId: "11111111-1111-4111-8111-111111111111",
  });
  assert.deepEqual(respuesta.armados, []);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]!.path, PYTHON_OMOIKANE_ARMADO_PATH);
  const cuerpo = (llamadas[0]!.body.payload ?? llamadas[0]!.body) as Json;
  const enviadas = cuerpo.curvas as Json[];
  assert.deepEqual(enviadas, [{ ...delCaso }], "el cuerpo lleva la lectura tal cual, con el desnivel");
  assert.equal(enviadas[0]!.desnivel, -0.335);
  ok("el adaptador lleva cada campo de la línea a Python, el desnivel incluido");

  // ---------------------------------------------------------------------------
  const base = casoArcoPatron().plan.plan.estructuras[0]!;
  const guirnalda = (ubicacion: string): EstructuraPlan => ({ ...base, estructura_id: `EST_${ubicacion}`, tipo: "guirnalda", ubicacion, repeticiones: 1 }) as EstructuraPlan;
  const apoyos = Object.fromEntries(["piso_frontal", "recorrido_suelo", "fondo_pared", "sobre_mesa_principal"].map((ubicacion) => [ubicacion, instanciasDeEscena([guirnalda(ubicacion)], undefined)[0]!.apoyo]));
  assert.deepEqual(apoyos, { piso_frontal: "piso", recorrido_suelo: "piso", fondo_pared: "pared", sobre_mesa_principal: "pared" });
  ok("la guía de escena apoya en el piso la guirnalda del piso; la de la pared y la de la mesa siguen centradas");

  console.log(`\n${casos} casos ok`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
