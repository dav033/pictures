import { useEffect, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "./use-revealed-text";
import type { AdvisorComposerCard, AdvisorProposal } from "./conversation-contract";

const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const consultedFormat = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });

/** "23 oct 2026, 10:00 a. m." instead of a raw ISO timestamp; unparsable values are shown as received. */
export function consultedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : consultedFormat.format(date);
}

type Fact = { ok: boolean; text: string };

/** A price that counts up to its value (ease-out); with reduced motion it just shows the value. */
function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 900);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(prefersReducedMotion() ? value : shown)}</>;
}

function proposalFacts(proposal: AdvisorProposal, city: string | null): Fact[] {
  const { coverage, baseGuests, guestCount } = proposal;
  const overBudget: Fact[] = proposal.disclosures.some((text) => /supera el presupuesto/.test(text)) ? [{ ok: false, text: "Supera el presupuesto que indicaste" }] : [];
  if (proposal.kind === "custom") return [
    { ok: true, text: guestCount ? `Cantidades calculadas para ${guestCount} invitados` : "Cantidades por confirmar" },
    coverage.city === "matches" ? { ok: true, text: city ? `Servicios disponibles en ${city}` : "Servicios disponibles en tu ciudad" } : { ok: false, text: "La cobertura en tu ciudad se confirma" },
    coverage.theme === "matches" ? { ok: true, text: "Incluye servicios de tu temática" } : { ok: false, text: "La temática y los colores los define el decorador" },
    ...overBudget,
  ];
  return [
    coverage.guests === "matches_base" ? { ok: true, text: `Para ${baseGuests} invitados` }
      : coverage.guests === "differs_from_base" && guestCount ? { ok: false, text: `Base para ${baseGuests} invitados: se ajusta a ${guestCount}` }
        : { ok: false, text: `Pensado para ${baseGuests} invitados` },
    coverage.city === "matches" ? { ok: true, text: city ? `Disponible en ${city}` : "Disponible en tu ciudad" } : { ok: false, text: "La cobertura en tu ciudad se confirma" },
    coverage.theme === "matches" ? { ok: true, text: "Encaja con tu temática" } : { ok: false, text: "La temática se confirma con el decorador" },
    ...overBudget,
  ];
}

type PackageProps = { proposal: AdvisorProposal; city: string | null; busy: boolean; onPick: (message: string) => void };

/** The standard Happia package as a reference price, never a quote: the decorator confirms it with the brief. */
export function PackageCard({ proposal, city, busy, onPick }: PackageProps) {
  const { estimate } = proposal;
  const price = estimate.status === "available" && estimate.subtotalCop !== null ? copFormat.format(estimate.subtotalCop) : null;
  const consulted = consultedAt(estimate.fetchedAt);
  const custom = proposal.kind === "custom";
  const lines = proposal.lines ?? [];
  return (
    <article aria-label="Paquete propuesto" className="asesor-sube ml-10 overflow-hidden rounded-[22px] border border-borde-suave bg-superficie shadow-[0_10px_30px_var(--sombra)]">
      {!custom && (proposal.categories?.length ?? 0) > 0 && <div className="flex flex-col gap-2 bg-superficie-suave px-4 py-3.5">
        <span className="text-xs font-semibold text-texto-suave">Incluye</span>
        <ul aria-label="Categorías del paquete" className="flex flex-wrap gap-1.5">
          {proposal.categories?.map((category) => <li key={category} className="rounded-full bg-superficie px-3 py-1 text-[13px]">{category}</li>)}
        </ul>
      </div>}
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-acento">{custom ? "Propuesta a medida" : "Paquete Happia"}</span>
          <div className="flex items-baseline justify-between gap-2.5">
            <h3 className="asesor-display text-xl font-bold">{proposal.name}</h3>
            {price && estimate.subtotalCop !== null && <span className="asesor-display text-xl font-bold tabular-nums"><CountUp value={estimate.subtotalCop} format={(amount) => copFormat.format(amount)} /></span>}
          </div>
          <span className="text-right text-xs text-texto-suave">{price ? "Precio de referencia · COP antes de IVA y comisión" : "Precio no disponible"}</span>
        </div>
        {custom && lines.length > 0 && <ul aria-label="Servicios de la propuesta" className="flex flex-col divide-y divide-borde-suave rounded-2xl bg-superficie-suave px-3 text-sm">
          {lines.map((line, index) => <li key={line.serviceId} style={{ "--i": index + 1 } as CSSProperties} className="asesor-sube flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0"><span className="font-medium">{line.name}</span>
              <span className="block text-xs text-texto-suave">{line.provider} · {line.basis === "per_person" ? `${line.quantity} invitados × ${copFormat.format(line.unitPriceCop)}` : line.quantity > 1 ? `${line.quantity} × ${copFormat.format(line.unitPriceCop)}` : "1 unidad"}</span></span>
            <span className="shrink-0 font-semibold">{copFormat.format(line.subtotalCop)}</span>
          </li>)}
        </ul>}
        <ul className="flex flex-col gap-1.5 text-sm text-[#4a4152]">
          {proposalFacts(proposal, city).map((fact, index) => <li key={fact.text} style={{ "--i": lines.length + index + 2 } as CSSProperties} className="asesor-fade flex gap-2">
            <span aria-hidden="true" className={`font-bold ${fact.ok ? "text-exito" : "text-aviso"}`}>{fact.ok ? "✓" : "!"}</span>{fact.text}
          </li>)}
        </ul>
        <details className="border-t border-borde-suave pt-2">
          <summary className="flex min-h-8 cursor-pointer list-none items-center text-[13px] font-medium text-acento">Ver condiciones del catálogo</summary>
          <div className="mt-1 flex flex-col gap-1 text-[13px] leading-relaxed text-texto-suave">
            <p>Precio de referencia del catálogo de Happia{consulted ? `, consultado el ${consulted}` : ""}. No es una cotización: el decorador la confirma con tu resumen.</p>
            <p>{estimate.notice}</p>
            {proposal.disclosures.map((disclosure) => <p key={disclosure}>{disclosure}</p>)}
          </div>
        </details>
        <div className="grid gap-2">
          <button type="button" disabled={busy} onClick={() => onPick(custom ? `Me gusta la propuesta ${proposal.name}.` : `Me gusta el paquete ${proposal.name}.`)} aria-label={custom ? `Me gusta la propuesta ${proposal.name}` : `Me gusta el paquete ${proposal.name}`} className="asesor-eleva min-h-11 rounded-[14px] bg-acento text-sm font-semibold text-sobre-acento disabled:opacity-50">Me gusta</button>
        </div>
      </div>
    </article>
  );
}

type DirectionProps = { cards: readonly AdvisorComposerCard[]; busy: boolean; onPick: (message: string) => void };

/** Curated directions for a customer who does not know what they want, scrolled sideways under the reply. */
export function DirectionCards({ cards, busy, onPick }: DirectionProps) {
  return (
    <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1 pl-[3.75rem]">
      {cards.map((card) => <button key={card.id} type="button" disabled={busy} onClick={() => onPick(card.content)} className="flex w-60 shrink-0 snap-start flex-col overflow-hidden rounded-[18px] border border-borde-suave bg-superficie text-left shadow-sm transition hover:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50">
        {card.imageUrl && <img src={card.imageUrl} alt={`Referencia visual: ${card.title}`} loading="lazy" className="h-32 w-full object-cover" />}
        <span className="flex flex-col gap-1 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-acento">Inspiración</span>
          <span className="font-medium text-texto">{card.title}</span>
          <span className="line-clamp-3 text-[13px] text-texto-suave">{card.description}</span>
          {card.source && <span className="text-xs text-texto-suave">Fuente: {card.source}</span>}
          {card.price && <span className="text-sm font-semibold text-texto">{card.price}</span>}
          <span className="text-xs text-texto-suave">Es una referencia: el decorador confirma qué se puede hacer.</span>
        </span>
      </button>)}
    </div>
  );
}
