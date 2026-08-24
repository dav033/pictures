import type { ResultadoMedidas } from "@/lib/medidas/geometria";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { distribuirReservaProyecto, optimizarCobertura, asignarUnidades } from "@/lib/plan/optimizar-materiales";
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
export type MaterialEstimateProduct = {
  id: string;
  familiaId?: string;
  nombre: string;
  categoria: string;
  colores: string[];
  descripcion: string;
  precio?: number;
  unidadesPaquete?: number;
  paquetes?: number;
  tamanoCodigo?: string;
  forma?: string;
  diamPulg?: number;
};

type MaterialEstimateValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function normalizar(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function positivoONull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function colorCoincide(demandColor: string | undefined, productColors: string[]): boolean {
  if (!demandColor) return true;
  const demand = normalizar(demandColor);
  return productColors.some((color) => {
    const candidate = normalizar(color);
    return candidate === demand || candidate.includes(demand) || demand.includes(candidate);
  });
}

function esGlobo(product: MaterialEstimateProduct): boolean {
  if (/corazon|heart|foil|numero|letra/i.test(`${product.categoria} ${product.nombre} ${product.descripcion}`)) return false;
  return product.diamPulg != null || /globo|balloon|latex|metalizad|redondo|fashion|reflex|satin/i.test(`${product.categoria} ${product.nombre} ${product.descripcion}`);
}

function paquete(product: MaterialEstimateProduct): { units: number; packages: number; capacity: number } {
  const units = Math.max(1, Math.round(product.unidadesPaquete ?? 1));
  const packages = Math.max(1, Math.round(product.paquetes ?? 1));
  return { units, packages, capacity: units * packages };
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

function physicalWarnings(design: DesignMaterialEstimate["design"], total: number): string[] {
  if (design.installation_length_m == null || design.installation_length_m <= 0 || total <= 0) return [];

  // This is a transparent preflight heuristic, not a replacement for field
  // calibration. It scales with the physical extent and density instead of
  // hardcoding a balloon count for a particular decoration type.
  const minimumPerMeter = { low: 8, medium: 14, high: 20 }[design.visual_density];
  const maximumPerMeter = { low: 48, medium: 68, high: 88 }[design.visual_density];
  const perMeter = total / design.installation_length_m;
  const warnings: string[] = [];
  if (perMeter < minimumPerMeter * 0.6) {
    warnings.push(`estimated material quantity appears too low for ${design.visual_density} density over ${design.installation_length_m.toFixed(2)} m (${total} installed balloons)`);
  }
  if (perMeter > maximumPerMeter * 1.3) {
    warnings.push(`estimated material quantity appears unusually high for ${design.visual_density} density over ${design.installation_length_m.toFixed(2)} m (${total} installed balloons)`);
  }
  return warnings;
}

function totals(balloons: DesignMaterialEstimate["balloons"], special: DesignMaterialEstimate["special_elements"], purchases: DesignMaterialEstimate["purchases"]): DesignMaterialEstimate["totals"] {
  const designQuantity = [...balloons, ...special].reduce((sum, line) => sum + line.design_quantity, 0);
  const targetWasteReserve = Math.ceil(balloons.reduce((sum, line) => sum + line.design_quantity, 0) * MERMA);
  const coveredWasteReserve = purchases.reduce((sum, line) => sum + line.waste_reserve, 0);
  const requiredQuantity = purchases.reduce((sum, line) => sum + line.required_quantity, 0);
  const wasteAdjustedQuantity = requiredQuantity;
  const purchaseQuantity = purchases.reduce((sum, line) => sum + line.purchase_quantity, 0);
  const operationalSurplus = purchases.reduce((sum, line) => sum + line.operational_surplus, 0);
  const potentialSurplus = purchases.reduce((sum, line) => sum + line.potential_surplus, 0);
  const wasteOnlySavingsCop = purchases.reduce((sum, line) => {
    const unitPrice = line.package_count > 0 ? line.purchase_cost / line.package_count : 0;
    const basePackages = Math.ceil(line.design_quantity / line.units_per_package);
    const naivePackages = Math.ceil(Math.ceil(line.design_quantity * (1 + MERMA)) / line.units_per_package);
    return sum + Math.max(0, (naivePackages - basePackages) * unitPrice);
  }, 0);
  return {
    design_quantity: designQuantity,
    target_waste_reserve: targetWasteReserve,
    covered_waste_reserve: coveredWasteReserve,
    uncovered_waste_reserve: Math.max(0, targetWasteReserve - coveredWasteReserve),
    natural_package_surplus: purchases.reduce((sum, line) => sum + Math.max(0, line.purchase_quantity - line.design_quantity), 0),
    required_quantity: requiredQuantity,
    consumption_cost: purchases.reduce((sum, line) => sum + line.consumption_cost, 0),
    purchase_cost: purchases.reduce((sum, line) => sum + line.purchase_cost, 0),
    waste_only_savings_cop: Math.round(wasteOnlySavingsCop),
    additional_waste_packages: purchases.filter((line) => line.additional_package_for_waste).reduce((sum, line) => sum + line.package_count, 0),
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

function purchaseLines(products: MaterialEstimateProduct[], designByProduct: Map<string, number>): DesignMaterialEstimate["purchases"] {
  const groups = new Map<string, MaterialEstimateProduct[]>();
  for (const product of products) {
    const key = `${product.familiaId ?? product.id}|${product.diamPulg ?? "special"}|${normalizar(product.colores[0] ?? "")}|${product.forma ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  const baseLines: DesignMaterialEstimate["purchases"] = [];
  for (const groupProducts of groups.values()) {
    const first = groupProducts[0]!;
    const totalDesign = groupProducts.reduce((sum, product) => sum + (designByProduct.get(product.id) ?? 0), 0);
    if (totalDesign <= 0) continue;
    if (!esGlobo(first)) {
      const product = groupProducts.find((candidate) => (designByProduct.get(candidate.id) ?? 0) > 0) ?? first;
      const physical = paquete(product);
      const designQuantity = designByProduct.get(product.id) ?? totalDesign;
      const packageCount = Math.max(physical.packages, Math.ceil(Math.max(1, designQuantity) / physical.units));
      const purchaseQuantity = packageCount * physical.units;
      const purchaseCost = packageCount * (product.precio ?? 0);
      baseLines.push({
        product_id: product.familiaId ?? product.id,
        variant_id: product.id,
        design_quantity: designQuantity,
        waste_reserve: 0,
        required_quantity: designQuantity,
        waste_adjusted_quantity: designQuantity,
        units_per_package: physical.units,
        package_count: packageCount,
        purchase_quantity: purchaseQuantity,
        used: designQuantity,
        leftover_inventory: Math.max(0, purchaseQuantity - designQuantity),
        consumption_cost: purchaseQuantity > 0 ? Math.round(purchaseCost * designQuantity / purchaseQuantity) : 0,
        purchase_cost: purchaseCost,
        additional_package_for_waste: false,
        operational_surplus: Math.max(0, purchaseQuantity - designQuantity),
        potential_surplus: Math.max(0, purchaseQuantity - designQuantity),
      });
      continue;
    }
    const opciones = groupProducts.map((product) => {
      const physical = paquete(product);
      return { variantId: product.id, unidadesPaquete: physical.units, precio: product.precio ?? 0, minPaquetes: physical.packages };
    });
    const cobertura = optimizarCobertura(totalDesign, opciones);
    if (!cobertura) continue;
    const asignadas = asignarUnidades(totalDesign, cobertura.compras);
    const productsById = new Map(groupProducts.map((product) => [product.id, product]));
    for (const compra of cobertura.compras) {
      const product = productsById.get(compra.variantId);
      if (!product) continue;
      const designQuantity = asignadas.get(compra.variantId) ?? 0;
      const purchaseQuantity = compra.capacidad;
      const purchaseCost = compra.paquetes * (product.precio ?? 0);
      baseLines.push({
        product_id: product.familiaId ?? product.id,
        variant_id: product.id,
        design_quantity: designQuantity,
        waste_reserve: 0,
        required_quantity: designQuantity,
        waste_adjusted_quantity: designQuantity,
        units_per_package: compra.unidadesPaquete,
        package_count: compra.paquetes,
        purchase_quantity: purchaseQuantity,
        used: designQuantity,
        leftover_inventory: Math.max(0, purchaseQuantity - designQuantity),
        consumption_cost: purchaseQuantity > 0 ? Math.round(purchaseCost * designQuantity / purchaseQuantity) : 0,
        purchase_cost: purchaseCost,
        additional_package_for_waste: false,
        operational_surplus: Math.max(0, purchaseQuantity - designQuantity),
        potential_surplus: Math.max(0, purchaseQuantity - designQuantity),
      });
    }
  }
  const reserva = distribuirReservaProyecto(
    baseLines.map((line) => ({
      id: line.variant_id,
      designQuantity: line.design_quantity,
      purchaseQuantity: line.purchase_quantity,
      compatibilityKey: (() => {
        const product = products.find((candidate) => candidate.id === line.variant_id);
        return `${product?.familiaId ?? line.product_id}|${product?.diamPulg ?? "special"}|${normalizar(product?.colores[0] ?? "")}|${product?.forma ?? ""}`;
      })(),
      eligible: products.some((product) => product.id === line.variant_id && esGlobo(product)),
    })),
    MERMA,
  );
  return baseLines.map((line) => {
    const wasteReserve = reserva.allocations.get(line.variant_id) ?? 0;
    const requiredQuantity = line.design_quantity + wasteReserve;
    return {
      ...line,
      waste_reserve: wasteReserve,
      required_quantity: requiredQuantity,
      waste_adjusted_quantity: requiredQuantity,
      used: line.design_quantity,
      leftover_inventory: Math.max(0, line.purchase_quantity - requiredQuantity),
      consumption_cost: line.purchase_quantity > 0 ? Math.round(line.purchase_cost * requiredQuantity / line.purchase_quantity) : 0,
      operational_surplus: Math.max(0, line.purchase_quantity - requiredQuantity),
    };
  });
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

export function estimateFromMeasuredMaterials(measures: ResultadoMedidas | undefined, products: MaterialEstimateProduct[]): DesignMaterialEstimate {
  const demands = (measures?.despiece ?? []).filter((line) => line.cantidad > 0).map((line) => ({ ...line, remaining: line.cantidad }));
  const balloons = products.filter(esGlobo);
  const designByProduct = new Map<string, number>();
  const warnings: string[] = [];

  for (const demand of demands) {
    let candidates = balloons.filter((product) => product.diamPulg === demand.pulgadas && colorCoincide(demand.color, product.colores));
    if (candidates.length === 0) {
      candidates = balloons.filter((product) => product.diamPulg === demand.pulgadas);
      if (candidates.length > 0) warnings.push(`color demand '${demand.color ?? "unspecified"}' for R-${demand.pulgadas} was assigned to the available catalog color`);
    }
    if (candidates.length === 0) {
      warnings.push(`no selected catalog material covers R-${demand.pulgadas}${demand.color ? ` ${demand.color}` : ""}`);
      continue;
    }
    const base = Math.floor(demand.remaining / candidates.length);
    let remainder = demand.remaining - base * candidates.length;
    for (const candidate of candidates) {
      const quantity = base + (remainder > 0 ? 1 : 0);
      remainder -= 1;
      designByProduct.set(candidate.id, (designByProduct.get(candidate.id) ?? 0) + quantity);
    }
  }

  for (const product of products) {
    if (!esGlobo(product)) {
      designByProduct.set(product.id, 1);
      continue;
    }
    if (designByProduct.has(product.id)) continue;
    const physical = paquete(product);
    designByProduct.set(product.id, measures ? 0 : physical.capacity);
    if (measures) warnings.push(`selected balloon ${product.nombre} has no matching measured demand; its package capacity is not used as installed design quantity`);
    else warnings.push(`no geometric estimate was supplied for ${product.nombre}; package capacity is used as a provisional installed quantity`);
  }

  const balloonLines = products.filter((product) => esGlobo(product) && (designByProduct.get(product.id) ?? 0) > 0).map((product) => {
    const designQuantity = designByProduct.get(product.id) ?? 0;
    return {
      product_id: product.familiaId ?? product.id,
      variant_id: product.id,
      color: product.colores[0] ?? null,
      finish: null,
      size_inches: product.diamPulg ?? null,
      shape: product.forma ?? "redondo",
      design_quantity: designQuantity,
      waste_reserve: 0,
      required_quantity: designQuantity,
      waste_adjusted_quantity: designQuantity,
    };
  });
  const specialElements = products.filter((product) => !esGlobo(product)).map((product) => ({
    product_id: product.familiaId ?? product.id,
    variant_id: product.id,
    color: product.colores[0] ?? null,
    finish: null,
    size_inches: null,
    shape: null,
    design_quantity: 1,
    waste_reserve: 0,
    required_quantity: 1,
    waste_adjusted_quantity: 1,
  }));
  const designQuantity = [...balloonLines, ...specialElements].reduce((sum, line) => sum + line.design_quantity, 0);
  const design = baseDesign({
    type: measures?.figura ?? "catalog_selection",
    shape: measures?.figura ?? null,
    width: measures?.anchoM ?? null,
    height: measures?.altoM ?? null,
    length: measures?.largoM ?? null,
    installationLength: measures?.ejeM ?? null,
    density: measures?.supuestos.find((item) => /densidad\s+(sencilla|media|lujosa)/i.test(item))?.match(/densidad\s+(sencilla|media|lujosa)/i)?.[1],
    clusterCount: 1,
  }, designQuantity);
  return withWarnings({ version: "design-material-estimate-v1", design, balloons: balloonLines, special_elements: specialElements, purchases: purchaseLines(products, designByProduct) }, [...warnings, ...physicalWarnings(design, designQuantity)]);
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
    density: plan.plan.estructuras.some((structure) => structure.densidad === "lujosa") ? "lujosa" : plan.plan.estructuras.some((structure) => structure.densidad === "media") ? "media" : "sencilla",
    clusterCount: plan.plan.estructuras.reduce((sum, structure) => sum + structure.repeticiones, 0),
  }, totalDesign);
  return withWarnings({ version: "design-material-estimate-v1", design, balloons, special_elements: specialElements, purchases }, [...plan.advertencias, ...physicalWarnings(design, totalDesign)]);
}

export function validateMaterialEstimate(estimate: DesignMaterialEstimate): MaterialEstimateValidation {
  const errors: string[] = [];
  const warnings = [...estimate.warnings];
  const calculated = totals(estimate.balloons, estimate.special_elements, estimate.purchases);
  if (JSON.stringify(calculated) !== JSON.stringify(estimate.totals)) errors.push("material estimate totals do not match its lines");
  for (const purchase of estimate.purchases) {
    if (purchase.purchase_quantity < purchase.waste_adjusted_quantity) errors.push(`purchase capacity is below waste-adjusted demand for ${purchase.variant_id}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function blockingPhysicalWarnings(estimate: DesignMaterialEstimate): string[] {
  return estimate.warnings.filter((warning) => /estimated material quantity appears too low|estimated material quantity appears unusually high/i.test(warning));
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
