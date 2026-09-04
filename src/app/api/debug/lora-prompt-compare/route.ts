import type { Pool } from "pg";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import { planBlueprint } from "@/app/api/generate/route";
import { buildApprovedSceneSpec } from "@/lib/ia/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { estimateFromPlan } from "@/lib/materiales/estimacion";
import { buildVisualContext } from "@/lib/ia/visual-context";
import { compileProductPrompt } from "@/lib/ia/lora-product-runtime";
import { buildLoraImagePromptV1 } from "@/lib/ia/build-image-prompt";
import { DEFAULT_SEMPERTEX_LORA_TRIGGER, ensureLoraTriggers } from "@/lib/ia/sempertex-lora";
import { preflightLoraPrompt } from "@/lib/ia/lora-prompt-preflight";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import type { PlanResuelto } from "@/lib/plan/resuelto";

/**
 * Herramienta de solo lectura para comparar el prompt LoRA v1 vs v2 del
 * mismo plan sin llamar a fal.ai — no genera imágenes, no gasta crédito.
 */

type Caso = "cumpleanos" | "xv";

const ROWS_CUMPLEANOS = [
  { product_id: "P-GLOBOS", variant_id: "20000444", sku: "SKU-R-12-ROJO", producto_titulo: "Globo rojo", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo R-12." },
  { product_id: "P-GLOBOS", variant_id: "20014242", sku: "SKU-R-12-DORADO", producto_titulo: "Globo dorado", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["dorado"], colores_variante: ["dorado"], descripcion: "Globo látex dorado metalizado R-12." },
];

const ROWS_XV = [
  { product_id: "P-GLOBOS", variant_id: "7109611618497", sku: "SKU-R-12-ROSADO", producto_titulo: "Globo rosado", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rosado"], colores_variante: ["rosado"], descripcion: "Globo látex rosado R-12." },
  { product_id: "P-GLOBOS", variant_id: "7109611323585", sku: "SKU-R-12-DORADO-ROSA", producto_titulo: "Globo dorado rosa", variante_titulo: "R-12", precio: 11000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["dorado rosa"], colores_variante: ["dorado rosa"], descripcion: "Globo látex dorado rosa metalizado R-12." },
];

function planCumpleanos(): PlanDecoracion {
  return PlanDecoracionSchema.parse({
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
}

function planXv(): PlanDecoracion {
  const materiales = [
    { product_id: "P-GLOBOS", color: "rosado", participacion: 0.6, rol_material: "principal" as const },
    { product_id: "P-GLOBOS", color: "dorado rosa", participacion: 0.4, rol_material: "secundario" as const },
  ];
  return PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "55555555-5555-4555-8555-555555555555",
    concepto: { titulo: "XV años coquette", descripcion: "Arco central con columnas laterales y centro de mesa.", paleta: ["rosado", "dorado rosa"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [
      { estructura_id: "EST_01_ARCO", nombre: "Arco principal", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 3, alto_m: 3 }, repeticiones: 1, densidad: "lujosa", mezcla: "organica_fina", materiales, porque: "Foco principal para fotos." },
      { estructura_id: "EST_02_COLUMNA", nombre: "Columnas coordinadas", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Enmarca el arco." },
      { estructura_id: "EST_03_COLUMNA", nombre: "Columnas coordinadas", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_derecho", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Enmarca el arco." },
      { estructura_id: "EST_04_MESA", nombre: "Acento bajo para mesa principal", tipo: "centro_mesa", rol_escena: "acento", ubicacion: "sobre_mesa_principal", medidas: {}, repeticiones: 1, densidad: "sencilla", mezcla: "clasica", materiales: [{ ...materiales[1]!, participacion: 1 }], porque: "Coordina la mesa principal con el arco." },
    ],
    supuestos: [],
  });
}

const CASES: Record<Caso, { rows: typeof ROWS_CUMPLEANOS; plan: () => PlanDecoracion; eventLabel: string }> = {
  cumpleanos: { rows: ROWS_CUMPLEANOS, plan: planCumpleanos, eventLabel: "cumpleaños" },
  xv: { rows: ROWS_XV, plan: planXv, eventLabel: "quince años" },
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const caso = (url.searchParams.get("caso") ?? "cumpleanos") as Caso;
  const config = CASES[caso];
  if (!config) return Response.json({ error: `caso desconocido: ${caso}. usa cumpleanos|xv` }, { status: 400 });

  const pool = { query: async () => ({ rows: config.rows }) } as unknown as Pool;
  const whitelist = new Map<string, ReadonlySet<string>>([
    ["P-GLOBOS", new Set(config.rows.map((row) => row.variant_id))],
  ]);

  const resultado: PlanResuelto = await resolverPlan(pool, config.plan(), whitelist);
  const blueprint = planBlueprint(resultado);
  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const targetBoxes = Object.fromEntries(Object.entries(cajas).map(([id, layout]) => [id, layout.bbox]));
  const materialEstimate = estimateFromPlan(resultado);
  const catalogProducts = Object.fromEntries(
    blueprint.elements
      .filter((element) => element.source_type === "catalog_backed")
      .map((element) => [
        element.element_id,
        (element.model_decision?.bill_of_materials ?? []).map((linea) => {
          const row = config.rows.find((candidate) => candidate.variant_id === linea.catalog_product_id || candidate.product_id === linea.catalog_product_id);
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

  const visualContext = buildVisualContext({ brief: { tipo_evento: config.eventLabel } });
  const sizeConfirmations = materialEstimate.balloons.flatMap((line) => {
    const elementId = line.structure_id;
    const productId = line.variant_id ?? line.product_id;
    const row = config.rows.find((candidate) => candidate.variant_id === productId);
    return elementId && productId && row?.codigo_tamano
      ? [{ elementId, productId, sizeCode: row.codigo_tamano, diameterInches: row.diam_pulg }]
      : [];
  });
  const compilation = compileProductPrompt({ sceneSpec, visualContext, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations });
  const promptV1 = ensureLoraTriggers(buildLoraImagePromptV1({ sceneSpec, visualContext }));
  const promptV2 = ensureLoraTriggers(compilation.prompt);
  const preflight = preflightLoraPrompt({ sceneSpec, clauses: compilation.clauses, prompt: promptV2, triggers: [DEFAULT_SEMPERTEX_LORA_TRIGGER], vocabulary: PRODUCT_VOCABULARY });

  return Response.json({
    caso,
    plan: { titulo: config.plan().concepto.titulo, estructuras: resultado.plan.estructuras.map((estructura) => ({ id: estructura.estructura_id, nombre: estructura.nombre, tipo: estructura.tipo, ubicacion: estructura.ubicacion })) },
    promptV1,
    promptV2,
    compilerVersion: compilation.captionCompilerVersion,
    preflight,
  });
}
