import assert from "node:assert/strict";
import { test } from "node:test";
import { getAsesorPool, closeAsesorPool, poolConfigFromDsn, type AsesorDb } from "../../../src/lib/asesor/db";
import { createAsesorRepository } from "../../../src/lib/asesor/repository";

type Call = { text: string; values?: unknown[] };

function fakeDb(handler: (text: string, values?: unknown[]) => { rows?: unknown[]; rowCount?: number }) {
  const calls: Call[] = [];
  let released = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const r = handler(text, values);
      return { rows: r.rows ?? [], rowCount: r.rowCount ?? 0 } as never;
    },
  };
  const db: AsesorDb = { ...client, connect: async () => ({ ...client, release: () => void released++ }) };
  return { db, calls, released: () => released };
}

test("pool reads only SUPABASE_DB_URL, permits loopback test Postgres and keeps TLS for remote DSNs", async () => {
  const saved = { s: process.env.SUPABASE_DB_URL, d: process.env.DATABASE_URL };
  try {
    delete process.env.SUPABASE_DB_URL;
    process.env.DATABASE_URL = "postgresql://u:p@neon.example/db";
    assert.throws(() => getAsesorPool(), /SUPABASE_DB_URL/);
    const config = poolConfigFromDsn("postgresql://u:p@pooler.example:6543/postgres?sslmode=disable&x=1");
    assert.ok(config.ssl, "ssl must be enabled");
    assert.equal(poolConfigFromDsn("postgresql://u:p@127.0.0.1:5432/rag").ssl, false);
    assert.equal(poolConfigFromDsn("postgresql://u:p@localhost:5432/rag").ssl, false);
    assert.ok(!config.connectionString!.includes("sslmode"));
    assert.ok(config.connectionString!.includes("x=1"));
    assert.equal(config.options, "-c search_path=asesor");
    process.env.SUPABASE_DB_URL = "postgresql://u:p@pooler.example:6543/postgres";
    assert.equal(getAsesorPool(), getAsesorPool());
  } finally {
    await closeAsesorPool();
    if (saved.s === undefined) delete process.env.SUPABASE_DB_URL; else process.env.SUPABASE_DB_URL = saved.s;
    if (saved.d === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.d;
  }
});

test("duplicate conversation and message ids report inserted=false and skip attachments", async () => {
  const { db, calls } = fakeDb((text) => ({ rowCount: /INSERT INTO (conversations|messages)/.test(text) ? 0 : 0 }));
  const repo = createAsesorRepository(db);
  assert.deepEqual(await repo.createConversation("c1"), { inserted: false });
  const out = await repo.appendMessage("c1", { id: "m1", role: "user", content: "hi", attachments: [{ id: "a1", mimeType: "image/png", data: Buffer.from([1]) }] });
  assert.deepEqual(out, { inserted: false });
  assert.ok(!calls.some((c) => c.text.includes("INSERT INTO attachments")));
  assert.ok(calls.some((c) => c.text === "COMMIT"));
});

test("new message inserts bytes with exact size inside one transaction", async () => {
  const { db, calls, released } = fakeDb((text) => ({ rowCount: text.startsWith("INSERT INTO messages") ? 1 : 1 }));
  const bytes = Buffer.from([0, 255, 1, 2]);
  const out = await createAsesorRepository(db).appendMessage("c1", { id: "m1", role: "user", content: "x", attachments: [{ id: "a1", mimeType: "image/jpeg", data: bytes }] });
  assert.deepEqual(out, { inserted: true });
  const att = calls.find((c) => c.text.includes("INSERT INTO attachments"))!;
  assert.equal(att.values![3], 4);
  assert.equal(att.values![4], bytes);
  assert.equal(calls[0].text, "BEGIN");
  assert.equal(calls.at(-1)!.text, "COMMIT");
  assert.equal(released(), 1);
});

test("database failure is surfaced, rolled back and never acknowledged", async () => {
  const { db, calls, released } = fakeDb((text) => {
    if (text.includes("INSERT INTO attachments")) throw new Error("boom");
    return { rowCount: 1 };
  });
  await assert.rejects(
    createAsesorRepository(db).appendMessage("c1", { id: "m1", role: "user", content: "x", attachments: [{ id: "a", mimeType: "image/png", data: Buffer.from([1]) }] }),
    /boom/,
  );
  assert.ok(calls.some((c) => c.text === "ROLLBACK"));
  assert.ok(!calls.some((c) => c.text === "COMMIT"));
  assert.equal(released(), 1);
  const failing = fakeDb(() => { throw new Error("down"); });
  await assert.rejects(createAsesorRepository(failing.db).saveBrief("c1", {}), /down/);
  await assert.rejects(createAsesorRepository(failing.db).createConversation("c1"), /down/);
});

test("listMessages keeps database order and groups attachments by message", async () => {
  const { db } = fakeDb((text) =>
    text.includes("FROM messages")
      ? { rows: [{ id: "m2", role: "user", content: "a" }, { id: "m1", role: "assistant", content: "b" }] }
      : { rows: [{ id: "a1", message_id: "m1", mime_type: "image/png", byte_size: 1, data: Buffer.from([9]) }] },
  );
  const list = await createAsesorRepository(db).listMessages("c1");
  assert.deepEqual(list.map((m) => m.id), ["m2", "m1"]);
  assert.equal(list[0].attachments.length, 0);
  assert.deepEqual(list[1].attachments[0].data, Buffer.from([9]));
});

test("saveBrief returns the version assigned by the database and latestBrief maps rows", async () => {
  const { db } = fakeDb((text) =>
    text.startsWith("INSERT INTO briefs") ? { rows: [{ version: 3 }] } : { rows: [{ conversation_id: "c1", version: 3, state: { a: 1 } }] },
  );
  const repo = createAsesorRepository(db);
  assert.deepEqual(await repo.saveBrief("c1", { a: 1 }), { version: 3 });
  assert.deepEqual(await repo.latestBrief("c1"), { conversationId: "c1", version: 3, state: { a: 1 } });
});
