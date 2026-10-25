import { z } from "zod";
import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { receiveVoiceNote, VOICE_NOTE_MESSAGES, type VoiceNoteError } from "@/lib/asesor/voice-notes";
import { isSameOriginRequest } from "@/lib/auth/request";
import { auditarLlamadaIa, conRegistro } from "@/lib/registro/servidor";
import { transcribirEnVps } from "@/lib/voz/cliente-vps";
import { leerConfigVoz } from "@/lib/voz/config";
import { tomarCupoVoz } from "@/lib/voz/limite";
import { MAX_BYTES_AUDIO } from "@/lib/voz/limites";
import { ipDe, leerConTope } from "@/lib/voz/transcribir";

/**
 * Web channel of the advisor's voice notes: the raw recording in the body, `conversationId` and `turnId` in the query.
 * The transcript is stored as the customer's turn and returned as `{ texto }`; the browser then sends that turn to
 * `/api/asesor/conversar` with the same `turnId`. The audio is neither stored nor audited (only size, type and timing).
 */
export const POST = conRegistro("/api/asesor/voice-notes", handlePost, { auditarEntrada: false, auditarSalida: false });

const QuerySchema = z.object({ conversationId: z.string().min(1).max(100), turnId: z.string().min(1).max(100) });
const STATUS: Record<VoiceNoteError, number> = { unsupported_format: 415, too_large: 413, empty: 400, no_speech: 422, not_configured: 404, busy: 503, timeout: 504, failed: 502 };

async function handlePost(request: Request): Promise<Response> {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  if (!isSameOriginRequest(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const url = new URL(request.url);
  const query = QuerySchema.safeParse({ conversationId: url.searchParams.get("conversationId"), turnId: url.searchParams.get("turnId") });
  if (!query.success) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
  const cupo = tomarCupoVoz(ipDe(request));
  if (!cupo.permitido) return Response.json({ code: "TOO_MANY", error: "Demasiadas notas de voz seguidas. Espera un momento." }, { status: 429, headers: { "Retry-After": String(cupo.reintentarEnSeg) } });
  const audio = await leerConTope(request, MAX_BYTES_AUDIO);
  if (audio === null) return Response.json({ code: "too_large", error: VOICE_NOTE_MESSAGES.too_large }, { status: 413 });

  const repository = createAsesorRepository();
  try {
    const { id: accountId } = await repository.upsertAccount(`advisor:${session.role}`);
    const conversation = await repository.getConversation(query.data.conversationId);
    if (!conversation || conversation.accountId !== accountId) return Response.json({ code: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  const result = await receiveVoiceNote({ ...query.data, audio, contentType: request.headers.get("content-type") }, {
    repository,
    config: () => leerConfigVoz(),
    transcribe: (bytes, contentType, config) => auditarLlamadaIa(
      { proveedor: "whisper-vps", modelo: "faster-whisper-small", proposito: "nota_voz_asesor", parametros: { bytes: bytes.byteLength, tipo: contentType } },
      () => transcribirEnVps(bytes, contentType, config),
      (r) => ({ modelo: "faster-whisper-small", costeEstimadoUsd: 0, crudo: { duracion_s: r.duracion_s, ms_servicio: r.ms } }),
    ),
  }).catch(() => ({ status: "rejected" as const, code: "failed" as const }));
  if (result.status === "rejected") return Response.json({ code: result.code, error: VOICE_NOTE_MESSAGES[result.code] }, { status: STATUS[result.code], headers: { "Cache-Control": "no-store" } });
  return Response.json({ turnId: query.data.turnId, texto: result.text }, { headers: { "Cache-Control": "no-store" } });
}
