"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, Search, Trash2, X } from "lucide-react";
import { servesText, type Serves } from "@/lib/asesor/servings";
import type { AdvisorProposal } from "./conversation-contract";
import { fetchCatalogue, saveProposal, type CatalogueResult, type CatalogueServiceView, type ProposalItem } from "./proposal-client";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const BASIS: Record<CatalogueServiceView["basis"], string> = { per_person: "por persona", unit: "por unidad", event: "por evento" };
const SAVE_DELAY_MS = 400;
const MAX_QUANTITY = 60;

type Row = { serviceId: string; name: string; provider: string; category: string; basis: CatalogueServiceView["basis"]; unitPriceCop: number; quantity: number; serves: Serves | null };

const normalise = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function rowsOf(proposal: AdvisorProposal | null, edits: Record<string, number>, added: Record<string, CatalogueServiceView>, guests: number): Row[] {
  const base: Row[] = (proposal?.lines ?? []).map((line) => ({
    serviceId: line.serviceId, name: line.name, provider: line.provider, category: line.category, basis: line.basis,
    unitPriceCop: line.unitPriceCop, quantity: line.quantity, serves: line.serves ? { ...line.serves, amount: Math.max(1, Math.round(line.serves.amount / line.quantity)) } : null,
  }));
  const kept = base.filter((row) => edits[row.serviceId] !== 0).map((row) => (row.basis === "unit" && edits[row.serviceId] ? { ...row, quantity: edits[row.serviceId] } : row));
  const known = new Set(base.map((row) => row.serviceId));
  const extra = Object.values(added).filter((service) => !known.has(service.id) && edits[service.id] !== 0).map((service): Row => ({
    serviceId: service.id, name: service.name, provider: service.provider, category: service.category, basis: service.basis, unitPriceCop: service.priceCop,
    quantity: service.basis === "per_person" ? guests : service.basis === "event" ? 1 : edits[service.id] ?? 1, serves: service.serves,
  }));
  return [...kept, ...extra];
}

const subtotal = (row: Row, guests: number) => row.unitPriceCop * (row.basis === "per_person" ? guests : row.basis === "event" ? 1 : row.quantity);
const itemsOf = (rows: Row[]): ProposalItem[] => rows.map((row) => (row.basis === "unit" ? { serviceId: row.serviceId, quantity: row.quantity } : { serviceId: row.serviceId }));

type Props = { conversationId: string; proposal: AdvisorProposal | null; guests: number | null; city: string | null; onClose: () => void; onSaved: (body: unknown) => boolean };

/** Explore Happia's services of the event's city and shape the proposal: add, raise or lower the quantity, remove. */
export function ProposalSheet({ conversationId, proposal, guests, city, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<"propuesta" | "explorar">(proposal?.lines?.length ? "propuesta" : "explorar");
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<Record<string, CatalogueServiceView>>({});
  const [catalogue, setCatalogue] = useState<CatalogueResult | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const sequence = useRef(0);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const headcount = guests ?? 0;
  const rows = useMemo(() => rowsOf(proposal, edits, added, Math.max(1, headcount)), [proposal, edits, added, headcount]);
  const total = rows.reduce((sum, row) => sum + subtotal(row, Math.max(1, headcount)), 0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCatalogue(conversationId, controller.signal).then((result) => { if (!controller.signal.aborted) setCatalogue(result); });
    return () => controller.abort();
  }, [conversationId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  /** Debounced save of the whole list: the last edit wins, the server answers with the priced proposal. */
  const schedule = (nextRows: Row[]) => {
    const mine = ++sequence.current;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setSaving(true);
    timer.current = window.setTimeout(() => {
      inflight.current = inflight.current.then(async () => {
        const result = await saveProposal(conversationId, itemsOf(nextRows));
        if (result.ok && onSaved(result.body)) {
          setError(null);
          if (sequence.current === mine) { setEdits({}); setAdded({}); }
        } else {
          setError(result.ok ? "No pudimos leer la respuesta del servidor." : result.message);
          if (sequence.current === mine) { setEdits({}); setAdded({}); }
        }
        if (sequence.current === mine) setSaving(false);
      });
    }, SAVE_DELAY_MS);
  };

  const apply = (nextEdits: Record<string, number>, nextAdded: Record<string, CatalogueServiceView>) => {
    setEdits(nextEdits); setAdded(nextAdded);
    schedule(rowsOf(proposal, nextEdits, nextAdded, Math.max(1, headcount)));
  };
  const add = (service: CatalogueServiceView) => apply({ ...edits, [service.id]: 1 }, { ...added, [service.id]: service });
  const setQuantity = (id: string, quantity: number) => apply({ ...edits, [id]: Math.min(MAX_QUANTITY, Math.max(1, quantity)) }, added);
  const remove = (id: string) => apply({ ...edits, [id]: 0 }, added);

  const services = catalogue?.status === "ok" ? catalogue.services : [];
  const categories = ["Todos", ...new Set(services.map((service) => service.category))];
  const visible = services.filter((service) => (category === "Todos" || service.category === category)
    && (!query.trim() || normalise(`${service.name} ${service.provider} ${service.description ?? ""} ${service.category}`).includes(normalise(query.trim()))));
  const inProposal = new Map(rows.map((row) => [row.serviceId, row]));
  const noGuests = headcount === 0;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="asesor-fade absolute inset-0 bg-[var(--overlay)]" />
      <section role="dialog" aria-modal="true" aria-label="Servicios y propuesta" className="asesor-hoja relative flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-[28px] bg-superficie pt-3 shadow-[0_-18px_50px_rgb(34_27_46/0.22)]">
        <div aria-hidden="true" className="mx-auto mb-2 h-[5px] w-11 shrink-0 rounded-full bg-borde" />
        <header className="flex items-start justify-between gap-3 px-5 pb-3">
          <div className="min-w-0">
            <h2 className="asesor-display text-xl font-bold">Servicios de Happia</h2>
            <p className="text-[13px] text-texto-suave">{city ? `${city}` : "Ciudad por definir"}{headcount ? ` · ${headcount} invitados` : ""} · precios de referencia antes de IVA y comisión</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-superficie-suave"><X className="size-5" aria-hidden /></button>
        </header>
        <div role="tablist" aria-label="Vista" className="mx-5 mb-3 grid grid-cols-2 gap-1 rounded-full bg-superficie-suave p-1 text-sm font-medium">
          {([["propuesta", `Tu propuesta (${rows.length})`], ["explorar", "Explorar servicios"]] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-10 rounded-full ${tab === key ? "bg-superficie shadow-sm" : "text-texto-suave"}`}>{label}</button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">
          {error && <p role="alert" className="mb-3 rounded-xl bg-error-suave px-3 py-2 text-sm">{error}</p>}
          {tab === "propuesta" ? (
            rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-texto-suave">
                <p>Tu propuesta está vacía. Explora los servicios de Happia y agrega los que quieras.</p>
                <button type="button" onClick={() => setTab("explorar")} className="min-h-11 rounded-full bg-acento px-5 font-semibold text-sobre-acento">Explorar servicios</button>
              </div>
            ) : (
              <ul aria-label="Servicios de tu propuesta" className="flex flex-col gap-2.5">
                {rows.map((row) => (
                  <li key={row.serviceId} className="asesor-sube flex flex-col gap-2 rounded-2xl border border-borde-suave bg-fondo p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-medium leading-snug">{row.name}</p><p className="text-xs text-texto-suave">{row.provider} · {row.category}</p></div>
                      <p className="shrink-0 font-semibold tabular-nums">{cop.format(subtotal(row, Math.max(1, headcount)))}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {row.basis === "unit" ? (
                        <div role="group" aria-label={`Cantidad de ${row.name}`} className="flex items-center gap-1 rounded-full border border-borde bg-superficie">
                          <button type="button" aria-label={`Menos ${row.name}`} disabled={row.quantity <= 1} onClick={() => setQuantity(row.serviceId, row.quantity - 1)} className="grid size-9 place-items-center rounded-full disabled:opacity-35"><Minus className="size-4" aria-hidden /></button>
                          <output aria-live="polite" className="min-w-7 text-center text-sm font-semibold tabular-nums">{row.quantity}</output>
                          <button type="button" aria-label={`Más ${row.name}`} disabled={row.quantity >= MAX_QUANTITY} onClick={() => setQuantity(row.serviceId, row.quantity + 1)} className="grid size-9 place-items-center rounded-full disabled:opacity-35"><Plus className="size-4" aria-hidden /></button>
                        </div>
                      ) : <span className="rounded-full bg-superficie px-3 py-1.5 text-xs text-texto-suave">{row.basis === "per_person" ? `${headcount} invitados × ${cop.format(row.unitPriceCop)}` : "1 por evento"}</span>}
                      <span className="flex-1 text-right text-xs text-texto-suave">{row.basis === "unit" ? `${cop.format(row.unitPriceCop)} c/u` : ""}{row.serves ? `${row.basis === "unit" ? " · " : ""}rinde ${servesText({ ...row.serves, amount: row.serves.amount * (row.basis === "unit" ? row.quantity : 1) })}` : ""}</span>
                      <button type="button" aria-label={`Quitar ${row.name}`} onClick={() => remove(row.serviceId)} className="grid size-9 shrink-0 place-items-center rounded-full text-texto-suave hover:bg-error-suave hover:text-error"><Trash2 className="size-4" aria-hidden /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="flex flex-col gap-3">
              {noGuests && <p className="rounded-xl bg-aviso-suave px-3 py-2 text-sm">Antes de agregar servicios dime en el chat cuántos invitados son: algunas cantidades dependen de eso.</p>}
              {catalogue === null ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-texto-suave"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Cargando los servicios de Happia…</p>
                : catalogue.status !== "ok" ? <p role="alert" className="rounded-xl bg-aviso-suave px-3 py-3 text-sm">{catalogue.message}</p>
                  : <>
                    <label className="relative block"><span className="sr-only">Buscar servicios</span><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-texto-suave" />
                      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar: torta, globos, picadas…" className="min-h-11 w-full rounded-full border border-borde bg-fondo pl-10 pr-4 text-base outline-none focus:border-acento" /></label>
                    <div role="group" aria-label="Categorías" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                      {categories.map((name) => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)} className={`min-h-9 shrink-0 rounded-full border px-3.5 text-sm ${category === name ? "border-acento bg-acento text-sobre-acento" : "border-borde bg-fondo"}`}>{name}</button>)}
                    </div>
                    {visible.length === 0 ? <p className="py-6 text-center text-sm text-texto-suave">Ningún servicio coincide con tu búsqueda.</p> : (
                      <ul aria-label="Servicios disponibles" className="flex flex-col gap-2.5">
                        {visible.map((service) => {
                          const current = inProposal.get(service.id);
                          return (
                            <li key={service.id} className="flex gap-3 rounded-2xl border border-borde-suave bg-fondo p-3">
                              {service.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={service.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} className="size-16 shrink-0 rounded-xl object-cover" />}
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <p className="font-medium leading-snug">{service.name}{service.venue && <span className="ml-1.5 rounded-full bg-aviso-suave px-2 py-0.5 text-[11px] font-semibold">Lugar</span>}</p>
                                <p className="text-xs text-texto-suave">{service.provider} · {service.category}</p>
                                <p className="text-sm"><span className="font-semibold tabular-nums">{cop.format(service.priceCop)}</span> <span className="text-texto-suave">{BASIS[service.basis]}</span>{service.serves && <span className="text-texto-suave"> · rinde {servesText(service.serves)}</span>}</p>
                                {service.description && <p className="line-clamp-2 text-xs text-texto-suave">{service.description}</p>}
                                <div className="mt-1 flex items-center gap-2">
                                  {current ? (
                                    <>
                                      {current.basis === "unit" && <div role="group" aria-label={`Cantidad de ${service.name}`} className="flex items-center gap-1 rounded-full border border-borde bg-superficie">
                                        <button type="button" aria-label={`Menos ${service.name}`} disabled={current.quantity <= 1} onClick={() => setQuantity(service.id, current.quantity - 1)} className="grid size-9 place-items-center rounded-full disabled:opacity-35"><Minus className="size-4" aria-hidden /></button>
                                        <output className="min-w-7 text-center text-sm font-semibold tabular-nums">{current.quantity}</output>
                                        <button type="button" aria-label={`Más ${service.name}`} disabled={current.quantity >= MAX_QUANTITY} onClick={() => setQuantity(service.id, current.quantity + 1)} className="grid size-9 place-items-center rounded-full disabled:opacity-35"><Plus className="size-4" aria-hidden /></button>
                                      </div>}
                                      <span className="text-xs font-semibold text-exito">En tu propuesta</span>
                                      <button type="button" aria-label={`Quitar ${service.name}`} onClick={() => remove(service.id)} className="ml-auto grid size-9 place-items-center rounded-full text-texto-suave hover:bg-error-suave hover:text-error"><Trash2 className="size-4" aria-hidden /></button>
                                    </>
                                  ) : <button type="button" aria-label={`Agregar ${service.name}`} disabled={noGuests} onClick={() => add(service)} className="asesor-eleva flex min-h-9 items-center gap-1.5 rounded-full bg-acento px-4 text-sm font-semibold text-sobre-acento disabled:opacity-45"><Plus className="size-4" aria-hidden />Agregar</button>}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>}
            </div>
          )}
          {tab === "propuesta" && rows.length > 0 && (proposal?.disclosures ?? []).some((text) => text.startsWith("Alcance:")) && (
            <ul aria-label="Alcance de las cantidades" className="mt-3 flex flex-col gap-1.5 rounded-xl bg-aviso-suave px-3 py-2.5 text-[13px] leading-snug">
              {(proposal?.disclosures ?? []).filter((text) => text.startsWith("Alcance:")).map((text) => <li key={text}>{text.replace(/^Alcance: /, "").replace(/^./, (letter) => letter.toUpperCase())}</li>)}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-borde-suave px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <div><p className="text-xs text-texto-suave">Total de referencia</p><p className="asesor-display flex items-center gap-2 text-2xl font-bold tabular-nums">{cop.format(total)}{saving && <Loader2 aria-label="Guardando" className="size-4 animate-spin text-texto-suave motion-reduce:animate-none" />}</p></div>
          <button type="button" onClick={onClose} className="asesor-eleva min-h-12 rounded-2xl bg-acento px-6 font-semibold text-sobre-acento">Listo</button>
        </footer>
      </section>
    </div>
  );
}
