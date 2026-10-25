"use client";

import { useState } from "react";

/** The customer message the contact form sends; the consent phrases are the ones the server recognises. */
export function contactMessage(input: { name: string; reach: string; address: string | null }): string {
  const reach = input.reach.includes("@") ? `mi correo es ${input.reach}` : `mi teléfono es ${input.reach}`;
  const address = input.address ? ` La dirección del evento es ${input.address}.` : "";
  return `Mi nombre es ${input.name} y ${reach}.${address} Autorizo que me contacten y autorizo usar mi dirección solo para esta propuesta.`;
}

type Props = { askAddress: boolean; busy: boolean; onSend: (message: string) => void };
const field = "min-h-12 rounded-xl border border-borde bg-fondo px-3.5 text-base text-texto placeholder:text-[#8a8192] focus:outline-none focus:ring-2 focus:ring-acento";

/** The contact, last of all: name, phone or e-mail, the address when still missing, and explicit consent. */
export function ContactForm({ askAddress, busy, onSend }: Props) {
  const [name, setName] = useState("");
  const [reach, setReach] = useState("");
  const [address, setAddress] = useState("");
  const [consent, setConsent] = useState(false);
  const ready = name.trim() && reach.trim() && (!askAddress || address.trim()) && consent;
  const send = () => { if (ready) onSend(contactMessage({ name: name.trim(), reach: reach.trim(), address: askAddress ? address.trim() : null })); };
  return (
    <section aria-label="Datos de contacto" className="ml-10 flex flex-col gap-3.5 rounded-[22px] border border-borde-suave bg-superficie p-4 shadow-[0_10px_30px_var(--sombra)]">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="advisor-contact-name" className="text-[13px] font-semibold">Tu nombre</label>
        <input id="advisor-contact-name" autoComplete="name" placeholder="Nombre y apellido" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} className={field} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="advisor-contact-reach" className="text-[13px] font-semibold">Teléfono o correo</label>
        <input id="advisor-contact-reach" autoComplete="tel" placeholder="300 123 4567" value={reach} onChange={(event) => setReach(event.target.value)} disabled={busy} className={field} />
      </div>
      {askAddress && <div className="flex flex-col gap-1.5">
        <label htmlFor="advisor-contact-address" className="text-[13px] font-semibold">Dirección del evento</label>
        <input id="advisor-contact-address" autoComplete="street-address" placeholder="Calle, número y barrio" value={address} onChange={(event) => setAddress(event.target.value)} disabled={busy} className={field} />
      </div>}
      <label className="flex items-start gap-2.5 text-[13px] leading-snug text-[#4a4152]">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} className="mt-0.5 size-5 shrink-0 accent-acento" />
        <span>Autorizo a Happia a guardar estos datos, contactarme y usar la dirección del evento solo para esta propuesta.</span>
      </label>
      <button type="button" disabled={busy || !ready} onClick={send} className="min-h-12 rounded-[14px] bg-acento font-semibold text-sobre-acento disabled:opacity-50">Enviar y ver el resumen</button>
      <p className="text-xs text-texto-suave">También puedes escribirlo en el chat.</p>
    </section>
  );
}
