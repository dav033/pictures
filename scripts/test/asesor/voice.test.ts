import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { POST, GET } from "@/app/api/voz/transcribir/route";
import { ASESOR_SESSION_COOKIE, createAdvisorSessionToken } from "@/lib/asesor/auth";
import { sessionToken } from "@/lib/auth/session";
import { ErrorVoz } from "@/lib/voz/cliente-vps";
import { MAX_BYTES_AUDIO, MAX_SEGUNDOS_AUDIO } from "@/lib/voz/limites";
import { atenderTranscripcion } from "@/lib/voz/transcribir";
import { codigoDeErrorMicrofono, codigoDeEstadoHttp, MENSAJES_ERROR_DICTADO } from "@/components/voz/mensajes-voz";
import { SEGUNDOS_CORTE } from "@/components/voz/useDictado";

const envKeys = ["APP_PASSWORD", "ASESOR_SESSION_SECRET", "VOZ_ENABLED", "VOZ_URL", "VOZ_SECRETO", "NODE_ENV"] as const;
const priorEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
after(() => {
  for (const key of envKeys) {
    const value = priorEnv.get(key);
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Reflect.set(process.env, key, value);
  }
});

const routeSource = readFileSync("src/app/api/voz/transcribir/route.ts", "utf8");
const chatViewSource = readFileSync("src/components/asesor/ChatView.tsx", "utf8");
const composerSource = readFileSync("src/components/asesor/Composer.tsx", "utf8");
const conversationSource = readFileSync("src/components/asesor/useConversation.ts", "utf8");

test("voice route accepts advisor and Pictures sessions while rejecting anonymous and cross-origin requests", async () => {
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.ASESOR_SESSION_SECRET = "test-advisor-voice-session-secret-32-bytes";
  process.env.APP_PASSWORD = "test-pictures-password";
  process.env.VOZ_ENABLED = "true";
  delete process.env.VOZ_URL;
  delete process.env.VOZ_SECRETO;
  const advisorToken = createAdvisorSessionToken("user");
  assert.ok(advisorToken);
  const origin = "https://example.test";
  const makeRequest = (cookie?: string, requestOrigin = origin) => new Request(`${origin}/api/voz/transcribir`, {
    method: "POST",
    headers: {
      "content-type": "audio/webm",
      origin: requestOrigin,
      ...(cookie ? { cookie } : {}),
    },
    body: new Uint8Array([1, 2, 3]),
  });

  assert.equal((await POST(makeRequest())).status, 401);
  assert.equal((await POST(makeRequest(`${ASESOR_SESSION_COOKIE}=${advisorToken}`, "https://attacker.test"))).status, 401);

  for (const cookie of [
    `${ASESOR_SESSION_COOKIE}=${advisorToken}`,
    `session=${sessionToken("test-pictures-password")}`,
  ]) {
    const response = await POST(makeRequest(cookie));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "El dictado por voz no está configurado en este servidor.",
      codigo: "no_configurada",
    });
  }

  assert.equal((await GET(new Request(`${origin}/api/voz/transcribir`))).status, 401);
  assert.equal((await GET(new Request(`${origin}/api/voz/transcribir`, {
    headers: { origin: "https://attacker.test", cookie: `${ASESOR_SESSION_COOKIE}=${advisorToken}` },
  }))).status, 403);
  const status = await GET(new Request(`${origin}/api/voz/transcribir`, {
    headers: { origin, cookie: `${ASESOR_SESSION_COOKIE}=${advisorToken}` },
  }));
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { habilitada: true });
});

test("transcription enforces audio limits, returns recoverable Spanish errors, and does not expose audio", async () => {
  const deps = {
    autenticado: () => true,
    mismoOrigen: () => true,
    config: () => ({ habilitada: true, url: "http://voz-decoracion:8000", secreto: "test-only" }),
    cupo: () => ({ permitido: true, reintentarEnSeg: 0 }),
    transcribir: async () => { throw new ErrorVoz("tiempo_agotado"); },
  };
  const request = (contentType: string, body: Uint8Array, headers: Record<string, string> = {}) => new Request("https://example.test/api/voz/transcribir", {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body: Buffer.from(body),
  });

  assert.equal(MAX_BYTES_AUDIO, 2 * 1024 * 1024);
  assert.equal(MAX_SEGUNDOS_AUDIO, 60);
  assert.ok(SEGUNDOS_CORTE < MAX_SEGUNDOS_AUDIO);
  assert.equal((await atenderTranscripcion(request("application/json", new Uint8Array([1])), deps)).status, 415);
  assert.equal((await atenderTranscripcion(request("audio/webm", new Uint8Array()), deps)).status, 400);
  assert.equal((await atenderTranscripcion(request("audio/webm", new Uint8Array(), { "content-length": String(MAX_BYTES_AUDIO + 1) }), deps)).status, 413);
  assert.equal((await atenderTranscripcion(request("audio/webm", new Uint8Array(MAX_BYTES_AUDIO + 1), { "content-length": "1" }), deps)).status, 413);

  const timeout = await atenderTranscripcion(request("audio/webm", new Uint8Array([1])), deps);
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).codigo, "tiempo_agotado");
  assert.equal(codigoDeEstadoHttp(504), "tiempo_agotado");
  assert.match(MENSAJES_ERROR_DICTADO.tiempo_agotado, /Inténtalo de nuevo/);
  assert.equal(codigoDeErrorMicrofono(new DOMException("denied", "NotAllowedError")), "sin_permiso");
  assert.match(MENSAJES_ERROR_DICTADO.sin_permiso, /Actívalo en los permisos/);

  const disabled = await atenderTranscripcion(request("audio/webm", new Uint8Array([1])), {
    ...deps,
    config: () => ({ habilitada: false, url: null, secreto: null }),
  });
  assert.equal(disabled.status, 404);
  assert.match(String((await disabled.json()).error), /no está habilitado/);
  assert.match(routeSource, /auditarEntrada: false, auditarSalida: false/);
  assert.doesNotMatch(routeSource, /console\.(?:log|info|warn|error)[^\n]*(?:audio|texto)/);
});

test("advisor dictation becomes a normal customer text turn with idempotent retries", () => {
  assert.match(composerSource, /<BotonVoz[^>]+alTexto=\{onVoiceText\}/);
  assert.match(chatViewSource, /onVoiceText=\{setDraft\}/);
  assert.match(conversationSource, /turnId: turn\.id/);
  assert.match(conversationSource, /const retry = useCallback\(\(\) => \{ if \(pendingTurn\) void sendTurn\(pendingTurn\); \}/);
  assert.match(routeSource, /duracion_s: r\.duracion_s, ms_servicio: r\.ms/);
  assert.doesNotMatch(routeSource, /crudo:[^\n]*(?:texto|audio)/);
});
