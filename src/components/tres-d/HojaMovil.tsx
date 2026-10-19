"use client";

import { useEffect, useRef, useState, type PointerEvent as EventoPuntero, type ReactNode } from "react";

export type AlturaHoja = "cerrada" | "media" | "alta";
export const ALTURAS: readonly AlturaHoja[] = ["cerrada", "media", "alta"];
/** Alto de cada escalón como parte de la ventana (el visor sigue a pantalla completa debajo). */
export const FRACCION_HOJA: Readonly<Record<AlturaHoja, number>> = { cerrada: 0.15, media: 0.45, alta: 0.85 };
/** Alto táctil del asa. */
const ASA_PX = 44;
/** Movimiento bajo el cual el gesto es un toque y no un arrastre. */
const UMBRAL_TOQUE_PX = 8;
/** Cuánto «adelante» se proyecta la velocidad del dedo al soltar para elegir el escalón. */
const PROYECCION_MS = 180;
/** Muelle: la hoja se pasa un poco y vuelve; con movimiento reducido no hay transición. */
const MUELLE = "height 380ms cubic-bezier(0.34, 1.45, 0.64, 1)";

/** El escalón al que llega la hoja al soltar: el más cercano a donde iría con la velocidad que llevaba (px/ms, negativa = sube). */
export function escalonAlSoltar(altoPx: number, velocidad: number, ventana: number): AlturaHoja {
  const destino = altoPx - velocidad * PROYECCION_MS;
  let mejor: AlturaHoja = "media";
  let distancia = Infinity;
  for (const a of ALTURAS) {
    const d = Math.abs(FRACCION_HOJA[a] * ventana - destino);
    if (d < distancia) { distancia = d; mejor = a; }
  }
  return mejor;
}

type Pestana<P extends string> = { id: P; nombre: string; icono: ReactNode };

type Props<P extends string> = {
  hoja: AlturaHoja;
  /** `1` la sube un escalón (cerrada → media → alta); `-1` la baja. */
  alCambiarAltura: (paso: 1 | -1) => void;
  /** Al soltar el asa arrastrada: el escalón al que se ajusta. */
  alFijarAltura: (altura: AlturaHoja) => void;
  /** px de la parte baja de la ventana que la hoja tapa (también durante el arrastre): el visor centra la escena en el resto. */
  alTapar?: (px: number) => void;
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
export function HojaMovil<P extends string>({ hoja, alCambiarAltura, alFijarAltura, alTapar, alEscribir, pestanas, activa, alElegir, elevacion = 0, children }: Props<P>) {
  const seccion = useRef<HTMLElement>(null);
  const gesto = useRef<{ inicioY: number; inicioAlto: number; muestras: { y: number; t: number }[]; movido: boolean } | null>(null);
  const [arrastre, setArrastre] = useState<number | null>(null);
  const alternar = () => alCambiarAltura(hoja === "alta" ? -1 : 1);
  const alTaparRef = useRef(alTapar);
  alTaparRef.current = alTapar;
  useEffect(() => {
    const nodo = seccion.current;
    if (!nodo) return;
    const medir = () => alTaparRef.current?.(Math.max(0, window.innerHeight - nodo.getBoundingClientRect().top));
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(nodo);
    window.addEventListener("resize", medir);
    return () => { observador.disconnect(); window.removeEventListener("resize", medir); alTaparRef.current?.(0); };
  }, []);
  const alto = arrastre !== null ? `${arrastre}px` : `${FRACCION_HOJA[hoja] * 100}dvh`;
  const soltar = (e: EventoPuntero) => {
    const g = gesto.current;
    gesto.current = null;
    setArrastre(null);
    if (!g) return;
    if (!g.movido) { alternar(); return; }
    const m = g.muestras;
    const ultima = m[m.length - 1];
    const primera = m.find((x) => ultima && ultima.t - x.t <= 120) ?? ultima;
    const velocidad = ultima && primera && ultima.t > primera.t ? (ultima.y - primera.y) / (ultima.t - primera.t) : 0;
    const altoFinal = g.inicioAlto - (e.clientY - g.inicioY);
    alFijarAltura(escalonAlSoltar(altoFinal, velocidad, window.innerHeight));
  };
  return (
    <section ref={seccion} aria-label="Paneles del taller" data-altura={hoja} data-arrastrando={arrastre !== null ? "" : undefined}
      style={{ height: alto, ...(elevacion ? { bottom: elevacion, maxHeight: `calc(100dvh - ${elevacion}px - 16px)` } : {}), ...(arrastre === null ? { transition: MUELLE } : {}) }}
      onFocusCapture={(e) => { if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox")) alEscribir(); }}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] border-t border-taller-borde bg-taller-panel shadow-[0_-10px_30px_var(--sombra)] motion-reduce:!transition-none">
      <div onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          gesto.current = { inicioY: e.clientY, inicioAlto: seccion.current?.getBoundingClientRect().height ?? 0, muestras: [{ y: e.clientY, t: e.timeStamp }], movido: false };
        }}
        onPointerMove={(e) => {
          const g = gesto.current;
          if (!g) return;
          g.muestras.push({ y: e.clientY, t: e.timeStamp });
          if (g.muestras.length > 8) g.muestras.shift();
          if (!g.movido && Math.abs(e.clientY - g.inicioY) < UMBRAL_TOQUE_PX) return;
          g.movido = true;
          const tope = window.innerHeight * FRACCION_HOJA.alta;
          const minimo = window.innerHeight * FRACCION_HOJA.cerrada;
          setArrastre(Math.max(minimo * 0.8, Math.min(tope * 1.03, g.inicioAlto - (e.clientY - g.inicioY))));
        }}
        onPointerCancel={() => { gesto.current = null; setArrastre(null); }}
        onPointerUp={soltar}
        style={{ height: ASA_PX }}
        className="flex shrink-0 cursor-row-resize touch-none items-center justify-center" role="button" tabIndex={0} aria-label={hoja === "alta" ? "Achicar el panel" : "Agrandar el panel"}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); }
          else if (e.key === "ArrowUp") { e.preventDefault(); alCambiarAltura(1); }
          else if (e.key === "ArrowDown") { e.preventDefault(); alCambiarAltura(-1); }
          else if (e.key === "Home") { e.preventDefault(); alFijarAltura("cerrada"); }
          else if (e.key === "End") { e.preventDefault(); alFijarAltura("alta"); }
        }}>
        <span className="h-1 w-10 rounded-full bg-taller-borde" aria-hidden />
      </div>
      {(hoja !== "cerrada" || arrastre !== null) && (
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
