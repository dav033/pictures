"use client";

import Link from "next/link";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { PanelCatalogo } from "./PanelCatalogo";
import { PanelRecomendacion } from "./PanelRecomendacion";

/** Panel para probar la integración con Happia en el despliegue: catálogo (API de integraciones) y recomendación (webhook). */
export function PanelesPrueba() {
  return (
    <div className="flex min-h-screen flex-col bg-fondo text-texto">
      <header className="flex items-center justify-between gap-3 border-b border-borde-suave px-4 py-2 sm:px-5">
        <span className="text-sm font-semibold">Prueba de integración con Happia</span>
        <div className="flex items-center gap-1">
          <Link href="/happie" className="ui-button-ghost rounded-lg px-2 py-1.5">
            ← Happie IA
          </Link>
          <InterruptorTema />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5">
        <PanelCatalogo />
        <PanelRecomendacion />
      </main>
    </div>
  );
}
