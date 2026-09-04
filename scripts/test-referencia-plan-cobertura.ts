import assert from "node:assert/strict";
import { construirSistema, serializeReferenceBlueprint } from "@/lib/ia/prompt-sistema";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { construirCoberturaReferencia } from "@/lib/plan/desglose";
import { validarCoberturaReferencia } from "@/lib/plan/restricciones";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { ALCANCE_POR_CATEGORIA_REFERENCIA } from "@/lib/rag/taxonomy/alcance-referencia";

/**
 * R2 (blueprint → prompt del chat) + R4 (cobertura referencia→plan). Sin
 * base de datos: prueba pura de serialización y validación.
 */

const blueprint: ReferenceBlueprintV2 = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [
    {
      element_id: "REF_01_E01", source_image_id: "REF_01", name: "cortina de fondo dorada", category: "curtain",
      scene_role: "backdrop", detection_confidence: 0.9, visible_evidence: "cortina metalizada",
      reference_bbox: { x: 0.1, y: 0.05, width: 0.7, height: 0.8 }, depth_layer: 1,
      include_policy: "include", approved: true, source_type: "reference_only",
      quantity: { mode: "approximate", min: 1, max: 1 },
      appearance: { observed_colors: ["dorado"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "tela metalizada", shape: "cortina", composition: "single uniform material" },
      relationships: [], uncertainties: [],
      model_decision: { action: "include", match_type: "none", reason: "relevante", adaptation: "sin catalogo en este modo" },
    },
    {
      element_id: "REF_01_E02", source_image_id: "REF_01", name: "arco de globos", category: "balloon_structure",
      scene_role: "midground", detection_confidence: 0.85, visible_evidence: "arco al frente",
      reference_bbox: { x: 0.15, y: 0.2, width: 0.6, height: 0.5 }, depth_layer: 2,
      include_policy: "include", approved: true, source_type: "reference_only",
      quantity: { mode: "exact", min: 80, max: 80 },
      appearance: { observed_colors: ["rojo", "dorado"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "arco", composition: "70% rojo, 30% dorado" },
      relationships: [{ type: "in_front_of", target_element_id: "REF_01_E01" }], uncertainties: [],
      model_decision: { action: "include", match_type: "none", reason: "relevante", adaptation: "sin catalogo en este modo" },
    },
    {
      // No aprobado: no debe exigirse cobertura de este elemento.
      element_id: "REF_01_E03", source_image_id: "REF_01", name: "silla suelta al fondo", category: "furniture",
      scene_role: "accent", detection_confidence: 0.3, visible_evidence: "silla desenfocada",
      reference_bbox: { x: 0.02, y: 0.02, width: 0.1, height: 0.1 }, depth_layer: 3,
      include_policy: "exclude", approved: false, source_type: "reference_only",
      quantity: { mode: "approximate", min: 1, max: 1 },
      appearance: { observed_colors: ["negro"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "no determinable", shape: "no determinable", composition: "single uniform material" },
      relationships: [], uncertainties: [],
      model_decision: { action: "omit", match_type: "none", reason: "irrelevante", adaptation: "omitir" },
    },
  ],
  composition: { focal_point: "arco con cortina de fondo", density: "moderate", symmetry: "symmetric", negative_space: ["piso frontal"] },
  palette: { observed: ["dorado", "rojo"], priority: ["dorado", "rojo"] },
  unresolved_decisions: [],
});

function planBase(overrides: Partial<{ estructuras: PlanDecoracion["estructuras"]; referencia_omitida: PlanDecoracion["referencia_omitida"] }>): PlanDecoracion {
  return PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "00000000-0000-0000-0000-000000000000",
    concepto: { titulo: "Boda dorada", descripcion: "arco con cortina", paleta: ["dorado", "rojo"] },
    espacio: { tipo: "salon", fuente: "supuesto" },
    estructuras: overrides.estructuras ?? [
      {
        estructura_id: "EST_01_ARCO", nombre: "Arco central", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central",
        medidas: { ancho_m: 3, alto_m: 2.5 }, densidad: "media", mezcla: "clasica",
        materiales: [{ product_id: "prod-1", participacion: 1, rol_material: "principal" }],
        porque: "focal del evento", referencia_element_id: "REF_01_E02",
      },
    ],
    supuestos: [],
    referencia_omitida: overrides.referencia_omitida ?? [],
  });
}

function run() {
  // --- R2: serialización determinista y bloque del prompt ---
  const serializado1 = serializeReferenceBlueprint(blueprint);
  const serializado2 = serializeReferenceBlueprint(blueprint);
  assert.equal(serializado1, serializado2, "la serialización debe ser determinista");
  assert.ok(serializado1.includes("REF_01_E01"), "debe listar el elemento aprobado 1");
  assert.ok(serializado1.includes("REF_01_E02"), "debe listar el elemento aprobado 2");
  assert.ok(!serializado1.includes("REF_01_E03"), "no debe listar elementos no aprobados");

  // BLOQUE_PLAN menciona "ANALISIS_REFERENCIA_VISUAL" de pasada (explicando
  // cuándo aplica referencia_element_id) — el encabezado completo con
  // "(presente en este turno)" solo lo agrega bloqueReferencia() de verdad.
  const encabezadoBloque = "ANALISIS_REFERENCIA_VISUAL (presente en este turno)";

  const sistemaConPlanYReferencia = construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: true, referenceBlueprint: blueprint });
  assert.ok(sistemaConPlanYReferencia.includes(encabezadoBloque), "el bloque debe aparecer con plan activo + blueprint");
  assert.ok(sistemaConPlanYReferencia.includes("REF_01_E02"), "el bloque debe incluir los element_id reales");

  const sistemaSinPlan = construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: false, referenceBlueprint: blueprint });
  assert.ok(!sistemaSinPlan.includes(encabezadoBloque), "sin modo plan, el bloque nunca debe aparecer (auto-gateado)");

  const sistemaSinBlueprint = construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: true });
  assert.equal(sistemaSinBlueprint, construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: true }), "sin blueprint, el prompt es estable");
  assert.ok(!sistemaSinBlueprint.includes(encabezadoBloque), "sin blueprint no debe aparecer el bloque");

  console.log("[PASS] R2 — blueprint serializado de forma determinista y auto-gateado al modo plan");

  // --- R4: cobertura completa ---
  const planCompleto = planBase({
    referencia_omitida: [{ element_id: "REF_01_E01", motivo: "la cortina no tiene equivalente real en catálogo", motivo_tipo: "emulacion_propuesta", propuesta: "plano vertical de globos en dorado" }],
  });
  assert.deepEqual(validarCoberturaReferencia(planCompleto, blueprint), [], "cobertura completa: estructura + omisión declarada");

  // --- R4: cobertura incompleta (nada cubre la cortina) ---
  const planIncompleto = planBase({});
  assert.deepEqual(validarCoberturaReferencia(planIncompleto, blueprint), ["REF_01_E01"], "debe reportar el elemento sin cubrir");

  // --- R4: sin blueprint, no hay nada que validar ---
  assert.deepEqual(validarCoberturaReferencia(planIncompleto, undefined), [], "sin blueprint, la validación es un no-op");

  // --- R4: elemento no aprobado nunca exige cobertura ---
  const planSinMencionarNoAprobado = planBase({
    referencia_omitida: [{ element_id: "REF_01_E01", motivo: "sin equivalente", motivo_tipo: "emulacion_rechazada" }],
  });
  assert.deepEqual(validarCoberturaReferencia(planSinMencionarNoAprobado, blueprint), [], "el elemento no aprobado (REF_01_E03) nunca debe exigirse");

  console.log("[PASS] R4 — cobertura referencia→plan (completa, incompleta, no-op sin blueprint, ignora no-aprobados)");

  const pendiente = construirCoberturaReferencia(blueprint);
  assert.ok(pendiente.elementos.every((elemento) => elemento.estado === "pendiente"), "sin plan todos los elementos quedan pendientes");
  assert.equal(pendiente.elementos[0]?.alcance, "emulable", "cortina expone alcance emulable");
  assert.equal(ALCANCE_POR_CATEGORIA_REFERENCIA.furniture.alcance, "fuera_de_catalogo");

  const planResuelto = {
    plan: planCompleto,
    estructuras: [{
      estructura_id: "EST_01_ARCO",
      nombre: "Arco central",
      lineas: [{ variant_id: "V-1" }, { variant_id: "V-2" }, { variant_id: "V-1" }],
    }],
  } as unknown as PlanResuelto;
  const cobertura = construirCoberturaReferencia(blueprint, planResuelto);
  assert.deepEqual(cobertura.elementos[0], {
    elementId: "REF_01_E01",
    nombre: "cortina de fondo dorada",
    categoria: "curtain",
    alcance: "emulable",
    estado: "emulable_pendiente",
    variantIds: [],
    motivo: "la cortina no tiene equivalente real en catálogo",
    motivoTipo: "emulacion_propuesta",
    propuesta: "plano vertical de globos en dorado",
  });
  assert.deepEqual(cobertura.elementos[1], {
    elementId: "REF_01_E02",
    nombre: "arco de globos",
    categoria: "balloon_structure",
    alcance: "cubierto",
    estado: "incluido",
    estructuraId: "EST_01_ARCO",
    estructuraNombre: "Arco central",
    variantIds: ["V-1", "V-2"],
  });
  assert.equal(cobertura.elementos[2]?.estado, "pendiente", "un elemento no resuelto queda pendiente");

  // B2: una emulación propuesta exige explicar qué se construye.
  assert.throws(() => planBase({
    referencia_omitida: [{ element_id: "REF_01_E01", motivo: "se puede reinterpretar", motivo_tipo: "emulacion_propuesta" }],
  }), /emulación propuesta/i);

  // B2/B3: una categoría fuera de catálogo no puede declararse cubierta por
  // una estructura aunque el modelo intente asignarle referencia_element_id.
  const blueprintConMuebleAprobado = ReferenceBlueprintV2Schema.parse({
    ...blueprint,
    elements: blueprint.elements.map((element) => element.element_id === "REF_01_E03"
      ? { ...element, approved: true, include_policy: "include" as const }
      : element),
  });
  const planConMuebleCubierto = planBase({
    referencia_omitida: [{ element_id: "REF_01_E01", motivo: "se ofrece reinterpretación", motivo_tipo: "emulacion_propuesta", propuesta: "plano vertical de globos" }],
    estructuras: [
      ...planBase({}).estructuras,
      {
        estructura_id: "EST_02_KIT",
        nombre: "Mobiliario inventado",
        tipo: "kit",
        rol_escena: "soporte",
        ubicacion: "lateral_izquierdo",
        medidas: {},
        repeticiones: 1,
        densidad: "sencilla",
        mezcla: "clasica",
        materiales: [{ product_id: "prod-kit", variant_id: "var-kit", participacion: 1, rol_material: "principal" }],
        unidades_declaradas: 1,
        porque: "prueba de rechazo",
        referencia_element_id: "REF_01_E03",
      },
    ],
  });
  assert.deepEqual(validarCoberturaReferencia(planConMuebleCubierto, blueprintConMuebleAprobado), ["REF_01_E03"]);

  const planConCortinaIncluida = planBase({
    referencia_omitida: [{ element_id: "REF_01_E02", motivo: "se deja como decisión posterior", motivo_tipo: "decision_de_diseno" }],
    estructuras: [{ ...planBase({}).estructuras[0]!, referencia_element_id: "REF_01_E01" }],
  });
  assert.deepEqual(validarCoberturaReferencia(planConCortinaIncluida, blueprint), ["REF_01_E01"]);

  // `fuera_de_catalogo` solo es honesto cuando el mapa lo confirma.
  const planCortinaFueraCatalogo = planBase({
    referencia_omitida: [{ element_id: "REF_01_E01", motivo: "no se vende", motivo_tipo: "fuera_de_catalogo" }],
  });
  assert.deepEqual(validarCoberturaReferencia(planCortinaFueraCatalogo, blueprint), ["REF_01_E01"]);
  console.log("[PASS] cobertura derivada — pendiente, incluido, omitido, nombres, categorías y variantes únicas");
}

run();
