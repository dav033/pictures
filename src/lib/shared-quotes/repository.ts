import "server-only";

import { z } from "zod";
import type { Pool } from "pg";
import type { OwnerSharedQuote, SharedQuoteStatus } from "./contracts";

export type NewSharedQuote = {
  id: string;
  schemaVersion: 1;
  sceneName: string;
  sceneRevisionHash: string;
  validUntil: string;
  totalCop: number;
  stillBytes: Buffer;
};

export type SharedQuoteRecord = {
  id: string;
  schemaVersion: number;
  sceneName: string;
  sceneRevisionHash: string;
  validUntil: string;
  totalCop: number;
  status: SharedQuoteStatus;
  customerName: string | null;
  comment: string | null;
  respondedAt: string | null;
  createdAt: string;
};

export type SharedQuoteRepository = {
  insert(record: NewSharedQuote): Promise<void>;
  findById(id: string): Promise<SharedQuoteRecord | null>;
  findStillById(id: string): Promise<Buffer | null>;
  listBySceneRevision(hash: string, limit: number): Promise<OwnerSharedQuote[]>;
  saveDecision(input: {
    id: string;
    validUntil: string;
    status: Exclude<SharedQuoteStatus, "pending">;
    customerName: string;
    comment: string | null;
  }): Promise<boolean>;
};

const PgIntegerSchema = z.union([
  z.number().int().safe(),
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().safe()),
]).pipe(z.number().nonnegative());

const SharedQuoteRowSchema = z.object({
  id: z.string().uuid(),
  schema_version: z.number().int(),
  scene_name: z.string().min(1).max(120),
  scene_revision_hash: z.string().regex(/^[0-9a-f]{64}$/),
  valid_until: z.string(),
  total_cop: PgIntegerSchema,
  status: z.enum(["pending", "approved", "changes_requested"]),
  customer_name: z.string().max(100).nullable(),
  customer_comment: z.string().max(2000).nullable(),
  responded_at: z.date().nullable(),
  created_at: z.date(),
}).strict();

function mapRecord(input: unknown): SharedQuoteRecord {
  const row = SharedQuoteRowSchema.parse(input);
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    sceneName: row.scene_name,
    sceneRevisionHash: row.scene_revision_hash,
    validUntil: row.valid_until,
    totalCop: row.total_cop,
    status: row.status,
    customerName: row.customer_name,
    comment: row.customer_comment,
    respondedAt: row.responded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = [
  "id",
  "schema_version",
  "scene_name",
  "scene_revision_hash",
  "valid_until::text AS valid_until",
  "total_cop",
  "status",
  "customer_name",
  "customer_comment",
  "responded_at",
  "created_at",
].join(", ");

export function createPostgresSharedQuoteRepository(pool: Pool): SharedQuoteRepository {
  return {
    async insert(record) {
      await pool.query(
        "INSERT INTO taller_quote_shares " +
          "(id, schema_version, scene_name, scene_revision_hash, valid_until, currency, total_cop, still_mime_type, still_bytes) " +
          "VALUES ($1, $2, $3, $4, $5::date, 'COP', $6, 'image/jpeg', $7)",
        [record.id, record.schemaVersion, record.sceneName, record.sceneRevisionHash, record.validUntil, record.totalCop, record.stillBytes],
      );
    },
    async findById(id) {
      const result = await pool.query<Record<string, unknown>>(
        `SELECT ${SELECT_COLUMNS} FROM taller_quote_shares WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? mapRecord(result.rows[0]) : null;
    },
    async findStillById(id) {
      const result = await pool.query<{ still_bytes: unknown }>(
        "SELECT still_bytes FROM taller_quote_shares WHERE id = $1",
        [id],
      );
      const bytes = result.rows[0]?.still_bytes;
      if (bytes === undefined || bytes === null) return null;
      if (!Buffer.isBuffer(bytes)) throw new Error("Invalid persisted quote image.");
      return bytes;
    },
    async listBySceneRevision(hash, limit) {
      const result = await pool.query<Record<string, unknown>>(
        `SELECT ${SELECT_COLUMNS} FROM taller_quote_shares
         WHERE scene_revision_hash = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [hash, limit],
      );
      return result.rows.map((raw) => {
        const row = mapRecord(raw);
        return {
          id: row.id,
          sceneName: row.sceneName,
          validUntil: row.validUntil,
          status: row.status,
          customerName: row.customerName,
          comment: row.comment,
          respondedAt: row.respondedAt,
          createdAt: row.createdAt,
        };
      });
    },
    async saveDecision(input) {
      const result = await pool.query(
        "UPDATE taller_quote_shares " +
          "SET status = $3, customer_name = $4, customer_comment = $5, responded_at = now() " +
          "WHERE id = $1 AND valid_until = $2::date AND status = 'pending' " +
          "AND valid_until >= (now() AT TIME ZONE 'America/Bogota')::date " +
          "RETURNING id",
        [input.id, input.validUntil, input.status, input.customerName, input.comment],
      );
      return result.rowCount === 1;
    },
  };
}
