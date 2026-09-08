import assert from "node:assert/strict";
import { mock } from "node:test";
import { z } from "zod";
import { HappiaClient, recomendarPaquetesConFiltros, type HappiaPackage } from "@sempertex/happie-package-ia";
import { BODY_LIMIT, MAX_PENDING_ACQUISITIONS, ejecutarWebhook, leerBodyLimitado, postgresWebhookStore, type WebhookStore } from "../src/lib/happie/webhook-control";
import { procesarTurnoConversacion } from "../src/lib/happie/conversacion-webhook";
import { manejarChatWebhook } from "../src/lib/happie/conversacion-webhook";
import type { Pool, PoolClient } from "pg";

const schema = z.object({ value: z.number() });
const url = "http://localhost/api/happie/webhook/chat";
const result = { status: 200, body: { ok: true } };
function request(body = '{"value":1}', key: string | null = "turn-1", signal?: AbortSignal) {
  return new Request(url, { method: "POST", body, signal, headers: { "x-api-key": "local-test-only", ...(key === null ? {} : { "Idempotency-Key": key }) } });
}
function memoryStore(): WebhookStore {
  const entries = new Map<string, { hash: string; owner: string; busy: boolean; result: typeof result | null }>();
  return {
    rate: async () => true,
    claim: async (scope, key, hash, owner) => {
      const entry = entries.get(scope + key);
      if (entry?.hash && entry.hash !== hash) return "conflict";
      if (entry?.result) return entry.result;
      if (entry?.busy) return "busy";
      entries.set(scope + key, { hash, owner, busy: true, result: null });
      return "claimed";
    },
    finish: async (scope, key, owner, response) => {
      const entry = entries.get(scope + key)!;
      if (entry.owner === owner) { entry.busy = false; entry.result = response as typeof result | null; }
    },
  };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalPool = globalThis.__ragPool;
  globalThis.fetch = async () => { throw new Error("Network forbidden in local tests"); };
  try {
    let calls = 0;
    const store = memoryStore();
    const work = async () => { calls++; return result; };
    const run = (req: Request, fn = work, db = store) => ejecutarWebhook(req, "chat", null, schema, fn, db);
    let response = await run(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.headers.get("x-correlation-id"));
    const firstId = response.headers.get("x-correlation-id");
    response = await run(request());
    assert.deepEqual(await response.json(), result.body);
    assert.notEqual(response.headers.get("x-correlation-id"), firstId);
    assert.equal(calls, 1);
    assert.equal((await run(request('{"value":2}'))).status, 409);
    await run(request(undefined, null));
    await run(request(undefined, null));
    assert.equal(calls, 3, "no guarantee without header");
    assert.equal((await run(request(undefined, " "))).status, 400);
    assert.equal((await run(request("{"))).status, 400);
    assert.equal((await run(request('{"value":"wrong"}'))).status, 400);

    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = run(request(undefined, "concurrent"), async () => {
      started(); await new Promise<void>(resolve => { release = resolve; }); return result;
    });
    await ready;
    response = await run(request(undefined, "concurrent"));
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("retry-after"), "120");
    assert.equal((await run(request('{"value":2}', "concurrent"))).status, 409);
    release(); await pending;
    for (const status of [502, 503, 504]) {
      const key = `retry-${status}`;
      assert.equal((await run(request(undefined, key), async () => ({ status, body: { ok: false } }))).status, status);
      assert.equal((await run(request(undefined, key))).status, 200);
    }
    response = await run(request(undefined, "secret-error"), async () => { throw new Error("secret-provider-body"); });
    const error = await response.json();
    assert.equal(response.status, 503);
    assert.ok(error.correlationId);
    assert.ok(!JSON.stringify(error).includes("secret-provider-body"));
    response = await run(request(), work, { ...store, rate: async () => false });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    response = await run(request(), work, { ...store, rate: async () => { throw new Error("db-password"); } });
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("db-password"));

    let cancelled = false;
    const streamed = new Request(url, { method: "POST", body: new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(BODY_LIMIT + 1)); },
      cancel() { cancelled = true; },
    }), duplex: "half" } as RequestInit);
    await assert.rejects(leerBodyLimitado(streamed, new AbortController().signal), { status: 413 });
    assert.ok(cancelled);
    const oversized = request("{}", null);
    oversized.headers.set("content-length", String(BODY_LIMIT + 1));
    await assert.rejects(leerBodyLimitado(oversized, oversized.signal), { status: 413 });
    const invalidUtf8 = new Request(url, { method: "POST", body: new Uint8Array([0xff]) });
    await assert.rejects(leerBodyLimitado(invalidUtf8, invalidUtf8.signal), { status: 400 });
    const bodyAbort = new AbortController();
    const stalled = new Request(url, { method: "POST", body: new ReadableStream(), duplex: "half" } as RequestInit);
    const reading = leerBodyLimitado(stalled, bodyAbort.signal);
    bodyAbort.abort();
    await assert.rejects(reading, { name: "AbortError" });
    const abort = new AbortController();
    response = await run(request(undefined, "abort", abort.signal), async () => { abort.abort(); return result; });
    assert.equal(response.status, 408);
    assert.equal((await run(request(undefined, "abort"))).status, 409, "cancel retains lease");

    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let startedTimeout!: () => void;
      const timeoutReady = new Promise<void>(resolve => { startedTimeout = resolve; });
      let deadlineSignal: AbortSignal | undefined;
      const timed = ejecutarWebhook(request(undefined, "deadline"), "chat", null, schema, async req => {
        deadlineSignal = req.signal;
        startedTimeout();
        return new Promise(() => {});
      }, store);
      await timeoutReady;
      mock.timers.tick(60_000);
      assert.equal((await timed).status, 504);
      assert.ok(deadlineSignal?.aborted);
      assert.equal((await run(request(undefined, "deadline"))).status, 409);
    } finally { mock.timers.reset(); }

    // Exercise PostgreSQL adapter branches and parameterization without opening a socket.
    const queries: { text: string; values: unknown[] }[] = [];
    let rows: object[][] = [];
    const adapterPool = { connect: async () => ({
      query: async (query: { text: string; values: unknown[] }) => {
        queries.push(query); return { rows: rows.shift() ?? [] };
      },
      release() {},
    }) } as unknown as Pool;
    globalThis.__ragPool = adapterPool;
    const sqlSignal = new AbortController().signal;
    rows = [[{ hits: 30 }], [{ hits: 31 }]];
    assert.equal(await postgresWebhookStore.rate("scope", sqlSignal), true);
    assert.equal(await postgresWebhookStore.rate("scope", sqlSignal), false);
    rows = [[{ owner: "owner" }]];
    assert.equal(await postgresWebhookStore.claim("scope", "key", "hash", "owner", sqlSignal), "claimed");
    rows = [[], [{ body_hash: "different", response: null }]];
    assert.equal(await postgresWebhookStore.claim("scope", "key", "hash", "owner", sqlSignal), "conflict");
    rows = [[], [{ body_hash: "hash", response: null }]];
    assert.equal(await postgresWebhookStore.claim("scope", "key", "hash", "owner", sqlSignal), "busy");
    rows = [[], [{ body_hash: "hash", status: 200, response: result.body }]];
    assert.deepEqual(await postgresWebhookStore.claim("scope", "key", "hash", "owner", sqlSignal), result);
    await postgresWebhookStore.finish("scope", "key", "owner", result, sqlSignal);
    assert.ok(queries.at(-1)!.text.includes("owner = $3"));
    assert.deepEqual(queries.at(-1)!.values, ["scope", "key", "owner", JSON.stringify(result.body), 200]);

    // All SQL operations must abandon acquisition, not enqueue a query after cancellation.
    const operations = [
      (signal: AbortSignal) => postgresWebhookStore.rate("scope", signal),
      (signal: AbortSignal) => postgresWebhookStore.claim("scope", "key", "hash", "owner", signal),
      (signal: AbortSignal) => postgresWebhookStore.finish("scope", "key", "owner", result, signal),
    ];
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      for (const operation of operations) {
        for (const reason of ["abort", "acquisition-timeout"] as const) {
          const controller = new AbortController();
          let deliver!: (client: PoolClient) => void;
          let connections = 0;
          let executions = 0;
          const releases: (boolean | undefined)[] = [];
          const client = {
            query: async () => { executions++; return { rows: [{ hits: 1 }] }; },
            release: (destroy?: boolean) => { releases.push(destroy); },
          } as unknown as PoolClient;
          globalThis.__ragPool = { connect: () => {
            connections++;
            return new Promise<PoolClient>(resolve => { deliver = resolve; });
          } } as unknown as Pool;
          const rejected = assert.rejects(operation(controller.signal), reason === "abort" ? { name: "AbortError" } : { status: 503 });
          if (reason === "abort") controller.abort();
          else mock.timers.tick(5_000);
          await rejected;
          assert.equal(connections, 1);
          assert.equal(executions, 0);
          deliver(client);
          await new Promise(setImmediate);
          assert.equal(executions, 0, "late acquisition must not mutate rate/claim/finish");
          assert.deepEqual(releases, [undefined], "late client released exactly once");
        }
      }
      let connections = 0;
      globalThis.__ragPool = { connect: async () => { connections++; throw new Error("must not connect"); } } as unknown as Pool;
      for (const operation of operations) await assert.rejects(operation(AbortSignal.abort()), { name: "AbortError" });
      assert.equal(connections, 0);

      // Abort in the acquisition handoff, before its awaiting continuation runs.
      const handoff = new AbortController();
      let handoffQueries = 0;
      let handoffReleases = 0;
      globalThis.__ragPool = { connect: async () => {
        handoff.abort();
        return { query: async () => { handoffQueries++; }, release: () => { handoffReleases++; } };
      } } as unknown as Pool;
      await assert.rejects(postgresWebhookStore.rate("scope", handoff.signal), { name: "AbortError" });
      await new Promise(setImmediate);
      assert.equal(handoffQueries, 0);
      assert.equal(handoffReleases, 1);

      // An interrupted in-flight query must not return a busy client to the idle pool.
      const inFlight = new AbortController();
      const destroyed: (boolean | undefined)[] = [];
      let queryStarted!: () => void;
      const queryReady = new Promise<void>(resolve => { queryStarted = resolve; });
      globalThis.__ragPool = { connect: async () => ({
        query: () => { queryStarted(); return new Promise(() => {}); },
        release: (destroy?: boolean) => { destroyed.push(destroy); },
      }) } as unknown as Pool;
      const interrupted = assert.rejects(postgresWebhookStore.rate("scope", inFlight.signal), { name: "AbortError" });
      await queryReady;
      inFlight.abort();
      await interrupted;
      assert.deepEqual(destroyed, [true]);

      // Abandoned acquisitions still occupy admission slots while pg's queue is saturated.
      const queued: { resolve: (client: PoolClient) => void; reject: (error: Error) => void }[] = [];
      let waitingCount = 0;
      let connectCalls = 0;
      let lateQueries = 0;
      let lateReleases = 0;
      globalThis.__ragPool = { connect: () => {
        connectCalls++;
        waitingCount++;
        return new Promise<PoolClient>((resolve, reject) => queued.push({
          resolve: client => { waitingCount--; resolve(client); },
          reject: error => { waitingCount--; reject(error); },
        }));
      } } as unknown as Pool;
      const abandonedControllers = Array.from({ length: MAX_PENDING_ACQUISITIONS }, () => new AbortController());
      const abandonedRequests = abandonedControllers.map((controller, index) =>
        assert.rejects(operations[index % operations.length](controller.signal), index % 2 === 0 ? { name: "AbortError" } : { status: 503 }));
      abandonedControllers.forEach((controller, index) => { if (index % 2 === 0) controller.abort(); });
      mock.timers.tick(5_000);
      await Promise.all(abandonedRequests);
      assert.equal(waitingCount, MAX_PENDING_ACQUISITIONS);
      for (let round = 0; round < 3; round++) {
        mock.timers.tick(60_000);
        for (const operation of operations) await assert.rejects(operation(sqlSignal), { status: 503 });
        assert.equal(connectCalls, MAX_PENDING_ACQUISITIONS, "no new pool.connect while abandoned slots remain pending");
        assert.equal(waitingCount, MAX_PENDING_ACQUISITIONS, "queue remains bounded beyond the request deadline");
      }
      queued.forEach((entry, index) => {
        if (index % 2 === 0) entry.reject(new Error("late pool rejection"));
        else entry.resolve({
          query: async () => { lateQueries++; },
          release: () => { lateReleases++; },
        } as unknown as PoolClient);
      });
      await new Promise(setImmediate);
      assert.equal(waitingCount, 0);
      assert.equal(lateQueries, 0);
      assert.equal(lateReleases, MAX_PENDING_ACQUISITIONS / 2);
      assert.equal(globalThis.__happiePendingAcquisitions, 0, "late resolution and rejection both release admission slots");

      // A synchronous pool failure must also return its reserved slot.
      globalThis.__ragPool = { connect: () => { throw new Error("sync connect failure"); } } as unknown as Pool;
      await assert.rejects(postgresWebhookStore.rate("scope", sqlSignal), /sync connect failure/);
      assert.equal(globalThis.__happiePendingAcquisitions, 0);
      globalThis.__ragPool = adapterPool;
      rows = [[{ hits: 1 }]];
      assert.equal(await postgresWebhookStore.rate("scope", sqlSignal), true, "admission recovers when abandoned connects settle");
    } finally {
      mock.timers.reset();
      globalThis.__ragPool = adapterPool;
    }

    // Regression: work fails at 59s, cleanup acquires at 61s. Response must settle at 60s.
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    try {
      let workStarted!: () => void;
      const workReady = new Promise<void>(resolve => { workStarted = resolve; });
      let cleanupStarted!: () => void;
      const cleanupReady = new Promise<void>(resolve => { cleanupStarted = resolve; });
      let connections = 0;
      let mutations = 0;
      let releases = 0;
      let cleanupSignal: AbortSignal | undefined;
      globalThis.__ragPool = { connect: async () => {
        connections++;
        const client = {
          query: async () => { mutations++; return { rows: mutations === 1 ? [{ hits: 1 }] : [{ owner: "owner" }] }; },
          release: () => { releases++; },
        };
        if (connections === 3) {
          cleanupStarted();
          await new Promise(resolve => setTimeout(resolve, 2_000));
        }
        return client;
      } } as unknown as Pool;
      let settledAt: number | undefined;
      const lateFailure = ejecutarWebhook(request(undefined, "cleanup-deadline"), "chat", null, schema, async () => {
        workStarted();
        await new Promise((_, reject) => setTimeout(() => reject(new Error("failure at 59s")), 59_000));
        return result;
      }, {
        ...postgresWebhookStore,
        finish: async (scope, key, owner, response, signal) => {
          cleanupSignal = signal;
          await postgresWebhookStore.finish(scope, key, owner, response, signal);
        },
      }).then(response => { settledAt = Date.now(); return response; });
      await workReady;
      mock.timers.tick(59_000);
      await cleanupReady;
      assert.equal(settledAt, undefined);
      mock.timers.tick(1_000);
      await new Promise(setImmediate);
      assert.equal(settledAt, 60_000, "cleanup must not extend the original deadline");
      assert.equal((await lateFailure).status, 503);
      assert.ok(cleanupSignal?.aborted);
      assert.equal(mutations, 2, "no lease release SQL after the deadline");
      mock.timers.tick(1_000);
      await new Promise(setImmediate);
      assert.equal(mutations, 2);
      assert.equal(releases, 3, "cleanup client arriving at 61s is released without SQL");
    } finally {
      mock.timers.reset();
      globalThis.__ragPool = adapterPool;
    }

    const clientAbort = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    globalThis.fetch = async (_url, init) => {
      fetchSignal = init?.signal;
      return new Response('{"packages":[]}');
    };
    const client = new HappiaClient({ baseUrl: "https://happia.invalid/api", apiKey: "fake" });
    assert.deepEqual(await client.listarPackages(clientAbort.signal), { packages: [] });
    clientAbort.abort();
    assert.ok(fetchSignal?.aborted);
    globalThis.fetch = async () => new Response("private upstream html", { status: 503 });
    await assert.rejects(client.listarPackages(), (err: unknown) => err instanceof Error && !err.message.includes("private"));

    const originalTimeout = AbortSignal.timeout;
    const providerTimeout = new AbortController();
    AbortSignal.timeout = (ms: number) => {
      assert.equal(ms, 10_000);
      return providerTimeout.signal;
    };
    try {
      globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
      const timedFetch = client.listarPackages();
      providerTimeout.abort(new DOMException("test timeout", "TimeoutError"));
      await assert.rejects(timedFetch, { name: "TimeoutError" });
    } finally { AbortSignal.timeout = originalTimeout; }

    let geminiBody = "";
    globalThis.fetch = async (_url, init) => {
      geminiBody = String(init?.body);
      fetchSignal = init?.signal;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ recomendaciones: [{ packageId: "active", razon: "Encaja" }], resumen: "Una opcion" }) }] } }] });
    };
    const packageFixture = { id: "active", is_active: true, name: "Demo", package_items: [
      { is_active: true, description: "ACTIVE_ITEM", total: 100 },
      { is_active: false, description: "INACTIVE_ITEM", total: 999 },
    ] } as HappiaPackage;
    const geminiAbort = new AbortController();
    const recommendation = await recomendarPaquetesConFiltros({ tipoEvento: "Boda", invitados: 10, presupuesto: 100, paquetes: [packageFixture], apiKey: "fake", signal: geminiAbort.signal });
    assert.equal(recommendation.recomendaciones.length, 1);
    assert.ok(geminiBody.includes("ACTIVE_ITEM"));
    assert.ok(!geminiBody.includes("INACTIVE_ITEM"));
    geminiAbort.abort();
    assert.ok(fetchSignal?.aborted);
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] });
    await assert.rejects(recomendarPaquetesConFiltros({ tipoEvento: "Boda", invitados: 10, presupuesto: 100, paquetes: [packageFixture], apiKey: "fake" }));
    await assert.rejects(recomendarPaquetesConFiltros({ tipoEvento: "Boda", invitados: 10, presupuesto: 100, paquetes: [], apiKey: "fake", signal: geminiAbort.signal }), { name: "AbortError" });

    const modelTimeout = new AbortController();
    AbortSignal.timeout = (ms: number) => { assert.equal(ms, 25_000); return modelTimeout.signal; };
    try {
      let fetchStarted!: () => void;
      let attempts = 0;
      const ready = new Promise<void>(resolve => { fetchStarted = resolve; });
      globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
        attempts++;
        init?.signal?.addEventListener("abort", () => reject(new Error("SDK-wrapped-private-error")), { once: true });
        fetchStarted();
      });
      const pending = recomendarPaquetesConFiltros({ tipoEvento: "Boda", invitados: 10, presupuesto: 100, paquetes: [packageFixture], apiKey: "fake" });
      await ready;
      modelTimeout.abort(new DOMException("model timeout", "TimeoutError"));
      await assert.rejects(pending, { name: "TimeoutError" });
      assert.equal(attempts, 1);
    } finally { AbortSignal.timeout = originalTimeout; }

    const oldWebhookKey = process.env.HAPPIE_WEBHOOK_API_KEY;
    const oldGeminiKey = process.env.GEMINI_API_KEY;
    try {
      process.env.HAPPIE_WEBHOOK_API_KEY = "local-webhook-test-key-32-bytes-minimum";
      process.env.GEMINI_API_KEY = "fake";
      rows = [[{ hits: 1 }]];
      globalThis.fetch = async () => Response.json({ error: { code: 400, message: "private-provider-secret" } }, { status: 400 });
      const req = new Request(url, { method: "POST", headers: { "x-api-key": process.env.HAPPIE_WEBHOOK_API_KEY }, body: '{"mensaje":"hola"}' });
      const chatError = await manejarChatWebhook(req);
      assert.equal(chatError.status, 502);
      assert.ok(chatError.headers.get("x-correlation-id"));
      assert.ok(!(await chatError.text()).includes("private-provider-secret"));
    } finally {
      if (oldWebhookKey === undefined) delete process.env.HAPPIE_WEBHOOK_API_KEY;
      else process.env.HAPPIE_WEBHOOK_API_KEY = oldWebhookKey;
      if (oldGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = oldGeminiKey;
    }

    const chatAbort = new AbortController();
    await procesarTurnoConversacion({ mensaje: "si", estado: { fase: "confirmacion", tipoEvento: "Boda", invitados: 10, presupuesto: 100, servicios: [], preferencias: [] } }, {
      extraer: async (_message, _state, signal) => {
        assert.equal(signal, chatAbort.signal);
        return { tipoEvento: "Boda", invitados: 10, presupuesto: 100, servicios: [], preferencias: [], respondioDetalles: false, confirmacion: "si", acuse: "" };
      },
      recomendar: async (req) => {
        chatAbort.abort(); assert.ok(req.signal.aborted);
        return { status: 502, body: { error: "cancelled" } };
      },
    }, chatAbort.signal);
    console.log("Happie controls: replay, conflicts, concurrency, retry, limits, cancellation, safe errors, SQL adapter and mocked providers PASS");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__ragPool = originalPool;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
