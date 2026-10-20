import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { Client, Pool } from "pg";
import { applyAsesorMigrations } from "../migrate-asesor";
import { poolConfigFromDsn } from "../../src/lib/asesor/db";
import { createAsesorRepository } from "../../src/lib/asesor/repository";

// Runs against a disposable Postgres given by ASESOR_TEST_DATABASE_URL; a throwaway schema is created and dropped.
const dsn = process.env.ASESOR_TEST_DATABASE_URL;
const skip = dsn ? false : "ASESOR_TEST_DATABASE_URL not set (explicit test target required)";
const schema = `asesor_it_${randomBytes(5).toString("hex")}`;
const isLocal = dsn ? ["localhost", "127.0.0.1", "::1"].includes(new URL(dsn).hostname) : false;
const config = () => ({
  ...(dsn ? (isLocal ? { connectionString: dsn } : poolConfigFromDsn(dsn)) : {}),
  options: `-c search_path=${schema}`,
});

let admin: Client;
let pool: Pool;
let neonLedgerCount: number | null = null;

before(async () => {
  if (!dsn) return;
  admin = new Client(config());
  await admin.connect();
  const ledger = await admin.query<{ relation: string | null }>(
    "SELECT to_regclass('public.schema_migrations')::text AS relation",
  );
  if (ledger.rows[0].relation) {
    const count = await admin.query<{ count: string }>("SELECT count(*)::text AS count FROM public.schema_migrations");
    neonLedgerCount = Number(count.rows[0].count);
  }
  await applyAsesorMigrations(admin, { schema });
  pool = new Pool({ ...config(), max: 2 });
});

after(async () => {
  if (!dsn) return;
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

test("migrations are idempotent, keep rows and leave the Neon ledger alone", { skip }, async () => {
  const repo = createAsesorRepository(pool);
  await repo.createConversation("idem");
  const again = await applyAsesorMigrations(admin, { schema });
  assert.deepEqual(again.applied, []);
  assert.equal(again.skipped.length, 1);
  const { rows } = await admin.query(`SELECT count(*)::int AS n FROM conversations WHERE id = 'idem'`);
  assert.equal(rows[0].n, 1);
  const tables = await admin.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [schema]);
  const names = tables.rows.map((r) => r.table_name);
  for (const t of ["accounts", "conversations", "messages", "attachments", "briefs", "asesor_schema_migrations"]) assert.ok(names.includes(t), t);
  assert.ok(!names.includes("schema_migrations"), "Neon ledger must not be created by advisor migrations");
  const attachment = await admin.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'attachments' AND column_name = 'data'`,
    [schema],
  );
  assert.equal(attachment.rows[0]?.data_type, "bytea");
  const briefKey = await admin.query<{ column_name: string }>(
    `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu USING (constraint_catalog, constraint_schema, constraint_name)
      WHERE tc.table_schema = $1 AND tc.table_name = 'briefs' AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position`,
    [schema],
  );
  assert.deepEqual(briefKey.rows.map((r) => r.column_name), ["conversation_id", "version"]);
  if (neonLedgerCount !== null) {
    const count = await admin.query<{ count: string }>("SELECT count(*)::text AS count FROM public.schema_migrations");
    assert.equal(Number(count.rows[0].count), neonLedgerCount, "Neon migration ledger rows must be unchanged");
  }
});

test("round trip preserves ids, order, bytes and brief versions; duplicates insert once", { skip }, async () => {
  const repo = createAsesorRepository(pool);
  const { id: accountId } = await repo.upsertAccount("ext-1", "Ana");
  assert.deepEqual(await repo.createConversation("c1", accountId, "t"), { inserted: true });
  assert.deepEqual(await repo.createConversation("c1"), { inserted: false });
  const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
  assert.deepEqual(await repo.appendMessage("c1", { id: "m-b", role: "user", content: "uno", attachments: [{ id: "a1", mimeType: "image/png", data: bytes }] }), { inserted: true });
  assert.deepEqual(await repo.appendMessage("c1", { id: "m-a", role: "assistant", content: "dos" }), { inserted: true });
  assert.deepEqual(await repo.appendMessage("c1", { id: "m-b", role: "user", content: "otra" }), { inserted: false });
  const list = await repo.listMessages("c1");
  assert.deepEqual(list.map((m) => m.id), ["m-b", "m-a"]);
  assert.equal(list[0].content, "uno");
  assert.ok(list[0].attachments[0].data.equals(bytes));
  assert.equal(list[0].attachments[0].byteSize, bytes.length);
  assert.deepEqual(await repo.saveBrief("c1", { step: 1 }), { version: 1 });
  assert.deepEqual(await repo.saveBrief("c1", { step: 2 }), { version: 2 });
  assert.deepEqual(await repo.latestBrief("c1"), { conversationId: "c1", version: 2, state: { step: 2 } });
});

test("database failure is surfaced", { skip }, async () => {
  const repo = createAsesorRepository(pool);
  await assert.rejects(repo.appendMessage("missing-conversation", { id: "mx", role: "user", content: "x" }));
  const { rows } = await admin.query(`SELECT count(*)::int AS n FROM messages WHERE id = 'mx'`);
  assert.equal(rows[0].n, 0);
});
