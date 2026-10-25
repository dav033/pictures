"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ADVISOR_CONVERSATION_STORAGE_KEY, parseAdvisorEvent, parseAdvisorSnapshot, parseCreatedConversation, type AdvisorMessage, type AdvisorPhoto, type AdvisorProgress, type AdvisorUiState } from "./conversation-contract";
import type { ComposerCapabilities } from "./Composer";

type Status = "loading" | "ready" | "sending" | "failed" | "invalid" | "unavailable" | "completed";
type PendingTurn = { id: string; content: string; photos?: File[]; photoKind?: "inspiration" | "venue" };

function parseUploadedPhotos(value: unknown, turnId: string): AdvisorPhoto[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.turnId !== turnId || !Array.isArray(response.attachments) || response.attachments.length < 1 || response.attachments.length > 4) return null;
  const attachments: AdvisorPhoto[] = [];
  for (const candidate of response.attachments) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const photo = candidate as Record<string, unknown>;
    if (typeof photo.id !== "string" || !["image/jpeg", "image/png", "image/webp"].includes(String(photo.mimeType))
      || !Number.isSafeInteger(photo.byteSize) || (photo.byteSize as number) < 1 || (photo.byteSize as number) > 6 * 1024 * 1024
      || (photo.kind !== "venue" && photo.kind !== "inspiration")) return null;
    attachments.push({ id: photo.id, mimeType: photo.mimeType as AdvisorPhoto["mimeType"], byteSize: photo.byteSize as number, kind: photo.kind, confirmed: null, preference: "neutral" });
  }
  return attachments;
}

const EMPTY_UI: AdvisorUiState = { cards: [], summary: null, approved: false, headline: { title: null, facts: [], city: null }, changes: [], proposal: null, directionChosen: false };
const uiOf = ({ cards, summary, approved, headline, changes, proposal, directionChosen }: AdvisorUiState): AdvisorUiState => ({ cards, summary, approved, headline, changes, proposal, directionChosen });

export function useConversation() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [progress, setProgress] = useState<AdvisorProgress | null>(null);
  const [briefVersion, setBriefVersion] = useState(0);
  const [ui, setUi] = useState<AdvisorUiState>(EMPTY_UI);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  /** Ids of the replies that arrived in this session; only those are typed out, restored history is shown whole. */
  const [liveReplyIds, setLiveReplyIds] = useState<string[]>([]);
  const [photoKind, setPhotoKind] = useState<"inspiration" | "venue">("inspiration");
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
    setUi(uiOf(created));
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
    if (!storedId) { await createConversation(); return; }
    try {
      const response = await fetch(`/api/asesor/conversations/${encodeURIComponent(storedId)}`, { cache: "no-store" });
      if (response.status === 404) {
        setConversationId(storedId); setStatus("invalid"); setError("Esta conversación ya no está disponible en tu cuenta."); return;
      }
      if (!response.ok) throw new Error("No pudimos recuperar tu conversación.");
      const snapshot = parseAdvisorSnapshot(await response.json());
      if (!snapshot || snapshot.conversationId !== storedId) throw new Error("La respuesta de conversación no es válida.");
      setConversationId(snapshot.conversationId);
      setMessages(snapshot.messages);
      setProgress(snapshot.progress);
      setBriefVersion(snapshot.briefVersion);
      setUi(uiOf(snapshot));
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
      setStatus("unavailable"); setError(cause instanceof Error ? cause.message : "No pudimos recuperar tu conversación.");
    }
  }, [createConversation]);

  useEffect(() => { if (bootstrapStarted.current) return; bootstrapStarted.current = true; void restore(); }, [restore]);

  const sendTurn = useCallback(async (turn: PendingTurn) => {
    if (!conversationId) return;
    setLiveReplyIds((current) => current.includes(`${turn.id}:assistant`) ? current : [...current, `${turn.id}:assistant`]);
    setPendingTurn(turn); setStatus("sending"); setError(null); setStreamingText("");
    const controller = new AbortController(); activeRequest.current = controller;
    try {
      if (turn.photos?.length) {
        const form = new FormData();
        form.set("conversationId", conversationId); form.set("turnId", turn.id); form.set("content", turn.content); form.set("kind", turn.photoKind ?? photoKind);
        for (const file of turn.photos) form.append("photos", file, file.name);
        const upload = await fetch("/api/asesor/photos", { method: "POST", body: form, signal: controller.signal });
        if (!upload.ok) throw new Error("No pudimos guardar la foto. Puedes reintentar sin duplicar el mensaje.");
        const attachments = parseUploadedPhotos(await upload.json(), turn.id);
        if (!attachments) throw new Error("La respuesta de la foto no es válida.");
        setMessages((current) => current.map((message) => message.id === turn.id ? { ...message, attachments } : message));
      }
      const response = await fetch("/api/asesor/conversar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, turnId: turn.id, content: turn.content }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(response.status === 404 ? "Esta conversación ya no está disponible." : "No pudimos enviar tu mensaje.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let streamed = ""; let terminalReceived = false; let committed = false;
      const consume = (frame: string) => {
        const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
        if (!line) return;
        const event = parseAdvisorEvent(JSON.parse(line.slice(6)) as unknown);
        if (!event) throw new Error("La respuesta de conversación no es válida.");
        if (event.type === "text") { streamed += event.delta; setStreamingText(streamed); return; }
        setProgress(event.progress); setBriefVersion(event.briefVersion); setUi(uiOf(event));
        if (event.type === "final") {
          terminalReceived = true; committed = true;
          setMessages((current) => [...current.filter((message) => message.id !== event.messageId), { id: event.messageId, role: "assistant", content: streamed }]);
          setStatus(event.progress.complete ? "completed" : "ready"); setPendingTurn(null); setStreamingText("");
        } else if (event.type === "error") {
          terminalReceived = true; setStatus("failed"); setError(event.message); setStreamingText("");
        }
      };
      while (true) {
        const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n"); buffer = frames.pop() ?? ""; for (const frame of frames) consume(frame);
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!committed && !terminalReceived) { setStatus("failed"); setError("La respuesta quedó incompleta. Puedes reintentar este mensaje."); }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStatus("failed"); setError(cause instanceof Error ? cause.message : "La respuesta se interrumpió. Puedes reintentar."); setStreamingText("");
    } finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }, [conversationId, photoKind]);

  const submit = useCallback((content: string, photos?: File[]) => {
    const cleaned = content.trim();
    if ((!cleaned && !photos?.length) || status === "sending") return;
    const turn: PendingTurn = { id: crypto.randomUUID(), content: cleaned, ...(photos?.length ? { photos, photoKind } : {}) };
    setMessages((current) => [...current, { id: turn.id, role: "user", content: cleaned, ...(photos?.length ? { attachments: [] } : {}) }]);
    void sendTurn(turn);
  }, [sendTurn, status, photoKind]);

  /** A voice note the server already stored as turn `turnId`: show it and run the advisor turn with its transcript. */
  const submitVoiceNote = useCallback((turnId: string, text: string) => {
    if (status === "sending") return;
    setMessages((current) => [...current, { id: turnId, role: "user", content: text, inputMode: "voice" }]);
    void sendTurn({ id: turnId, content: text });
  }, [sendTurn, status]);

  const retry = useCallback(() => { if (pendingTurn) void sendTurn(pendingTurn); }, [pendingTurn, sendTurn]);
  const startFresh = useCallback(async () => {
    window.localStorage.removeItem(ADVISOR_CONVERSATION_STORAGE_KEY); setConversationId(null); setMessages([]); setPendingTurn(null); setUi(EMPTY_UI); await createConversation();
  }, [createConversation]);
  const capabilities: ComposerCapabilities = { photo: true, voice: true };
  return { conversationId, messages, progress, briefVersion, ...ui, status, error, streamingText, streamingId: pendingTurn ? `${pendingTurn.id}:assistant` : null, liveReplyIds, photoKind, setPhotoKind, capabilities, submit, submitVoiceNote, retry, startFresh };
}
