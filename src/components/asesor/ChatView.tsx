"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { History } from "lucide-react";
import { ADVISOR_DIRECTIONS_ENABLED } from "@/lib/asesor/features";
import { AdvisorHeader } from "./AdvisorHeader";
import { AssistantText } from "./AssistantText";
import { PhotoNotes } from "./PhotoNotes";
import { VoiceNoteBubble } from "./VoiceNoteBubble";
import { Composer } from "./Composer";
import { ContactForm } from "./ContactForm";
import { DirectionCards, PackageCard } from "./OfferCards";
import { QuickReplies } from "./QuickReplies";
import { asksOnlyForStartTime } from "./start-time";
import { StartTimePicker } from "./StartTimePicker";
import { SummaryCard } from "./SummaryCard";
import { useConversation } from "./useConversation";
import { useStickToBottom } from "./use-stick-to-bottom";
import type { AdvisorChange, AdvisorMessage } from "./conversation-contract";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-asesor-display" });
const text = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-asesor-texto" });

const welcome: AdvisorMessage = {
  id: "advisor-welcome",
  role: "assistant",
  content: "¡Hola! Soy Happia. Cuéntame sobre la celebración que tienes en mente: qué celebran y para quién es.",
};

function Avatar() {
  return <span aria-hidden="true" className="asesor-pop asesor-display grid size-7 shrink-0 place-items-center rounded-full bg-acento text-[13px] font-bold text-sobre-acento">H</span>;
}

const stagger = (index: number): CSSProperties => ({ "--i": Math.min(index, 6) } as CSSProperties);

function ChangeNotes({ changes }: { changes: AdvisorChange[] }) {
  return <div className="asesor-sube ml-10 flex items-start gap-2.5 rounded-xl bg-superficie-suave px-3 py-2.5 text-[13px] leading-snug">
    <History aria-hidden="true" className="mt-px size-4 shrink-0 text-acento" />
    <div className="flex flex-col gap-0.5">
      <span className="font-semibold text-acento">Cambio anotado</span>
      {changes.map((change, index) => <span key={index}>{change.text}{change.impact ? `. ${change.impact}` : ""}</span>)}
    </div>
  </div>;
}

export function ChatView() {
  const conversation = useConversation();
  const [draft, setDraft] = useState("");
  const [timeDismissedAt, setTimeDismissedAt] = useState<number | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  // Replies being typed out: what hangs off a reply (change notes, cards, quick replies, the summary) waits for it to finish.
  const [revealing, setRevealing] = useState<ReadonlySet<string>>(() => new Set());
  const onRevealing = useCallback((id: string, on: boolean) => setRevealing((current) => {
    if (current.has(id) === on) return current;
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const settled = revealing.size === 0;
  const { follow, snap } = useStickToBottom(transcriptEnd);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const visibleMessages = conversation.messages.length ? conversation.messages : [welcome];
  const progress = conversation.progress;
  const busy = conversation.voicePending || !conversation.conversationId || conversation.status === "sending" || conversation.status === "loading" || conversation.status === "invalid" || conversation.status === "unavailable";
  const idle = !busy && conversation.status !== "failed";
  const directions = ADVISOR_DIRECTIONS_ENABLED ? conversation.cards.filter((card) => card.kind === "direction") : [];
  // The package card belongs to the reply that presents it: once the customer answers, it leaves the screen.
  const [proposalSeen, setProposalSeen] = useState<{ id: string; messages: number } | null>(null);
  const proposalId = conversation.proposal?.packageId ?? null;
  if (proposalId && proposalSeen?.id !== proposalId) setProposalSeen({ id: proposalId, messages: conversation.messages.length });
  const showProposal = Boolean(conversation.proposal) && proposalSeen?.id === proposalId && conversation.messages.length <= (proposalSeen?.messages ?? 0) + 1;

  const lastRole = conversation.messages.at(-1)?.role;
  // Sending something goes to the end; anything that grows the chat afterwards is followed until the person scrolls up.
  useEffect(() => { if (lastRole === "user") snap(); else follow(); }, [conversation.messages.length, lastRole, snap, follow]);
  useEffect(() => { follow(); }, [follow, conversation.streamingText, conversation.status, progress?.step, progress?.ask, settled, conversation.proposal?.packageId, conversation.summary?.version]);

  const correct = () => { setDraft("Quiero corregir: "); textarea.current?.focus(); };

  return (
    <main className={`asesor-chat ${display.variable} ${text.variable} flex min-h-dvh flex-col`}>
      <AdvisorHeader headline={conversation.headline} progress={progress} onNew={conversation.conversationId ? () => void conversation.startFresh() : undefined} />

      <section aria-label="Conversación con tu asesor" aria-live="polite" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-5">
        <aside aria-label="Privacidad" className="rounded-2xl border border-borde-suave bg-superficie px-4 py-3 text-[13px] leading-relaxed text-texto-suave">
          <p><span className="font-semibold text-texto">Tus datos se usan para preparar esta propuesta.</span> Comparte solo lo que quieras incluir; puedes corregirlo durante la conversación.</p>
        </aside>
        <aside aria-label="Versión de prueba" className="rounded-2xl bg-aviso-suave px-4 py-3 text-[13px] leading-relaxed text-texto">
          <p><span className="font-semibold">Versión de prueba.</span> Estamos afinando esta asesoría; revisaremos contigo los detalles antes de cerrar la propuesta.</p>
        </aside>

        {conversation.status === "loading" && <p role="status" className="rounded-2xl bg-superficie-suave px-4 py-3 text-sm text-texto-suave">Recuperando tu conversación…</p>}
        {conversation.status === "invalid" && <div role="alert" className="rounded-2xl border border-aviso/30 bg-aviso-suave p-4"><p className="font-medium">{conversation.error}</p><button type="button" onClick={() => void conversation.startFresh()} className="mt-3 min-h-11 rounded-xl bg-acento px-4 font-semibold text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">Empezar una conversación nueva</button></div>}
        {conversation.status === "unavailable" && <div role="alert" className="rounded-2xl border border-error/30 bg-error-suave p-4"><p>{conversation.error}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-11 rounded-xl border border-borde bg-superficie px-4 font-semibold text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">Intentar recuperar de nuevo</button></div>}

        <ol className="flex flex-col gap-5" aria-label="Mensajes">
          {visibleMessages.map((message, index) => {
            const changes = conversation.changes.filter((change) => change.turnId !== null && `${change.turnId}:assistant` === message.id);
            const live = conversation.liveReplyIds.includes(message.id);
            return message.role === "user"
              ? <li key={message.id} className="asesor-sube-der ml-auto max-w-[80%] rounded-2xl border border-borde-suave bg-superficie px-3.5 py-2.5 text-[15px] leading-relaxed shadow-[0_1px_2px_var(--sombra)]">
                {message.inputMode === "voice"
                  ? <VoiceNoteBubble message={message} onDiscard={conversation.discardVoiceNote} />
                  : message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
                {message.attachments?.map((photo) => <figure key={photo.id} className="mt-2">
                  <img src={`/api/asesor/photos/${encodeURIComponent(photo.id)}`} alt={photo.kind === "venue" ? "Foto del lugar del evento" : "Foto de inspiración"} loading="lazy" className="max-h-64 max-w-full rounded-xl object-cover" />
                  <figcaption className="mt-1 text-xs text-texto-suave">{photo.kind === "venue" ? "Lugar del evento" : "Inspiración"} · {photo.preference === "neutral" ? "por revisar" : photo.preference === "like" ? "me gusta" : "no me gusta"}</figcaption>
                  <PhotoNotes photo={photo} />
                </figure>)}
              </li>
              : <li key={message.id} style={live ? undefined : stagger(index)} className={`flex flex-col gap-2.5 ${live ? "" : "asesor-sube"}`}>
                <div className="flex items-start gap-3"><Avatar /><AssistantText id={message.id} content={message.content} animate={live} onRevealing={onRevealing} onGrow={follow} /></div>
                {changes.length > 0 && !revealing.has(message.id) && <ChangeNotes changes={changes} />}
              </li>;
          })}
          {conversation.streamingText && <li aria-label="Respuesta en curso" className="asesor-sube flex items-start gap-3"><Avatar /><AssistantText id={conversation.streamingId ?? "streaming"} content={conversation.streamingText} animate streaming onRevealing={onRevealing} onGrow={follow} /></li>}
          {conversation.status === "sending" && !conversation.streamingText && <li role="status" className="asesor-sube flex items-center gap-3 text-sm text-texto-suave"><Avatar />Estoy pensando… <span aria-hidden="true" className="asesor-puntos"><span /><span /><span /></span></li>}
          {conversation.summary && settled && <SummaryCard summary={conversation.summary} approved={conversation.approved} conversationId={conversation.conversationId} busy={busy}
            onApprove={() => conversation.submit(`Apruebo el resumen versión ${conversation.summary?.version}.`)} onCorrect={correct} />}
        </ol>

        {idle && settled && !conversation.summary && (directions.length > 0 && !conversation.directionChosen || showProposal) && <section aria-label="Opciones para continuar" className="flex flex-col gap-3">
          {directions.length > 0 && !conversation.directionChosen && <DirectionCards cards={directions} busy={busy} onPick={conversation.submit} />}
          {showProposal && conversation.proposal && <PackageCard proposal={conversation.proposal} city={conversation.headline.city} busy={busy} onPick={conversation.submit} />}
        </section>}
        {idle && settled && progress?.ask && <QuickReplies ask={progress.ask} busy={busy} onPick={conversation.submit} />}
        {idle && settled && progress?.step === "contact" && !conversation.summary && <ContactForm askAddress={progress.missing.includes("address")} busy={busy} onSend={conversation.submit} />}
        <div ref={transcriptEnd} aria-hidden="true" className="scroll-mb-36" />
      </section>

      {idle && settled && asksOnlyForStartTime(progress) && timeDismissedAt !== conversation.briefVersion
        && <StartTimePicker busy={busy} onConfirm={(message) => conversation.submit(message)} onDismiss={() => setTimeDismissedAt(conversation.briefVersion)} />}

      <footer className="sticky bottom-0 z-10 bg-fondo/95 px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <Composer value={draft} onChange={setDraft} onSubmit={conversation.submit} busy={busy} capabilities={conversation.capabilities} photoKind={conversation.photoKind} onPhotoKindChange={conversation.setPhotoKind} onVoiceText={setDraft} voiceNote={{ conversationId: conversation.conversationId, onRecorded: conversation.recordVoiceNote, onNote: conversation.submitVoiceNote, onFailed: conversation.failVoiceNote }} textareaRef={textarea}
          placeholder={progress?.ask === "budget" ? "O escribe un monto…" : "Escribe tu respuesta…"}
          error={conversation.status === "failed" ? conversation.error : null} onRetry={conversation.status === "failed" ? conversation.retry : undefined} />
      </footer>
    </main>
  );
}
