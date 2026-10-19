import "server-only";

import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  getPublicSharedQuote,
  getPublicSharedStill,
  createSharedQuote,
  listOwnerSharedQuotes,
  recordSharedQuoteDecision,
  SharedQuoteConfigurationError,
  SharedQuoteDisabledError,
  SharedQuoteStillError,
  type SharedQuoteServiceDependencies,
} from "./service";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const MAX_CREATE_BODY_BYTES = 1_050_000;
const MAX_DECISION_BODY_BYTES = 8_192;

export type SharedQuoteHttpDependencies = SharedQuoteServiceDependencies & {
  authenticate: (request: Request) => boolean;
  sameOrigin: (request: Request) => boolean;
};

type JsonBodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

async function readJsonBody(request: Request, maximumBytes: number): Promise<JsonBodyResult> {
  const declaredBytes = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) return { ok: false, status: 413 };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400 };
  }
  if (Buffer.byteLength(text, "utf8") > maximumBytes) return { ok: false, status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

function emptyNotFound(): Response {
  return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
}

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: PRIVATE_HEADERS });
}

function hasRequiredOrigin(request: Request, dependencies: SharedQuoteHttpDependencies): boolean {
  return request.headers.has("origin") && dependencies.sameOrigin(request);
}

export async function handleCreateSharedQuote(
  request: Request,
  dependencies: SharedQuoteHttpDependencies,
): Promise<Response> {
  if (!dependencies.authenticate(request)) return errorJson(401, "UNAUTHORIZED", "La sesión no es válida.");
  if (!hasRequiredOrigin(request, dependencies)) return errorJson(403, "ORIGIN_REJECTED", "La solicitud no es válida.");
  const body = await readJsonBody(request, MAX_CREATE_BODY_BYTES);
  if (!body.ok) return errorJson(body.status, body.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", "No se pudo leer la solicitud.");

  try {
    const result = await createSharedQuote(dependencies, body.value);
    return Response.json(result, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ZodError) return errorJson(400, "INVALID_INPUT", "La cotización compartida no tiene un formato válido.");
    if (error instanceof SharedQuoteStillError) return errorJson(400, "INVALID_STILL", "No se pudo preparar la imagen de la escena.");
    if (error instanceof SharedQuoteDisabledError) return emptyNotFound();
    if (error instanceof SharedQuoteConfigurationError) return errorJson(503, "SHARING_UNAVAILABLE", "La cotización compartida no está disponible.");
    console.error("[shared-quotes] create failed", { requestId: randomUUID() });
    return errorJson(502, "QUOTE_UNAVAILABLE", "No pude preparar el precio para compartir.");
  }
}

export async function handleListOwnerSharedQuotes(
  request: Request,
  dependencies: SharedQuoteHttpDependencies,
): Promise<Response> {
  if (!dependencies.authenticate(request)) return errorJson(401, "UNAUTHORIZED", "La sesión no es válida.");
  if (!dependencies.readerEnabled) return emptyNotFound();
  const sceneKey = new URL(request.url).searchParams.get("sceneKey");
  if (!sceneKey) return errorJson(400, "INVALID_INPUT", "Falta la escena.");
  try {
    const quotes = await listOwnerSharedQuotes(dependencies, sceneKey);
    return Response.json({ quotes }, { headers: PRIVATE_HEADERS });
  } catch {
    console.error("[shared-quotes] owner list failed", { requestId: randomUUID() });
    return errorJson(503, "SHARING_UNAVAILABLE", "No pude cargar las respuestas.");
  }
}

export async function handlePublicSharedQuote(
  token: string,
  dependencies: SharedQuoteHttpDependencies,
): Promise<Response> {
  try {
    const quote = await getPublicSharedQuote(dependencies, token);
    return quote ? Response.json(quote, { headers: PRIVATE_HEADERS }) : emptyNotFound();
  } catch {
    console.error("[shared-quotes] public read failed", { requestId: randomUUID() });
    return errorJson(503, "SHARING_UNAVAILABLE", "La cotización no está disponible.");
  }
}

export async function handlePublicSharedStill(
  token: string,
  dependencies: SharedQuoteHttpDependencies,
): Promise<Response> {
  try {
    const bytes = await getPublicSharedStill(dependencies, token);
    if (!bytes) return emptyNotFound();
    return new Response(Uint8Array.from(bytes), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    console.error("[shared-quotes] public image read failed", { requestId: randomUUID() });
    return errorJson(503, "SHARING_UNAVAILABLE", "La imagen no está disponible.");
  }
}

export async function handlePublicSharedQuoteDecision(
  request: Request,
  token: string,
  dependencies: SharedQuoteHttpDependencies,
): Promise<Response> {
  if (!hasRequiredOrigin(request, dependencies)) return errorJson(403, "ORIGIN_REJECTED", "La solicitud no es válida.");
  const body = await readJsonBody(request, MAX_DECISION_BODY_BYTES);
  if (!body.ok) return errorJson(body.status, body.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", "No se pudo leer la respuesta.");
  try {
    const result = await recordSharedQuoteDecision(dependencies, token, body.value);
    if (result.status === "not-found" || result.status === "disabled") return emptyNotFound();
    if (result.status === "already-answered") return errorJson(409, "ALREADY_ANSWERED", "Esta cotización ya tiene una respuesta.");
    return Response.json({ status: "saved" }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ZodError) return errorJson(400, "INVALID_INPUT", "La respuesta no tiene un formato válido.");
    console.error("[shared-quotes] decision failed", { requestId: randomUUID() });
    return errorJson(503, "SHARING_UNAVAILABLE", "No pude guardar la respuesta.");
  }
}
