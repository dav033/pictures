"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { z } from "zod";
import type { PublicSharedQuote, SharedQuoteStatus } from "@/lib/shared-quotes/contracts";

const DecisionResponseSchema = z.object({ status: z.literal("saved") }).strict();
const PublicResponseSchema = z.object({
  sceneName: z.string(),
  validUntil: z.string(),
  totalCop: z.number().int().nonnegative(),
  currency: z.literal("COP"),
  status: z.enum(["pending", "approved", "changes_requested"]),
  createdAt: z.string(),
}).strict();

const currency = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "America/Bogota" });
function formatValidUntil(value: string): string {
  return date.format(new Date(value + "T12:00:00-05:00"));
}

const STATUS_LABEL: Record<SharedQuoteStatus, string> = {
  pending: "Pendiente de respuesta",
  approved: "Aprobada",
  changes_requested: "Solicitud de cambios recibida",
};

export function CustomerSharedQuote({
  token,
  quote,
  canRespond,
}: {
  token: string;
  quote: PublicSharedQuote;
  canRespond: boolean;
}) {
  const [status, setStatus] = useState(quote.status);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<"approved" | "changes_requested">("approved");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || status !== "pending") return;
    setSubmitting(true);
    setError(null);
    const input = {
      decision,
      customerName: name,
      ...(decision === "changes_requested" ? { comment } : {}),
    };
    try {
      const response = await fetch("/api/cotizacion-compartida/" + encodeURIComponent(token) + "/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      });
      if (response.status === 404) {
        setExpired(true);
        return;
      }
      if (response.status === 409) {
        await refreshStatus();
        setError("Esta cotización ya tiene una respuesta.");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = z.object({ message: z.string().optional() }).safeParse(body);
        throw new Error(parsedError.success && parsedError.data.message ? parsedError.data.message : "No pude guardar la respuesta.");
      }
      DecisionResponseSchema.parse(body);
      setStatus(decision);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "No pude guardar la respuesta.");
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshStatus() {
    const response = await fetch("/api/cotizacion-compartida/" + encodeURIComponent(token), { cache: "no-store" });
    if (response.status === 404) {
      setExpired(true);
      return;
    }
    if (!response.ok) return;
    const current = PublicResponseSchema.parse(await response.json());
    setStatus(current.status);
  }

  if (expired) {
    return <main className="mx-auto max-w-xl p-6 text-center text-texto"><h1 className="text-2xl font-semibold">Este enlace venció o ya no está disponible.</h1></main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-4 py-8 text-texto sm:px-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-acento">Cotización de decoración</p>
        <h1 className="mt-2 text-2xl font-semibold">{quote.sceneName}</h1>
      </header>
      <div className="relative h-[60vh] max-h-[600px] w-full">
        <Image
          unoptimized
          fill
          sizes="(max-width: 768px) 100vw, 768px"
          src={"/api/cotizacion-compartida/" + encodeURIComponent(token) + "/imagen"}
          alt={"Vista de la escena " + quote.sceneName}
          className="rounded-2xl border border-borde-suave bg-superficie object-contain"
        />
      </div>
      <section aria-label="Precio de la cotización" className="rounded-2xl border border-borde-suave bg-superficie p-5">
        <p className="text-sm text-texto-suave">Total para el cliente</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{currency.format(quote.totalCop)}</p>
        <p className="mt-3 text-sm text-texto-suave">Válida hasta el {formatValidUntil(quote.validUntil)}.</p>
      </section>
      {status !== "pending" ? (
        <p role="status" className="rounded-xl bg-superficie p-4 text-sm">{STATUS_LABEL[status]}.</p>
      ) : !canRespond ? (
        <p role="status" className="rounded-xl bg-superficie p-4 text-sm">La respuesta está temporalmente deshabilitada.</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 rounded-2xl border border-borde-suave bg-superficie p-5">
          <h2 className="text-lg font-semibold">¿Apruebas esta cotización?</h2>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="decision" checked={decision === "approved"} onChange={() => setDecision("approved")} />
            Aprobar
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="decision" checked={decision === "changes_requested"} onChange={() => setDecision("changes_requested")} />
            Pedir cambios
          </label>
          <label htmlFor="customer-name" className="text-sm font-medium">Tu nombre</label>
          <input id="customer-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100}
            className="min-h-11 rounded-lg border border-borde-suave bg-fondo px-3 text-sm focus-visible:outline-2 focus-visible:outline-acento" />
          {decision === "changes_requested" && (
            <>
              <label htmlFor="customer-comment" className="text-sm font-medium">¿Qué cambios necesitas?</label>
              <textarea id="customer-comment" value={comment} onChange={(event) => setComment(event.target.value)} required maxLength={2000} rows={4}
                className="rounded-lg border border-borde-suave bg-fondo px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-acento" />
            </>
          )}
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <button type="submit" disabled={submitting} className="min-h-11 rounded-xl bg-acento px-4 text-sm font-semibold text-sobre-acento disabled:opacity-60">
            {submitting ? "Enviando…" : decision === "approved" ? "Confirmar aprobación" : "Enviar solicitud de cambios"}
          </button>
        </form>
      )}
    </main>
  );
}
