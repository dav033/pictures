/**
 * Lectura de los vectores golden de
 * `contracts/domain/v1/golden/plan-resolution`.
 *
 * Los 28 vectores son el cerrojo de regresión del resolutor, y desde el paso 5
 * del ADR-0023 ese resolutor sólo existe en Python: quien los recorre para
 * comparar conteos es `services/ai-api/tests/test_plan_parity.py`. Aquí queda
 * lo que el lado TypeScript sigue necesitando de ellos: cargarlos y leer su
 * bloque `expected` como fixture congelado. Con el resolutor TypeScript se
 * fueron el comparador de paridad (`scripts/test-paridad-plan-python.ts`), la
 * suite de invariantes (`scripts/test-invariantes-plan.ts`), el doble del
 * `Pool` que ambas usaban y el generador de las tres formas de la UI.
 *
 * Módulo importable a propósito (AGENTS.md, "Keep scripts import-safe"): aquí
 * no hay CLI ni efectos al cargar. Nada de esto necesita base de datos ni red.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { MaterialEstimateSchema, type DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { PLAN_RESUELTO_CONTRACT_VERSION, PlanResolutionResultV1Schema, PlanResueltoV1Schema } from "@/lib/ia/contracts/domain-v1";
import { planResueltoDesdePython } from "@/lib/plan/python-mapper";
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

/**
 * `expected` es un oráculo congelado: lo escribió una implementación
 * independiente y desde el paso 3 del ADR-0023 solo se cambia editando a mano
 * el JSON del vector. Ningún script lo regenera.
 */
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

const VECTORS_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "domain",
  "v1",
  "golden",
  "plan-resolution",
);

/**
 * Ningún script escribe ya el archivo de un vector, ni lo resuelve. Aquí
 * vivieron el escritor del bloque `expected` (retirado en el paso 3 del
 * ADR-0023, que lo congeló como oráculo editable sólo a mano) y después
 * `resolverVector`, con su doble del `Pool`, y `formasDeUiDesdeTypeScript`, que
 * calculaban plan, estimado y cotización con el resolutor TypeScript para
 * compararlos contra ese oráculo. El paso 5 borra ese resolutor: la comparación
 * la hace ahora `test_plan_parity.py` desde Python. Con ellos se fueron los
 * ayudantes que sólo existían para serializarlos (`jsonCompatible`,
 * `withoutNonDomainPlanFields`).
 */

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

/**
 * Un vector por nombre de fichero, sin su extensión (`"20-tamanos-obligatorios"`).
 * Falla nombrando los vectores disponibles: un nombre mal escrito en un test es
 * un error del test, no un vector que haya que inventar.
 */
export function loadVector(nombre: string): GoldenVector {
  const file = join(VECTORS_DIRECTORY, `${nombre}.json`);
  let contenido: string;
  try {
    contenido = readFileSync(file, "utf8");
  } catch {
    const disponibles = readdirSync(VECTORS_DIRECTORY, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.replace(/\.json$/, ""))
      .sort();
    throw new Error(`No existe el vector golden "${nombre}". Disponibles: ${disponibles.join(", ")}`);
  }
  const parsed: unknown = JSON.parse(contenido);
  return GoldenVectorSchema.parse(parsed);
}

/**
 * `request_id` fijo para los planes congelados, aquí y en
 * `scripts/lib/planes-fijados.ts`. Lo emite el servidor en producción y ningún
 * oráculo congelado lo guarda; un fixture que lo generase al azar dejaría de
 * ser reproducible entre ejecuciones. No entra en `plan_hash` (el JSON
 * canónico es `{plan, snapshot}`).
 */
export const REQUEST_ID_PLAN_FIJADO = "00000000-0000-4000-8000-000000000000";

/** `elementosOrigen` de una línea cotizada: unión discriminada, como `OrigenLineaPlan`. */
const OrigenLineaFijadaSchema = z.union([
  z.object({ kind: z.literal("estructura"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("prop"), id: z.string().min(1) }).strict(),
]);

/**
 * `expected.quote` es una `Cotizacion` de la UI (camelCase), no el `quote.v1`
 * del transporte, así que no hay esquema publicado que la valide. Este describe
 * exactamente `LineaCotizada`/`Cotizacion`: la firma de `planFijadoDeVector`
 * devuelve `Cotizacion`, de modo que si esos tipos cambian y el esquema no, el
 * chequeo de tipos falla aquí en vez de dejar pasar un fixture incompleto.
 * `.strict()` para que una clave sobrante en un vector se vea.
 */
const LineaCotizadaFijadaSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1).optional(),
  tamano: z.string(),
  tamanoCodigo: z.string().optional(),
  diamPulg: z.number().optional(),
  estructuras: z.array(z.string().min(1)).optional(),
  elementosOrigen: z.array(OrigenLineaFijadaSchema).optional(),
  referenciaElementIds: z.array(z.string().min(1)).optional(),
  color: z.string().optional(),
  cantidadNecesaria: z.number(),
  designQuantity: z.number().optional(),
  wasteReserve: z.number().optional(),
  requiredQuantity: z.number().optional(),
  purchaseQuantity: z.number().optional(),
  used: z.number().optional(),
  leftoverInventory: z.number().optional(),
  consumptionCost: z.number().optional(),
  purchaseCost: z.number().optional(),
  additionalPackageForWaste: z.boolean().optional(),
  disponible: z.boolean(),
  varianteId: z.string().min(1).optional(),
  nombre: z.string().optional(),
  categoria: z.string().optional(),
  colores: z.array(z.string()).optional(),
  foto: z.string().optional(),
  descripcion: z.string().optional(),
  precioPaquete: z.number().optional(),
  unidadesPaquete: z.number().optional(),
  paquetes: z.number().optional(),
  subtotal: z.number().optional(),
  sobrante: z.number().optional(),
  sinReferencia: z.boolean().optional(),
}).strict();

const CotizacionFijadaSchema = z.object({
  lineas: z.array(LineaCotizadaFijadaSchema),
  total: z.number(),
  mermaPorcentaje: z.number(),
  incluyeIva: z.boolean(),
  complementosSoportados: z.literal(false),
  purchaseCost: z.number().optional(),
  consumptionCost: z.number().optional(),
  targetWasteReserve: z.number().optional(),
  coveredWasteReserve: z.number().optional(),
  leftoverInventory: z.number().optional(),
  plan_hash: z.string().min(1).optional(),
}).strict();

/** Las tres formas congeladas de un vector, listas para usar como fixture. */
export type PlanFijado = {
  /** El vector del que salen, por si el test necesita su catálogo o su allowlist. */
  vector: GoldenVector;
  plan: PlanResuelto;
  materialEstimate: DesignMaterialEstimate;
  cotizacion: Cotizacion;
};

/**
 * El `PlanResuelto`, el estimado de materiales y la cotización **congelados**
 * de un vector dorado: se leen de su bloque `expected`, no se recalculan.
 *
 * Por qué existe. Varios scripts llamaban a `resolverPlan`, `estimateFromPlan`
 * o `cotizarPlan` sólo como fábrica de fixtures: necesitan un `PlanResuelto`
 * para probar otra cosa (el prompt de imagen, el QA visual, el caption LoRA, el
 * desglose). El paso 5 del ADR-0023 borró ese resolutor, y sustituirlo por una
 * llamada al servicio Python volvería esas pruebas dependientes de red y de un
 * proceso levantado, cuando hoy corren offline. `expected` ya es un oráculo
 * congelado desde el paso 3 del mismo ADR —lo escribió una implementación
 * independiente y sólo cambia editando el JSON a mano—, así que sirve de
 * fixture sin recalcular nada. Un escenario que no cabe en ningún vector usa
 * `scripts/lib/planes-fijados.ts`.
 *
 * Cómo. `expected.plan_resuelto` es el plan sin los campos que no son del
 * dominio: `withoutNonDomainPlanFields` quita `approval_token` y `request_id`,
 * y el bloque nunca llevó `schema_version`. Se reponen los dos que el contrato
 * necesita y el resultado pasa por `PlanResueltoV1Schema` y por el mismo
 * mapeador que usa producción con las respuestas de Python
 * (`planResueltoDesdePython`), en vez de por un cast. Un vector corrupto falla
 * en el parseo, nombrando el campo, en lugar de propagar basura hasta una
 * aserción lejana. `expected.material_estimate` y `expected.quote` se validan
 * igual, con `MaterialEstimateSchema` y con el esquema de arriba.
 *
 * Lo que NO hace: emitir `approval_token`. Un plan congelado es una entrada de
 * prueba, no una propuesta aprobada; quien necesite el token lo firma él.
 */
export function planFijadoDeVector(vector: GoldenVector): PlanFijado {
  const expected = vector.expected;
  assert.ok(expected, `${vector.name}: el vector no trae bloque \`expected\` y no puede dar un plan congelado`);
  const plan = planResueltoDesdePython(PlanResueltoV1Schema.parse({
    schema_version: PLAN_RESUELTO_CONTRACT_VERSION,
    request_id: REQUEST_ID_PLAN_FIJADO,
    ...expected.plan_resuelto,
  }));
  return {
    vector,
    plan,
    materialEstimate: MaterialEstimateSchema.parse(expected.material_estimate),
    cotizacion: CotizacionFijadaSchema.parse(expected.quote),
  };
}

/** Lo mismo, cargando el vector por su nombre de fichero (`"26-variant-override-sin-color"`). */
export function planFijadoDesdeVector(nombre: string): PlanFijado {
  return planFijadoDeVector(loadVector(nombre));
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
