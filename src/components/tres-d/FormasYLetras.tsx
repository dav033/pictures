"use client";

import { useMemo, useState } from "react";
import type { Escena } from "@/lib/globos3d/escena";
import type { Miniatura } from "@/lib/globos3d/decoraciones-escena";
import { agregarIdeaForma, formasConMiniatura, type DestinoForma } from "@/lib/globos3d/ideas-formas";
import { ACTIVO, BOTON, INACTIVO } from "./PanelFlor";

/** Dibujo de frente de una forma: globos como elipses y tubitos como trazos. */
function MiniaturaForma({ miniatura, nombre }: { miniatura: Miniatura; nombre: string }) {
  const { caja, formas } = miniatura;
  return (
    <svg viewBox={`${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`} role="img" aria-label={`Dibujo de ${nombre}`} className="size-14">
      {formas.map((f, i) => f.tipo === "tubito"
        ? <polyline key={i} points={f.puntos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke={f.hex} strokeWidth={Math.max(f.grosor, caja.ancho / 120)} strokeLinecap="round" strokeLinejoin="round" opacity={f.papel ? 0.6 : 1} />
        : <ellipse key={i} cx={f.cx} cy={f.cy} rx={f.rx} ry={f.ry} transform={`rotate(${f.giroGrados.toFixed(1)} ${f.cx} ${f.cy})`} fill={f.hex} stroke="rgba(0,0,0,.22)" strokeWidth={caja.ancho / 300} />)}
    </svg>
  );
}

type Props = {
  escena: Escena;
  onEscena: (e: Escena) => void;
  onSeleccion?: (id: string | null) => void;
};

/**
 * Grupo «Formas y letras» de «Decoraciones pequeñas»: las ideas de sempertex.com con siluetas rellenas, volúmenes y
 * letras (ancla, corazones, cruz, árboles, esfera, globo aerostático, «2012», el 1 orgánico…) y unas formas básicas.
 * Se abre a pedido (armarlas todas cuesta un poco) y cada una se pone de pie en el piso o en la pared del fondo.
 */
export function FormasYLetras({ escena, onEscena, onSeleccion }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [elegida, setElegida] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const formas = useMemo(() => (abierto ? formasConMiniatura() : []), [abierto]);
  const abierta = elegida === null ? null : formas[elegida] ?? null;

  const poner = (destino: DestinoForma) => {
    if (!abierta) return;
    const { escena: nueva, id } = agregarIdeaForma(escena, abierta, destino);
    onEscena(nueva);
    onSeleccion?.(id);
    setAviso(`Listo: «${abierta.nombre}» quedó ${destino.en === "piso" ? "de pie en el piso" : "en la pared del fondo"} y la dejé elegida para que la muevas con «Dónde va».`);
  };

  return (
    <details className="flex flex-col gap-1" open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)} aria-label="Formas y letras">
      <summary className="cursor-pointer text-xs font-semibold text-texto">Formas y letras <span className="font-normal text-texto-suave">· siluetas rellenas, volúmenes y letras de globos (ideas de sempertex.com)</span></summary>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {formas.map((f, i) => {
          const activa = i === elegida;
          return (
            <button key={`${f.id}-${f.nombre}`} type="button" aria-pressed={activa} aria-expanded={activa} title={f.nota} onClick={() => { setElegida(activa ? null : i); setAviso(null); }}
              className={`flex min-h-24 flex-col items-center gap-0.5 rounded-xl p-1.5 text-center ring-1 transition-colors ${activa ? "bg-superficie-suave ring-2 ring-acento" : "bg-superficie ring-borde hover:bg-superficie-suave"}`}>
              <MiniaturaForma miniatura={f.miniatura} nombre={f.nombre} />
              <span className="text-[0.7rem] leading-tight text-texto">{f.nombre}</span>
              <span className="text-[0.65rem] text-texto-suave">{f.id ? `#${f.id} · ` : ""}{f.globos} globos</span>
            </button>
          );
        })}
      </div>
      {abierta && (
        <div className="flex flex-col gap-2 rounded-xl bg-superficie-suave p-2 ring-1 ring-acento/60" aria-label={`Dónde poner ${abierta.nombre}`}>
          <p className="text-xs text-texto"><b>{abierta.nombre}</b> · {abierta.globos} globos. <span className="text-texto-suave">{abierta.nota}</span></p>
          <p className="text-[0.7rem] text-texto-suave">
            {abierta.fuente === "ficha" ? "Productos de la ficha: " : "Colores (la ficha no trae productos): "}
            {abierta.productos.map((p) => `${p.formatoId} ${p.codigo} ${p.nombre}`).join(" · ")}
            {abierta.url && <> · <a href={abierta.url} target="_blank" rel="noopener noreferrer" className="underline">ver la idea en sempertex.com</a></>}
          </p>
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => poner({ en: "piso" })} className={`${BOTON} ${abierta.lugar === "piso" ? ACTIVO : INACTIVO} text-xs`}>De pie en el piso</button>
            <button type="button" onClick={() => poner({ en: "pared" })} className={`${BOTON} ${abierta.lugar === "pared" ? ACTIVO : INACTIVO} text-xs`}>En la pared del fondo</button>
          </div>
          {aviso && <p role="status" className="rounded-lg bg-superficie p-2 text-xs text-texto ring-1 ring-borde">{aviso}</p>}
        </div>
      )}
    </details>
  );
}
