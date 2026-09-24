/**
 * W3 (docs/planes/propuestas-2026-09/plan-mejoras-color-distribucion-conteo.md):
 * el prompt y las herramientas del modo DISEÑO DE DECORACIÓN no pueden
 * contradecir lo que cotiza confirmar_plan_decoracion.
 *
 * Invariantes deterministas, sin red ni proveedores:
 * - DISEÑO DE DECORACIÓN es el único modo: `calcular_medidas` y `usar_despiece`
 *   ya no existen (ADR-0023, paso 2) y las cantidades que se le dicen al
 *   cliente salen del último plan ok:true.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-prompt-modo-plan.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

async function main(): Promise<void> {
  const { construirSistema } = await import("../../src/lib/ia/omoikane/prompt-sistema");
  const { crearEstadoConversacion, crearRegistroHerramientas, herramientasActivas } = await import("../../src/lib/ia/herramientas/registro-herramientas");

  const modoPlan = construirSistema({ ragEnabled: true });

  // 1. El prompt no menciona el despiece legacy por ningún lado: nombrar una
  //    herramienta que ya no existe es tan dañino como recomendarla.
  assert.doesNotMatch(modoPlan, /calcular_medidas/);
  assert.doesNotMatch(modoPlan, /usar_despiece/);
  assert.doesNotMatch(modoPlan, /MEDIDAS FÍSICAS/);
  assert.match(modoPlan, /NUNCA CALCULES NI ESTIMES CANTIDADES TÚ/);
  assert.match(modoPlan, /total_unidades[\s\S]{0,200}ok:true de confirmar_plan_decoracion/);
  ok("el prompt no nombra calcular_medidas y las cantidades salen del último plan ok:true");

  // 2. Herramientas expuestas: una sola lista, sin handler de calcular_medidas.
  const nombres = (flags: { ragEnabled?: boolean }) => herramientasActivas(flags).map((herramienta) => herramienta.nombre);
  assert.ok(!nombres({ ragEnabled: true }).includes("calcular_medidas"), nombres({ ragEnabled: true }).join(", "));
  assert.ok(nombres({ ragEnabled: true }).includes("confirmar_plan_decoracion"));
  assert.deepEqual(nombres({ ragEnabled: false }), []);
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const registro = crearRegistroHerramientas(crearEstadoConversacion({}, "un arco rojo"), { pool });
  assert.ok(!("calcular_medidas" in registro), "el handler legacy ya no está registrado");
  ok("herramientasActivas: una sola lista, sin calcular_medidas ni su handler");

  // 2b. Revisión W3-2: las descripciones que viajan en el mismo request tampoco
  //     pueden mandar al modelo a una herramienta que no existe.
  const herramientasPlanActivas = herramientasActivas({ ragEnabled: true });
  for (const herramienta of herramientasPlanActivas) {
    assert.doesNotMatch(herramienta.descripcion, /calcular_medidas/, herramienta.nombre);
    assert.doesNotMatch(JSON.stringify(herramienta.esquema), /usar_despiece|calcular_medidas/, herramienta.nombre);
  }
  const seleccionPlan = herramientasPlanActivas.find((herramienta) => herramienta.nombre === "confirmar_seleccion_rag")!;
  assert.doesNotMatch(seleccionPlan.descripcion, /usar_despiece/);
  assert.match(seleccionPlan.descripcion, /los calcula confirmar_plan_decoracion/);
  ok("ninguna descripción ni esquema activo menciona calcular_medidas ni usar_despiece");

  // 3. Regla acotada de variant_id/unidades_declaradas: las estructuras con
  //    geometría no llevan cantidades, Bouquet/Figura y las piezas de catálogo sí.
  const { ESTRUCTURAS_OFICIALES, EJEMPLO_UNIDADES_DECLARADAS } = await import("../../src/lib/plan/estructuras-oficiales");
  const { HERRAMIENTAS_PLAN } = await import("../../src/lib/ia/herramientas/herramientas");
  const { perfilCreatividad } = await import("../../src/lib/ia/escena/creatividad");
  assert.doesNotMatch(modoPlan, /Nunca mandes tamaños de globo, cantidades de globos/);
  assert.match(modoPlan, /estructuras con geometría \(arco, semiarco, guirnalda, columna, pared, centro de mesa\) no mandes variant_id, tamaños de globo ni cantidades/);
  assert.match(modoPlan, /Bouquet y Figura \(que se arman con tipo kit\), y también kit, backdrop y accesorio, necesitan variant_id en cada material y unidades_declaradas/);
  // El mínimo tiene un solo dueño: la tabla de estructuras oficiales.
  const esperado = Object.values(ESTRUCTURAS_OFICIALES)
    .flatMap((estructura) => estructura.unidadesMinimasPorInstancia === undefined
      ? []
      : [`${estructura.nombre} con repeticiones 2 → unidades_declaradas ${estructura.unidadesMinimasPorInstancia * 2} o más (${estructura.unidadesMinimasPorInstancia} por pieza)`])
    .join("; ");
  assert.equal(EJEMPLO_UNIDADES_DECLARADAS, esperado);
  assert.ok(modoPlan.includes(esperado), "el prompt usa el ejemplo derivado de la tabla");
  const estructuraPlan = (HERRAMIENTAS_PLAN[0]!.esquema as { properties: { estructuras: { items: { properties: Record<string, { description?: string }> } } } }).properties.estructuras.items.properties;
  assert.ok(String(estructuraPlan.unidades_declaradas!.description).includes(esperado), String(estructuraPlan.unidades_declaradas!.description));
  assert.doesNotMatch(HERRAMIENTAS_PLAN[0]!.descripcion, /No mandes tamaños, cantidades de globos ni precios/);
  assert.match(perfilCreatividad(5).instruccionDiseno ?? "", /no inventes precios \(las cantidades de las estructuras con geometría las calcula el sistema/);
  ok("regla acotada: geometría sin cantidades, Bouquet/Figura con unidades_declaradas del mínimo de la tabla");

  // 4. Notas de costo de los acentos y lectura de "clear" en la foto.
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  assert.match(modoPlan, /paquete cerrado en CADA tamaño de la mezcla[\s\S]{0,200}0,2 o más/);
  const blueprint = ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: [{
      element_id: "REF_01_E01", source_image_id: "REF_01", name: "arco de globos", category: "balloon_structure",
      scene_role: "midground", detection_confidence: 0.9, visible_evidence: "arco al frente",
      reference_bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, depth_layer: 1,
      include_policy: "include", approved: true, source_type: "reference_only",
      quantity: { mode: "exact", min: 1, max: 1 },
      appearance: { observed_colors: ["rosado"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "arco", composition: "single uniform material" },
      relationships: [], uncertainties: [],
      visual_semantics: { structure_type: "arco", density: "media", placement: "arco_central", design_role: "focal", repetition_group: "arco_central" },
      model_decision: { action: "include", match_type: "none", reason: "relevante", adaptation: "ninguna" },
    }],
    composition: { focal_point: "arco", density: "moderate", symmetry: "symmetric", negative_space: [] },
    palette: { observed: ["rosado"], priority: ["rosado"] },
    unresolved_decisions: [],
  });
  const conReferencia = construirSistema({ ragEnabled: true, referenceBlueprint: blueprint });
  assert.match(conReferencia, /"clear" junto a un color, como "clear pink", es la línea Cristal de ese color/);
  assert.match(conReferencia, /"clear" solo sí es transparente/);
  ok("notas de costo del acento pequeño y lectura de 'clear' con color en la foto");

  console.log(`\n${casos} casos OK (prompt del modo diseño)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
