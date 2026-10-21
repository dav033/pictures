import "server-only";
import { createRequire } from "node:module";
import { z } from "zod";
import seededFallback from "./catalogue-fallback.json";
import { getAsesorPool, type AsesorClient } from "./db";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const saleUnitSchema = z.object({ singular: z.string(), plural: z.string() });
const itemSchema = z.object({
  id: z.string().min(1),
  total: z.number().finite().nonnegative(),
  is_active: z.boolean(),
  package_id: z.string().min(1),
  charge_type: z.string().trim().min(1),
  description: z.string().nullable(),
  suggested_start_time: z.string().nullable(),
  provider_name: z.string().nullable(),
  category_name: z.string().nullable(),
  charge_mode: z.enum(["per_person", "unit", "event"]).optional(),
  quantity_editable: z.boolean().optional(),
  sale_unit: saleUnitSchema.nullable().optional(),
  removable: z.boolean().optional(),
}).passthrough();
const packageSchema = z.object({
  id: z.string().min(1), event_type_id: z.string().min(1), name: z.string().trim().min(1),
  base_guests: z.number().int().positive(), standard_duration_minutes: z.number().int().positive().nullable(),
  conditions: z.string().nullable(), restrictions: z.string().nullable(), is_active: z.boolean(), is_featured: z.boolean(),
  package_items: z.array(itemSchema), city_id: z.string().optional(), city: z.string().optional(), city_slug: z.string().optional(),
}).passthrough();
const serviceSchema = z.object({
  id: z.string().min(1), name: z.string().nullable(), description: z.string().nullable(), total: z.number().finite().nonnegative(),
  charge_type: z.enum(["total", "per_person"]), charge_mode: z.enum(["per_person", "unit", "event"]),
  quantity_editable: z.boolean(), sale_unit: saleUnitSchema.nullable(), has_delivery: z.boolean(), image_url: z.string().nullable(),
  image_focus: z.string(), category_name: z.string(), provider_name: z.string(), city: z.string(), city_slug: z.string(),
  rating: z.object({ average: z.number().finite(), count: z.number().int().nonnegative() }).nullable(),
}).passthrough();
const payloadSchema = z.object({
  packages: z.array(packageSchema),
  services: z.array(serviceSchema),
});
const fallbackSchema = z.object({
  version: z.literal(1), source: z.literal("seeded_last_good"), capturedAt: z.string().datetime().nullable(),
  packages: z.array(packageSchema), services: z.array(serviceSchema),
});

export type HappiaPackage = z.infer<typeof packageSchema>;
export type HappiaService = z.infer<typeof serviceSchema>;
export type HappiaCatalogueData = z.infer<typeof payloadSchema>;
export type HappiaCatalogueResult =
  | { status: "available"; data: HappiaCatalogueData; source: "postgres" | "seeded_last_good"; snapshotAgeSeconds: number | null; fetchedAt: string | null }
  | { status: "unavailable"; reason: "no_valid_snapshot" };

type SnapshotRow = { payload: unknown; fetched_at: Date | string; source: string };
type CatalogueStore = Pick<AsesorClient, "query">;
type CatalogueReader = () => Promise<HappiaCatalogueData>;
type Clock = () => Date;

function parseData(value: unknown): HappiaCatalogueData | null {
  const parsed = payloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readFallback(): HappiaCatalogueData | null {
  const parsed = fallbackSchema.safeParse(seededFallback);
  return parsed.success ? parseData(parsed.data) : null;
}

async function readSnapshot(db: CatalogueStore): Promise<{ data: HappiaCatalogueData; fetchedAt: Date } | null> {
  const result = await db.query<SnapshotRow>(
    "SELECT payload, fetched_at, source FROM happia_catalogue_snapshot WHERE snapshot_key = 'all'",
  );
  const row = result.rows[0];
  if (!row || row.source !== "happia_api") return null;
  const data = parseData(row.payload);
  const fetchedAt = new Date(row.fetched_at);
  return data && Number.isFinite(fetchedAt.getTime()) ? { data, fetchedAt } : null;
}

function resultFromSnapshot(snapshot: { data: HappiaCatalogueData; fetchedAt: Date }, now: Date): HappiaCatalogueResult {
  return {
    status: "available", data: snapshot.data, source: "postgres",
    snapshotAgeSeconds: Math.max(0, Math.floor((now.getTime() - snapshot.fetchedAt.getTime()) / 1000)),
    fetchedAt: snapshot.fetchedAt.toISOString(),
  };
}

function fallbackResult(): HappiaCatalogueResult {
  const data = readFallback();
  return data && (data.packages.length > 0 || data.services.length > 0)
    ? { status: "available", data, source: "seeded_last_good", snapshotAgeSeconds: null, fetchedAt: seededFallback.capturedAt }
    : { status: "unavailable", reason: "no_valid_snapshot" };
}

async function claimDailyRefresh(db: CatalogueStore): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO happia_catalogue_refresh (refresh_key, attempt_started_at)
     VALUES ('all', now())
     ON CONFLICT (refresh_key) DO UPDATE
       SET attempt_started_at = now()
       WHERE happia_catalogue_refresh.attempt_started_at <= now() - interval '24 hours'
     RETURNING refresh_key`,
  );
  return result.rows.length === 1;
}

async function storeSnapshot(db: CatalogueStore, data: HappiaCatalogueData, fetchedAt: Date): Promise<void> {
  await db.query(
    `INSERT INTO happia_catalogue_snapshot (snapshot_key, payload, fetched_at, source)
     VALUES ('all', $1::jsonb, $2, 'happia_api')
     ON CONFLICT (snapshot_key) DO UPDATE
       SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at, source = EXCLUDED.source`,
    [JSON.stringify(data), fetchedAt],
  );
}

async function createHappiaReader(): Promise<CatalogueReader> {
  const require = createRequire(import.meta.url);
  const packageName = "@sempertex/happie-package-ia";
  const happia = require(packageName) as {
    HappiaClient: new (config: { baseUrl: string; apiKey: string }) => {
      listarPackages(): Promise<{ packages: unknown[] }>;
      listarServicios(): Promise<unknown[]>;
    };
    cargarConfigDesdeEnv(): { baseUrl: string; apiKey: string };
  };
  const client = new happia.HappiaClient(happia.cargarConfigDesdeEnv());
  return async () => {
    const [packages, services] = await Promise.all([client.listarPackages(), client.listarServicios()]);
    const parsed = payloadSchema.parse({ packages: packages.packages, services });
    return parsed;
  };
}

/** Serves the advisor's public Happia catalogue cache; provider calls run after the refresh claim commits. */
export async function getHappiaCatalogue(options: {
  db?: CatalogueStore;
  readFromHappia?: CatalogueReader;
  now?: Clock;
} = {}): Promise<HappiaCatalogueResult> {
  const db = options.db ?? getAsesorPool();
  const now = options.now ?? (() => new Date());
  const clockNow = now();
  let snapshot: Awaited<ReturnType<typeof readSnapshot>>;
  try {
    snapshot = await readSnapshot(db);
  } catch {
    return fallbackResult();
  }

  if (snapshot && clockNow.getTime() - snapshot.fetchedAt.getTime() < MAX_AGE_MS) {
    return resultFromSnapshot(snapshot, clockNow);
  }

  let claimed = false;
  try {
    claimed = await claimDailyRefresh(db);
  } catch {
    // A validated last-good copy remains useful if the refresh marker is unavailable.
  }
  if (!claimed) return snapshot ? resultFromSnapshot(snapshot, clockNow) : fallbackResult();

  try {
    const readFromHappia = options.readFromHappia ?? await createHappiaReader();
    const fresh = parseData(await readFromHappia());
    if (!fresh) throw new Error("Happia catalogue validation failed");
    const fetchedAt = now();
    await storeSnapshot(db, fresh, fetchedAt);
    return resultFromSnapshot({ data: fresh, fetchedAt }, fetchedAt);
  } catch {
    // Keep errors opaque: provider responses can contain external data and credentials must not leak.
    return snapshot ? resultFromSnapshot(snapshot, clockNow) : fallbackResult();
  }
}
