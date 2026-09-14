/**
 * Vectores dorados compartidos por los dos resolutores de plan.
 *
 * Cada vector de `contracts/domain/v1/golden/plan-resolution` describe un
 * catálogo, una allowlist same-turn y un Plan 1.0, y guarda dos expectativas:
 *
 * - `expected`: lo que produce el resolutor TypeScript, en las formas que
 *   consume la UI (`PlanResuelto`, `DesignMaterialEstimate`, `Cotizacion`).
 * - `expected_python`: el payload `plan-resolution-result.v1` que produce el
 *   servicio Python, regenerado por `services/ai-api/tests/test_plan_parity.py`.
 *
 * Modos:
 * - por defecto, bloqueo de regresión del resolutor TypeScript contra `expected`;
 * - `--update`, regenera `expected` tras un cambio intencional de TypeScript;
 * - `--paridad`, compara los dos backends pasando la respuesta Python por el
 *   mapper de producción. Esa es la puerta para poder activar
 *   `PYTHON_BACKEND_ENABLED`, y hoy todavía no pasa.
 *
 * Nada de esto necesita base de datos ni red: el catálogo del vector entra por
 * un doble del `Pool`, igual que en `scripts/test-resolver-plan.ts`.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { z } from "zod";
import { cotizarPlan } from "../src/lib/cotizacion/motor";
import { estimateFromPlan } from "../src/lib/materiales/estimacion";
import { PlanResolutionResultV1Schema } from "../src/lib/ia/contracts/domain-v1";
import { cotizacionDesdePython, planResueltoDesdePython } from "../src/lib/plan/python-mapper";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracionSchema, type PlanDecoracion } from "../src/lib/plan/tipos";
import type { CatalogAllowlist } from "../src/lib/rag/retrieval/types";
import { crearCatalogAllowlist } from "../src/lib/rag/retrieval/allowlist";
import type { PlanResuelto } from "../src/lib/plan/resuelto";

const CatalogRowSchema = z.object({
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

const AllowlistEntrySchema = z.object({
  product_id: z.string().min(1),
  variant_ids: z.array(z.string().min(1)),
}).strict();

const ExpectedSchema = z.object({
  plan_resuelto: z.record(z.string(), z.unknown()),
  material_estimate: z.record(z.string(), z.unknown()),
  quote: z.record(z.string(), z.unknown()),
}).strict();

const GoldenVectorSchema = z.object({
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

/**
 * Campos deliberadamente fuera de la comparación de paridad, cada uno con su
 * razón. No son puntos ciegos: `assertCamposExcluidos` comprueba aparte que los
 * dos backends los producen bien formados.
 *
 * - `plan_hash`: el ADR 0006 lo define por backend. Un plan se re-resuelve con
 *   el backend que lo produjo, así que los dos hashes no tienen que coincidir;
 *   lo que sí tiene que coincidir es todo el valor comercial.
 * - `merma_log`: texto para una persona, no un valor comercial.
 */
const CAMPOS_FUERA_DE_PARIDAD = ["plan_hash", "merma_log"] as const;

type GoldenVector = z.infer<typeof GoldenVectorSchema>;
type GoldenExpected = z.infer<typeof ExpectedSchema>;
type Diferencia = { path: string; expected: unknown; actual: unknown };

const VECTORS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "contracts", "domain", "v1", "golden", "plan-resolution");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, stableSort(item)]),
  );
}

function formatValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function jsonCompatible(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonCompatible);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, jsonCompatible(item)]),
  );
}

function jsonCompatibleRecord(value: Record<string, unknown>): Record<string, unknown> {
  const compatible = jsonCompatible(value);
  assert.ok(isRecord(compatible));
  return compatible;
}

/**
 * Todas las diferencias, no solo la primera: lo útil de esta suite es la lista
 * completa de lo que falta para activar el backend Python, y quedarse en la
 * primera clave que difiere esconde el resto del informe.
 */
function allDifferences(expected: unknown, actual: unknown, path: string, sink: Diferencia[]): Diferencia[] {
  if (Object.is(expected, actual)) return sink;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) sink.push({ path: `${path}.length`, expected: expected.length, actual: actual.length });
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      allDifferences(expected[index], actual[index], `${path}[${index}]`, sink);
    }
    return sink;
  }
  if (isRecord(expected) && isRecord(actual)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      if (!(key in expected)) sink.push({ path: `${path}.${key}`, expected: undefined, actual: actual[key] });
      else if (!(key in actual)) sink.push({ path: `${path}.${key}`, expected: expected[key], actual: undefined });
      else allDifferences(expected[key], actual[key], `${path}.${key}`, sink);
    }
    return sink;
  }
  sink.push({ path, expected, actual });
  return sink;
}

function describirDiferencias(name: string, diferencias: readonly Diferencia[], izquierda: string, derecha: string): string {
  const detalle = diferencias
    .slice(0, 20)
    .map((item) => `    ${item.path}: ${izquierda}=${formatValue(item.expected)} ${derecha}=${formatValue(item.actual)}`)
    .join("\n");
  const extra = diferencias.length > 20 ? `\n    ... y ${diferencias.length - 20} más` : "";
  return `${name}: ${diferencias.length} diferencia(s)\n${detalle}${extra}`;
}

function assertGoldenMatch(name: string, expected: unknown, actual: unknown): void {
  const diferencias = allDifferences(expected, actual, "", []);
  if (diferencias.length === 0) return;
  throw new Error(describirDiferencias(name, diferencias, "esperado", "obtenido"));
}

function withoutNonDomainPlanFields(plan: PlanResuelto | Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "approval_token" && key !== "request_id"),
  );
}

function sinCamposExcluidos(valor: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(valor).filter(([key]) => !(CAMPOS_FUERA_DE_PARIDAD as readonly string[]).includes(key)),
  );
}

function expectedFromTypeScript(plan: PlanResuelto): GoldenExpected {
  return ExpectedSchema.parse(jsonCompatible({
    plan_resuelto: withoutNonDomainPlanFields(plan),
    material_estimate: estimateFromPlan(plan),
    quote: cotizarPlan(plan) as unknown as Record<string, unknown>,
  }));
}

function loadVectors(): Array<{ file: string; vector: GoldenVector }> {
  return readdirSync(VECTORS_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const file = join(VECTORS_DIRECTORY, entry.name);
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      return { file, vector: GoldenVectorSchema.parse(parsed) };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function fakePool(rows: GoldenVector["catalog_rows"]): Pool {
  // El esquema del vector validó cada fila antes de llegar a este doble estrecho.
  return { query: async () => ({ rows }) } as unknown as Pool;
}

function loraAllowlist(vector: GoldenVector): CatalogAllowlist | null {
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

async function resolveWithTypeScript(vector: GoldenVector): Promise<GoldenExpected> {
  const plan: PlanDecoracion = PlanDecoracionSchema.parse(vector.plan);
  const whitelist = new Map(vector.allowlist.map((entry) => [entry.product_id, new Set(entry.variant_ids)]));
  const resuelto = await resolverPlan(fakePool(vector.catalog_rows), plan, whitelist, loraAllowlist(vector));
  return expectedFromTypeScript(resuelto);
}

/**
 * Lo excluido de la comparación no queda sin comprobar: los dos backends deben
 * seguir produciendo un hash de plan bien formado y un log de merma legible.
 */
function assertCamposExcluidos(name: string, lado: string, plan: Record<string, unknown>): void {
  const hash = plan["plan_hash"];
  assert.ok(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash), `${name} (${lado}): plan_hash no es un sha256 hexadecimal`);
  const log = plan["merma_log"];
  assert.ok(typeof log === "string" && log.trim().length > 0, `${name} (${lado}): merma_log vacío`);
}

/**
 * Paridad real: la respuesta Python pasa por el mapper de producción y se
 * compara contra la salida TypeScript en las mismas formas que consume la UI.
 * Hacer la comparación aquí evita además el ruido de 12 frente a 12.0: el JSON
 * que emite Python se parsea a números de JavaScript.
 */
function compararParidad(vector: GoldenVector, expectedTs: GoldenExpected): void {
  const resultadoPython = vector.expected_python;
  if (!resultadoPython) {
    throw new Error(`${vector.name}: falta expected_python; regenéralo con PARIDAD_ACTUALIZAR=1 pytest tests/test_plan_parity.py`);
  }
  const planPython = withoutNonDomainPlanFields(planResueltoDesdePython(resultadoPython.plan_resuelto));
  const cotizacionPython = jsonCompatibleRecord(cotizacionDesdePython(resultadoPython) as unknown as Record<string, unknown>);
  assertCamposExcluidos(vector.name, "typescript", expectedTs.plan_resuelto);
  assertCamposExcluidos(vector.name, "python", planPython);

  const diferencias: Diferencia[] = [];
  allDifferences(sinCamposExcluidos(expectedTs.plan_resuelto), sinCamposExcluidos(planPython), "plan_resuelto", diferencias);
  allDifferences(expectedTs.material_estimate, resultadoPython.material_estimate, "material_estimate", diferencias);
  allDifferences(sinCamposExcluidos(expectedTs.quote), sinCamposExcluidos(cotizacionPython), "cotizacion", diferencias);
  if (diferencias.length > 0) throw new Error(describirDiferencias(vector.name, diferencias, "typescript", "python"));
}

const USO = "Usage: tsx --conditions=react-server scripts/test-paridad-plan-python.ts [--update | --paridad]";

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  if (argumentos.length > 1 || argumentos.some((argumento) => argumento !== "--update" && argumento !== "--paridad")) {
    throw new Error(USO);
  }
  const update = argumentos[0] === "--update";
  const paridad = argumentos[0] === "--paridad";

  const vectors = loadVectors();
  if (vectors.length === 0) throw new Error(`No golden vectors found in ${VECTORS_DIRECTORY}`);

  const fallos: string[] = [];
  for (const { file, vector } of vectors) {
    const generated = await resolveWithTypeScript(vector);
    if (update) {
      const serialized = JSON.stringify(stableSort({ ...vector, expected: generated }), null, 2);
      if (serialized === undefined) throw new Error(`${vector.name}: vector could not be serialized`);
      writeFileSync(file, serialized + "\n", "utf8");
      console.log(`[UPDATED] ${vector.name}`);
      continue;
    }
    if (!vector.expected) throw new Error(`${vector.name}: falta expected; regenéralo con --update`);
    assertGoldenMatch(vector.name, vector.expected, generated);
    if (!paridad) {
      console.log(`[PASS] ${vector.name}`);
      continue;
    }
    // En modo paridad se recorren todos los vectores antes de fallar.
    try {
      compararParidad(vector, vector.expected);
      console.log(`[PARIDAD OK] ${vector.name}`);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      fallos.push(mensaje);
      console.log(`[PARIDAD FAIL] ${mensaje}`);
    }
  }
  if (fallos.length > 0) {
    throw new Error(`${fallos.length} vector(es) divergen entre el resolutor TypeScript y el Python.`);
  }
}

main().catch((error: unknown) => {
  console.error("[FAIL] plan parity golden vectors", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
