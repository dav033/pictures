"use client";

import { useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import type { HappiaPackage } from "@sempertex/happie-package-ia";
import { ListaRecomendaciones } from "./PaqueteCard";

type Recomendacion = {
  paquete: HappiaPackage;
  razon: string;
};

function IconoIA({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" />
        <circle cx="12" cy="12" r="3.4" />
      </svg>
    </div>
  );
}

export function ChatFlow({
  idsEnCarrito,
  onAgregar,
}: {
  idsEnCarrito: Set<string>;
  onAgregar: (paquete: HappiaPackage) => void;
}) {
  const [descripcionEvento, setDescripcionEvento] = useState("");
  const [enviado, setEnviado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recomendaciones, setRecomendaciones] = useState<Recomendacion[]>([]);
  const [resumen, setResumen] = useState<string | null>(null);

  async function recomendar() {
    if (!descripcionEvento.trim() || cargando) return;
    const texto = descripcionEvento.trim();
    setCargando(true);
    setError(null);
    setEnviado(texto);
    try {
      const respuesta = await fetch("/api/happie/recomendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ descripcionEvento: texto }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? "Error desconocido");
      setRecomendaciones(datos.recomendaciones ?? []);
      setResumen(datos.resumen ?? null);
      setDescripcionEvento("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-2xl border border-borde bg-superficie p-4 shadow-[0_2px_10px_var(--sombra)]">
        <IconoIA className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acento-suave text-acento" />
        <textarea
          value={descripcionEvento}
          onChange={(e) => setDescripcionEvento(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              recomendar();
            }
          }}
          placeholder="Ej: cumpleaños de mi hija, cumple 15, somos 30 personas, en el patio de la casa"
          rows={2}
          className="flex-grow resize-none bg-transparent pt-1.5 text-[15px] text-texto outline-none placeholder:text-texto-suave"
        />
        <button
          onClick={recomendar}
          disabled={cargando || !descripcionEvento.trim()}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-acento text-white shadow-[0_6px_16px_var(--sombra-acento)] disabled:opacity-40"
        >
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[17px] w-[17px]" strokeWidth={2.4} />}
        </button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {enviado && !cargando && recomendaciones.length > 0 && (
        <div className="happie-entra flex items-start gap-3">
          <div
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white"
            style={{ background: "linear-gradient(135deg, var(--acento), var(--acento-2))" }}
          >
            <IconoIA />
          </div>
          <p className="pt-1.5 text-[15px] leading-relaxed text-texto text-pretty">
            {resumen ?? "Aquí tienes lo que mejor encaja con tu evento."}
          </p>
        </div>
      )}

      {cargando && (
        <div className="flex items-center gap-3 text-sm text-texto-suave">
          <Sparkles className="h-4 w-4 animate-pulse text-acento" />
          Buscando los paquetes que mejor encajan…
        </div>
      )}

      <ListaRecomendaciones recomendaciones={recomendaciones} idsEnCarrito={idsEnCarrito} onAgregar={onAgregar} />
    </div>
  );
}
