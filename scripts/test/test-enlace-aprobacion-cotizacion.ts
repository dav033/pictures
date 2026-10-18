import assert from "node:assert/strict";
import { handleCreateSharedQuote, handleListOwnerSharedQuotes, handlePublicSharedQuote, handlePublicSharedStill, handlePublicSharedQuoteDecision } from "@/lib/shared-quotes/http";
import type { NewSharedQuote, SharedQuoteRecord, SharedQuoteRepository } from "@/lib/shared-quotes/repository";
import type { OwnerSharedQuote, SharedQuoteStatus } from "@/lib/shared-quotes/contracts";
import type { SharedQuoteHttpDependencies } from "@/lib/shared-quotes/http";
import { signShareToken } from "@/lib/shared-quotes/token";
import type { SharedQuoteServiceDependencies } from "@/lib/shared-quotes/service";
import { isPublicSharedQuotePath } from "@/lib/auth/shared-quote-public-path";
import { redactRouteForLogs } from "@/lib/registro/ruta-segura";

const SECRET = "shared-quote-test-secret-with-at-least-32-bytes";
const NOW = new Date("2026-10-16T17:00:00.000Z");
const RECORD_ID = "00000000-0000-4000-8000-000000000001";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);

const quoteInput = {
  materiales: [{
    variant_id: "sempertex:R-12-570",
    descripcion: "Globo R-12 rosa",
    paquetes: 1,
    precio_paquete_catalogo_cop: 1000,
  }],
  mano_de_obra: [],
  equipos_transporte: [],
  indirectos: [],
  utilidad_porcentaje: null,
};

const quoteResult = {
  operation_schema_version: "cotizacion-profesional-result.v1",
  currency: "COP",
  materiales: {
    lineas: [{
      variant_id: "sempertex:R-12-570",
      descripcion: "Globo R-12 rosa",
      paquetes: 1,
      precio_paquete_catalogo_cop: 1000,
      precio_paquete_cop: 1000,
      precio_editado: false,
      subtotal_cop: 1000,
    }],
    total_cop: 1000,
  },
  mano_de_obra: { lineas: [], total_cop: 0 },
  equipos_transporte: { lineas: [], total_cop: 0 },
  indirectos: { lineas: [], total_cop: 0 },
  total_costos_cop: 1000,
  utilidad_porcentaje: null,
  utilidad_cop: 0,
  precio_sugerido_cop: 12345,
  margen_porcentaje: null,
};

class FakeRepository implements SharedQuoteRepository {
  readonly records = new Map<string, SharedQuoteRecord>();
  readonly images = new Map<string, Buffer>();
  reads = 0;

  async insert(record: NewSharedQuote): Promise<void> {
    this.records.set(record.id, {
      id: record.id,
      schemaVersion: record.schemaVersion,
      sceneName: record.sceneName,
      sceneRevisionHash: record.sceneRevisionHash,
      validUntil: record.validUntil,
      totalCop: record.totalCop,
      status: "pending",
      customerName: null,
      comment: null,
      respondedAt: null,
      createdAt: NOW.toISOString(),
    });
    this.images.set(record.id, record.stillBytes);
  }

  async findById(id: string): Promise<SharedQuoteRecord | null> {
    this.reads += 1;
    return this.records.get(id) ?? null;
  }

  async findStillById(id: string): Promise<Buffer | null> {
    return this.images.get(id) ?? null;
  }

  async listBySceneRevision(hash: string, limit: number): Promise<OwnerSharedQuote[]> {
    return [...this.records.values()]
      .filter((record) => record.sceneRevisionHash === hash)
      .slice(0, limit)
      .map((record) => ({
        id: record.id,
        sceneName: record.sceneName,
        validUntil: record.validUntil,
        status: record.status,
        customerName: record.customerName,
        comment: record.comment,
        respondedAt: record.respondedAt,
        createdAt: record.createdAt,
      }));
  }

  async saveDecision(input: {
    id: string;
    validUntil: string;
    status: Exclude<SharedQuoteStatus, "pending">;
    customerName: string;
    comment: string | null;
  }): Promise<boolean> {
    const record = this.records.get(input.id);
    if (!record || record.status !== "pending" || record.validUntil !== input.validUntil) return false;
    this.records.set(input.id, {
      ...record,
      status: input.status,
      customerName: input.customerName,
      comment: input.comment,
      respondedAt: NOW.toISOString(),
    });
    return true;
  }
}

function createDependencies(repository: FakeRepository): SharedQuoteHttpDependencies {
  const serviceDependencies: SharedQuoteServiceDependencies = {
    repository,
    secret: SECRET,
    readerEnabled: true,
    writerEnabled: true,
    calculateQuote: async () => quoteResult,
    now: () => new Date(NOW),
    createId: () => RECORD_ID,
  };
  return {
    ...serviceDependencies,
    authenticate: () => true,
    sameOrigin: () => true,
  };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request("https://app.example.com" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.example.com" },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const repository = new FakeRepository();
  const dependencies = createDependencies(repository);
  const createResponse = await handleCreateSharedQuote(
    jsonRequest("/api/taller/cotizaciones-compartidas", {
      sceneName: "Arco de prueba",
      sceneKey: "taller-test-scene",
      validUntil: "2026-10-20",
      quoteInput,
      stillBase64: JPEG.toString("base64"),
    }),
    dependencies,
  );
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json() as { path: string; validUntil: string };
  assert.equal(created.validUntil, "2026-10-20");
  assert.match(created.path, /^\/cotizacion-compartida\/[A-Za-z0-9_.-]+$/);
  assert.equal(repository.records.get(RECORD_ID)?.totalCop, 12345, "el precio guardado viene del recálculo del servidor");

  const token = created.path.split("/").pop()!;
  const readsBeforeInvalid = repository.reads;
  const invalid = await handlePublicSharedQuote(token + "x", dependencies);
  assert.equal(invalid.status, 404);
  assert.equal(await invalid.text(), "", "los enlaces inválidos no devuelven datos");
  assert.equal(repository.reads, readsBeforeInvalid, "la firma inválida se rechaza antes de consultar Postgres");

  const expiredToken = signShareToken({ id: RECORD_ID, validUntil: "2026-10-15" }, SECRET);
  const expired = await handlePublicSharedQuote(expiredToken, dependencies);
  assert.equal(expired.status, 404);
  assert.equal(await expired.text(), "");
  assert.equal(repository.reads, readsBeforeInvalid, "los enlaces vencidos se rechazan antes de consultar Postgres");

  const publicResponse = await handlePublicSharedQuote(token, dependencies);
  assert.equal(publicResponse.status, 200);
  const publicData = await publicResponse.json() as Record<string, unknown>;
  assert.equal(publicData["totalCop"], 12345);
  assert.equal(publicData["sceneName"], "Arco de prueba");
  assert.equal("total_costos_cop" in publicData, false);
  assert.equal("utilidad_cop" in publicData, false);

  const image = await handlePublicSharedStill(token, dependencies);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("Content-Type"), "image/jpeg");
  assert.equal(image.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), JPEG);

  const badPriceEdit = await handlePublicSharedQuoteDecision(
    jsonRequest("/api/cotizacion-compartida/" + token + "/decision", {
      decision: "approved",
      customerName: "Cliente",
      totalCop: 1,
    }),
    token,
    dependencies,
  );
  assert.equal(badPriceEdit.status, 400, "el contrato estricto no acepta cambios de precio");
  assert.equal(repository.records.get(RECORD_ID)?.status, "pending");

  const badOriginRequest = new Request("https://app.example.com/api/cotizacion-compartida/" + token + "/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ decision: "approved", customerName: "Cliente" }),
  });
  const wrongOrigin = await handlePublicSharedQuoteDecision(badOriginRequest, token, {
    ...dependencies,
    sameOrigin: () => false,
  });
  assert.equal(wrongOrigin.status, 403);

  const approval = await handlePublicSharedQuoteDecision(
    jsonRequest("/api/cotizacion-compartida/" + token + "/decision", {
      decision: "approved",
      customerName: "Cliente",
    }),
    token,
    dependencies,
  );
  assert.equal(approval.status, 200);
  assert.equal(repository.records.get(RECORD_ID)?.status, "approved");
  assert.equal(repository.records.get(RECORD_ID)?.customerName, "Cliente");
  const duplicate = await handlePublicSharedQuoteDecision(
    jsonRequest("/api/cotizacion-compartida/" + token + "/decision", {
      decision: "approved",
      customerName: "Otra persona",
    }),
    token,
    dependencies,
  );
  assert.equal(duplicate.status, 409, "una cotización admite una sola respuesta");

  const changeId = "00000000-0000-4000-8000-000000000002";
  await repository.insert({
    id: changeId,
    schemaVersion: 1,
    sceneName: "Columna de prueba",
    sceneRevisionHash: repository.records.get(RECORD_ID)!.sceneRevisionHash,
    validUntil: "2026-10-20",
    totalCop: 23456,
    stillBytes: JPEG,
  });
  const changeToken = signShareToken({ id: changeId, validUntil: "2026-10-20" }, SECRET);
  const requestedChanges = await handlePublicSharedQuoteDecision(
    jsonRequest("/api/cotizacion-compartida/" + changeToken + "/decision", {
      decision: "changes_requested",
      customerName: "Cliente",
      comment: "Cambia el tono rosa por lila.",
    }),
    changeToken,
    dependencies,
  );
  assert.equal(requestedChanges.status, 200);
  assert.equal(repository.records.get(changeId)?.status, "changes_requested");
  assert.equal(repository.records.get(changeId)?.comment, "Cambia el tono rosa por lila.");

  const invalidChange = await handlePublicSharedQuoteDecision(
    jsonRequest("/api/cotizacion-compartida/" + token + "/decision", {
      decision: "changes_requested",
      customerName: "Cliente",
    }),
    token,
    createDependencies(new FakeRepository()),
  );
  assert.equal(invalidChange.status, 400, "pedir cambios requiere comentario");

  const ownerResponse = await handleListOwnerSharedQuotes(
    new Request("https://app.example.com/api/taller/cotizaciones-compartidas?sceneKey=taller-test-scene"),
    dependencies,
  );
  assert.equal(ownerResponse.status, 200);
  const ownerData = await ownerResponse.json() as { quotes: OwnerSharedQuote[] };
  assert.equal(ownerData.quotes.find((quote) => quote.id === RECORD_ID)?.comment, null);
  assert.equal(ownerData.quotes.find((quote) => quote.id === RECORD_ID)?.customerName, "Cliente");
  assert.equal(ownerData.quotes.find((quote) => quote.id === changeId)?.comment, "Cambia el tono rosa por lila.");

  const readerOnly = { ...dependencies, writerEnabled: false };
  const blockedCreate = await handleCreateSharedQuote(
    jsonRequest("/api/taller/cotizaciones-compartidas", {
      sceneName: "Arco de prueba",
      sceneKey: "taller-test-scene",
      validUntil: "2026-10-20",
      quoteInput,
      stillBase64: JPEG.toString("base64"),
    }),
    readerOnly,
  );
  assert.equal(blockedCreate.status, 404, "la escritura no se activa antes del lector");

  assert.equal(isPublicSharedQuotePath("/cotizacion-compartida/not-a-token"), true);
  assert.equal(isPublicSharedQuotePath("/api/cotizacion-compartida/not-a-token/imagen"), true);
  assert.equal(isPublicSharedQuotePath("/api/taller/cotizaciones-compartidas"), false);
  assert.equal(isPublicSharedQuotePath("/cotizacion-compartida/not-a-token/other"), false);
  assert.equal(redactRouteForLogs(`/cotizacion-compartida/${token}`), "/cotizacion-compartida/[token]");
  assert.equal(redactRouteForLogs(`/api/cotizacion-compartida/${token}/imagen`), "/api/cotizacion-compartida/[token]/imagen");
  assert.equal(redactRouteForLogs(`/api/cotizacion-compartida/${token}/decision`), "/api/cotizacion-compartida/[token]/decision");
  assert.equal(redactRouteForLogs("/3d"), "/3d", "las rutas sin secreto conservan su valor");

  const strictInput = await handleCreateSharedQuote(
    jsonRequest("/api/taller/cotizaciones-compartidas", {
      sceneName: "Arco de prueba",
      sceneKey: "taller-test-scene",
      validUntil: "2026-10-20",
      quoteInput,
      stillBase64: JPEG.toString("base64"),
      totalCop: 1,
    }),
    dependencies,
  );
  assert.equal(strictInput.status, 400, "el cliente no puede indicar el total al crear el snapshot");

  console.log("[PASS] enlace firmado, expiración local, snapshot recalculado, still privado, decisiones estrictas, control de origen y consulta del Taller.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
