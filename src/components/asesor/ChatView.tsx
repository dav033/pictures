"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import Image from "next/image";
import { Composer } from "./Composer";
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
          {visibleMessages.map((message) => <li key={message.id} className={`max-w-[90%] whitespace-pre-wrap rounded-3xl px-4 py-3 text-[15px] leading-relaxed shadow-sm sm:max-w-[82%] ${message.role === "user" ? "ml-auto rounded-br-lg bg-acento text-sobre-acento" : "mr-auto rounded-bl-lg border border-borde bg-superficie text-texto"}`}>{message.content}</li>)}
          {conversation.streamingText && <li aria-label="Respuesta en curso" className="mr-auto max-w-[90%] whitespace-pre-wrap rounded-3xl rounded-bl-lg border border-borde bg-superficie px-4 py-3 text-[15px] leading-relaxed shadow-sm">{conversation.streamingText}<span className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-acento" aria-hidden="true" /></li>}
          {conversation.status === "sending" && !conversation.streamingText && <li role="status" className="mr-auto rounded-3xl rounded-bl-lg border border-borde bg-superficie px-4 py-3 text-sm text-texto-suave">Estoy pensando…</li>}
        </ol>
        {conversation.directionOffers.length > 0 && <section aria-label="Direcciones de decoración" className="grid gap-4 sm:grid-cols-2">
          {conversation.directionOffers.map((direction) => <article key={direction.id} className={`overflow-hidden rounded-2xl border bg-superficie shadow-sm ${conversation.selectedDirectionId === direction.id ? "border-acento ring-2 ring-acento" : "border-borde"}`}>
            <div className="relative aspect-[4/3] w-full">
              <Image src={direction.photoUrl} alt={`Referencia visual: ${direction.title}`} fill sizes="(max-width: 640px) 100vw, 50vw" className="object-cover" />
            </div>
            <div className="space-y-2 p-4">
              <h2 className="font-semibold">{direction.title}</h2>
              <p className="text-sm text-texto-suave">{direction.description}</p>
              {direction.provenance.label && <p className="text-xs text-aviso">{direction.provenance.label}</p>}
              <div className="border-t border-borde pt-2 text-sm">
                <p className="font-medium">Artículos temáticos verificados</p>
                {direction.themedItems.status === "unavailable" && <p className="mt-1 text-texto-suave">No fue posible consultar el catálogo de artículos. No se muestran artículos ni precios.</p>}
                {direction.themedItems.status === "no_verified_matches" && <p className="mt-1 text-texto-suave">No hay artículos del catálogo verificados para esta dirección.</p>}
                {direction.themedItems.status === "available" && <ul className="mt-1 list-inside list-disc text-texto-suave">
                  {direction.themedItems.items.map((item) => <li key={`${item.source}:${item.id}`}>{item.name} · {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(item.price)}</li>)}
                </ul>}
              </div>
              <button type="button" disabled={conversation.status === "sending"} onClick={() => conversation.selectDirection(direction.id)} className="min-h-11 w-full rounded-xl bg-acento px-4 font-semibold text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-60">
                {conversation.selectedDirectionId === direction.id ? "Dirección elegida" : "Elegir esta dirección"}
              </button>
            </div>
          </article>)}
        </section>}
        <div ref={transcriptEnd} aria-hidden="true" />
      </section>

      <footer className="sticky bottom-0 z-10 border-t border-borde bg-fondo/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
        <Composer value={draft} onChange={setDraft} onSubmit={conversation.submit} busy={!conversation.conversationId || conversation.status === "sending" || conversation.status === "loading" || conversation.status === "invalid" || conversation.status === "unavailable"} cards={conversation.cards} capabilities={conversation.capabilities} error={conversation.status === "failed" ? conversation.error : null} onRetry={conversation.status === "failed" ? conversation.retry : undefined} />
      </footer>
    </main>
  );
}
