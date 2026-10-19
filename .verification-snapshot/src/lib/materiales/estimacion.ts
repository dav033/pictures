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

/**
 * Puerta sobre la estimación que llega del resolutor (ADR-0023 paso 6).
 *
 * Valida el LÍMITE, no las reglas: el esquema ya exige tipos, enteros y no
 * negativos, y aquí solo queda el invariante estructural que el esquema no
 * puede expresar — una compra no puede quedar por debajo de la demanda que
 * dice cubrir.
 *
 * Hasta el paso 6 esta función recalculaba los catorce totales desde las
 * líneas para compararlos. Eso no era validar: era un segundo dueño de las
 * fórmulas comerciales, y el 2026-09-16 costó una propuesta fallida y una
 * mañana de diagnóstico cuando las dos definiciones se separaron. Con un solo
 * dueño no hay con quién discrepar, así que el recálculo sobra.
 */
export function validateMaterialEstimate(estimate: DesignMaterialEstimate): MaterialEstimateValidation {
  const errors: string[] = [];
  for (const purchase of estimate.purchases) {
    if (purchase.purchase_quantity < purchase.waste_adjusted_quantity) {
      errors.push(`purchase capacity is below waste-adjusted demand for ${purchase.variant_id}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings: [...estimate.warnings] };
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
