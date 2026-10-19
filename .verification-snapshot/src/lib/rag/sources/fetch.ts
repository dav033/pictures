import { createHash } from "node:crypto";
import {
  CatalogProductSourceSchema,
  OrderDataSourceSchema,
  ProductsCatalogSourceSchema,
  type OrderDataSource,
  type ProductsCatalogSource,
  type SourceKind,
  summarizeSource,
} from "./contracts";

export const PRODUCTS_CATALOG_URL =
  "https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json?v=1779763986";
export const ORDER_DATA_URL =
  "https://cdn.shopify.com/s/files/1/0983/2752/7703/files/order_data.json?v=1779763985de";

export type FetchOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
};

export type SourceManifest = {
  kind: SourceKind;
  url: string;
  fetched_at: string;
  status: number;
  content_type: string | null;
  bytes: number;
  sha256: string;
  counts: ReturnType<typeof summarizeSource>;
  contract_version: "cdn-graphql-v1";
};

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly source: SourceKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown network error";
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Descarga solo en memoria. No escribe RAW, no reenvía cookies/auth y no
 * incluye body en los errores para evitar que IDs reales terminen en logs.
 */
export async function fetchSourceJson<T>(kind: SourceKind, url: string, options: FetchOptions = {}): Promise<{
  body: string;
  response: Response;
}> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = Math.max(0, options.retries ?? 2);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        if (attempt < retries && isRetryableStatus(response.status)) {
          await wait(retryDelayMs * 2 ** attempt);
          continue;
        }
        throw new SourceFetchError(`source returned HTTP ${response.status}`, kind, response.status);
      }
      return { body: await response.text(), response };
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      if (attempt >= retries) {
        throw new SourceFetchError(`source fetch failed after ${attempt + 1} attempts: ${errorMessage(error)}`, kind);
      }
      await wait(retryDelayMs * 2 ** attempt);
    }
  }

  throw new SourceFetchError("source fetch exhausted retries", kind);
}

function parseJson(body: string, kind: SourceKind): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SourceFetchError("source body is not valid JSON", kind);
  }
}

export function parseProductsCatalog(body: string): ProductsCatalogSource {
  return ProductsCatalogSourceSchema.parse(parseJson(body, "products_catalog"));
}

export function parseOrderData(body: string): OrderDataSource {
  return OrderDataSourceSchema.parse(parseJson(body, "order_data"));
}

export function createManifest(
  kind: SourceKind,
  url: string,
  body: string,
  response: Pick<Response, "status" | "headers">,
  source: ProductsCatalogSource | OrderDataSource,
  fetchedAt = new Date().toISOString(),
): SourceManifest {
  const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
  return {
    kind,
    url,
    fetched_at: fetchedAt,
    status: response.status,
    content_type: response.headers.get("content-type"),
    bytes: Buffer.byteLength(body, "utf8"),
    sha256,
    counts: summarizeSource(kind, source),
    contract_version: "cdn-graphql-v1",
  };
}

export function parseByKind(kind: SourceKind, body: string): ProductsCatalogSource | OrderDataSource {
  return kind === "products_catalog" ? parseProductsCatalog(body) : parseOrderData(body);
}

export function sourceLabel(kind: SourceKind): string {
  return kind === "products_catalog" ? "products_catalog" : "order_data";
}

// Import-time references ensure accidental schema drift fails at compile time.
void CatalogProductSourceSchema;
