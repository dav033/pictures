import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { before, test } from "node:test";
import { getHappiaCatalogue, type HappiaCatalogueData } from "../../../src/lib/asesor/catalogue";
import { existsSync, readFileSync } from "node:fs";

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

// The default reader loads the workspace package's build output, which a clean checkout does not have yet.
before(() => {
  if (!existsSync("packages/happie-package-ia/dist/index.js")) {
    execFileSync("npm", ["run", "build", "--workspace=@sempertex/happie-package-ia"], { stdio: "ignore" });
  }
});

const NOW = new Date("2026-10-25T12:00:00.000Z");

test("every call reads packages and services from the provider with no snapshot", async () => {
  let reads = 0;
  const readFromHappia = async () => { reads++; return data(String(reads)); };
  const first = await getHappiaCatalogue({ now: () => NOW, readFromHappia });
  const second = await getHappiaCatalogue({ now: () => NOW, readFromHappia });
  assert.equal(reads, 2);
  assert.deepEqual(first, { status: "available", data: data("1"), source: "happia_api", fetchedAt: NOW.toISOString(), snapshotAgeSeconds: 0 });
  assert.equal(second.status === "available" && second.data.services[0]?.id, "service-2");
});

test("a valid empty catalogue is available with empty arrays", async () => {
  const result = await getHappiaCatalogue({ now: () => NOW, readFromHappia: async () => ({ packages: [], services: [] }) });
  assert.deepEqual(result, { status: "available", data: { packages: [], services: [] }, source: "happia_api", fetchedAt: NOW.toISOString(), snapshotAgeSeconds: 0 });
});

test("missing Happia configuration reports not_configured", async () => {
  const saved = { base: process.env.HAPPIA_API_BASE_URL, key: process.env.HAPPIA_API_KEY };
  delete process.env.HAPPIA_API_BASE_URL;
  delete process.env.HAPPIA_API_KEY;
  try {
    assert.deepEqual(await getHappiaCatalogue(), { status: "unavailable", reason: "not_configured" });
  } finally {
    if (saved.base !== undefined) process.env.HAPPIA_API_BASE_URL = saved.base;
    if (saved.key !== undefined) process.env.HAPPIA_API_KEY = saved.key;
  }
});

test("provider failures report request_failed without leaking details", async () => {
  const result = await getHappiaCatalogue({ readFromHappia: async () => { throw new Error("HTTP 503 key=secret-value"); } });
  assert.deepEqual(result, { status: "unavailable", reason: "request_failed" });
});

test("a read that exceeds the 10 s deadline reports request_failed", async () => {
  const original = AbortSignal.timeout;
  const deadlines: number[] = [];
  AbortSignal.timeout = (ms: number) => { deadlines.push(ms); return AbortSignal.abort(new DOMException("deadline", "TimeoutError")); };
  try {
    const result = await getHappiaCatalogue({
      readFromHappia: (signal) => new Promise((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); if (signal.aborted) reject(signal.reason); }),
    });
    assert.deepEqual(result, { status: "unavailable", reason: "request_failed" });
    assert.deepEqual(deadlines, [10_000]);
  } finally {
    AbortSignal.timeout = original;
  }
});

test("data outside the validated schema reports invalid_response", async () => {
  const bad = await getHappiaCatalogue({ readFromHappia: async () => ({ packages: [], services: [service("invalid", -1)] }) });
  assert.deepEqual(bad, { status: "unavailable", reason: "invalid_response" });
  const missing = await getHappiaCatalogue({ readFromHappia: async () => ({ packages: [{ id: "bad" }], services: [] }) });
  assert.deepEqual(missing, { status: "unavailable", reason: "invalid_response" });
});

test("the catalogue has no database snapshot, refresh marker or fallback file", () => {
  const source = readFileSync("src/lib/asesor/catalogue.ts", "utf8");
  assert.equal(source.includes("happia_catalogue_"), false);
  assert.equal(/getAsesorPool|createRequire|catalogue-fallback/.test(source), false);
  assert.equal(existsSync("src/lib/asesor/catalogue-fallback.json"), false);
});
