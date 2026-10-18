import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CreateSharedQuoteSchema,
  MAX_SHARED_STILL_BYTES,
  SharedQuoteDecisionSchema,
  type OwnerSharedQuote,
  type PublicSharedQuote,
  type SharedQuoteDecision,
} from "./contracts";
import { isFutureValidUntil, isNotExpired } from "./dates";
import { signShareToken, verifyShareToken } from "./token";
import type { NewSharedQuote, SharedQuoteRecord, SharedQuoteRepository } from "./repository";
import { CotizacionProfesionalResultadoSchema, MAX_COP, type EntradaCotizacionProfesional } from "@/lib/cotizacion/profesional";

const SceneKeySchema = z.string().trim().min(1).max(128);
const IdSchema = z.string().uuid();

export class SharedQuoteDisabledError extends Error {}
export class SharedQuoteConfigurationError extends Error {}
export class SharedQuoteStillError extends Error {}

export type SharedQuoteServiceDependencies = {
  repository: SharedQuoteRepository;
  secret: string;
  readerEnabled: boolean;
  writerEnabled: boolean;
  calculateQuote: (input: EntradaCotizacionProfesional) => Promise<unknown>;
  now?: () => Date;
  createId?: () => string;
};

function currentTime(dependencies: SharedQuoteServiceDependencies): Date {
  return dependencies.now?.() ?? new Date();
}

function writerIsEnabled(dependencies: SharedQuoteServiceDependencies): boolean {
  return dependencies.readerEnabled && dependencies.writerEnabled;
}

function revisionHash(sceneKey: string): string {
  return createHash("sha256").update(sceneKey, "utf8").digest("hex");
}

function jpegFromBase64(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (bytes.toString("base64") !== value || bytes.length > MAX_SHARED_STILL_BYTES || !isJpeg) {
    throw new SharedQuoteStillError("La imagen de la escena no tiene un JPEG válido.");
  }
  return bytes;
}

function tokenPayloadFor(
  dependencies: SharedQuoteServiceDependencies,
  token: string,
): { id: string; validUntil: string } | null {
  return verifyShareToken(token, dependencies.secret, currentTime(dependencies));
}

function recordMatchesToken(
  record: SharedQuoteRecord | null,
  payload: { id: string; validUntil: string },
  now: Date,
): record is SharedQuoteRecord {
  return record !== null && record.id === payload.id && record.schemaVersion === 1
    && record.validUntil === payload.validUntil && isNotExpired(record.validUntil, now);
}

export async function createSharedQuote(
  dependencies: SharedQuoteServiceDependencies,
  unknownInput: unknown,
): Promise<{ path: string; validUntil: string }> {
  if (!writerIsEnabled(dependencies)) throw new SharedQuoteDisabledError();
  if (Buffer.byteLength(dependencies.secret, "utf8") < 32) throw new SharedQuoteConfigurationError();

  const input = CreateSharedQuoteSchema.parse(unknownInput);
  const now = currentTime(dependencies);
  if (!isFutureValidUntil(input.validUntil, now)) {
    throw new z.ZodError([{
      code: "custom",
      path: ["validUntil"],
      message: "La vigencia debe terminar después de hoy en Colombia.",
    }]);
  }

  const stillBytes = jpegFromBase64(input.stillBase64);
  const calculated = CotizacionProfesionalResultadoSchema.parse(await dependencies.calculateQuote(input.quoteInput));
  if (calculated.precio_sugerido_cop > MAX_COP) {
    throw new SharedQuoteConfigurationError();
  }

  const id = (dependencies.createId ?? randomUUID)();
  IdSchema.parse(id);
  const record: NewSharedQuote = {
    id,
    schemaVersion: 1,
    sceneName: input.sceneName,
    sceneRevisionHash: revisionHash(input.sceneKey),
    validUntil: input.validUntil,
    totalCop: calculated.precio_sugerido_cop,
    stillBytes,
  };
  const token = signShareToken({ id, validUntil: input.validUntil }, dependencies.secret);
  await dependencies.repository.insert(record);
  return { path: `/cotizacion-compartida/${token}`, validUntil: input.validUntil };
}

export async function getPublicSharedQuote(
  dependencies: SharedQuoteServiceDependencies,
  token: string,
): Promise<PublicSharedQuote | null> {
  if (!dependencies.readerEnabled) return null;
  const payload = tokenPayloadFor(dependencies, token);
  if (!payload) return null;
  const now = currentTime(dependencies);
  const record = await dependencies.repository.findById(payload.id);
  if (!recordMatchesToken(record, payload, now)) return null;
  return {
    sceneName: record.sceneName,
    validUntil: record.validUntil,
    totalCop: record.totalCop,
    currency: "COP",
    status: record.status,
    createdAt: record.createdAt,
  };
}

export async function getPublicSharedStill(
  dependencies: SharedQuoteServiceDependencies,
  token: string,
): Promise<Buffer | null> {
  if (!dependencies.readerEnabled) return null;
  const payload = tokenPayloadFor(dependencies, token);
  if (!payload) return null;
  const now = currentTime(dependencies);
  const record = await dependencies.repository.findById(payload.id);
  if (!recordMatchesToken(record, payload, now)) return null;
  return dependencies.repository.findStillById(payload.id);
}

export async function recordSharedQuoteDecision(
  dependencies: SharedQuoteServiceDependencies,
  token: string,
  unknownDecision: unknown,
): Promise<{ status: "saved" } | { status: "already-answered" } | { status: "not-found" } | { status: "disabled" }> {
  if (!writerIsEnabled(dependencies)) return { status: "disabled" };
  const parsedDecision = SharedQuoteDecisionSchema.safeParse(unknownDecision);
  if (!parsedDecision.success) throw parsedDecision.error;
  const decision: SharedQuoteDecision = parsedDecision.data;
  const payload = tokenPayloadFor(dependencies, token);
  if (!payload) return { status: "not-found" };
  const now = currentTime(dependencies);
  const record = await dependencies.repository.findById(payload.id);
  if (!recordMatchesToken(record, payload, now)) return { status: "not-found" };
  if (record.status !== "pending") return { status: "already-answered" };

  const saved = await dependencies.repository.saveDecision({
    id: payload.id,
    validUntil: payload.validUntil,
    status: decision.decision,
    customerName: decision.customerName,
    comment: decision.comment ?? null,
  });
  if (saved) return { status: "saved" };

  const afterRace = await dependencies.repository.findById(payload.id);
  if (!recordMatchesToken(afterRace, payload, currentTime(dependencies))) return { status: "not-found" };
  return { status: afterRace.status === "pending" ? "not-found" : "already-answered" };
}

export async function listOwnerSharedQuotes(
  dependencies: SharedQuoteServiceDependencies,
  sceneKey: unknown,
): Promise<OwnerSharedQuote[]> {
  if (!dependencies.readerEnabled) return [];
  const parsedKey = SceneKeySchema.safeParse(sceneKey);
  if (!parsedKey.success) return [];
  return dependencies.repository.listBySceneRevision(revisionHash(parsedKey.data), 20);
}
