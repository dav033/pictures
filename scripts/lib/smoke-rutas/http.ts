import { createHash } from "node:crypto";

/**
 * HTTP client for the running Next dev server. Redirects are never followed:
 * the session proxy answers 307 to /login, and a client that follows it would
 * read the login page as a 200.
 */

export type RespuestaHttp = {
  status: number;
  headers: Headers;
  texto: string;
  json: unknown;
};

export type OpcionesSolicitud = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  conCookie?: boolean;
  timeoutMs?: number;
};

const TIMEOUT_POR_DEFECTO_MS = 120_000;

function parsearJson(texto: string): unknown {
  if (!texto) return undefined;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return undefined;
  }
}

export function esRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function campoTexto(value: unknown, clave: string): string | undefined {
  if (!esRegistro(value)) return undefined;
  const campo = value[clave];
  return typeof campo === "string" ? campo : undefined;
}

export function sessionEsperada(appPassword: string): string {
  return createHash("sha256").update(appPassword).digest("hex");
}

export class ClienteNext {
  private cookie: string | undefined;

  constructor(readonly base: URL) {}

  fijarCookie(valor: string): void {
    this.cookie = valor;
  }

  url(ruta: string): URL {
    return new URL(ruta, this.base);
  }

  private cabeceras(opciones: OpcionesSolicitud): Headers {
    const headers = new Headers(opciones.headers);
    if (opciones.body !== undefined) headers.set("content-type", "application/json");
    if ((opciones.conCookie ?? true) && this.cookie) headers.set("cookie", `session=${this.cookie}`);
    return headers;
  }

  async solicitar(ruta: string, opciones: OpcionesSolicitud = {}): Promise<RespuestaHttp> {
    const response = await fetch(this.url(ruta), {
      method: opciones.method ?? (opciones.body === undefined ? "GET" : "POST"),
      headers: this.cabeceras(opciones),
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS),
    });
    const texto = await response.text();
    return { status: response.status, headers: response.headers, texto, json: parsearJson(texto) };
  }

  /** Opens a streaming POST (SSE); the caller consumes the body. */
  async abrirStream(ruta: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
    return fetch(this.url(ruta), {
      method: "POST",
      headers: this.cabeceras({ body, headers }),
      body: JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
}

/** Reads `session=<value>` from Set-Cookie without printing it. */
export function cookieSesion(headers: Headers): string | undefined {
  const valores = headers.getSetCookie();
  for (const valor of valores) {
    const match = /^session=([^;]+)/.exec(valor);
    if (match) return match[1];
  }
  return undefined;
}
