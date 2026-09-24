/**
 * Creativity calibration scenarios for the standard (Gemini) image path.
 *
 * Builds the provider prompt of /api/generate for an approved plan without a
 * venue photo, reference photos or catalog photos: frozen resolved plan ->
 * planBlueprint -> scene spec -> buildImagePrompt. The two private blueprint
 * steps of the route are mirrored below; keep them in sync with
 * src/app/api/generate/route.ts (applyAutomaticDecisions keeps every element
 * under a plan whose variants are all loaded, and
 * addCreativeCatalogRelationships adds the relationships reproduced here).
 *
 * The resolved plan of each scenario is a frozen fixture
 * (scripts/lib/planes-fijados.ts): step 5 of ADR-0023 makes Python the only
 * owner of the counting rules and removes the TypeScript resolver, and these
 * scenarios never checked the count — they check the prompt built from it.
 * Import-safe: no network, no database. The paid CLI is
 * scripts/calibrar-creatividad-gemini.ts.
 */
import { planBlueprint } from "@/lib/plan/blueprint";
import { buildImagePrompt } from "@/lib/ia/uzume/build-image-prompt";
import { perfilCreatividad, type NivelCreatividad } from "@/lib/ia/escena/creatividad";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { buildApprovedSceneSpec, SceneSpecSchema, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import { buildVisualContext, completarEscenaConPlan, type VisualContext } from "@/lib/ia/escena/visual-context";
import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { verificarCoherenciaPrompt } from "@/lib/plan/coherencia";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import type { Brief } from "@/lib/types";
import { planFijado } from "./planes-fijados";

const PRODUCTO = "P-CALIBRACION-LATEX";
const COLORES = ["blanco", "dorado", "rojo", "rosado", "verde", "azul"] as const;
const TAMANOS = [5, 9, 12, 18, 24] as const;

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

export type EscenarioCalibracion = {
  id: string;
  descripcion: string;
  brief: Brief;
  solicitud: string;
  /** Nombre del plan resuelto congelado en `scripts/fixtures/planes-fijados/`. */
  fixture: string;
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
    fixture: "calibracion-xv-arco-columnas",
  },
  {
    id: "cumple-semiarco-columna",
    descripcion: "Cumpleaños rojo y dorado: semiarco derecho + columna izquierda separados (2 estructuras)",
    brief: { tipo_evento: "cumpleaños", colores: ["rojo", "dorado"] },
    solicitud: "Cumpleaños rojo y dorado con un semiarco a la derecha y una columna a la izquierda",
    fixture: "calibracion-cumple-semiarco-columna",
  },
  {
    id: "baby-guirnalda-mono",
    descripcion: "Baby shower azul: una guirnalda monocromática de un solo diámetro (1 estructura)",
    brief: { tipo_evento: "baby shower", colores: ["azul"] },
    solicitud: "Baby shower con una guirnalda de globos azules en la pared",
    fixture: "calibracion-baby-guirnalda-mono",
  },
  {
    id: "boda-cinco-piezas",
    descripcion: "Boda blanco, verde y dorado: pared + 2 columnas de entrada + 2 centros de mesa (5 instancias)",
    brief: { tipo_evento: "boda", colores: ["blanco", "verde", "dorado"] },
    solicitud: "Boda en blanco, verde y dorado con pared de globos, columnas en la entrada y centros de mesa",
    fixture: "calibracion-boda-cinco-piezas",
  },
];

/** Mirror of the route's private officialStructuresDePlan (src/app/api/generate/route.ts), for the same prompt vocabulary as the catalog. */
function officialStructuresDePlan(plan: PlanResuelto): ReadonlyMap<string, string> | undefined {
  return new Map(plan.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
}

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
  officialStructures: ReadonlyMap<string, string> | undefined;
  sizeMixBlock: string | undefined;
};

export function resolverEscenario(escenario: EscenarioCalibracion): EscenaResuelta {
  const { plan, materialEstimate } = planFijado(escenario.fixture);
  if (plan.sin_cobertura.length) throw new Error(`${escenario.id}: materiales sin cobertura ${JSON.stringify(plan.sin_cobertura)}`);
  const blueprint = relacionesCreativas(planBlueprint(plan));
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
  return { plan, sceneSpec, materialEstimate, officialStructures: officialStructuresDePlan(plan), sizeMixBlock };
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
  const prompt = buildImagePrompt({ sceneSpec: escena.sceneSpec, inputs: [], visualContext, sizeMixBlock: escena.sizeMixBlock, creatividad: creatividad.nivel, officialStructures: escena.officialStructures });
  const coherencia = verificarCoherenciaPrompt(prompt, escena.plan);
  if (!coherencia.ok) throw new Error(`${escenario.id} nivel ${nivel}: ${coherencia.errores.join("; ")}`);
  return { prompt, visualContext, nivel };
}
