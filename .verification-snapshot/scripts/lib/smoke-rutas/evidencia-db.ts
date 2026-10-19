import { setTimeout as esperar } from "node:timers/promises";
import { Pool } from "pg";

/**
 * Read-only evidence from the LOCAL PostgreSQL (loopback demo_rag, validated in
 * entorno.ts): published snapshot, audit rows written by Next, the durable
 * nonce store of FastAPI, and catalog rows used to build negative cases.
 */

export function crearPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
}

export async function snapshotsPublicados(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ source_snapshot_id: string }>(
    `SELECT source_snapshot_id
       FROM rag_source_snapshots
      WHERE source_kind = 'products_catalog' AND status = 'published'
      ORDER BY published_at DESC NULLS LAST`,
  );
  return rows.map((row) => row.source_snapshot_id);
}

export async function contarNonces(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ total: string }>("SELECT count(*)::text AS total FROM operational.operational_request_nonces");
  return Number(rows[0]?.total ?? 0);
}

export type FilaAuditoria = { status: string; plan_hash: string | null; created_at: Date };

export async function filasAuditoria(pool: Pool, filtro: { requestId: string; planHash?: string; estados?: string[]; desde?: Date }): Promise<FilaAuditoria[]> {
  const { rows } = await pool.query<FilaAuditoria>(
    `SELECT status, plan_hash, created_at
       FROM plan_audit_log
      WHERE request_id = $1::uuid
        AND ($2::text IS NULL OR plan_hash = $2::text)
        AND ($3::text[] IS NULL OR status = ANY($3::text[]))
        AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz)
      ORDER BY created_at DESC`,
    [filtro.requestId, filtro.planHash ?? null, filtro.estados ?? null, filtro.desde ?? null],
  );
  return rows;
}

/** Audit writes are queued by the routes; poll briefly before concluding absence. */
export async function esperarAuditoria(pool: Pool, filtro: Parameters<typeof filasAuditoria>[1], timeoutMs = 10_000): Promise<FilaAuditoria[]> {
  const limite = Date.now() + timeoutMs;
  while (true) {
    const filas = await filasAuditoria(pool, filtro);
    if (filas.length > 0 || Date.now() >= limite) return filas;
    await esperar(500);
  }
}

export type VarianteCatalogo = {
  variant_id: string;
  product_id: string;
  source_snapshot_id: string | null;
  codigo_tamano: string | null;
  available: boolean;
};

export async function variantesPorId(pool: Pool, ids: readonly string[]): Promise<Map<string, VarianteCatalogo>> {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<VarianteCatalogo>(
    `SELECT variant_id, product_id, source_snapshot_id, codigo_tamano, available
       FROM catalog_variants
      WHERE variant_id = ANY($1::text[])`,
    [[...new Set(ids)]],
  );
  return new Map(rows.map((row) => [row.variant_id, row]));
}

/** A published, available variant of the snapshot that is outside `excluidas`. */
export async function varianteFueraDe(pool: Pool, snapshotId: string, excluidas: readonly string[], productosExcluidos: readonly string[] = []): Promise<VarianteCatalogo | null> {
  const { rows } = await pool.query<VarianteCatalogo>(
    `SELECT v.variant_id, v.product_id, v.source_snapshot_id, v.codigo_tamano, v.available
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.source_snapshot_id = $1
        AND p.source_snapshot_id = $1
        AND v.available = true
        AND p.available = true
        AND p.status = 'ACTIVE'
        AND NOT (v.variant_id = ANY($2::text[]))
        AND NOT (v.product_id = ANY($3::text[]))
      ORDER BY v.product_id, v.variant_id
      LIMIT 1`,
    [snapshotId, [...excluidas], [...productosExcluidos]],
  );
  return rows[0] ?? null;
}
