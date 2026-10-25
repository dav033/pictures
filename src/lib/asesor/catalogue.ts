import "server-only";
import { z } from "zod";

const READ_TIMEOUT_MS = 10_000;

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
export type HappiaPackage = z.infer<typeof packageSchema>;
export type HappiaService = z.infer<typeof serviceSchema>;
export type HappiaCatalogueData = z.infer<typeof payloadSchema>;
export type HappiaCatalogueUnavailableReason = "not_configured" | "request_failed" | "invalid_response";
export type HappiaCatalogueResult =
  | { status: "available"; data: HappiaCatalogueData; source: "happia_api"; snapshotAgeSeconds: 0; fetchedAt: string }
  | { status: "unavailable"; reason: HappiaCatalogueUnavailableReason };

type CatalogueReader = (signal: AbortSignal) => Promise<unknown>;
type Clock = () => Date;

class NotConfiguredError extends Error {}

async function createHappiaReader(): Promise<CatalogueReader> {
  // Literal specifier so the Next build traces the package, like the /happie routes.
  const { HappiaClient, cargarConfigDesdeEnv } = await import("@sempertex/happie-package-ia");
  let config: { baseUrl: string; apiKey: string };
  try {
    config = cargarConfigDesdeEnv();
  } catch {
    throw new NotConfiguredError("Happia API is not configured");
  }
  const client = new HappiaClient(config);
  return async (signal) => {
    const [packages, services] = await Promise.all([client.listarPackages(signal), client.listarServicios({ signal })]);
    return { packages: packages.packages, services };
  };
}

/** Reads the public Happia catalogue straight from its API on every call; nothing is cached or invented. */
export async function getHappiaCatalogue(options: {
  readFromHappia?: CatalogueReader;
  now?: Clock;
} = {}): Promise<HappiaCatalogueResult> {
  const now = options.now ?? (() => new Date());
  let raw: unknown;
  try {
    const readFromHappia = options.readFromHappia ?? await createHappiaReader();
    raw = await readFromHappia(AbortSignal.timeout(READ_TIMEOUT_MS));
  } catch (error) {
    // Keep errors opaque: provider responses can contain external data and credentials must not leak.
    if (error instanceof NotConfiguredError) return { status: "unavailable", reason: "not_configured" };
    return { status: "unavailable", reason: error instanceof z.ZodError ? "invalid_response" : "request_failed" };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { status: "unavailable", reason: "invalid_response" };
  return { status: "available", data: parsed.data, source: "happia_api", snapshotAgeSeconds: 0, fetchedAt: now().toISOString() };
}
