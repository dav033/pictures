"use client";

import { useRef, type ReactNode } from "react";

export type AlturaHoja = "cerrada" | "media" | "alta";
export const ALTURAS: readonly AlturaHoja[] = ["cerrada", "media", "alta"];
/** Alto de la hoja del teléfono (el visor sigue a pantalla completa debajo). */
const ALTURA_HOJA: Readonly<Record<AlturaHoja, string>> = { cerrada: "h-auto", media: "h-[44dvh]", alta: "h-[78dvh]" };

type Pestana<P extends string> = { id: P; nombre: string; icono: ReactNode };

type Props<P extends string> = {
  hoja: AlturaHoja;
  /** `1` la sube un escalón (cerrada → media → alta); `-1` la baja. */
  alCambiarAltura: (paso: 1 | -1) => void;
  /** Se escribe en un campo de texto: la hoja sube para que el teclado no la tape. */
  alEscribir: () => void;
  /** px que el teclado de pantalla tapa de la parte baja (ver `useInsetTeclado`): la hoja sube esa cantidad. */
  elevacion?: number;
  pestanas: readonly Pestana<P>[];
  activa: P;
  alElegir: (id: P) => void;
  children: ReactNode;
};

/** La hoja inferior del teléfono: asa para subirla y bajarla (arrastrando, tocando o con flechas), el contenido de la pestaña y la barra de secciones. */
export function HojaMovil<P extends string>({ hoja, alCambiarAltura, alEscribir, pestanas, activa, alElegir, elevacion = 0, children }: Props<P>) {
  const deslizar = useRef<number | null>(null);
  const alternar = () => alCambiarAltura(hoja === "alta" ? -1 : 1);
  return (
    <section aria-label="Paneles del taller" style={elevacion ? { bottom: elevacion, maxHeight: `calc(100dvh - ${elevacion}px - 16px)` } : undefined}
      onFocusCapture={(e) => { if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox")) alEscribir(); }}
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] border-t border-taller-borde bg-taller-panel shadow-[0_-10px_30px_var(--sombra)] ${ALTURA_HOJA[hoja]}`}>
      <div onPointerDown={(e) => { deslizar.current = e.clientY; }} onPointerCancel={() => { deslizar.current = null; }}
        onPointerUp={(e) => {
          const inicio = deslizar.current;
          deslizar.current = null;
          if (inicio === null) return;
          const dy = e.clientY - inicio;
          if (Math.abs(dy) < 8) alternar(); else alCambiarAltura(dy < 0 ? 1 : -1);
        }}
        className="flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center" role="button" tabIndex={0} aria-label={hoja === "alta" ? "Achicar el panel" : "Agrandar el panel"}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); } if (e.key === "ArrowUp") alCambiarAltura(1); if (e.key === "ArrowDown") alCambiarAltura(-1); }}>
        <span className="h-1 w-10 rounded-full bg-taller-borde" aria-hidden />
      </div>
      {hoja !== "cerrada" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-lg:[&_input[type=range]]:min-h-11 max-lg:[&_input[type=checkbox]]:size-5 max-lg:[&_summary]:min-h-11">{children}</div>
      )}
      <nav aria-label="Secciones" className="flex shrink-0 border-t border-taller-linea pb-[max(6px,env(safe-area-inset-bottom))]">
        {pestanas.map((p) => (
          <button key={p.id} type="button" onClick={() => alElegir(p.id)} aria-current={activa === p.id ? "page" : undefined}
            className={`flex h-[52px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${activa === p.id ? "text-taller-acento" : "text-taller-medio"}`}>
            {p.icono}{p.nombre}
          </button>
        ))}
      </nav>
    </section>
  );
}
