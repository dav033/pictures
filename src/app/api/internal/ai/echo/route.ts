import {
  PYTHON_MAX_BODY_BYTES,
  llamarPythonEcho,
  parseEchoPayload,
  pythonErrorBody,
  seleccionarBackendPython,
  PythonAdapterError,
} from "@/lib/ia/python-adapter";
import {
  leerContextoOperativo,
  sha256Body,
} from "@/lib/ia/contracts/operational-v1";

export const maxDuration = 75;

const commonHeaders = (requestId: string, correlationId: string): Record<string, string> => ({
  "Cache-Control": "no-store",
  "X-Request-ID": requestId,
  "X-Correlation-ID": correlationId,
});

export async function POST(request: Request): Promise<Response> {
  const preliminaryContext = leerContextoOperativo(request);
  const preliminaryHeaders = commonHeaders(
    preliminaryContext.request_id,
    preliminaryContext.correlation_id,
  );

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json(
      {
        schema_version: "operational.v1",
        code: "INVALID_INPUT",
        message: "El cuerpo JSON no se pudo leer.",
        request_id: preliminaryContext.request_id,
        correlation_id: preliminaryContext.correlation_id,
      },
      { status: 400, headers: preliminaryHeaders },
    );
  }

  const bodyBytes = new TextEncoder().encode(rawBody).byteLength;
  if (bodyBytes > PYTHON_MAX_BODY_BYTES) {
    return Response.json(
      {
        schema_version: "operational.v1",
        code: "PAYLOAD_TOO_LARGE",
        message: "La solicitud supera el tamaño máximo permitido.",
        request_id: preliminaryContext.request_id,
        correlation_id: preliminaryContext.correlation_id,
      },
      { status: 413, headers: preliminaryHeaders },
    );
  }

  let payload: Record<string, unknown> | undefined;
  try {
    payload = parseEchoPayload(JSON.parse(rawBody));
  } catch {
    payload = undefined;
  }
  const context = leerContextoOperativo(request, sha256Body(rawBody));
  const headers = commonHeaders(context.request_id, context.correlation_id);
  if (!payload) {
    return Response.json(
      {
        schema_version: "operational.v1",
        code: "INVALID_INPUT",
        message: "El cuerpo debe ser un objeto JSON.",
        request_id: context.request_id,
        correlation_id: context.correlation_id,
      },
      { status: 400, headers },
    );
  }

  const selection = seleccionarBackendPython();
  if (selection.backend === "next") {
    return Response.json(
      {
        schema_version: "operational.v1",
        backend: "next",
        request_id: context.request_id,
        correlation_id: context.correlation_id,
        payload,
      },
      { status: 200, headers },
    );
  }

  try {
    const pythonResponse = await llamarPythonEcho({
      payload,
      requestId: context.request_id,
      correlationId: context.correlation_id,
      bodySha256: context.body_sha256,
      deadlineMs: context.deadline_ms,
      idempotencyKey: context.idempotency_key,
      scopes: ["ai.echo"],
      parentSignal: request.signal,
    });
    return Response.json(
      {
        ...pythonResponse,
        request_id: context.request_id,
        backend: "python",
        correlation_id: context.correlation_id,
      },
      {
        status: 200,
        headers: pythonResponse.replayed
          ? { ...headers, "X-Idempotency-Result": "replay" }
          : headers,
      },
    );
  } catch (error) {
    const stableError = error instanceof PythonAdapterError
      ? error
      : new PythonAdapterError({
          code: "PYTHON_UNAVAILABLE",
          status: 502,
          requestId: context.request_id,
          correlationId: context.correlation_id,
        });
    return Response.json(pythonErrorBody(stableError), {
      status: stableError.status,
      headers,
    });
  }
}
