import { factorGlobosPorMetro, proporcionesEfectivas, tamanosObligatorios } from "@/lib/medidas/geometria";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { ahorroSoloMermaCop, paquetesExtraPorMerma } from "@/lib/plan/optimizar-materiales";
import { MERMA } from "@/lib/cotizacion/constantes";
import { z } from "zod";

export const MATERIAL_VISUAL_DENSITIES = ["low", "medium", "high"] as const;
export const MATERIAL_VISUAL_SCALES = ["small", "small_medium", "medium", "large", "very_large"] as const;

const MaterialEstimateLineSchema = z.object({
  structure_id: z.string().min(1).optional(),
  product_id: z.string().min(1).optional(),
  variant_id: z.string().min(1).optional(),
  color: z.string().nullable(),
  finish: z.string().nullable(),
  size_inches: z.number().positive().nullable(),
  shape: z.string().nullable(),
  design_quantity: z.number().int().nonnegative(),
  waste_reserve: z.number().int().nonnegative(),
  required_quantity: z.number().int().nonnegative(),
  waste_adjusted_quantity: z.number().int().nonnegative(),
}).strict();

const MaterialPurchaseSchema = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  design_quantity: z.number().int().nonnegative(),
  waste_reserve: z.number().int().nonnegative(),
  required_quantity: z.number().int().nonnegative(),
  waste_adjusted_quantity: z.number().int().nonnegative(),
  units_per_package: z.number().int().positive(),
  package_count: z.number().int().positive(),
  purchase_quantity: z.number().int().positive(),
  used: z.number().int().nonnegative(),
  leftover_inventory: z.number().int().nonnegative(),
  consumption_cost: z.number().nonnegative(),
  purchase_cost: z.number().nonnegative(),
  additional_package_for_waste: z.boolean(),
  operational_surplus: z.number().int().nonnegative(),
  potential_surplus: z.number().int().nonnegative(),
}).strict();

export const MaterialEstimateSchema = z.object({
  version: z.literal("design-material-estimate-v1"),
  design: z.object({
    type: z.string().min(1),
    shape: z.string().nullable(),
    dimensions_m: z.object({ width: z.number().positive().nullable(), height: z.number().positive().nullable(), length: z.number().positive().nullable() }).strict(),
    installation_length_m: z.number().positive().nullable(),
    density: z.string().nullable(),
    visual_density: z.enum(MATERIAL_VISUAL_DENSITIES),
    visual_scale: z.enum(MATERIAL_VISUAL_SCALES),
    cluster_count: z.number().int().positive(),
  }).strict(),
  balloons: z.array(MaterialEstimateLineSchema),
  special_elements: z.array(MaterialEstimateLineSchema),
  purchases: z.array(MaterialPurchaseSchema),
  totals: z.object({
    design_quantity: z.number().int().nonnegative(),
    target_waste_reserve: z.number().int().nonnegative(),
    covered_waste_reserve: z.number().int().nonnegative(),
    uncovered_waste_reserve: z.number().int().nonnegative(),
    natural_package_surplus: z.number().int().nonnegative(),
    required_quantity: z.number().int().nonnegative(),
    consumption_cost: z.number().nonnegative(),
    purchase_cost: z.number().nonnegative(),
    waste_only_savings_cop: z.number().nonnegative(),
    additional_waste_packages: z.number().int().nonnegative(),
    waste_adjusted_quantity: z.number().int().nonnegative(),
    purchase_quantity: z.number().int().nonnegative(),
    operational_surplus: z.number().int().nonnegative(),
    potential_surplus: z.number().nonnegative(),
  }).strict(),
  warnings: z.array(z.string().min(1)),
}).strict();

export type DesignMaterialEstimate = z.infer<typeof MaterialEstimateSchema>;

type MaterialEstimateValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function positivoONull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function visualDensity(value: string | undefined): (typeof MATERIAL_VISUAL_DENSITIES)[number] {
  if (value === "lujosa" || value === "high") return "high";
  if (value === "sencilla" || value === "low") return "low";
  return "medium";
}

function visualScale(total: number, length: number | null, density: (typeof MATERIAL_VISUAL_DENSITIES)[number]): (typeof MATERIAL_VISUAL_SCALES)[number] {
  const extent = Math.max(length ?? 0, 0.5);
  const massPerMeter = total / extent;
  if (extent >= 4 && massPerMeter >= 20) return "very_large";
  if ((extent >= 3 && massPerMeter >= 14) || total >= 120) return "large";
  if ((extent >= 2 && massPerMeter >= 10) || (density === "high" && total >= 70)) return "medium";
  if (total <= 35 && extent <= 2.5) return "small";
  return "small_medium";
}

/**
 * Line-based structures: their balloon count is a function of an axis length.
 * `pared` uses an area model (its axis is 0) and `centro_mesa` is a compact
 * piece whose largest dimension is not an installation run, so neither has a
 * calibrated balloons-per-meter range; inventing one would block valid plans.
 * Non-geometric pieces (bouquet, figura, kit, backdrop, escultura) declare
 * their units and have no geometry at all.
 */
const ESTRUCTURAS_LINEALES = new Set(["arco", "semiarco", "guirnalda", "columna"]);

/**
 * Único dueño de la puerta física en Next: corre sobre el `PlanResuelto` de
 * cualquiera de los dos backends (`resolver-backend.ts` devuelve el mismo
 * tipo), así que Next y Python bloquean lo mismo.
 *
 * Antes la comprobación vivía dentro de `estimateFromPlan` y dividía TODOS los
 * globos instalados (incluida la pared, cuyo eje es 0, y las piezas sin
 * geometría) entre el eje sumado de las estructuras lineales: "pared +
 * guirnalda" quedaba en 173 globos/m y no se podía confirmar en Next, mientras
 * el backend Python —que nunca calculó estas advertencias— sí lo aceptaba.
 *
 * Cada estructura lineal se compara ahora contra su propia densidad y su
 * propio eje por instancia. Los umbrales siguen siendo heurísticos sin
 * calibrar: son una comprobación previa transparente, no un sustituto de la
 * calibración en campo, y escalan con la extensión física y la densidad en vez
 * de fijar un conteo de globos para un tipo de decoración concreto.
 *
 * Esos umbrales están calibrados en globos por metro contra mezclas donde R-12
 * domina el volumen, así que no son comparables cuando `restricciones.tamanos`
 * cambia el globo dominante: un arco 3 × 2,4 m "solo R-24" cuenta 52 globos
 * correctos (8,4/m) donde la mezcla completa contaba 119 (19,2/m) y caía por
 * debajo del mínimo, de modo que un plan válido dejaba de poder confirmarse.
 * La banda se escala con el mismo modelo que produjo el conteo
 * (`factorGlobosPorMetro`), que vale 1 exacto sin tamaños obligatorios.
 */
export function physicalWarningsForPlan(plan: PlanResuelto): string[] {
  const warnings: string[] = [];
  const tamanos = tamanosObligatorios(plan.plan.restricciones);
  for (const structure of plan.estructuras) {
    if (!ESTRUCTURAS_LINEALES.has(structure.tipo)) continue;
    const repeticiones = Math.max(1, Math.round(structure.repeticiones));
    const extent = (structure.eje_m ?? 0) * repeticiones;
    if (extent <= 0) continue;
    const balloons = structure.lineas.filter((line) => line.diam_pulg != null).reduce((sum, line) => sum + line.unidades, 0);
    if (balloons <= 0) continue;
    const declarada = plan.plan.estructuras.find((item) => item.estructura_id === structure.estructura_id);
    const density = visualDensity(declarada?.densidad);
    const mezcla = declarada && "mezcla" in declarada ? declarada.mezcla : undefined;
    const factor = mezcla ? factorGlobosPorMetro(mezcla, proporcionesEfectivas(mezcla, tamanos).proporciones) : 1;
    const minimumPerMeter = { low: 8, medium: 14, high: 20 }[density] * factor;
    const maximumPerMeter = { low: 48, medium: 68, high: 88 }[density] * factor;
    const perMeter = balloons / extent;
    if (perMeter < minimumPerMeter * 0.6) {
      warnings.push(`${structure.estructura_id}: estimated material quantity appears too low for ${density} density over ${extent.toFixed(2)} m (${balloons} installed balloons)`);
    }
    if (perMeter > maximumPerMeter * 1.3) {
      warnings.push(`${structure.estructura_id}: estimated material quantity appears unusually high for ${density} density over ${extent.toFixed(2)} m (${balloons} installed balloons)`);
    }
  }
  return warnings;
}

/**
 * `design.density` / `visual_density` del plan: la densidad de la estructura
 * con más globos de diseño (empate: la primera en el orden del plan). TypeScript
 * usaba "lujosa si alguna lo es" y Python la primera estructura, así que el
 * mismo plan mixto llegaba al prompt de imagen con densidades distintas.
 * Espejo: `_plan_density` en `services/ai-api/app/plan.py`.
 */
function planDensity(plan: PlanResuelto): string | undefined {
  const balloonsByStructure = new Map(plan.estructuras.map((structure) => [
    structure.estructura_id,
    structure.lineas.filter((line) => line.diam_pulg != null).reduce((sum, line) => sum + line.unidades, 0),
  ]));
  const structures = plan.plan.estructuras;
  let dominant = structures[0];
  for (const structure of structures) {
    if ((balloonsByStructure.get(structure.estructura_id) ?? 0) > (balloonsByStructure.get(dominant?.estructura_id ?? "") ?? 0)) dominant = structure;
  }
  return dominant?.densidad;
}

/**
 * MERMA models balloons bursting while they are inflated and mounted, so only
 * balloon purchases can avoid a waste-only package. This mirrors the waste
 * reserve eligibility of both producers (`resolver.ts` uses `diam_pulg != null`,
 * `purchaseLines` uses `esGlobo`), which is not stored on purchase lines in
 * `design-material-estimate-v1`. It is derived from the estimate's own lines so
 * `validateMaterialEstimate` recomputes the same value:
 *
 * - a purchase whose variant is a special element is never eligible;
 * - otherwise it is eligible when its variant is a balloon line, or when its
 *   product is: `purchaseLines` can buy a different package presentation of the
 *   same balloon family than the variant that received the measured demand.
 *
 * Removal condition: a future estimate contract version that carries explicit
 * per-purchase waste eligibility. Python mirrors this rule in
 * `services/ai-api/app/plan.py` (`_material_waste_only_savings`).
 */
export function wasteOnlySavingsCop(
  balloons: DesignMaterialEstimate["balloons"],
  special: DesignMaterialEstimate["special_elements"],
  purchases: DesignMaterialEstimate["purchases"],
): number {
  const specialVariants = new Set(special.map((line) => line.variant_id).filter((id) => id !== undefined));
  const balloonVariants = new Set(balloons.map((line) => line.variant_id).filter((id) => id !== undefined));
  const balloonProducts = new Set(balloons.map((line) => line.product_id).filter((id) => id !== undefined));
  const savings = purchases.reduce((sum, line) => {
    if (specialVariants.has(line.variant_id)) return sum;
    if (!balloonVariants.has(line.variant_id) && !balloonProducts.has(line.product_id)) return sum;
    const unitPrice = line.package_count > 0 ? line.purchase_cost / line.package_count : 0;
    return sum + ahorroSoloMermaCop(line.design_quantity, line.units_per_package, line.package_count, unitPrice, MERMA);
  }, 0);
  return Math.round(savings);
}

/**
 * Cambio de significado dentro de `design-material-estimate-v1` (ADR 0022), sin
 * cambiar el esquema porque los dos campos se derivan de las mismas líneas:
 *
 * - `additional_waste_packages` es el delta de paquetes comprados por la
 *   reserva de merma, no todos los paquetes de la línea marcada.
 * - `waste_only_savings_cop` compara la compra ingenua con lo que de verdad se
 *   compró, así que una línea que sí necesitó un paquete extra ya no reporta
 *   un ahorro que no ocurrió.
 *
 * Los dos alimentan `merma_log` (IMAGE_DEBUG) y las auditorías; quien calibre
 * MERMA con series anteriores al despliegue debe saber que la definición
 * cambió. `validateMaterialEstimate` recalcula ambos desde las líneas.
 */
function totals(balloons: DesignMaterialEstimate["balloons"], special: DesignMaterialEstimate["special_elements"], purchases: DesignMaterialEstimate["purchases"]): DesignMaterialEstimate["totals"] {
  const designQuantity = [...balloons, ...special].reduce((sum, line) => sum + line.design_quantity, 0);
  const targetWasteReserve = Math.ceil(balloons.reduce((sum, line) => sum + line.design_quantity, 0) * MERMA);
  const coveredWasteReserve = purchases.reduce((sum, line) => sum + line.waste_reserve, 0);
  const requiredQuantity = purchases.reduce((sum, line) => sum + line.required_quantity, 0);
  const wasteAdjustedQuantity = requiredQuantity;
  const purchaseQuantity = purchases.reduce((sum, line) => sum + line.purchase_quantity, 0);
  const operationalSurplus = purchases.reduce((sum, line) => sum + line.operational_surplus, 0);
  const potentialSurplus = purchases.reduce((sum, line) => sum + line.potential_surplus, 0);
  return {
    design_quantity: designQuantity,
    target_waste_reserve: targetWasteReserve,
    covered_waste_reserve: coveredWasteReserve,
    uncovered_waste_reserve: Math.max(0, targetWasteReserve - coveredWasteReserve),
    natural_package_surplus: purchases.reduce((sum, line) => sum + Math.max(0, line.purchase_quantity - line.design_quantity), 0),
    required_quantity: requiredQuantity,
    consumption_cost: purchases.reduce((sum, line) => sum + line.consumption_cost, 0),
    purchase_cost: purchases.reduce((sum, line) => sum + line.purchase_cost, 0),
    waste_only_savings_cop: wasteOnlySavingsCop(balloons, special, purchases),
    additional_waste_packages: purchases.filter((line) => line.additional_package_for_waste).reduce((sum, line) => sum + paquetesExtraPorMerma(line.design_quantity, line.units_per_package, line.package_count), 0),
    waste_adjusted_quantity: wasteAdjustedQuantity,
    purchase_quantity: purchaseQuantity,
    operational_surplus: operationalSurplus,
    potential_surplus: potentialSurplus,
  };
}

function withWarnings(estimate: Omit<DesignMaterialEstimate, "warnings" | "totals">, extraWarnings: string[]): DesignMaterialEstimate {
  const result = {
    ...estimate,
    totals: totals(estimate.balloons, estimate.special_elements, estimate.purchases),
    warnings: [...new Set(extraWarnings)],
  } satisfies DesignMaterialEstimate;
  return MaterialEstimateSchema.parse(result);
}

function baseDesign(input: {
  type: string;
  shape?: string | null;
  width?: number | null;
  height?: number | null;
  length?: number | null;
  installationLength?: number | null;
  density?: string;
  clusterCount?: number;
}, total: number): DesignMaterialEstimate["design"] {
  const visual = visualDensity(input.density);
  const installationLength = positivoONull(input.installationLength);
  return {
    type: input.type,
    shape: input.shape ?? null,
    dimensions_m: { width: positivoONull(input.width), height: positivoONull(input.height), length: positivoONull(input.length) },
    installation_length_m: installationLength,
    density: input.density ?? null,
    visual_density: visual,
    visual_scale: visualScale(total, installationLength, visual),
    cluster_count: Math.max(1, Math.round(input.clusterCount ?? 1)),
  };
}

export function estimateFromPlan(plan: PlanResuelto): DesignMaterialEstimate {
  const balloons: DesignMaterialEstimate["balloons"] = [];
  const specialElements: DesignMaterialEstimate["special_elements"] = [];
  for (const structure of plan.estructuras) {
    for (const line of structure.lineas) {
      const target = line.diam_pulg != null ? balloons : specialElements;
      target.push({
        structure_id: structure.estructura_id,
        product_id: line.product_id,
        variant_id: line.variant_id,
        color: line.color,
        finish: line.acabado,
        size_inches: line.diam_pulg,
        shape: line.forma,
        design_quantity: line.unidades,
        waste_reserve: 0,
        required_quantity: line.unidades,
        waste_adjusted_quantity: line.unidades,
      });
    }
  }
  const purchases = plan.compras.map((purchase) => ({
    product_id: purchase.product_id,
    variant_id: purchase.variant_id,
    design_quantity: purchase.unidades_necesarias,
    waste_reserve: purchase.waste_reserve,
    required_quantity: purchase.required_quantity,
    waste_adjusted_quantity: purchase.unidades_con_merma,
    units_per_package: purchase.unidades_paquete,
    package_count: purchase.paquetes,
    purchase_quantity: purchase.purchase_quantity,
    used: purchase.used,
    leftover_inventory: purchase.leftover_inventory,
    consumption_cost: purchase.consumption_cost,
    purchase_cost: purchase.purchase_cost,
    additional_package_for_waste: purchase.additional_package_for_waste,
    operational_surplus: purchase.leftover_inventory,
    potential_surplus: Math.max(0, purchase.paquetes * purchase.unidades_paquete - purchase.unidades_necesarias),
  }));
  const geometric = plan.estructuras.filter((structure) => structure.eje_m != null);
  const first = plan.plan.estructuras[0];
  const totalDesign = [...balloons, ...specialElements].reduce((sum, line) => sum + line.design_quantity, 0);
  const installationLength = geometric.length ? geometric.reduce((sum, structure) => sum + (structure.eje_m ?? 0) * structure.repeticiones, 0) : null;
  const design = baseDesign({
    type: plan.plan.estructuras.length === 1 ? first?.tipo ?? "installation" : "composite_installation",
    shape: plan.plan.estructuras.length === 1 ? first?.mezcla ?? null : "coordinated structures",
    width: first?.medidas.ancho_m ?? null,
    height: first?.medidas.alto_m ?? null,
    length: first?.medidas.largo_m ?? null,
    installationLength,
    density: planDensity(plan),
    clusterCount: plan.plan.estructuras.reduce((sum, structure) => sum + structure.repeticiones, 0),
  }, totalDesign);
  // La puerta física del plan ya no se inyecta aquí: la calcula
  // `physicalWarningsForPlan` sobre el `PlanResuelto` de cualquiera de los dos
  // backends, así que la estimación que compara la paridad no lleva
  // advertencias que solo existen en TypeScript.
  return withWarnings({ version: "design-material-estimate-v1", design, balloons, special_elements: specialElements, purchases }, plan.advertencias);
}

export function validateMaterialEstimate(estimate: DesignMaterialEstimate): MaterialEstimateValidation {
  const errors: string[] = [];
  const warnings = [...estimate.warnings];
  const calculated = totals(estimate.balloons, estimate.special_elements, estimate.purchases);
  // Naming the fields that differ turns an unactionable refusal into a
  // diagnosable one: with the Python backend the mismatch can only be seen
  // here, and the model retries the same plan until the convergence guard fires.
  const diferencias = (Object.keys(calculated) as Array<keyof typeof calculated>)
    .filter((campo) => calculated[campo] !== estimate.totals[campo])
    .map((campo) => `${campo}: líneas ${calculated[campo]} ≠ totales ${estimate.totals[campo]}`);
  if (diferencias.length > 0) errors.push(`material estimate totals do not match its lines (${diferencias.join("; ")})`);
  for (const purchase of estimate.purchases) {
    if (purchase.purchase_quantity < purchase.waste_adjusted_quantity) errors.push(`purchase capacity is below waste-adjusted demand for ${purchase.variant_id}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function designQuantityForProduct(estimate: DesignMaterialEstimate, productId: string): number {
  return [...estimate.balloons, ...estimate.special_elements]
    .filter((line) => line.variant_id === productId || line.product_id === productId)
    .reduce((sum, line) => sum + line.design_quantity, 0);
}

export function purchaseForProduct(estimate: DesignMaterialEstimate, productId: string): DesignMaterialEstimate["purchases"][number] | undefined {
  return estimate.purchases.find((line) => line.variant_id === productId || line.product_id === productId);
}

export function formatMaterialEstimateLog(estimate: DesignMaterialEstimate): string {
  const sizes = new Map<string, number>();
  const colors = new Map<string, number>();
  for (const line of estimate.balloons) {
    const size = line.size_inches == null ? "special" : `${line.size_inches}\\"`;
    sizes.set(size, (sizes.get(size) ?? 0) + line.design_quantity);
    const color = line.color ?? "unspecified";
    colors.set(color, (colors.get(color) ?? 0) + line.design_quantity);
  }
  const lines = [
    "DESIGN ESTIMATION",
    `Type: ${estimate.design.type}`,
    `Length: ${estimate.design.installation_length_m ?? "n/a"}m`,
    `Density: ${estimate.design.density ?? estimate.design.visual_density}`,
    "",
    `Estimated design balloons: ${estimate.balloons.reduce((sum, line) => sum + line.design_quantity, 0)}`,
    ...[...sizes.entries()].map(([size, quantity]) => `${size}: ${quantity}`),
    ...[...colors.entries()].map(([color, quantity]) => `${color}: ${quantity}`),
    "",
    "MERMA / PACKAGE OPTIMIZATION",
    `Total design balloons: ${estimate.balloons.reduce((sum, line) => sum + line.design_quantity, 0)}`,
    `Target waste reserve: ${estimate.totals.target_waste_reserve}`,
    `Natural package surplus: ${estimate.totals.natural_package_surplus}`,
    `Usable waste coverage: ${estimate.totals.covered_waste_reserve}`,
    `Additional packages required for waste: ${estimate.totals.additional_waste_packages}`,
    ...estimate.purchases.map((purchase) => `${purchase.variant_id}: design=${purchase.design_quantity}, required=${purchase.required_quantity}, package=${purchase.units_per_package}, packages=${purchase.package_count}, purchased=${purchase.purchase_quantity}, natural surplus=${purchase.purchase_quantity - purchase.design_quantity}, waste reserve=${purchase.waste_reserve}, leftover inventory=${purchase.leftover_inventory}`),
    "",
    `Waste-adjusted: ${estimate.totals.waste_adjusted_quantity}`,
    `Purchase quantity after packages: ${estimate.totals.purchase_quantity}`,
    `Purchase cost: ${estimate.totals.purchase_cost}`,
    `Consumption cost: ${estimate.totals.consumption_cost}`,
    `Savings from avoiding waste-only packages: ${estimate.totals.waste_only_savings_cop}`,
    `Operational surplus: ${estimate.totals.operational_surplus}`,
    "",
    "VISUAL GENERATION",
    `Target design quantity: ${estimate.totals.design_quantity}`,
    `Target density: ${estimate.design.visual_density}`,
    `Target visual scale: ${estimate.design.visual_scale}`,
    "Image prompt successfully constructed from estimate.",
  ];
  if (estimate.warnings.length) lines.push(`Warnings: ${estimate.warnings.join(" | ")}`);
  return lines.join("\n");
}
