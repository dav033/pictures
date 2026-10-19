import { randomUUID } from "node:crypto";
import { campoTexto, cookieSesion, esRegistro, sessionEsperada, type RespuestaHttp } from "./http";
import { detalleRespuesta, registrarPeticion, type Contexto } from "./contexto";
import type { Reporte } from "./reporte";

/**
 * P0: FastAPI liveness/readiness and the Next session boundary. Shared by every
 * phase: FastAPI must stay up even in `python-down` (only Next points elsewhere).
 */

async function getFastapi(ctx: Contexto, ruta: string): Promise<{ status: number; json: unknown } | { error: string }> {
  try {
    const response = await fetch(new URL(ruta, ctx.config.fastapiUrl), { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    const texto = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(texto) as unknown;
    } catch {
      json = undefined;
    }
    return { status: response.status, json };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function preflightFastapi(ctx: Contexto): Promise<void> {
  const reporte: Reporte = ctx.reporte;
  const health = await getFastapi(ctx, "/healthz");
  reporte.exigir("P0.fastapi.healthz", "status" in health && health.status === 200 && campoTexto(health.json, "status") === "ok", "status" in health ? `status=${health.status}` : `sin conexión: ${health.error}`);
  const ready = await getFastapi(ctx, "/readyz");
  reporte.exigir("P0.fastapi.readyz", "status" in ready && ready.status === 200 && campoTexto(ready.json, "status") === "ready", "status" in ready ? `status=${ready.status}` : `sin conexión: ${ready.error}`);
}

function redirigeALogin(respuesta: RespuestaHttp, desde: string): boolean {
  const location = respuesta.headers.get("location") ?? "";
  return respuesta.status === 307 && location.includes(`/login?from=${encodeURIComponent(desde)}`);
}

export async function preflightSesion(ctx: Contexto): Promise<void> {
  const reporte: Reporte = ctx.reporte;
  const next = ctx.next;
  const sinCookie = await next.solicitar("/", { conCookie: false });
  reporte.exigir("P0.next.GET/ sin cookie → 307 /login", redirigeALogin(sinCookie, "/"), `status=${sinCookie.status} location=${sinCookie.headers.get("location") ?? "(ninguna)"}`);

  registrarPeticion(ctx, "P0.login", "/api/login", { password: "<APP_PASSWORD redactada>" });
  const login = await next.solicitar("/api/login", { body: { password: ctx.config.appPassword }, conCookie: false });
  const cookie = cookieSesion(login.headers);
  reporte.exigir("P0.next.POST /api/login", login.status === 200 && esRegistro(login.json) && login.json.ok === true && cookie !== undefined, `status=${login.status} set-cookie session=${cookie ? "presente" : "ausente"}`);
  reporte.check("P0.next.cookie = sha256(APP_PASSWORD)", cookie === sessionEsperada(ctx.config.appPassword), "comparado sin imprimir el valor");
  next.fijarCookie(cookie);

  const conCookie = await next.solicitar("/");
  reporte.exigir("P0.next.GET/ con cookie → 200 html", conCookie.status === 200 && (conCookie.headers.get("content-type") ?? "").includes("text/html"), `status=${conCookie.status} content-type=${conCookie.headers.get("content-type") ?? ""}`);

  const echoSinCookie = await next.solicitar("/api/internal/ai/echo", { body: { message: "smoke-sin-cookie" }, conCookie: false });
  reporte.check("P0.echo sin cookie → 307", redirigeALogin(echoSinCookie, "/api/internal/ai/echo"), `status=${echoSinCookie.status}`);
}

export type ResultadoEcho = { primera: RespuestaHttp; replay: RespuestaHttp; mensaje: string };

export async function echoConIdempotencia(ctx: Contexto): Promise<ResultadoEcho> {
  const id = randomUUID();
  const mensaje = `smoke-${id}`;
  const headers = { "Idempotency-Key": `smoke-${id}`, "X-Correlation-ID": randomUUID() };
  registrarPeticion(ctx, "P0.echo", "/api/internal/ai/echo", { message: mensaje, headers: { "Idempotency-Key": headers["Idempotency-Key"] } });
  const primera = await ctx.next.solicitar("/api/internal/ai/echo", { body: { message: mensaje }, headers });
  const replay = await ctx.next.solicitar("/api/internal/ai/echo", { body: { message: mensaje }, headers });
  return { primera, replay, mensaje };
}

export function mensajeEchoDevuelto(respuesta: RespuestaHttp): string | undefined {
  if (!esRegistro(respuesta.json) || !esRegistro(respuesta.json.payload)) return undefined;
  return campoTexto(respuesta.json.payload, "message");
}

export async function echoPython(ctx: Contexto): Promise<void> {
  const reporte: Reporte = ctx.reporte;
  const { primera, replay, mensaje } = await echoConIdempotencia(ctx);
  reporte.exigir("P0.echo con cookie → 200 backend python", primera.status === 200 && campoTexto(primera.json, "backend") === "python" && mensajeEchoDevuelto(primera) === mensaje, detalleRespuesta(primera, 250));
  reporte.check("P0.echo replay → X-Idempotency-Result: replay", replay.status === 200 && replay.headers.get("x-idempotency-result") === "replay" && mensajeEchoDevuelto(replay) === mensaje, `status=${replay.status} x-idempotency-result=${replay.headers.get("x-idempotency-result") ?? "(ausente)"}`);
}
