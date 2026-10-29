"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Composer } from "./Composer";
import { PersonalizedStateSchema } from "@/lib/asesor/personalizado/state";
import { personalizedBriefRows } from "@/lib/asesor/personalizado/brief";

const snapshotSchema = z.object({ id: z.string().uuid(), version: z.number().int().positive(), state: PersonalizedStateSchema, messages: z.array(z.object({ id: z.string(), role: z.string(), content: z.string(), attachments: z.array(z.object({ id: z.string(), mimeType: z.string() })) })) });
type Snapshot = z.infer<typeof snapshotSchema>;
type Pending = { id: string; content: string; photos: File[]; uploaded: boolean };
const STORAGE_KEY = "advisor-personalized-conversation-v1";

export function PersonalizedChat() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [review, setReview] = useState(false);
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async (id: string) => {
    const response = await fetch(`/api/asesor/personalizado?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("No pudimos recuperar esta conversación.");
    const data = snapshotSchema.parse(await response.json());
    const lastUser = data.messages.findLast((message) => message.role === "user");
    if (lastUser && lastUser.id !== data.state.completedTurn) { setPending({ id: lastUser.id, content: lastUser.content, photos: [], uploaded: true }); setError("Tu último mensaje quedó guardado, pero falta recibir la respuesta. Puedes reintentarlo."); }
    else setPending(null);
    setSnapshot(data); return data;
  }, []);
  const create = useCallback(async () => {
    const response = await fetch("/api/asesor/personalizado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
    if (!response.ok) throw new Error("No pudimos iniciar la asesoría personalizada.");
    const data = snapshotSchema.parse(await response.json());
    localStorage.setItem(STORAGE_KEY, data.id); setSnapshot(data); setReview(false); setPending(null); return data;
  }, []);
  useEffect(() => {
    if (started.current) return; started.current = true;
    void (async () => { try { const id = localStorage.getItem(STORAGE_KEY); if (id) await load(id); else await create(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos iniciar."); } finally { setBusy(false); } })();
  }, [create, load]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [snapshot?.messages.length]);

  async function send(turn: Pending) {
    if (!snapshot) return;
    setBusy(true); setError(null); setPending(turn); setReview(false);
    try {
      if (turn.photos.length && !turn.uploaded) {
        const form = new FormData(); form.set("conversationId", snapshot.id); form.set("turnId", turn.id); form.set("content", turn.content); form.set("kind", "inspiration");
        turn.photos.forEach((file) => form.append("photos", file));
        const upload = await fetch("/api/asesor/photos", { method: "POST", body: form });
        if ([400, 413, 415].includes(upload.status)) { setPending(null); setDraft(turn.content); throw new Error("No se guardaron las imágenes. Selecciona fotos JPEG, PNG o WebP de hasta 6 MB cada una."); }
        if (!upload.ok) throw new Error("No pudimos guardar las imágenes. Revisa su formato y tamaño e inténtalo de nuevo.");
        turn = { ...turn, uploaded: true }; setPending(turn);
      }
      const response = await fetch("/api/asesor/personalizado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "turn", id: snapshot.id, turnId: turn.id, content: turn.content, version: snapshot.version }) });
      if (response.status === 409) { await load(snapshot.id); throw new Error("La conversación cambió en otra pestaña. Revisa los cambios y vuelve a intentar."); }
      if (!response.ok) throw new Error("No pudimos obtener la respuesta. Puedes reintentar el mensaje.");
      await load(snapshot.id); setPending(null); setReview(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos enviar el mensaje."); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!snapshot) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/asesor/personalizado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", id: snapshot.id, version: snapshot.version }) });
      if (!response.ok) throw new Error("No pudimos aprobar el brief. Revisa la conversación e inténtalo de nuevo.");
      await load(snapshot.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos aprobar el brief."); }
    finally { setBusy(false); }
  }
  async function newConversation() {
    setBusy(true); setError(null);
    try { await create(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos iniciar."); } finally { setBusy(false); }
  }
  async function retryLoading() {
    setBusy(true); setError(null);
    try { const id = localStorage.getItem(STORAGE_KEY); if (id) await load(id); else await create(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos iniciar."); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-screen flex-col bg-fondo text-texto">
    <header className="sticky top-0 z-10 border-b border-borde-suave bg-fondo/95 px-5 py-4"><div className="mx-auto flex max-w-2xl items-center justify-between gap-3"><div><h1 className="asesor-display text-xl font-bold">Asesor personalizado</h1><p className="text-sm text-texto-suave">Cuéntanos la celebración que imaginas</p></div><div className="flex gap-2"><Link href="/asesor" className="rounded-full border border-borde px-3 py-2 text-sm">Volver</Link><button type="button" disabled={busy} onClick={() => void newConversation()} className="rounded-full border border-borde px-3 py-2 text-sm disabled:opacity-50">Nueva</button></div></div></header>
    <section aria-label="Conversación personalizada" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 py-6">
      <p className="rounded-2xl bg-superficie p-4">¡Hola! Soy tu asesor de Happia. Cuéntame qué celebración imaginas y qué la haría especial.</p>
      <ol aria-live="polite" className="flex flex-col gap-4">{snapshot?.messages.filter((message) => message.role !== "system").map((message) => <li key={message.id} className={message.role === "user" ? "ml-auto max-w-[90%] rounded-2xl bg-acento p-4 text-sobre-acento" : "mr-auto max-w-[90%] rounded-2xl bg-superficie p-4"}><p className="whitespace-pre-wrap">{message.content}</p>{message.attachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{message.attachments.map((photo) => <Image width={112} height={112} unoptimized key={photo.id} src={`/api/asesor/photos/${encodeURIComponent(photo.id)}`} alt="Referencia compartida" className="h-28 w-28 rounded-xl object-cover" />)}</div>}</li>)}</ol>
      {snapshot && snapshot.messages.some((message) => message.role === "user") && !review && <button type="button" onClick={() => setReview(true)} disabled={busy || !!pending} className="self-start rounded-full border border-borde bg-superficie px-4 py-3 font-semibold disabled:opacity-50">Revisar mi brief</button>}
      {review && snapshot && <section aria-label="Brief personalizado" className="rounded-2xl border border-borde bg-superficie p-5"><h2 className="asesor-display text-lg font-bold">Revisa los detalles de tu evento</h2><p className="mt-1 text-sm text-texto-suave">Puedes dejar datos pendientes y contarnos cualquier corrección.</p><dl className="mt-4 space-y-3">{personalizedBriefRows(snapshot.state.brief).map((row) => <div key={row.label}><dt className="text-xs font-semibold uppercase text-texto-suave">{row.label}</dt><dd className="whitespace-pre-wrap">{row.value}</dd></div>)}</dl>{snapshot.messages.some((message) => message.attachments.length > 0) && <section className="mt-5"><h3 className="font-semibold">Imágenes de referencia</h3><div className="mt-2 flex flex-wrap gap-2">{snapshot.messages.flatMap((message) => message.attachments).map((photo) => <Image width={112} height={112} unoptimized key={photo.id} src={`/api/asesor/photos/${encodeURIComponent(photo.id)}`} alt="Imagen de referencia para el brief" className="h-28 w-28 rounded-xl object-cover" />)}</div></section>}{snapshot.state.approved ? <><p role="status" className="mt-5 font-semibold text-exito">Brief aprobado</p><iframe title="PDF del brief personalizado" src={`/api/asesor/personalizado/${encodeURIComponent(snapshot.id)}/pdf#toolbar=0`} className="mt-4 h-[70vh] w-full rounded-xl border border-borde" /></> : <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => setReview(false)} className="rounded-xl border border-borde px-4 py-3">Corregir</button><button type="button" disabled={busy || !!pending} onClick={() => void approve()} className="rounded-xl bg-acento px-4 py-3 font-semibold text-sobre-acento disabled:opacity-50">Aprobar brief</button></div>}</section>}
      <div ref={bottom} />
    </section>
    <footer className="sticky bottom-0 bg-fondo/95 px-4 pb-5 pt-3"><Composer value={draft} onChange={setDraft} onSubmit={(content, photos = []) => void send({ id: crypto.randomUUID(), content: content.trim() || "Quiero compartir estas fotos para orientar la propuesta.", photos, uploaded: false })} busy={busy || !snapshot || !!pending} capabilities={{ photo: true, voice: false }} error={error} retryWhileBusy={!busy && (!!pending || !snapshot)} onRetry={pending ? () => void send(pending) : !snapshot ? () => void retryLoading() : undefined} /></footer>
  </main>;
}
