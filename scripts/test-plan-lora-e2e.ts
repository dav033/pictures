import assert from "node:assert/strict";
import type { Pool } from "pg";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import { planBlueprint } from "@/lib/plan/blueprint";
import { buildApprovedSceneSpec } from "@/lib/ia/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { estimateFromPlan } from "@/lib/materiales/estimacion";
import { buildVisualContext } from "@/lib/ia/visual-context";
import { compileLoraCaption } from "@/lib/ia/lora-caption-compiler";
import { preflightLoraPrompt } from "@/lib/ia/lora-prompt-preflight";

/**
 * Fixture end-to-end real: PlanResuelto (via resolverPlan, sin BD real) ->
 * planBlueprint -> SceneSpec -> compileLoraCaption. Verifica que la cadena
 * completa preserve tipo/ubicación/rol de la estructura, no solo los
 * fixtures sintéticos de scripts/test-lora-caption-compiler.ts.
 */

const rows = [
  { product_id: "P-GLOBOS", variant_id: "V-R-12-ROJO", sku: "SKU-R-12-ROJO", producto_titulo: "Globo rojo", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo R-12." },
  { product_id: "P-GLOBOS", variant_id: "V-R-12-DORADO", sku: "SKU-R-12-DORADO", producto_titulo: "Globo dorado", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["dorado"], colores_variante: ["dorado"], descripcion: "Globo látex dorado metalizado R-12." },
];
const pool = { query: async () => ({ rows }) } as unknown as Pool;
const whitelist = new Map<string, ReadonlySet<string>>([
  ["P-GLOBOS", new Set(rows.map((row) => row.variant_id))],
]);

const plan: PlanDecoracion = PlanDecoracionSchema.parse({
  plan_version: "1.0",
  plan_id: "44444444-4444-4444-8444-444444444444",
  concepto: { titulo: "Cumpleaños rojo y dorado", descripcion: "Arco de globos en la entrada del salón.", paleta: ["rojo", "dorado"] },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [
    {
      estructura_id: "EST_01_ARCO",
      nombre: "Arco de cumpleaños",
      tipo: "arco",
      rol_escena: "focal",
      ubicacion: "entrada",
      medidas: { ancho_m: 2.5, alto_m: 2.2 },
      repeticiones: 1,
      densidad: "media",
      mezcla: "clasica",
      materiales: [
        { product_id: "P-GLOBOS", color: "rojo", participacion: 0.6, rol_material: "principal" },
        { product_id: "P-GLOBOS", color: "dorado", participacion: 0.4, rol_material: "secundario" },
      ],
      porque: "Arco de bienvenida para el cumpleaños.",
    },
  ],
  supuestos: [],
});

async function main(): Promise<void> {
  const resultado = await resolverPlan(pool, plan, whitelist);
  assert.equal(resultado.sin_cobertura.length, 0, "el plan debe resolver sin huecos de cobertura");

  const blueprint = planBlueprint(resultado);
  const arco = blueprint.elements.find((element) => element.element_id === "EST_01_ARCO");
  assert.ok(arco, "el blueprint debe conservar el elemento EST_01_ARCO");
  assert.equal(arco!.visual_semantics?.structure_type, "arco", "debe preservar el tipo canónico declarado en el plan");
  assert.equal(arco!.visual_semantics?.placement, "entrada", "debe preservar la ubicación canónica declarada en el plan");
  assert.equal(arco!.visual_semantics?.design_role, "focal", "debe preservar el rol visual declarado en el plan");
  assert.deepEqual(new Set(arco!.appearance.observed_colors), new Set(["rojo", "dorado"]), "debe traer los colores reales resueltos por variante");

  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const targetBoxes = Object.fromEntries(Object.entries(cajas).map(([id, layout]) => [id, layout.bbox]));
  const materialEstimate = estimateFromPlan(resultado);
  const catalogProducts = Object.fromEntries(
    blueprint.elements
      .filter((element) => element.source_type === "catalog_backed")
      .map((element) => [
        element.element_id,
        (element.model_decision?.bill_of_materials ?? []).map((linea) => {
          const row = rows.find((candidate) => candidate.variant_id === linea.catalog_product_id || candidate.product_id === linea.catalog_product_id);
          return { id: linea.catalog_product_id, name: row?.producto_titulo ?? linea.catalog_product_id, description: row?.descripcion ?? "", category: "balloon", colors: row?.colores_variante, share: linea.share, role: linea.role };
        }),
      ]),
  );

  const sceneSpec = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes,
    catalogProducts,
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: resultado.plan_hash,
    catalogOnly: true,
  });
  assert.equal(sceneSpec.elements.length, 1);
  assert.equal(sceneSpec.elements[0]!.visual_semantics?.structure_type, "arco", "el SceneSpec debe recibir la semántica canónica sin perderla en buildApprovedSceneSpec");

  const visualContext = buildVisualContext({ brief: { tipo_evento: "cumpleaños" } });
  const compilation = compileLoraCaption({ sceneSpec, visualContext });
  assert.ok(compilation.prompt.includes("arch"), "el caption debe traducir 'arco' a 'arch' en inglés");
  assert.ok(compilation.prompt.length <= 750, "el caption no debe superar el límite duro de 750 caracteres");
  assert.doesNotMatch(compilation.prompt, /balloon installation/, "un tipo conocido (arco) nunca debe degradar a 'balloon installation' genérico");

  const preflight = preflightLoraPrompt({ sceneSpec, clauses: compilation.clauses, prompt: compilation.prompt });
  assert.equal(preflight.ok, true, `el preflight debe pasar para este plan real: ${preflight.errors.join("; ")}`);

  console.log("[PASS] PlanResuelto -> planBlueprint -> SceneSpec -> compileLoraCaption preserva tipo/ubicación/rol end-to-end");
  console.log(`caption: ${compilation.prompt}`);

  await parDeColumnasLaterales();
}

/**
 * Regresión (2026-09-14, plan real de chat con loraMode training_1): el modelo
 * declara "dos columnas a los lados" como UNA estructura `lateral_izquierdo`
 * con `repeticiones: 2`. Las dos instancias quedaban a la izquierda: el caption
 * decía "standing on the left side" y el QA marcaba
 * `placement failure EST_02_COLUMNAS#2` (5 casos en plan_audit_log).
 */
async function parDeColumnasLaterales(): Promise<void> {
  const planPar = PlanDecoracionSchema.parse({
    ...plan,
    plan_id: "55555555-5555-4555-8555-555555555555",
    estructuras: [
      { ...plan.estructuras[0]!, ubicacion: "arco_central" },
      {
        estructura_id: "EST_02_COLUMNAS",
        nombre: "Columnas laterales",
        tipo: "columna",
        rol_escena: "soporte",
        ubicacion: "lateral_izquierdo",
        medidas: { alto_m: 1.8 },
        repeticiones: 2,
        densidad: "media",
        mezcla: "clasica",
        materiales: [
          { product_id: "P-GLOBOS", color: "rojo", participacion: 0.5, rol_material: "principal" },
          { product_id: "P-GLOBOS", color: "dorado", participacion: 0.5, rol_material: "secundario" },
        ],
        porque: "Enmarcan el arco a ambos lados.",
      },
    ],
  });
  const resultado = await resolverPlan(pool, planPar, whitelist);
  assert.equal(resultado.sin_cobertura.length, 0);

  const blueprint = planBlueprint(resultado);
  const columna1 = blueprint.elements.find((element) => element.element_id === "EST_02_COLUMNAS#1");
  const columna2 = blueprint.elements.find((element) => element.element_id === "EST_02_COLUMNAS#2");
  assert.equal(columna1?.visual_semantics?.placement, "lateral_izquierdo");
  assert.equal(columna2?.visual_semantics?.placement, "lateral_derecho", "la segunda instancia del par va a la derecha");

  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const izquierda = cajas["EST_02_COLUMNAS#1"]!.bbox;
  const derecha = cajas["EST_02_COLUMNAS#2"]!.bbox;
  assert.ok(izquierda.x + izquierda.width <= 0.5, `#1 en la mitad izquierda: ${JSON.stringify(izquierda)}`);
  assert.ok(derecha.x >= 0.5, `#2 en la mitad derecha: ${JSON.stringify(derecha)}`);
  assert.ok(Math.abs(izquierda.x - (1 - derecha.x - derecha.width)) < 1e-9, "las cajas del par son simétricas");

  // Declarar el par como lateral_derecho produce el mismo par.
  const cajasDerecha = cajasDeEstructuras(resultado.plan.estructuras.map((estructura) => estructura.estructura_id === "EST_02_COLUMNAS" ? { ...estructura, ubicacion: "lateral_derecho" as const } : estructura));
  assert.deepEqual(cajasDerecha["EST_02_COLUMNAS#1"], cajas["EST_02_COLUMNAS#1"]);
  assert.deepEqual(cajasDerecha["EST_02_COLUMNAS#2"], cajas["EST_02_COLUMNAS#2"]);

  const sceneSpec = buildApprovedSceneSpec({
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
  const compilation = compileLoraCaption({ sceneSpec, visualContext: buildVisualContext({ brief: { tipo_evento: "cumpleaños" } }) });
  assert.match(compilation.prompt, /one standing on the left and one on the right/, compilation.prompt);
  assert.doesNotMatch(compilation.prompt, /standing on the left side/);
  const preflight = preflightLoraPrompt({ sceneSpec, clauses: compilation.clauses, prompt: compilation.prompt });
  assert.equal(preflight.ok, true, preflight.errors.join("; "));
  assert.deepEqual(preflight.relationships, { expected: 1, represented: 1 });

  console.log("[PASS] columnas con repeticiones 2 en un lateral → par izquierda/derecha simétrico, caption bilateral y preflight 1/1");
  console.log(`caption: ${compilation.prompt}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
