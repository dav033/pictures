"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** El menú de la escena (junto a su nombre): renombrar, plantillas, guardar en la biblioteca, ayuda y volver al asistente. */
export function MenuMas({ onCerrar, onRenombrar, onPlantillas, onAyuda, onGuardar }: { onCerrar: () => void; onRenombrar: () => void; onPlantillas: () => void; onAyuda: () => void; onGuardar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const fuera = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onCerrar(); };
    window.addEventListener("pointerdown", fuera, true);
    return () => window.removeEventListener("pointerdown", fuera, true);
  }, [onCerrar]);
  const item = "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-taller-texto outline-none hover:bg-taller-elegido focus-visible:bg-taller-elegido";
  const hacer = (f: () => void) => () => { onCerrar(); f(); };
  return (
    <div ref={ref} role="menu" aria-label="Opciones de la escena"
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onCerrar(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      }}
      className="absolute left-0 top-9 z-50 flex w-64 flex-col gap-0.5 rounded-xl border border-taller-solitario-borde bg-taller-boton p-1.5 shadow-[0_18px_40px_var(--sombra)]">
      <button type="button" role="menuitem" onClick={hacer(onRenombrar)} className={item}>Cambiar el nombre</button>
      <button type="button" role="menuitem" onClick={hacer(onPlantillas)} className={item}>Empezar de una plantilla…</button>
      <button type="button" role="menuitem" onClick={hacer(onGuardar)} className={item}>Guardar la escena en mi biblioteca…</button>
      <button type="button" role="menuitem" onClick={hacer(onAyuda)} className={item}>Ayuda y atajos de teclado</button>
      <div aria-hidden className="mx-1 my-1 h-px bg-taller-borde" />
      <Link href="/asistente" role="menuitem" onClick={onCerrar} className={item}><ArrowLeft className="size-4" aria-hidden />Volver al asistente</Link>
    </div>
  );
}
