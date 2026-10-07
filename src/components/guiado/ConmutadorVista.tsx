"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ConmutadorVista() {
  const pathname = usePathname();
  const guiada = pathname === "/asistente";
  return (
    <div className="hidden items-center gap-1 rounded-full border border-borde-suave bg-superficie p-1 sm:inline-flex" data-testid="conmutador-vista" aria-label="Vista">
      <span className="sr-only">Vista</span>
      <Link href="/" aria-current={guiada ? undefined : "page"} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${guiada ? "text-texto-suave hover:bg-superficie-2 hover:text-texto" : "bg-acento text-sobre-acento"}`}>Clásica</Link>
      <Link href="/asistente" aria-current={guiada ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${guiada ? "bg-acento text-sobre-acento" : "text-texto-suave hover:bg-superficie-2 hover:text-texto"}`}>Guiada</Link>
    </div>
  );
}
