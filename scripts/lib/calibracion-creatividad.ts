/**
 * Creativity calibration scenarios for the standard (Gemini) image path.
 *
 * Builds the provider prompt of /api/generate for an approved plan without a
 * venue photo, reference photos or catalog photos: declared plan -> resolverPlan
 * (mocked catalog rows) -> planBlueprint -> scene spec -> buildImagePrompt. The
 * two private blueprint steps of the route are mirrored below; keep them in
 * sync with src/app/api/generate/route.ts (applyAutomaticDecisions keeps every
 * element under a plan whose variants are all loaded, and
 * addCreativeCatalogRelationships adds the relationships reproduced here).
 * Import-safe: no network, no database. The paid CLI is
 * scripts/calibrar-creatividad-gemini.ts.
 */
import type { Pool } from "pg";
import { planBlueprint } from "@/app/api/generate/route";
import { buildImagePrompt } from "@/lib/ia/build-image-prompt";
import { perfilCreatividad, type NivelCreatividad } from "@/lib/ia/creatividad";
import { approvedPlanQaInputs } from "@/lib/ia/generation-qa";
import type { QaPlanInputs } from "@/lib/ia/image-qa";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { buildApprovedSceneSpec, SceneSpecSchema, type SceneSpec } from "@/lib/ia/scene-spec";
import { bloqueMezclaPorEstructura } from "@/lib/ia/tamano-fisico";
import { buildVisualContext, completarEscenaConPlan, type VisualContext } from "@/lib/ia/visual-context";
import { estimateFromPlan, type DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { verificarCoherenciaPrompt } from "@/lib/plan/coherencia";
import { resolverPlan } from "@/lib/plan/resolver";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import type { Brief } from "@/lib/types";

const PRODUCTO = "P-CALIBRACION-LATEX";
const COLORES = ["blanco", "dorado", "rojo", "rosado", "verde", "azul"] as const;
const TAMANOS = [5, 9, 12, 18, 24] as const;

type Color = (typeof COLORES)[number];

const rows = COLORES.flatMap((color) => TAMANOS.map((diam) => ({
  product_id: PRODUCTO,
  variant_id: `V-R-${diam}-${color.toUpperCase()}`,
  sku: `SKU-R-${diam}-${color.toUpperCase()}`,
  sku_original: null,
  source_snapshot_id: null,
  source_variant_id: null,
  inventory_quantity: 1000,
  unidades_inferidas: false,
  producto_titulo: `Globo Latex Redondo ${color[0]!.toUpperCase()}${color.slice(1)}`,
  variante_titulo: `R-${diam} / PAQUETE X 50`,
  precio: 8000 + diam * 500,
  unidades_paq: 50,
  disponible: true,
  producto_disponible: true,
  codigo_tamano: `R-${diam}`,
  forma: "redondo",
  diam_pulg: diam,
  colores_producto: [color],
  colores_variante: [color],
  acabados_producto: [],
  descripcion: `Globo de látex redondo ${color} R-${diam}.`,
  imagen: null,
})));
const pool = { query: async () => ({ rows }) } as unknown as Pool;
const whitelist = new Map<string, ReadonlySet<string>>([[PRODUCTO, new Set(rows.map((row) => row.variant_id))]]);

function mezclaColores(...colores: Color[]) {
  const shares = colores.length === 1 ? [1] : colores.length === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
  return colores.map((color, index) => ({
    product_id: PRODUCTO,
    color,
    participacion: shares[index]!,
    rol_material: index === 0 ? "principal" : index === 1 ? "secundario" : "acento",
  }));
}

export type EscenarioCalibracion = {
  id: string;
  descripcion: string;
  brief: Brief;
  solicitud: string;
  plan: unknown;
};

/**
 * Four plans that cover the recurring failure shapes: arch + mirrored columns,
 * separate side pieces, one single-diameter monochrome garland, and a
 * five-instance plan with repeated table centerpieces. The venue and time
 * recorded in each plan are fixed across levels so the only variable is the
 * generation level (chat-side differences change the plan itself).
 */
export const ESCENARIOS: readonly EscenarioCalibracion[] = [
  {
    id: "xv-arco-columnas",
    descripcion: "XV años blanco y dorado: arco central + dos columnas (3 estructuras)",
    brief: { tipo_evento: "quinceañera", colores: ["blanco", "dorado"] },
    solicitud: "Decoración de XV años en blanco y dorado con un arco orgánico y dos columnas",
    plan: {
      plan_version: "1.0",
      plan_id: "c0000001-0000-4000-8000-000000000001",
      concepto: { titulo: "XV blanco y dorado", descripcion: "Arco orgánico con dos columnas a juego.", paleta: ["blanco", "dorado"], momento_dia: "noche" },
      espacio: { tipo: "salón", fuente: "supuesto" },
      estructuras: [
        { estructura_id: "EST_01_ARCO", nombre: "Arco orgánico", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 3, alto_m: 2.5 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales: mezclaColores("blanco", "dorado"), porque: "Foco." },
        { estructura_id: "EST_02_COL_IZQ", nombre: "Columna izquierda", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: mezclaColores("blanco", "dorado"), porque: "Enmarca." },
        { estructura_id: "EST_03_COL_DER", nombre: "Columna derecha", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_derecho", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: mezclaColores("blanco", "dorado"), porque: "Enmarca." },
      ],
      supuestos: [],
    },
  },
  {
    id: "cumple-semiarco-columna",
    descripcion: "Cumpleaños rojo y dorado: semiarco derecho + columna izquierda separados (2 estructuras)",
    brief: { tipo_evento: "cumpleaños", colores: ["rojo", "dorado"] },
    solicitud: "Cumpleaños rojo y dorado con un semiarco a la derecha y una columna a la izquierda",
    plan: {
      plan_version: "1.0",
      plan_id: "c0000002-0000-4000-8000-000000000002",
      concepto: { titulo: "Cumpleaños rojo y dorado", descripcion: "Semiarco y columna separados.", paleta: ["rojo", "dorado"] },
      espacio: { tipo: "interior", fuente: "supuesto" },
      estructuras: [
        { estructura_id: "EST_01_SEMIARCO", nombre: "Semiarco derecho", tipo: "semiarco", rol_escena: "focal", ubicacion: "lateral_derecho", medidas: { ancho_m: 1.2, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "organica_gruesa", materiales: mezclaColores("rojo", "dorado"), porque: "Pieza principal a un lado." },
        { estructura_id: "EST_02_COLUMNA", nombre: "Columna izquierda", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.6 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: mezclaColores("rojo", "dorado"), porque: "Pieza baja al otro lado." },
      ],
      supuestos: [],
    },
  },
  {
    id: "baby-guirnalda-mono",
    descripcion: "Baby shower azul: una guirnalda monocromática de un solo diámetro (1 estructura)",
    brief: { tipo_evento: "baby shower", colores: ["azul"] },
    solicitud: "Baby shower con una guirnalda de globos azules en la pared",
    plan: {
      plan_version: "1.0",
      plan_id: "c0000003-0000-4000-8000-000000000003",
      concepto: { titulo: "Baby shower azul", descripcion: "Guirnalda sencilla en la pared.", paleta: ["azul"], momento_dia: "día" },
      espacio: { tipo: "casa", fuente: "supuesto" },
      estructuras: [
        { estructura_id: "EST_01_GUIRNALDA", nombre: "Guirnalda de pared", tipo: "guirnalda", rol_escena: "focal", ubicacion: "fondo_pared", medidas: { ancho_m: 2.5 }, repeticiones: 1, densidad: "sencilla", mezcla: "clasica", materiales: mezclaColores("azul"), porque: "Foco sencillo." },
      ],
      supuestos: [],
    },
  },
  {
    id: "boda-cinco-piezas",
    descripcion: "Boda blanco, verde y dorado: pared + 2 columnas de entrada + 2 centros de mesa (5 instancias)",
    brief: { tipo_evento: "boda", colores: ["blanco", "verde", "dorado"] },
    solicitud: "Boda en blanco, verde y dorado con pared de globos, columnas en la entrada y centros de mesa",
    plan: {
      plan_version: "1.0",
      plan_id: "c0000004-0000-4000-8000-000000000004",
      concepto: { titulo: "Boda blanco verde dorado", descripcion: "Pared de globos, columnas y centros de mesa.", paleta: ["blanco", "verde", "dorado"], momento_dia: "atardecer" },
      espacio: { tipo: "jardín", fuente: "supuesto" },
      estructuras: [
        { estructura_id: "EST_01_PARED", nombre: "Pared de globos", tipo: "pared", rol_escena: "focal", ubicacion: "fondo_pared", medidas: { ancho_m: 2.4, alto_m: 2.2 }, repeticiones: 1, densidad: "lujosa", mezcla: "organica_fina", materiales: mezclaColores("blanco", "verde", "dorado"), porque: "Foco." },
        { estructura_id: "EST_02_COL_ENTRADA", nombre: "Columna de entrada", tipo: "columna", rol_escena: "soporte", ubicacion: "entrada", medidas: { alto_m: 1.8 }, repeticiones: 2, densidad: "media", mezcla: "clasica", materiales: mezclaColores("blanco", "dorado"), porque: "Recibe a los invitados." },
        { estructura_id: "EST_03_CENTRO", nombre: "Centro de mesa", tipo: "centro_mesa", rol_escena: "acento", ubicacion: "mesas_invitados", medidas: { ancho_m: 0.5, alto_m: 0.6 }, repeticiones: 2, densidad: "sencilla", mezcla: "clasica", materiales: mezclaColores("blanco", "verde"), porque: "Acento en mesas." },
      ],
      supuestos: [],
    },
  },
];

/** Mirror of the route's private addCreativeCatalogRelationships for plan blueprints (no kits, no backdrop, no lighting). */
function relacionesCreativas(blueprint: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  const active = blueprint.elements.filter((element) => element.approved && element.include_policy !== "exclude");
  const balloonStructure = active.find((element) => element.category === "balloon_structure");
  if (!balloonStructure) return blueprint;
  return ReferenceBlueprintV2Schema.parse({
    ...blueprint,
    elements: blueprint.elements.map((element) => {
      if (element.element_id === balloonStructure.element_id || element.category !== "balloon_structure") return element;
      const exists = element.relationships.some((item) => item.type === "overlaps" && item.target_element_id === balloonStructure.element_id);
      return exists ? element : { ...element, relationships: [...element.relationships, { type: "overlaps" as const, target_element_id: balloonStructure.element_id }].slice(0, 12) };
    }),
  });
}

export type EscenaResuelta = {
  plan: PlanResuelto;
  sceneSpec: SceneSpec;
  materialEstimate: DesignMaterialEstimate;
  qaPlan: QaPlanInputs | undefined;
  sizeMixBlock: string | undefined;
};

export async function resolverEscenario(escenario: EscenarioCalibracion): Promise<EscenaResuelta> {
  const plan = await resolverPlan(pool, PlanDecoracionSchema.parse(escenario.plan), whitelist);
  if (plan.sin_cobertura.length) throw new Error(`${escenario.id}: materiales sin cobertura ${JSON.stringify(plan.sin_cobertura)}`);
  const blueprint = relacionesCreativas(planBlueprint(plan));
  const materialEstimate = estimateFromPlan(plan);
  const nombrePorVariante = new Map(rows.map((row) => [row.variant_id, row]));
  const catalogProducts = Object.fromEntries(blueprint.elements.map((element) => [
    element.element_id,
    (element.model_decision?.bill_of_materials ?? []).map((linea) => {
      const row = nombrePorVariante.get(linea.catalog_product_id);
      const compra = plan.compras.find((item) => item.variant_id === linea.catalog_product_id);
      return { id: linea.catalog_product_id, name: row?.producto_titulo ?? linea.catalog_product_id, description: row?.descripcion ?? "", category: "globos", colors: row ? [...row.colores_variante] : [], unitsPerPackage: compra?.unidades_paquete, packageCount: compra?.paquetes ?? 1, installedUnits: Math.round((element.quantity.max ?? 0) * linea.share), share: linea.share, role: linea.role };
    }),
  ]));
  const cajas = Object.fromEntries(Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox]));
  const sceneSpec = SceneSpecSchema.parse(buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: cajas,
    eventPalette: escenario.brief.colores,
    catalogProducts,
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  }));
  const sizeMixBlock = bloqueMezclaPorEstructura(plan.estructuras.map((estructura) => ({
    nombre: estructura.nombre,
    total_unidades: estructura.total_unidades,
    repeticiones: estructura.repeticiones,
    mezcla_real: estructura.mezcla_real.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades })),
  }))) ?? undefined;
  return { plan, sceneSpec, materialEstimate, qaPlan: approvedPlanQaInputs(plan), sizeMixBlock };
}

export type PromptCalibracion = { prompt: string; visualContext: VisualContext; nivel: NivelCreatividad };

/** Same visual context and prompt call as /api/generate for a plan without venue photo. */
export function promptParaNivel(escenario: EscenarioCalibracion, escena: EscenaResuelta, nivel: NivelCreatividad): PromptCalibracion {
  const creatividad = perfilCreatividad(nivel);
  const visualContext = buildVisualContext({
    brief: completarEscenaConPlan({ brief: escenario.brief, userRequest: escenario.solicitud, plan: escena.plan.plan, nivel: creatividad.nivel, fotoEspacio: false }),
    userRequest: escenario.solicitud,
    approvedPlan: escena.plan.plan.estructuras.map((estructura) => `${estructura.nombre} (${estructura.tipo}, ${estructura.ubicacion})`),
    approvedMaterials: escena.plan.compras.map((compra) => {
      const row = rows.find((candidate) => candidate.variant_id === compra.variant_id);
      return row ? `${row.producto_titulo} — ${row.colores_variante.join(", ")}` : undefined;
    }).filter((material): material is string => Boolean(material)),
    pieceMatchLevels: [],
  });
  const prompt = buildImagePrompt({ sceneSpec: escena.sceneSpec, inputs: [], visualContext, sizeMixBlock: escena.sizeMixBlock, creatividad: creatividad.nivel, officialStructures: escena.qaPlan?.officialStructures });
  const coherencia = verificarCoherenciaPrompt(prompt, escena.plan);
  if (!coherencia.ok) throw new Error(`${escenario.id} nivel ${nivel}: ${coherencia.errores.join("; ")}`);
  return { prompt, visualContext, nivel };
}
