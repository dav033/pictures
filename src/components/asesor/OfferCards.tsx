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

function proposalFacts(proposal: AdvisorProposal, city: string | null): Fact[] {
  const { coverage, baseGuests, guestCount } = proposal;
  return [
    coverage.guests === "matches_base" ? { ok: true, text: `Para ${baseGuests} invitados` }
      : coverage.guests === "differs_from_base" && guestCount ? { ok: false, text: `Base para ${baseGuests} invitados: se ajusta a ${guestCount}` }
        : { ok: false, text: `Pensado para ${baseGuests} invitados` },
    coverage.city === "matches" ? { ok: true, text: city ? `Disponible en ${city}` : "Disponible en tu ciudad" } : { ok: false, text: "La cobertura en tu ciudad se confirma" },
    coverage.theme === "matches" ? { ok: true, text: "Encaja con tu temática" } : { ok: false, text: "La temática se confirma con el decorador" },
  ];
}

type PackageProps = { proposal: AdvisorProposal; city: string | null; busy: boolean; onPick: (message: string) => void };

/** The standard Happia package as a reference price, never a quote: the decorator confirms it with the brief. */
export function PackageCard({ proposal, city, busy, onPick }: PackageProps) {
  const { estimate } = proposal;
  const price = estimate.status === "available" && estimate.subtotalCop !== null ? copFormat.format(estimate.subtotalCop) : null;
  const consulted = consultedAt(estimate.fetchedAt);
  return (
    <article aria-label="Paquete propuesto" className="ml-10 overflow-hidden rounded-[22px] border border-borde-suave bg-superficie shadow-[0_10px_30px_var(--sombra)]">
      {(proposal.categories?.length ?? 0) > 0 && <div className="flex flex-col gap-2 bg-superficie-suave px-4 py-3.5">
        <span className="text-xs font-semibold text-texto-suave">Incluye</span>
        <ul aria-label="Categorías del paquete" className="flex flex-wrap gap-1.5">
          {proposal.categories?.map((category) => <li key={category} className="rounded-full bg-superficie px-3 py-1 text-[13px]">{category}</li>)}
        </ul>
      </div>}
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-acento">Paquete Happia</span>
          <div className="flex items-baseline justify-between gap-2.5">
            <h3 className="asesor-display text-xl font-bold">{proposal.name}</h3>
            {price && <span className="asesor-display text-xl font-bold">{price}</span>}
          </div>
          <span className="text-right text-xs text-texto-suave">{price ? "Precio de referencia · COP antes de IVA y comisión" : "Precio no disponible"}</span>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm text-[#4a4152]">
          {proposalFacts(proposal, city).map((fact) => <li key={fact.text} className="flex gap-2">
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
          <button type="button" disabled={busy} onClick={() => onPick(`Me gusta el paquete ${proposal.name}.`)} aria-label={`Me gusta el paquete ${proposal.name}`} className="min-h-11 rounded-[14px] bg-acento text-sm font-semibold text-sobre-acento disabled:opacity-50">Me gusta</button>
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
