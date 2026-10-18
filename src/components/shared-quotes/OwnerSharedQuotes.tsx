"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { OwnerSharedQuote } from "@/lib/shared-quotes/contracts";
import { BTN } from "@/components/tres-d/ui-taller";

const OwnerListSchema = z.object({
  quotes: z.array(z.object({
    id: z.string().uuid(),
    sceneName: z.string(),
    validUntil: z.string(),
    status: z.enum(["pending", "approved", "changes_requested"]),
    customerName: z.string().nullable(),
    comment: z.string().nullable(),
    respondedAt: z.string().nullable(),
    createdAt: z.string(),
  }).strict()),
}).strict();

const STATUS_LABEL: Record<OwnerSharedQuote["status"], string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  changes_requested: "Cambios solicitados",
};

const dateTime = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});
function formatResponseDate(value: string): string {
  return dateTime.format(new Date(value));
}

export function OwnerSharedQuotes({ sceneKey, enabled }: { sceneKey: string; enabled: boolean }) {
  const [quoteState, setQuoteState] = useState<{ sceneKey: string; quotes: OwnerSharedQuote[] } | null>(null);
  const [errorState, setErrorState] = useState<{ sceneKey: string; message: string } | null>(null);
  const [refreshingSceneKey, setRefreshingSceneKey] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const quotes = quoteState?.sceneKey === sceneKey ? quoteState.quotes : [];
  const loading = refreshingSceneKey === sceneKey || quoteState?.sceneKey !== sceneKey;
  const error = errorState?.sceneKey === sceneKey ? errorState.message : null;

  const loadQuotes = useCallback(async (): Promise<OwnerSharedQuote[]> => {
    const query = new URLSearchParams({ sceneKey });
    const response = await fetch("/api/taller/cotizaciones-compartidas?" + query.toString(), {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("No pude cargar las respuestas.");
    return OwnerListSchema.parse(await response.json()).quotes;
  }, [sceneKey]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const version = ++requestVersion.current;
    setRefreshingSceneKey(sceneKey);
    setErrorState(null);
    try {
      const loadedQuotes = await loadQuotes();
      if (requestVersion.current !== version) return;
      setQuoteState({ sceneKey, quotes: loadedQuotes });
    } catch {
      if (requestVersion.current === version) setErrorState({ sceneKey, message: "No pude cargar las respuestas de esta escena." });
    } finally {
      if (requestVersion.current === version) setRefreshingSceneKey(null);
    }
  }, [enabled, loadQuotes, sceneKey]);

  useEffect(() => {
    if (!enabled) return;
    const version = ++requestVersion.current;
    let active = true;
    void loadQuotes().then((loadedQuotes) => {
      if (!active || requestVersion.current !== version) return;
      setQuoteState({ sceneKey, quotes: loadedQuotes });
      setErrorState(null);
      setRefreshingSceneKey(null);
    }).catch(() => {
      if (!active || requestVersion.current !== version) return;
      setQuoteState({ sceneKey, quotes: [] });
      setErrorState({ sceneKey, message: "No pude cargar las respuestas de esta escena." });
      setRefreshingSceneKey(null);
    });
    return () => { active = false; };
  }, [enabled, loadQuotes, sceneKey]);

  if (!enabled) return null;
  return (
    <section aria-label="Respuestas a cotizaciones compartidas" className="mt-4 border-t border-taller-linea pt-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-semibold">Respuestas del cliente</h5>
        <button type="button" className={BTN} disabled={loading} onClick={() => void refresh()}>{loading ? "Actualizando…" : "Actualizar"}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {!loading && !error && quotes.length === 0 && <p className="mt-2 text-xs text-taller-suave">Esta escena aún no tiene enlaces compartidos.</p>}
      <OwnerSharedQuoteList quotes={quotes} />
    </section>
  );
}

export function OwnerSharedQuoteList({ quotes }: { quotes: OwnerSharedQuote[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-3">
      {quotes.map((quote) => (
        <li key={quote.id} className="rounded-lg bg-taller-superficie p-3 text-sm">
          <p className="font-medium">{quote.sceneName} · {STATUS_LABEL[quote.status]} · válida hasta {quote.validUntil}</p>
          {quote.customerName && (
            <p className="mt-1">
              {quote.customerName}{quote.respondedAt ? " · " + formatResponseDate(quote.respondedAt) : ""}
            </p>
          )}
          {quote.comment && <p className="mt-2 whitespace-pre-wrap break-words" aria-label="Comentario del cliente">{quote.comment}</p>}
        </li>
      ))}
    </ul>
  );
}
