import assert from "node:assert/strict";
import type { Pool } from "pg";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import { planBlueprint } from "@/lib/plan/blueprint";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { estimateFromPlan } from "@/lib/materiales/estimacion";
import { buildQaObserverPrompt, evaluateSceneQa, parseVisionObservation, qaPlanInputsFromPlan, type QaPlanInputs } from "@/lib/ia/image-qa";
import { compileLoraCaption } from "@/lib/ia/lora-caption-compiler";
import { buildImagePrompt } from "@/lib/ia/build-image-prompt";
import type { VisualContext } from "@/lib/ia/visual-context";

/**
 * Regresión I13 (2026-09-14): el QA visual aprobó una imagen que unió en un
 * solo arco las dos piezas laterales separadas del plan (semiarco a un lado,
 * columna al otro, con hueco). El observador nunca preguntaba por la
 * separación y evaluateSceneQa no tenía razón de fallo para piezas unidas.
 * Determinista y sin red: PlanDecoracion -> resolverPlan (pool simulado) ->
 * planBlueprint -> SceneSpec -> instrucción/parseo/evaluación del QA.
 * Run: npx tsx --conditions=react-server scripts/test-image-qa-piezas-separadas.ts
 */

const rows = [
  { product_id: "P-GLOBOS", variant_id: "V-R-12-ROJO", sku: "SKU-R-12-ROJO", producto_titulo: "Globo rojo", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo R-12." },
  { product_id: "P-GLOBOS", variant_id: "V-R-12-DORADO", sku: "SKU-R-12-DORADO", producto_titulo: "Globo dorado", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["dorado"], colores_variante: ["dorado"], descripcion: "Globo látex dorado metalizado R-12." },
];
// Pool simulado con la misma forma que usa scripts/test-plan-lora-e2e.ts: el resolver solo lee `rows`.
const pool = { query: async () => ({ rows }) } as unknown as Pool;
const whitelist = new Map<string, ReadonlySet<string>>([["P-GLOBOS", new Set(rows.map((row) => row.variant_id))]]);

const materiales = [
  { product_id: "P-GLOBOS", color: "rojo", participacion: 0.6, rol_material: "principal" },
  { product_id: "P-GLOBOS", color: "dorado", participacion: 0.4, rol_material: "secundario" },
];

type PlanAprobado = { escena: SceneSpec } & QaPlanInputs;

async function planAprobado(planId: string, estructuras: unknown[]): Promise<PlanAprobado> {
  const plan = PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: planId,
    concepto: { titulo: "Cumpleaños rojo y dorado", descripcion: "Piezas de globos en el salón.", paleta: ["rojo", "dorado"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras,
    supuestos: [],
  });
  const resultado = await resolverPlan(pool, plan, whitelist);
  assert.equal(resultado.sin_cobertura.length, 0, "el plan debe resolver sin huecos de cobertura");
  const blueprint = planBlueprint(resultado);
  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const escena = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajas).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((linea) => ({ id: linea.catalog_product_id, name: linea.catalog_product_id, description: "", category: "balloon", share: linea.share, role: linea.role }))])),
    materialEstimate: estimateFromPlan(resultado),
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: resultado.plan_hash,
    catalogOnly: true,
  });
  // Los datos del plan aprobado que route.ts pasa al compilador del prompt y al QA.
  return { escena, ...qaPlanInputsFromPlan(resultado.plan.estructuras) };
}

function todosPresentes(scene: SceneSpec): string[] {
  return scene.elements.map((element) => element.element_id);
}

const CONTEXTO: VisualContext = { venueKind: "indoor", lightingKind: "night", palette: ["rojo", "dorado"] };
const PROMPT_PIDE_SEPARACION = /stand apart with an open gap between them/;

/**
 * Paridad con el prompt LoRA: el QA pregunta y evalúa la separación justo
 * cuando el compilador la pidió al modelo de imagen, con los mismos datos del
 * plan aprobado. Mientras el compilador tenga su copia privada de la regla
 * (separatePiecesPhrase), esta comprobación es la que detecta que diverjan.
 */
function paridadConPrompt(caso: string, { escena, officialStructures }: PlanAprobado, pideSeparacion: boolean): void {
  for (const dialect of ["product_v007", "scene_v004"] as const) {
    const prompt = compileLoraCaption({ sceneSpec: escena, visualContext: CONTEXTO, officialStructures, dialect }).prompt;
    assert.equal(PROMPT_PIDE_SEPARACION.test(prompt), pideSeparacion, `${caso} (${dialect}): el prompt LoRA ${pideSeparacion ? "debe" : "no debe"} pedir separación: ${prompt}`);
  }
  // Mismo dueño de la regla en el camino Gemini: la cláusula del hueco abierto
  // aparece exactamente cuando el QA la va a exigir.
  const promptGemini = buildImagePrompt({ sceneSpec: escena, officialStructures });
  assert.equal(/SEPARATE SIDE PIECES:/.test(promptGemini), pideSeparacion, `${caso}: el prompt de imagen ${pideSeparacion ? "debe" : "no debe"} pedir el hueco abierto`);
  const plan = { officialStructures };
  const instruccion = buildQaObserverPrompt(escena, undefined, plan);
  assert.equal(/separate_side_pieces/.test(instruccion), pideSeparacion, `${caso}: el observador pregunta por la separación igual que el prompt`);
  const unidas = evaluateSceneQa(escena, { presentElementIds: todosPresentes(escena), sidePiecesSeparation: "merged" }, undefined, plan);
  assert.equal(unidas.pass, !pideSeparacion, `${caso}: 'merged' ${pideSeparacion ? "suspende" : "no añade criterio"}: ${JSON.stringify(unidas.retry_reasons)}`);
  assert.equal(unidas.composition.separate_side_pieces_ok, pideSeparacion ? false : undefined, caso);
}

async function main(): Promise<void> {
  // Caso de referencia: semiarco alto a la derecha, columna baja a la izquierda.
  const planSeparadas = await planAprobado("66666666-6666-4666-8666-666666666666", [
    { estructura_id: "EST_01_SEMIARCO", nombre: "Semiarco derecho", tipo: "semiarco", rol_escena: "focal", ubicacion: "lateral_derecho", medidas: { ancho_m: 1.2, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Pieza principal a un lado." },
    { estructura_id: "EST_02_COLUMNA", nombre: "Columna izquierda", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Pieza baja al otro lado, separada." },
  ]);
  const separadas = planSeparadas.escena;
  const plan: QaPlanInputs = planSeparadas;
  assert.deepEqual(todosPresentes(separadas).sort(), ["EST_01_SEMIARCO", "EST_02_COLUMNA"]);

  // 1. Si el observador ve las piezas unidas en un arco, el QA no pasa y lo explica.
  const unidas = evaluateSceneQa(separadas, { presentElementIds: todosPresentes(separadas), sidePiecesSeparation: "merged" }, undefined, plan);
  assert.equal(unidas.pass, false, `piezas separadas unidas en un arco no pueden aprobar: ${JSON.stringify(unidas.retry_reasons)}`);
  const razon = unidas.retry_reasons.find((reason) => /merged/i.test(reason));
  assert.ok(razon, `retry_reasons explica la unión: ${JSON.stringify(unidas.retry_reasons)}`);
  assert.match(razon, /EST_01_SEMIARCO/);
  assert.match(razon, /EST_02_COLUMNA/);
  assert.equal(unidas.composition.separate_side_pieces_ok, false);
  console.log("[PASS] QA: semiarco y columna unidos en un arco -> pass=false con retry_reason");

  // 2. Separadas con hueco: pasa sin razones.
  const conHueco = evaluateSceneQa(separadas, { presentElementIds: todosPresentes(separadas), sidePiecesSeparation: "separate" }, undefined, plan);
  assert.equal(conHueco.pass, true, JSON.stringify(conHueco.retry_reasons));
  assert.deepEqual(conHueco.retry_reasons, []);
  assert.equal(conHueco.composition.separate_side_pieces_ok, true);
  console.log("[PASS] QA: piezas separadas con hueco -> pass=true");

  // 3. Respuesta antigua sin el campo (o null): no evaluado. No inventa un fallo ni un acierto.
  for (const sidePiecesSeparation of [undefined, null]) {
    const sinVeredicto = evaluateSceneQa(separadas, { presentElementIds: todosPresentes(separadas), sidePiecesSeparation }, undefined, plan);
    assert.equal(sinVeredicto.pass, true, JSON.stringify(sinVeredicto.retry_reasons));
    assert.equal(sinVeredicto.composition.separate_side_pieces_ok, undefined, "ausencia de veredicto = no evaluado: el reporte no afirma la separación");
  }
  console.log("[PASS] QA: observación sin veredicto de separación -> no evaluada, sin retry_reason");

  // 4. La instrucción al observador aparece solo cuando el plan tiene piezas laterales separadas.
  const instruccion = buildQaObserverPrompt(separadas, undefined, plan);
  assert.match(instruccion, /separate_side_pieces/);
  assert.match(instruccion, /EST_01_SEMIARCO/);
  assert.match(instruccion, /EST_02_COLUMNA/);
  assert.match(instruccion, /"merged"/);
  assert.match(instruccion, /"separate"/);

  // Par simétrico (una estructura lateral con repeticiones 2): el compilador lo
  // describe como par a ambos lados, no como piezas separadas.
  const planParSimetrico = await planAprobado("77777777-7777-4777-8777-777777777777", [
    { estructura_id: "EST_01_ARCO", nombre: "Arco central", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 2.5, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Arco principal." },
    { estructura_id: "EST_02_SEMIARCOS", nombre: "Semiarcos laterales", tipo: "semiarco", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { ancho_m: 1.2, alto_m: 2.2 }, repeticiones: 2, densidad: "media", mezcla: "clasica", materiales, porque: "Enmarcan el arco a ambos lados." },
  ]);
  const parSimetrico = planParSimetrico.escena;
  assert.deepEqual(todosPresentes(parSimetrico).sort(), ["EST_01_ARCO", "EST_02_SEMIARCOS#1", "EST_02_SEMIARCOS#2"]);
  assert.doesNotMatch(buildQaObserverPrompt(parSimetrico, undefined, planParSimetrico), /separate_side_pieces/, "un par simétrico no pide confirmar piezas separadas");

  // Dos columnas distintas en lados opuestos: nunca se leen como un arco (misma regla que el compilador).
  const planDosColumnas = await planAprobado("88888888-8888-4888-8888-888888888888", [
    { estructura_id: "EST_01_COLUMNA", nombre: "Columna alta", tipo: "columna", rol_escena: "focal", ubicacion: "lateral_derecho", medidas: { alto_m: 2.4 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Columna alta." },
    { estructura_id: "EST_02_COLUMNA", nombre: "Columna baja", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Columna baja." },
  ]);
  assert.doesNotMatch(buildQaObserverPrompt(planDosColumnas.escena, undefined, planDosColumnas), /separate_side_pieces/, "dos columnas no piden confirmar separación");
  console.log("[PASS] observador: la instrucción de separación aparece solo con piezas laterales separadas");

  // 5. Sin piezas separadas en el plan, un "merged" del observador no es un criterio del plan: se ignora.
  const parUnido = evaluateSceneQa(parSimetrico, { presentElementIds: todosPresentes(parSimetrico), sidePiecesSeparation: "merged" }, undefined, planParSimetrico);
  assert.equal(parUnido.pass, true, JSON.stringify(parUnido.retry_reasons));
  assert.equal(parUnido.composition.separate_side_pieces_ok, undefined, "el reporte no trae el campo cuando el plan no lo exige");
  console.log("[PASS] QA: sin piezas separadas en el plan, la separación no se evalúa");

  // 6. Paridad con el prompt LoRA en todos los casos, incluidas las variantes
  // declaradas en `estructura_oficial`, que mandan sobre el nombre
  // (estructuras-oficiales.ts) y deciden qué laterales forman un par.
  paridadConPrompt("semiarco y columna", planSeparadas, true);
  paridadConPrompt("par simétrico", planParSimetrico, false);
  paridadConPrompt("dos columnas", planDosColumnas, false);

  // Dos semiarcos de alturas distintas (lora-run-v004-1000): no son un par, son dos piezas.
  const arcoCentral = { estructura_id: "EST_01_ARCO", nombre: "Arco central", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 2.5, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Arco principal." };
  const semiarco = { tipo: "semiarco", rol_escena: "soporte", medidas: { ancho_m: 1.2, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Pieza lateral." };
  const dosSemiarcos = await planAprobado("99999999-9999-4999-8999-999999999999", [
    arcoCentral,
    { ...semiarco, estructura_id: "EST_02_SEMIARCO", nombre: "Semiarco alto", ubicacion: "lateral_izquierdo", medidas: { ancho_m: 1.2, alto_m: 2.4 } },
    { ...semiarco, estructura_id: "EST_03_SEMIARCO", nombre: "Semiarco bajo", ubicacion: "lateral_derecho", medidas: { ancho_m: 1.0, alto_m: 1.4 } },
  ]);
  paridadConPrompt("dos semiarcos de alturas distintas", dosSemiarcos, true);
  const razonSemiarcos = evaluateSceneQa(dosSemiarcos.escena, { presentElementIds: todosPresentes(dosSemiarcos.escena), sidePiecesSeparation: "merged" }, undefined, dosSemiarcos).retry_reasons.join(" | ");
  assert.match(razonSemiarcos, /EST_02_SEMIARCO on the left and EST_03_SEMIARCO on the right/);

  // Variantes declaradas distintas con nombres neutros: el prompt las describe
  // como dos piezas; sin el mapa del plan se leerían como par simétrico.
  const variantesDistintas = await planAprobado("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [
    arcoCentral,
    { ...semiarco, estructura_id: "EST_02_SEMIARCO_IZQ", nombre: "Semiarco izquierdo", ubicacion: "lateral_izquierdo", estructura_oficial: "semiarco" },
    { ...semiarco, estructura_id: "EST_03_SEMIARCO_DER", nombre: "Semiarco derecho", ubicacion: "lateral_derecho", estructura_oficial: "semiarco_asimetrico" },
  ]);
  paridadConPrompt("variantes declaradas distintas", variantesDistintas, true);
  assert.match(buildQaObserverPrompt(variantesDistintas.escena, undefined, variantesDistintas), /EST_03_SEMIARCO_DER: [^\n]*official structure=asymmetrical one-sided curved organic balloon garland;/, "el observador recibe la variante declarada");

  // Misma variante declarada aunque un nombre diga "asimétrico": el prompt los
  // describe como par y el QA no exige un hueco que el prompt nunca pidió.
  const mismaVariante = await planAprobado("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", [
    arcoCentral,
    { ...semiarco, estructura_id: "EST_02_SEMIARCO_IZQ", nombre: "Semiarco asimétrico izquierdo", ubicacion: "lateral_izquierdo", estructura_oficial: "semiarco" },
    { ...semiarco, estructura_id: "EST_03_SEMIARCO_DER", nombre: "Semiarco derecho", ubicacion: "lateral_derecho", estructura_oficial: "semiarco" },
  ]);
  paridadConPrompt("misma variante declarada", mismaVariante, false);
  assert.match(buildQaObserverPrompt(mismaVariante.escena, undefined, mismaVariante), /EST_02_SEMIARCO_IZQ: [^\n]*official structure=one-sided curved organic balloon garland;/, "la variante declarada manda sobre el nombre");

  // Estructura repetida (`<estructura_id>#<n>`): cada instancia hereda la variante declarada.
  const parAsimetrico = await planAprobado("cccccccc-cccc-4ccc-8ccc-cccccccccccc", [
    arcoCentral,
    { ...semiarco, estructura_id: "EST_02_SEMIARCOS", nombre: "Semiarcos laterales", ubicacion: "lateral_izquierdo", repeticiones: 2, estructura_oficial: "semiarco_asimetrico" },
  ]);
  paridadConPrompt("par repetido con variante declarada", parAsimetrico, false);
  assert.match(buildQaObserverPrompt(parAsimetrico.escena, undefined, parAsimetrico), /EST_02_SEMIARCOS#2: [^\n]*official structure=asymmetrical one-sided curved organic balloon garland;/);
  // Sin los datos del plan (un caller que no los pasa), el QA no puede saber
  // si el prompt pidió la separación: no la pregunta ni la evalúa. Antes, con
  // el nombre como sustituto, "Semiarco asimétrico izquierdo" + "Semiarco
  // derecho" declarados como la misma variante pedían un hueco que el prompt
  // nunca pidió, y ese falso fallo lanzaba un retry correctivo con gasto.
  for (const [caso, { escena }] of [["misma variante declarada", mismaVariante], ["semiarco y columna", planSeparadas]] as const) {
    assert.doesNotMatch(buildQaObserverPrompt(escena), /separate_side_pieces/, `${caso}: sin datos del plan el observador no pregunta por la separación`);
    const sinPlan = evaluateSceneQa(escena, { presentElementIds: todosPresentes(escena), sidePiecesSeparation: "merged" });
    assert.equal(sinPlan.pass, true, `${caso}: sin datos del plan un 'merged' no suspende: ${JSON.stringify(sinPlan.retry_reasons)}`);
    assert.equal(sinPlan.composition.separate_side_pieces_ok, undefined, `${caso}: sin datos del plan la separación queda sin evaluar`);
  }
  console.log("[PASS] paridad: el QA pide y evalúa la separación justo cuando el prompt LoRA la pidió, con las variantes declaradas del plan");

  // 7. Cardinalidad por tipo de estructura, no por subcadena del nombre:
  // "Semiarco…" y "Marco circular…" se contaban como arcos completos ("render
  // exactly 2 arches") y el resto de tipos salían como el token interno.
  const cardinalidad = await planAprobado("dddddddd-dddd-4ddd-8ddd-dddddddddddd", [
    { estructura_id: "EST_01_SEMIARCO", nombre: "Semiarco izquierdo", tipo: "semiarco", rol_escena: "focal", ubicacion: "lateral_izquierdo", medidas: { ancho_m: 1.2, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Pieza principal a un lado." },
    { estructura_id: "EST_02_MARCO", nombre: "Marco circular de globos", tipo: "arco", rol_escena: "soporte", ubicacion: "arco_central", medidas: { ancho_m: 1.6, alto_m: 1.6 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Aro al centro." },
    { estructura_id: "EST_03_COLUMNA", nombre: "Columna derecha", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_derecho", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Columna al otro lado." },
  ]);
  const promptCardinalidad = buildImagePrompt({ sceneSpec: cardinalidad.escena, officialStructures: cardinalidad.officialStructures });
  const contrato = promptCardinalidad.split("\n").find((linea) => linea.startsWith("CARDINALITY CONTRACT"))!;
  assert.doesNotMatch(contrato, /\d+ arches/, contrato);
  assert.match(contrato, /1 half-arch/, contrato);
  assert.match(contrato, /1 circular hoop/, contrato);
  assert.match(contrato, /1 column/, contrato);
  assert.doesNotMatch(contrato, /balloon_structure/, "ningún token interno llega al modelo");
  // La forma abierta del semiarco viaja con la instancia, igual que la del arco.
  assert.match(promptCardinalidad, /one-sided half-arch rising from the floor on one side and ending in open air; never closed into a full arch/);
  // Y el semiarco a la izquierda con la columna a la derecha piden el hueco.
  assert.match(promptCardinalidad, /SEPARATE SIDE PIECES: Semiarco izquierdo on the left and Columna derecha on the right/);
  assert.doesNotMatch(promptCardinalidad, /SEPARATE SIDE PIECES:[^\n]*EST_\d/, "la cláusula usa nombres legibles, no ids");
  // Varias instancias del mismo tipo se pluralizan bien.
  const parDeSemiarcos = await planAprobado("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", [
    { estructura_id: "EST_01_SEMIARCOS", nombre: "Semiarcos laterales", tipo: "semiarco", rol_escena: "focal", ubicacion: "lateral_izquierdo", medidas: { ancho_m: 1.2, alto_m: 2.2 }, repeticiones: 2, densidad: "media", mezcla: "clasica", materiales, porque: "Uno a cada lado." },
  ]);
  assert.match(buildImagePrompt({ sceneSpec: parDeSemiarcos.escena, officialStructures: parDeSemiarcos.officialStructures }), /render exactly 2 half-arches/);
  console.log("[PASS] cardinalidad: semiarco, aro y columna se cuentan por tipo declarado, no por el nombre");

  // 8. Parseo en la frontera: campo validado en runtime y compatible con respuestas antiguas.
  assert.equal(parseVisionObservation({ separate_side_pieces: "merged" }).sidePiecesSeparation, "merged");
  assert.equal(parseVisionObservation({ separate_side_pieces: "separate" }).sidePiecesSeparation, "separate");
  assert.equal(parseVisionObservation({ separate_side_pieces: null }).sidePiecesSeparation, null);
  assert.equal(parseVisionObservation({ present_element_ids: ["EST_01_SEMIARCO"] }).sidePiecesSeparation, null, "respuesta antigua sin el campo = no evaluado");
  assert.throws(() => parseVisionObservation({ separate_side_pieces: "joined" }), "un valor fuera del enum se rechaza");
  assert.throws(() => parseVisionObservation({ separate_side_pieces: true }), "un booleano no reemplaza al enum");
  console.log("[PASS] parseo: separate_side_pieces validado (merged/separate/null) y ausente = null");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
