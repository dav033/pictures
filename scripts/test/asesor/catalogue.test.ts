import assert from "node:assert/strict";
import { test } from "node:test";
import { getHappiaCatalogue, type HappiaCatalogueData } from "../../../src/lib/asesor/catalogue";
import type { AsesorClient } from "../../../src/lib/asesor/db";

const DAY = 24 * 60 * 60 * 1000;

function service(id: string, total = 350000): HappiaCatalogueData["services"][number] {
  return {
    id, name: "Animación", description: null, total, charge_type: "total", charge_mode: "unit",
    quantity_editable: true, sale_unit: { singular: "hora", plural: "horas" }, has_delivery: false,
    image_url: null, image_focus: "50% 50%", category_name: "Animación", provider_name: "Proveedor Happia",
    city: "Barranquilla", city_slug: "barranquilla", rating: null,
  };
}

function packageRecord(id: string) {
  return {
    id, event_type_id: "event-1", name: "Paquete", base_guests: 10, standard_duration_minutes: 120,
    conditions: null, restrictions: null, is_active: true, is_featured: false, city_slug: "barranquilla",
    package_items: [{
      id: `${id}-item`, total: 80000, is_active: true, package_id: id, charge_type: "total", description: "Decoración",
      suggested_start_time: null, provider_name: "Proveedor del ítem", category_name: "Decoración",
      charge_mode: "event", quantity_editable: false, sale_unit: null, removable: false,
    }],
  };
}

const data = (id: string, total?: number) => ({ packages: [packageRecord(`pkg-${id}`)], services: [service(`service-${id}`, total)] }) as HappiaCatalogueData;

function fakeStore(options: { snapshot?: { data: unknown; fetchedAt: Date }; attemptedAt?: Date } = {}) {
  let snapshot = options.snapshot;
  let attemptedAt = options.attemptedAt;
  const queries: string[] = [];
  const db: AsesorClient = {
    async query<Row>(text: string, values?: unknown[]) {
      queries.push(text);
      if (text.startsWith("SELECT payload")) {
        return { rows: snapshot ? [{ payload: snapshot.data, fetched_at: snapshot.fetchedAt, source: "happia_api" }] as Row[] : [], rowCount: snapshot ? 1 : 0 };
      }
      if (text.includes("INSERT INTO happia_catalogue_refresh")) {
        const timestamp = new Date(values?.[0] as string ?? Date.now());
        const eligible = !attemptedAt || timestamp.getTime() - attemptedAt.getTime() >= DAY;
        if (eligible) attemptedAt = timestamp;
        return { rows: eligible ? [{ refresh_key: "all" }] as Row[] : [], rowCount: eligible ? 1 : 0 };
      }
      if (text.includes("INSERT INTO happia_catalogue_snapshot")) {
        snapshot = { data: JSON.parse(values?.[0] as string), fetchedAt: new Date(values?.[1] as Date) };
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  return { db, queries, get snapshot() { return snapshot; }, get attemptedAt() { return attemptedAt; } };
}

test("cold read claims the refresh and stores a validated Happia snapshot without a long transaction", async () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  const store = fakeStore();
  let providerCalls = 0;
  const source = data("one");
  const result = await getHappiaCatalogue({ db: store.db, now: () => now, readFromHappia: async () => { providerCalls++; return source; } });

  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.source, "postgres");
    assert.equal(result.snapshotAgeSeconds, 0);
    assert.equal(result.data.services[0]?.id, "service-one");
    assert.equal(result.data.services[0]?.total, 350000);
    assert.equal(result.data.services[0]?.charge_type, "total");
    assert.equal(result.data.services[0]?.charge_mode, "unit");
    assert.deepEqual(result.data.services[0]?.sale_unit, { singular: "hora", plural: "horas" });
    assert.equal(result.data.services[0]?.provider_name, "Proveedor Happia");
    assert.equal(result.data.packages[0]?.package_items[0]?.id, "pkg-one-item");
    assert.equal(result.data.packages[0]?.package_items[0]?.provider_name, "Proveedor del ítem");
    assert.equal(result.data.packages[0]?.package_items[0]?.total, 80000);
    assert.equal(result.data.packages[0]?.package_items[0]?.charge_type, "total");
  }
  assert.equal(providerCalls, 1);
  assert.ok(store.snapshot);
  assert.equal(store.queries.some((query) => /\bBEGIN\b/.test(query)), false);
  assert.equal(store.queries.some((query) => query.includes("happia_catalogue_snapshot")), true);
});

test("a validated snapshot is fresh before the 24-hour boundary and refreshes at the boundary", async () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  const store = fakeStore({ snapshot: { data: data("old"), fetchedAt: new Date(now.getTime() - DAY + 1) } });
  let providerCalls = 0;
  const fresh = await getHappiaCatalogue({ db: store.db, now: () => now, readFromHappia: async () => { providerCalls++; return data("new"); } });
  assert.equal(fresh.status, "available");
  assert.equal(providerCalls, 0);

  store.snapshot!.fetchedAt = new Date(now.getTime() - DAY);
  const stale = await getHappiaCatalogue({ db: store.db, now: () => now, readFromHappia: async () => { providerCalls++; return data("new"); } });
  assert.equal(stale.status, "available");
  assert.equal(providerCalls, 1);
  if (stale.status === "available") assert.equal(stale.data.services[0]?.id, "service-new");
});

test("concurrent cold reads share the durable daily marker and only one refreshes", async () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  const store = fakeStore();
  let providerCalls = 0;
  let releaseProvider!: () => void;
  const waiting = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const reader = async () => { providerCalls++; await waiting; return data("shared"); };
  const options = { db: store.db, now: () => now, readFromHappia: reader };
  const first = getHappiaCatalogue(options);
  await new Promise((resolve) => setImmediate(resolve));
  const second = getHappiaCatalogue(options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerCalls, 1);
  releaseProvider();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.status), ["available", "unavailable"]);
});

test("API timeout or invalid data preserve the last good snapshot and the marker blocks same-day retries", async () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  const store = fakeStore({ snapshot: { data: data("last-good"), fetchedAt: new Date(now.getTime() - DAY) } });
  const failed = await getHappiaCatalogue({ db: store.db, now: () => now, readFromHappia: async () => { throw new Error("timeout"); } });
  assert.equal(failed.status, "available");
  if (failed.status === "available") assert.equal(failed.data.services[0]?.id, "service-last-good");

  let calls = 0;
  const next = await getHappiaCatalogue({ db: store.db, now: () => now, readFromHappia: async () => { calls++; return { services: [service("invalid", -1)], packages: [] }; } });
  assert.equal(next.status, "available");
  assert.equal(calls, 0);

  const invalidStore = fakeStore({ snapshot: { data: data("preserved"), fetchedAt: new Date(now.getTime() - DAY) } });
  const invalidPayload = await getHappiaCatalogue({
    db: invalidStore.db, now: () => now,
    readFromHappia: async () => ({ packages: [], services: [service("invalid", -1)] }),
  });
  assert.equal(invalidPayload.status, "available");
  if (invalidPayload.status === "available") assert.equal(invalidPayload.data.services[0]?.id, "service-preserved");
});

test("missing or invalid persisted sources return explicit unavailable without invented items", async () => {
  const noSource = await getHappiaCatalogue({ db: fakeStore().db, now: () => new Date("2026-10-21T12:00:00Z"), readFromHappia: async () => { throw new Error("offline"); } });
  assert.deepEqual(noSource, { status: "unavailable", reason: "no_valid_snapshot" });

  const store = fakeStore({ snapshot: { data: { packages: [{ id: "bad" }], services: [] }, fetchedAt: new Date("2020-01-01T00:00:00Z") } });
  const result = await getHappiaCatalogue({ db: store.db, now: () => new Date("2026-10-21T12:00:00Z"), readFromHappia: async () => { throw new Error("offline"); } });
  assert.deepEqual(result, { status: "unavailable", reason: "no_valid_snapshot" });
});
