"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { guardarVistaApp } from "@/lib/estado/vista-app";

export function ConmutadorVista() {
  const pathname = usePathname();
  const guiada = pathname === "/asistente";
  return (
    <div className="hidden items-center gap-1 rounded-full border border-borde-suave bg-superficie p-1 sm:inline-flex" data-testid="conmutador-vista" aria-label="Vista">
      <span className="sr-only">Vista</span>
      <Link href="/" onClick={() => guardarVistaApp("clasica")} aria-current={guiada ? undefined : "page"} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${guiada ? "text-texto-secundario hover:bg-superficie-hover" : "bg-acento text-white"}`}>Clásica</Link>
      <Link href="/asistente" onClick={() => guardarVistaApp("guiada")} aria-current={guiada ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${guiada ? "bg-acento text-white" : "text-texto-secundario hover:bg-superficie-hover"}`}>Guiada</Link>
    </div>
  );
}
