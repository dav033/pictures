"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle, ListChecks } from "lucide-react";
import type { HappiaPackage } from "@sempertex/happie-package-ia";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { ChatFlow } from "./ChatFlow";
import { WizardFlow } from "./WizardFlow";
import { Carrito, type ItemCarrito } from "./Carrito";

type Modo = "chat" | "pasos";

export default function HappiePage() {
  const [modo, setModo] = useState<Modo>("pasos");
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);

  const idsEnCarrito = useMemo(() => new Set(carrito.map((item) => item.paquete.id)), [carrito]);

  function agregarAlCarrito(paquete: HappiaPackage) {
    setCarrito((actual) => {
      const existente = actual.find((item) => item.paquete.id === paquete.id);
      if (existente) return actual;
      return [...actual, { paquete, cantidad: 1 }];
    });
  }

  function cambiarCantidad(packageId: string, delta: number) {
    setCarrito((actual) =>
      actual
        .map((item) => (item.paquete.id === packageId ? { ...item, cantidad: item.cantidad + delta } : item))
        .filter((item) => item.cantidad > 0),
    );
  }

  function quitarDelCarrito(packageId: string) {
    setCarrito((actual) => actual.filter((item) => item.paquete.id !== packageId));
  }

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-borde-suave bg-fondo px-4 py-2 sm:px-5">
        <span className="text-sm font-semibold text-texto">Happie IA</span>
        <div className="flex items-center gap-1">
          <Link href="/" className="ui-button-ghost rounded-lg px-2 py-1.5">
            ← Volver al asistente
          </Link>
          <InterruptorTema />
        </div>
      </header>

      {/* Hero — la imagen es una capa absoluta que llena al padre; el padre
          crece con el contenido (sin alto fijo) para que el título/toggle
          nunca queden recortados si el texto ocupa más de una línea.
          Excepción de color: el velo oscuro y el texto blanco van fijos
          porque se leen sobre la foto, igual en tema claro y oscuro. */}
      <div className="relative bg-[#1c1425]">
        <div className="absolute inset-0 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- ya viene comprimida/dimensionada por el pipeline de generación; el optimizador de Next rechaza este JPEG */}
          <img src="/happie/hero.jpg" alt="" className="h-full w-full object-cover opacity-80" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(100deg, rgba(28,20,37,0.94) 0%, rgba(28,20,37,0.74) 42%, rgba(28,20,37,0.2) 74%, rgba(28,20,37,0.55) 100%)",
            }}
          />
        </div>

        <div className="relative mx-auto flex max-w-5xl flex-col gap-4 px-4 pb-10 pt-9 sm:gap-5 sm:px-5 sm:pt-12">
          <div className="flex items-center gap-2.5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c4a6ff" strokeWidth="1.6" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" />
              <circle cx="12" cy="12" r="3.4" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c4a6ff]">Happie IA</span>
          </div>

          <h1 className="max-w-[560px] text-[32px] font-bold leading-[1.1] tracking-tight text-white text-pretty sm:text-[40px]">
            Cuéntanos tu celebración. Nosotros armamos el paquete.
          </h1>

          <p className="max-w-[440px] text-[14px] leading-relaxed text-white/70">
            Describe tu evento o respóndenos tres preguntas. Te mostramos los paquetes que mejor encajan.
          </p>

          <div className="mt-1 flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-white/10 p-1">
            <button
              type="button"
              aria-pressed={modo === "chat"}
              onClick={() => setModo("chat")}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
              style={modo === "chat" ? { background: "#ffffff", color: "#1c1425" } : { color: "rgba(255,255,255,0.82)" }}
            >
              <MessageCircle className="h-[15px] w-[15px]" strokeWidth={1.8} />
              Describir mi evento
            </button>
            <button
              type="button"
              aria-pressed={modo === "pasos"}
              onClick={() => setModo("pasos")}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
              style={modo === "pasos" ? { background: "#ffffff", color: "#1c1425" } : { color: "rgba(255,255,255,0.82)" }}
            >
              <ListChecks className="h-[15px] w-[15px]" strokeWidth={1.8} />
              Guiarme por pasos
            </button>
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-7 px-4 py-8 sm:px-5 md:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          {modo === "chat" ? (
            <ChatFlow idsEnCarrito={idsEnCarrito} onAgregar={agregarAlCarrito} />
          ) : (
            <WizardFlow idsEnCarrito={idsEnCarrito} onAgregar={agregarAlCarrito} />
          )}
        </section>

        <Carrito items={carrito} onCambiarCantidad={cambiarCantidad} onQuitar={quitarDelCarrito} />
      </div>
    </div>
  );
}
