"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ADVISOR_CONVERSATION_STORAGE_KEY, parseAdvisorSnapshot, parseCreatedConversation, type AdvisorComposerCard, type AdvisorMessage, type AdvisorProgress } from "./conversation-contract";
import type { ComposerCapabilities } from "./Composer";
import type { PhotoKind } from "@/lib/asesor/repository";

type Status = "loading" | "ready" | "sending" | "failed" | "invalid" | "unavailable" | "completed";
type PendingTurn = { id: string; content: string; files?: File[]; kind?: PhotoKind };
const PhotoUploadResponseSchema = z.object({
  turnId: z.string().uuid(),
  attachments: z.array(z.object({ id: z.string().min(1), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), byteSize: z.number().int().min(1).max(6 * 1024 * 1024), kind: z.enum(["inspiration", "venue"]) }).strict()).min(1).max(4),
}).strict();

export function useConversation() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [progress, setProgress] = useState<AdvisorProgress | null>(null);
  const [briefVersion, setBriefVersion] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const bootstrapStarted = useRef(false);

  const acceptCreated = useCallback((value: unknown) => {
    const created = parseCreatedConversation(value);
    if (!created) throw new Error("Respuesta inválida al crear la conversación.");
    window.localStorage.setItem(ADVISOR_CONVERSATION_STORAGE_KEY, created.conversationId);
    setConversationId(created.conversationId);
    setMessages([]);
    setProgress(created.progress);
    setBriefVersion(created.briefVersion);
    setStatus("ready");
    setError(null);
  }, []);

  const createConversation = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/asesor/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("No pudimos iniciar una conversación. Intenta de nuevo.");
      acceptCreated(await response.json());
    } catch (cause) {
      setStatus("unavailable");
      setError(cause instanceof Error ? cause.message : "No pudimos iniciar una conversación.");
    }
  }, [acceptCreated]);

  const restore = useCallback(async () => {
    const storedId = window.localStorage.getItem(ADVISOR_CONVERSATION_STORAGE_KEY);
    if (!storedId) {
      await createConversation();
      return;
    }
    try {
      const response = await fetch(`/api/asesor/conversations/${encodeURIComponent(storedId)}`, { cache: "no-store" });
      if (response.status === 404) {
        setConversationId(storedId);
        setStatus("invalid");
        setError("Esta conversación ya no está disponible en tu cuenta.");
        return;
      }
      if (!response.ok) throw new Error("No pudimos recuperar tu conversación.");
      const snapshot = parseAdvisorSnapshot(await response.json());
      if (!snapshot || snapshot.conversationId !== storedId) throw new Error("La respuesta de conversación no es válida.");
      setConversationId(snapshot.conversationId);
      setMessages(snapshot.messages);
      setProgress(snapshot.progress);
      setBriefVersion(snapshot.briefVersion);
      const lastMessage = snapshot.messages.at(-1);
      if (lastMessage?.role === "user") {
        setPendingTurn({ id: lastMessage.id, content: lastMessage.content });
        setStatus("failed");
        setError("Tu último mensaje quedó pendiente. Puedes reintentar sin duplicarlo.");
      } else {
        setPendingTurn(null);
        setStatus(snapshot.progress.complete ? "completed" : "ready");
        setError(null);
      }
    } catch (cause) {
      setStatus("unavailable");
      setError(cause instanceof Error ? cause.message : "No pudimos recuperar tu conversación.");
    }
  }, [createConversation]);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void restore();
  }, [restore]);

  const sendTurn = useCallback(async (turn: PendingTurn) => {
    if (!conversationId) return;
    setPendingTurn(turn);
    setStatus("sending");
    setError(null);
    setStreamingText("");
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      let content = turn.content;
      if (turn.files?.length) {
        if (turn.files.length > 4) throw new Error("Puedes compartir hasta 4 fotos por mensaje.");
        for (const file of turn.files) {
          if (file.size > 6 * 1024 * 1024) throw new Error(`La foto “${file.name}” supera el máximo permitido de 6 MB.`);
        }
        if (!content.trim()) content = "Quiero compartir estas fotos para orientar la propuesta.";
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("turnId", turn.id);
        form.set("content", content);
        form.set("kind", turn.kind ?? "inspiration");
        for (const file of turn.files) form.append("photos", file, file.name);
        const uploaded = await fetch("/api/asesor/photos", { method: "POST", body: form, signal: controller.signal });
        const responseBody: unknown = await uploaded.json().catch(() => null);
        const parsedUpload = PhotoUploadResponseSchema.safeParse(responseBody);
        if (!uploaded.ok || !parsedUpload.success || parsedUpload.data.turnId !== turn.id) {
          const message = typeof responseBody === "object" && responseBody !== null && typeof Reflect.get(responseBody, "message") === "string"
            ? Reflect.get(responseBody, "message") as string : "No pudimos subir las fotos. Revisa los archivos e intenta de nuevo.";
          throw new Error(message);
        }
        const attachments = parsedUpload.data.attachments;
        setMessages((current) => current.map((message) => message.id === turn.id ? {
          ...message,
          attachments: attachments.map((attachment) => ({
            id: attachment.id, mimeType: attachment.mimeType, byteSize: attachment.byteSize,
            kind: attachment.kind, confirmed: null, preference: "neutral",
          })),
        } : message));
      }
      const response = await fetch("/api/asesor/conversar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, turnId: turn.id, content }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(response.status === 404 ? "Esta conversación ya no está disponible." : "No pudimos enviar tu mensaje.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamed = "";
      let terminalReceived = false;
      let committed = false;
      const consume = (frame: string) => {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) return;
        const event: unknown = JSON.parse(dataLine.slice(6));
        if (typeof event !== "object" || event === null || Array.isArray(event)) return;
        const record = event as Record<string, unknown>;
        if (Number.isSafeInteger(record.briefVersion) && (record.briefVersion as number) >= 0) setBriefVersion(record.briefVersion as number);
        if (record.type === "text" && typeof record.delta === "string") {
          streamed += record.delta;
          setStreamingText(streamed);
        }
        if ((record.type === "tool" || record.type === "final" || record.type === "error") && typeof record.progress === "object" && record.progress !== null) {
          const progressValue = record.progress as AdvisorProgress;
          if (typeof progressValue.complete === "boolean" && Number.isSafeInteger(progressValue.completed) && Number.isSafeInteger(progressValue.required)) setProgress(progressValue);
        }
        if (record.type === "final" && typeof record.messageId === "string") {
          terminalReceived = true;
          committed = true;
          setMessages((current) => [...current.filter((message) => message.id !== record.messageId), { id: record.messageId as string, role: "assistant", content: streamed }]);
          setStatus(typeof record.progress === "object" && record.progress !== null && Reflect.get(record.progress, "complete") === true ? "completed" : "ready");
          setPendingTurn(null);
          setStreamingText("");
        } else if (record.type === "error") {
          terminalReceived = true;
          setStatus("failed");
          setError(typeof record.message === "string" ? record.message : "La respuesta se interrumpió. Puedes reintentar.");
          setStreamingText("");
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) consume(frame);
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!committed && !terminalReceived) {
        setStatus("failed");
        setError("La respuesta quedó incompleta. Puedes reintentar este mensaje.");
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : "La respuesta se interrumpió. Puedes reintentar.");
      setStreamingText("");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [conversationId]);

  const submit = useCallback((content: string, files?: File[], kind?: PhotoKind) => {
    const cleaned = content.trim();
    if ((!cleaned && !files?.length) || status === "sending") return;
    const turn = { id: crypto.randomUUID(), content: cleaned, ...(files?.length ? { files, kind } : {}) };
    setMessages((current) => [...current, { id: turn.id, role: "user", content: cleaned || "Quiero compartir estas fotos para orientar la propuesta." }]);
    void sendTurn(turn);
  }, [sendTurn, status]);

  const retry = useCallback(() => { if (pendingTurn) void sendTurn(pendingTurn); }, [pendingTurn, sendTurn]);
  const startFresh = useCallback(async () => {
    window.localStorage.removeItem(ADVISOR_CONVERSATION_STORAGE_KEY);
    setConversationId(null);
    setMessages([]);
    setPendingTurn(null);
    await createConversation();
  }, [createConversation]);

  const cards: readonly AdvisorComposerCard[] = [];
  const capabilities: ComposerCapabilities = { photo: true, voice: false };
  return { conversationId, messages, progress, briefVersion, status, error, streamingText, cards, capabilities, submit, retry, startFresh };
}
