/**
 * Carga y resolución de los vectores golden de
 * `contracts/domain/v1/golden/plan-resolution`.
 *
 * Un solo dueño para lo que comparten las dos suites que los recorren:
 * `scripts/test-paridad-plan-python.ts` (bloqueo de regresión del resolutor
 * TypeScript y paridad cruzada con Python) y `scripts/test-invariantes-plan.ts`
 * (invariantes entre líneas, compras, estimado, cotización y bloques de
 * prompt). Antes de extraerlo, la segunda suite habría tenido que copiar el
 * esquema del vector y el doble del `Pool`, y una divergencia entre las dos
 * copias habría hecho que cada una probara un catálogo distinto.
 *
 * Módulo importable a propósito (AGENTS.md, "Keep scripts import-safe"): aquí
 * no hay CLI ni efectos al cargar. Nada de esto necesita base de datos ni red.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { z } from "zod";
import { cotizarPlan } from "@/lib/cotizacion/motor";
import { estimateFromPlan } from "@/lib/materiales/estimacion";
import { PlanResolutionResultV1Schema } from "@/lib/ia/contracts/domain-v1";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { crearCatalogAllowlist } from "@/lib/rag/retrieval/allowlist";
import type { PlanResuelto } from "@/lib/plan/resuelto";

export const CatalogRowSchema = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  sku: z.string().nullable(),
  sku_original: z.string().nullable(),
  source_snapshot_id: z.string().min(1),
  source_variant_id: z.string().nullable(),
  inventory_quantity: z.number().int().nullable(),
  unidades_inferidas: z.boolean().nullable(),
  producto_titulo: z.string().min(1),
  variante_titulo: z.string().nullable(),
  precio: z.number().positive(),
  unidades_paq: z.number().int().positive(),
  disponible: z.literal(true),
  producto_disponible: z.literal(true),
  codigo_tamano: z.string().nullable(),
  forma: z.string().nullable(),
  diam_pulg: z.number().nonnegative().nullable(),
  colores_producto: z.array(z.string()),
  colores_variante: z.array(z.string()),
  acabados_producto: z.array(z.string()),
  descripcion: z.string().nullable(),
  imagen: z.string().url().nullable(),
  currency: z.literal("COP"),
}).strict();

export const AllowlistEntrySchema = z.object({
  product_id: z.string().min(1),
  variant_ids: z.array(z.string().min(1)),
}).strict();

export const ExpectedSchema = z.object({
  plan_resuelto: z.record(z.string(), z.unknown()),
  material_estimate: z.record(z.string(), z.unknown()),
  quote: z.record(z.string(), z.unknown()),
}).strict();

export const GoldenVectorSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  catalog_snapshot_id: z.string().min(1),
  catalog_rows: z.array(CatalogRowSchema),
  allowlist: z.array(AllowlistEntrySchema),
  lora_variant_ids: z.array(z.string().min(1)).min(1).nullable(),
  plan: z.record(z.string(), z.unknown()),
  expected: ExpectedSchema.optional(),
  expected_python: PlanResolutionResultV1Schema.optional(),
}).strict();

export type CatalogRow = z.infer<typeof CatalogRowSchema>;
export type GoldenVector = z.infer<typeof GoldenVectorSchema>;
export type GoldenExpected = z.infer<typeof ExpectedSchema>;

export const VECTORS_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "domain",
  "v1",
  "golden",
  "plan-resolution",
);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonCompatible(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonCompatible);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, jsonCompatible(item)]),
  );
}

export function jsonCompatibleRecord(value: Record<string, unknown>): Record<string, unknown> {
  const compatible = jsonCompatible(value);
  assert.ok(isRecord(compatible));
  return compatible;
}

/** `approval_token` y `request_id` los emite el servidor, no el dominio del plan. */
export function withoutNonDomainPlanFields(plan: PlanResuelto | Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "approval_token" && key !== "request_id"),
  );
}

export function loadVectors(): Array<{ file: string; vector: GoldenVector }> {
  return readdirSync(VECTORS_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const file = join(VECTORS_DIRECTORY, entry.name);
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      return { file, vector: GoldenVectorSchema.parse(parsed) };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function fakePool(rows: readonly CatalogRow[]): Pool {
  // El esquema del vector validó cada fila antes de llegar a este doble estrecho.
  return { query: async () => ({ rows }) } as unknown as Pool;
}

export function loraAllowlist(vector: GoldenVector): CatalogAllowlist | null {
  // Solo `variantIds` decide la cobertura real del dataset (ver resolver.ts).
  // El dueño de cada variante sale de las filas del catálogo del vector, igual
  // que en producción sale de filas reales unidas por product_id.
  if (!vector.lora_variant_ids) return null;
  const duenoPorVariante = new Map(vector.catalog_rows.map((row) => [row.variant_id, row.product_id]));
  return crearCatalogAllowlist(vector.lora_variant_ids.map((variantId) => {
    const productId = duenoPorVariante.get(variantId);
    assert.ok(productId, `${vector.name}: la variante LoRA ${variantId} no está en catalog_rows`);
    return { productId, variantId };
  }));
}

/** El `PlanResuelto` que produce el resolutor TypeScript para este vector. */
export async function resolverVector(vector: GoldenVector): Promise<PlanResuelto> {
  const plan: PlanDecoracion = PlanDecoracionSchema.parse(vector.plan);
  const whitelist = new Map(vector.allowlist.map((entry) => [entry.product_id, new Set(entry.variant_ids)]));
  return resolverPlan(fakePool(vector.catalog_rows), plan, whitelist, loraAllowlist(vector));
}

/** Las tres formas que consume la UI, tal como las guarda `expected`. */
export function expectedFromTypeScript(plan: PlanResuelto): GoldenExpected {
  return ExpectedSchema.parse(jsonCompatible({
    plan_resuelto: withoutNonDomainPlanFields(plan),
    material_estimate: estimateFromPlan(plan),
    quote: cotizarPlan(plan) as unknown as Record<string, unknown>,
  }));
}
