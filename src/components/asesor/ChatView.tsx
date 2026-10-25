"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { plainChatText } from "./chat-text";
import { Composer } from "./Composer";
import { asksOnlyForStartTime } from "./start-time";
import { StartTimePicker } from "./StartTimePicker";
import { useConversation } from "./useConversation";
import type { AdvisorMessage } from "./conversation-contract";

const welcome: AdvisorMessage = {
  id: "advisor-welcome",
  role: "assistant",
  content: "¡Hola! Me alegra acompañarte. ¿Qué celebración estás planeando, para quién es y qué te gustaría que sintieran tus invitados?",
};

export function ChatView() {
  const conversation = useConversation();
  const [draft, setDraft] = useState("");
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const visibleMessages = conversation.messages.length ? conversation.messages : [welcome];
  const progress = conversation.progress;

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [conversation.messages, conversation.streamingText]);

  return (
    <main className="flex min-h-dvh flex-col bg-fondo text-texto">
      <header className="sticky top-0 z-10 border-b border-borde bg-superficie/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-acento">Asesoría guiada</p>
            <h1 className="mt-0.5 text-lg font-semibold">Planeemos tu celebración</h1>
          </div>
          {conversation.conversationId && <button type="button" onClick={() => void conversation.startFresh()} className="rounded-full px-3 py-2 text-sm font-medium text-acento hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">Nueva charla</button>}
        </div>
        <div className="mx-auto mt-3 max-w-3xl">
          {progress && <>
            <div className="flex items-center justify-between gap-3 text-xs text-texto-suave">
              <span>Datos para preparar tu propuesta</span>
              <span aria-live="polite">{progress.completed} de {progress.required}</span>
            </div>
            <progress aria-label="Avance de los datos del evento" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.required} value={progress.completed} max={progress.required} className="mt-1.5 block h-2 w-full overflow-hidden rounded-full accent-acento" />
            {progress.complete && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-exito"><Check aria-hidden="true" className="size-3.5" />Ya tenemos los datos principales.</p>}
          </>}
          {conversation.briefVersion > 0 && <p className="mt-1 text-right text-[11px] text-texto-tenue">Datos actualizados · versión {conversation.briefVersion}</p>}
        </div>
      </header>

      <section aria-label="Conversación con tu asesor" aria-live="polite" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <aside aria-label="Privacidad" className="rounded-2xl border border-borde bg-superficie px-4 py-3 text-sm leading-relaxed text-texto-suave shadow-sm">
          <p className="font-semibold text-texto">Tus datos se usan para preparar esta propuesta.</p>
          <p className="mt-1">Comparte solo la información que quieras incluir. Puedes corregirla durante la conversación.</p>
        </aside>
        <aside aria-label="Versión de prueba" className="flex items-start gap-2 rounded-2xl border border-aviso/30 bg-aviso-suave px-4 py-3 text-sm leading-relaxed text-texto">
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-aviso" />
          <p><span className="font-semibold">Versión de prueba.</span> Estamos afinando esta asesoría; revisaremos contigo los detalles antes de cerrar la propuesta.</p>
        </aside>

        {conversation.status === "loading" && <p role="status" className="rounded-2xl bg-superficie-suave px-4 py-3 text-sm text-texto-suave">Recuperando tu conversación…</p>}
        {conversation.status === "invalid" && <div role="alert" className="rounded-2xl border border-aviso/30 bg-aviso-suave p-4"><p className="font-medium">{conversation.error}</p><button type="button" onClick={() => void conversation.startFresh()} className="mt-3 min-h-11 rounded-xl bg-acento px-4 font-semibold text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">Empezar una conversación nueva</button></div>}
        {conversation.status === "unavailable" && <div role="alert" className="rounded-2xl border border-error/30 bg-error-suave p-4"><p>{conversation.error}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-11 rounded-xl border border-borde bg-superficie px-4 font-semibold text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">Intentar recuperar de nuevo</button></div>}

        <ol className="flex flex-col gap-3" aria-label="Mensajes">
          {visibleMessages.map((message) => <li key={message.id} className={`max-w-[90%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed shadow-sm sm:max-w-[82%] ${message.role === "user" ? "ml-auto rounded-br-lg bg-acento text-sobre-acento" : "mr-auto rounded-bl-lg border border-borde bg-superficie text-texto"}`}>
            {message.content && <p className="whitespace-pre-wrap">{message.role === "user" ? message.content : plainChatText(message.content)}</p>}
            {message.attachments?.map((photo) => <figure key={photo.id} className="mt-2">
              <img src={`/api/asesor/photos/${encodeURIComponent(photo.id)}`} alt={photo.kind === "venue" ? "Foto del lugar del evento" : "Foto de inspiración"} loading="lazy" className="max-h-64 max-w-full rounded-xl object-cover" />
              <figcaption className="mt-1 text-xs opacity-80">{photo.kind === "venue" ? "Lugar del evento" : "Inspiración"} · {photo.preference === "neutral" ? "por revisar" : photo.preference === "like" ? "me gusta" : "no me gusta"}</figcaption>
            </figure>)}
          </li>)}
          {conversation.streamingText && <li aria-label="Respuesta en curso" className="mr-auto max-w-[90%] whitespace-pre-wrap rounded-3xl rounded-bl-lg border border-borde bg-superficie px-4 py-3 text-[15px] leading-relaxed shadow-sm">{plainChatText(conversation.streamingText)}<span className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-acento" aria-hidden="true" /></li>}
          {conversation.status === "sending" && !conversation.streamingText && <li role="status" className="mr-auto rounded-3xl rounded-bl-lg border border-borde bg-superficie px-4 py-3 text-sm text-texto-suave">Estoy pensando…</li>}
          {conversation.summary && <li aria-label="Resumen actual del evento" className="mr-auto w-full max-w-[90%] rounded-3xl border border-acento/40 bg-superficie p-4 text-sm text-texto shadow-sm sm:max-w-[82%]">
            <h2 className="font-semibold">Resumen para revisar · versión {conversation.summary.version}</h2>
            <p className="mt-2 whitespace-pre-wrap">{conversation.summary.text}</p>
            {conversation.approved
              ? <a className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-acento px-4 font-semibold text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento" href={`/asesor/brief/${encodeURIComponent(conversation.conversationId ?? "")}`}>Ver resumen aprobado</a>
              : <button type="button" disabled={conversation.status === "sending"} onClick={() => conversation.submit(`Apruebo el resumen versión ${conversation.summary?.version}.`)} className="mt-3 min-h-11 rounded-xl bg-acento px-4 font-semibold text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50">Aprobar resumen</button>}
          </li>}
        </ol>
        <div ref={transcriptEnd} aria-hidden="true" />
      </section>

      <footer className="sticky bottom-0 z-10 border-t border-borde bg-fondo/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
        {asksOnlyForStartTime(progress) && <StartTimePicker busy={!conversation.conversationId || conversation.status === "sending" || conversation.status === "loading" || conversation.status === "invalid" || conversation.status === "unavailable"} onConfirm={(message) => conversation.submit(message)} />}
        <Composer value={draft} onChange={setDraft} onSubmit={conversation.submit} busy={!conversation.conversationId || conversation.status === "sending" || conversation.status === "loading" || conversation.status === "invalid" || conversation.status === "unavailable"} cards={conversation.cards} capabilities={conversation.capabilities} photoKind={conversation.photoKind} onPhotoKindChange={conversation.setPhotoKind} onVoiceText={setDraft} error={conversation.status === "failed" ? conversation.error : null} onRetry={conversation.status === "failed" ? conversation.retry : undefined} />
      </footer>
    </main>
  );
}
