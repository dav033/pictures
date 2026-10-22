import { z } from "zod";
import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { isSameOriginRequest } from "@/lib/auth/request";
import { MAX_PHOTO_BYTES, parsePhotoKind, prepareAdvisorPhoto } from "@/lib/asesor/photos";

const MAX_PHOTOS_PER_TURN = 4;
const MAX_REQUEST_BYTES = MAX_PHOTO_BYTES * MAX_PHOTOS_PER_TURN + 64 * 1024;
const FormSchema = z.object({
  conversationId: z.string().min(1).max(100),
  turnId: z.string().uuid(),
  content: z.string().trim().max(12_000),
  kind: z.enum(["inspiration", "venue"]),
});

async function boundedBody(request: Request): Promise<ArrayBuffer> {
  if (!request.body) throw new Error("empty_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("photo_request_too_large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const backing = new ArrayBuffer(total);
  const body = new Uint8Array(backing);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return backing;
}

export async function POST(request: Request) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  if (!isSameOriginRequest(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return Response.json({ code: "INVALID_PHOTO", message: "Las fotos superan el máximo permitido de 6 MB cada una." }, { status: 413 });
  }
  let form: FormData;
  try {
    const body = await boundedBody(request);
    form = await new Request(request.url, { method: "POST", headers: request.headers, body }).formData();
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "photo_request_too_large";
    return Response.json({ code: "INVALID_PHOTO", message: tooLarge ? "Las fotos superan el máximo permitido de 6 MB cada una." : "No se pudieron leer las fotos enviadas." }, { status: tooLarge ? 413 : 400 });
  }
  const input = FormSchema.safeParse(Object.fromEntries(["conversationId", "turnId", "content", "kind"].map((key) => [key, form.get(key)])));
  const files = form.getAll("photos");
  if (!input.success || files.length < 1 || files.length > MAX_PHOTOS_PER_TURN || !parsePhotoKind(input.data?.kind)) {
    return Response.json({ code: "INVALID_INPUT", message: "Selecciona entre 1 y 4 fotos JPEG, PNG o WebP." }, { status: 400 });
  }
  if (!files.every((file): file is File => typeof File !== "undefined" && file instanceof File)) {
    return Response.json({ code: "INVALID_PHOTO", message: "El archivo enviado no es una foto válida." }, { status: 400 });
  }
  try {
    const repo = createAsesorRepository();
    const { id: accountId } = await repo.upsertAccount(`advisor:${session.role}`);
    const conversation = await repo.getConversation(input.data.conversationId);
    if (!conversation || conversation.accountId !== accountId) return Response.json({ code: "CONVERSATION_NOT_FOUND" }, { status: 404 });
    const content = input.data.content || "Quiero compartir estas fotos para orientar la propuesta.";
    const existingTurn = (await repo.listMessages(input.data.conversationId)).find((message) => message.id === input.data.turnId);
    if (existingTurn) {
      if (existingTurn.role !== "user" || existingTurn.content !== content || existingTurn.attachments.length === 0) {
        return Response.json({ code: "TURN_ID_CONFLICT" }, { status: 409 });
      }
      return Response.json({ turnId: existingTurn.id, attachments: existingTurn.attachments.map(({ id, mimeType, byteSize, kind }) => ({ id, mimeType, byteSize, kind })) }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
    const photos = [];
    for (const file of files) {
      if (file.size > MAX_PHOTO_BYTES) return Response.json({ code: "INVALID_PHOTO", message: "La foto supera el máximo permitido de 6 MB." }, { status: 413 });
      let prepared;
      try {
        prepared = await prepareAdvisorPhoto(file.type, Buffer.from(await file.arrayBuffer()));
      } catch (error) {
        return Response.json({ code: "INVALID_PHOTO", message: error instanceof Error ? error.message : "No se pudo leer la foto. Prueba con otra imagen." }, { status: 400 });
      }
      photos.push({ id: crypto.randomUUID(), mimeType: prepared.mimeType, data: prepared.original, kind: input.data.kind, confirmed: null, preference: "neutral" as const });
    }
    await repo.appendMessage(input.data.conversationId, { id: input.data.turnId, role: "user", content, attachments: photos });
    return Response.json({ turnId: input.data.turnId, attachments: photos.map(({ id, mimeType, data, kind }) => ({ id, mimeType, byteSize: data.length, kind })) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error("[asesor-photos] upload failed");
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
}
