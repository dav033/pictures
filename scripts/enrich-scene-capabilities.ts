// Enriquecimiento con evidencia (Tarea 03.1, PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md,
// Plan 03). Recorre el catálogo real ya publicado en `catalog_products`
// (Postgres, la fuente de verdad — nunca el seed SQLite ni `manualProducts`),
// deriva funciones de escena candidatas por reglas de texto deterministas
// (`deriveSceneCapabilities`, que reutiliza `adaptCatalogProductV2ToV3` de
// `src/lib/rag/sources/provenance.ts`), y opcionalmente las persiste en
// `catalog_items` / `catalog_product_capabilities` con auditoría en
// `catalog_source_audit`.
//
//   --dry-run        calcula y reporta; NUNCA escribe en la base de datos.
//                     Determinista: la misma entrada de catálogo produce
//                     exactamente el mismo reporte en corridas sucesivas.
//   --limit N         procesa como máximo N productos (por defecto: todo el
//                     catálogo publicado). Útil para una corrida real
//                     pequeña y reversible durante verificación.
//   --offset N         salta los primeros N productos (orden estable por
//                     product_id). Por defecto 0.
//   --page-size N       tamaño de página de lectura desde Postgres (por
//                     defecto 500). No afecta el resultado, solo el
//                     tamaño de cada consulta.
//   --actor STR         valor de `catalog_source_audit.actor` en modo real
//                     (por defecto "enrich-scene-capabilities").
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { CatalogProductSchema, type CatalogProduct } from "../src/lib/rag/catalog/schemas";
import { deriveSceneCapabilities, type DeriveSceneCapabilitiesResult } from "../src/lib/rag/catalog/derive-scene-capabilities";
import { persistSceneCapabilities } from "../src/lib/rag/catalog/persist-staged";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

type CliOptions = {
  dryRun: boolean;
  limit: number | null;
  offset: number;
  pageSize: number;
  actor: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, limit: null, offset: 0, pageSize: 500, actor: "enrich-scene-capabilities" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--limit requiere un entero positivo");
      options.limit = Math.floor(value);
    } else if (arg === "--offset") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) throw new Error("--offset requiere un entero >= 0");
      options.offset = Math.floor(value);
    } else if (arg === "--page-size") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--page-size requiere un entero positivo");
      options.pageSize = Math.floor(value);
    } else if (arg === "--actor") {
      const value = argv[++i];
      if (!value) throw new Error("--actor requiere un valor");
      options.actor = value;
    } else {
      throw new Error(`argumento no reconocido: ${arg}`);
    }
  }
  return options;
}

type ProductRow = {
  product_id: string;
  handle: string;
  title: string;
  description_text: string | null;
  vendor: string | null;
  product_type: string | null;
  tags: string[];
  image_urls: string[];
  status: string;
  available: boolean;
  price_min: number | null;
  price_max: number | null;
  derived: unknown;
  source_payload: unknown;
  search_text: string | null;
  embedding_source_hash: string | null;
  source_updated_at: string | null;
};

async function fetchProductPage(pool: Pool, offset: number, limit: number): Promise<ProductRow[]> {
  const { rows } = await pool.query<ProductRow>(
    `SELECT product_id, handle, title, description_text, vendor, product_type, tags, image_urls,
            status, available, price_min::float8 AS price_min, price_max::float8 AS price_max,
            derived, source_payload, search_text, embedding_source_hash,
            source_updated_at::text AS source_updated_at
       FROM catalog_products
      ORDER BY product_id
      OFFSET $1 LIMIT $2`,
    [offset, limit],
  );
  return rows;
}

async function countRows(pool: Pool, table: "catalog_items" | "catalog_product_capabilities" | "catalog_source_audit"): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(rows[0]?.count ?? 0);
}

type FunctionBucket = { derived: number; review: number };

type Report = {
  scanned_products: number;
  processed_products: number;
  invalid_products: number;
  items_needing_review: number;
  items_with_zero_capabilities: number;
  capabilities_total: number;
  capabilities_derived: number;
  capabilities_review: number;
  category_v3_distribution: Record<string, number>;
  function_distribution: Record<string, FunctionBucket>;
};

function emptyReport(): Report {
  return {
    scanned_products: 0,
    processed_products: 0,
    invalid_products: 0,
    items_needing_review: 0,
    items_with_zero_capabilities: 0,
    capabilities_total: 0,
    capabilities_derived: 0,
    capabilities_review: 0,
    category_v3_distribution: {},
    function_distribution: {},
  };
}

function accumulate(report: Report, result: DeriveSceneCapabilitiesResult): void {
  report.processed_products++;
  if (result.needsReview) report.items_needing_review++;
  if (result.capabilities.length === 0) report.items_with_zero_capabilities++;
  report.category_v3_distribution[result.categoryV3] = (report.category_v3_distribution[result.categoryV3] ?? 0) + 1;
  for (const capability of result.capabilities) {
    report.capabilities_total++;
    if (capability.derived_from === "derived") report.capabilities_derived++;
    else report.capabilities_review++;
    const bucket = report.function_distribution[capability.scene_function] ?? { derived: 0, review: 0 };
    bucket[capability.derived_from]++;
    report.function_distribution[capability.scene_function] = bucket;
  }
}

function toCatalogProduct(row: ProductRow): CatalogProduct {
  return CatalogProductSchema.parse({
    product_id: row.product_id,
    handle: row.handle,
    title: row.title,
    description_text: row.description_text,
    vendor: row.vendor,
    product_type: row.product_type,
    tags: row.tags,
    image_urls: row.image_urls,
    status: row.status,
    available: row.available,
    price_min: row.price_min,
    price_max: row.price_max,
    derived: row.derived,
    source_payload: row.source_payload,
    // Ambos campos son NOT NULL en el contrato Zod pero nullable en la
    // columna de Postgres; un fallback vacío evita rechazar un producto real
    // solo por metadata de búsqueda faltante (no afecta la derivación de
    // capacidades, que nunca lee estos dos campos).
    search_text: row.search_text ?? "",
    embedding_source_hash: row.embedding_source_hash ?? "",
    source_updated_at: row.source_updated_at,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada.");
  const pool = new Pool({ connectionString: url });

  try {
    const { rows: totalRows } = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM catalog_products");
    const totalProductsInCatalog = Number(totalRows[0]?.count ?? 0);
    const effectiveLimit = options.limit ?? Math.max(totalProductsInCatalog - options.offset, 0);

    const report = emptyReport();
    const results: DeriveSceneCapabilitiesResult[] = [];
    const invalidReasons: string[] = [];

    let offset = options.offset;
    let remaining = effectiveLimit;
    while (remaining > 0) {
      const pageSize = Math.min(options.pageSize, remaining);
      const rows = await fetchProductPage(pool, offset, pageSize);
      if (rows.length === 0) break;

      for (const row of rows) {
        report.scanned_products++;
        let producto: CatalogProduct;
        try {
          producto = toCatalogProduct(row);
        } catch (error) {
          report.invalid_products++;
          invalidReasons.push(`${row.product_id}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const result = deriveSceneCapabilities(producto);
        results.push(result);
        accumulate(report, result);
      }

      offset += rows.length;
      remaining -= rows.length;
      if (rows.length < pageSize) break;
    }

    if (options.dryRun) {
      const beforeItems = await countRows(pool, "catalog_items");
      const beforeCapabilities = await countRows(pool, "catalog_product_capabilities");
      const beforeAudit = await countRows(pool, "catalog_source_audit");

      console.log(JSON.stringify({ mode: "dry-run", total_products_in_catalog: totalProductsInCatalog, ...report }, null, 2));

      const afterItems = await countRows(pool, "catalog_items");
      const afterCapabilities = await countRows(pool, "catalog_product_capabilities");
      const afterAudit = await countRows(pool, "catalog_source_audit");
      const untouched = beforeItems === afterItems && beforeCapabilities === afterCapabilities && beforeAudit === afterAudit;

      console.log(
        `[${untouched ? "PASS" : "FAIL"}] --dry-run no modificó filas: ` +
          `catalog_items ${beforeItems}->${afterItems}, ` +
          `catalog_product_capabilities ${beforeCapabilities}->${afterCapabilities}, ` +
          `catalog_source_audit ${beforeAudit}->${afterAudit}`,
      );
      if (invalidReasons.length) {
        console.error(`[INFO] productos con datos inválidos (schema, omitidos): ${invalidReasons.length}`);
        for (const reason of invalidReasons.slice(0, 20)) console.error(`  - ${reason}`);
      }
      if (!untouched) process.exitCode = 1;
      return;
    }

    const persisted = await persistSceneCapabilities(pool, results, { actor: options.actor });
    console.log(
      JSON.stringify(
        { mode: "write", total_products_in_catalog: totalProductsInCatalog, ...report, persisted },
        null,
        2,
      ),
    );
    if (invalidReasons.length) {
      console.error(`[INFO] productos con datos inválidos (schema, omitidos): ${invalidReasons.length}`);
      for (const reason of invalidReasons.slice(0, 20)) console.error(`  - ${reason}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] enrich-scene-capabilities: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
