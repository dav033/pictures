"use client";

import { memo, useState } from "react";
import { idNuevo, type Colocacion, type Escena } from "@/lib/globos3d/escena";
import type { ElementoEscenografia } from "@/lib/globos3d/escenografia";
import type { Pieza } from "@/lib/globos3d/piezas";
import { FONDOS_CATALOGO, type FondoCatalogo } from "@/lib/globos3d/fondos-escenografia";
import { useArrastreDesdePanel } from "./arrastre-decoracion";
import { MINI, TARJETA, coincide } from "./ui-taller";

/** Dibujo plano del fondo, de frente, con sus colores (de sus propios elementos). */
function DibujoFondo({ elementos }: { elementos: readonly ElementoEscenografia[] }) {
  const puntos = elementos.flatMap((e) => (e.forma === "panel" ? e.contorno : e.forma === "caja" ? [{ x: e.centro.x - e.tamano.x / 2, y: e.centro.y - e.tamano.y / 2 }, { x: e.centro.x + e.tamano.x / 2, y: e.centro.y + e.tamano.y / 2 }] : [{ x: e.base.x - e.radioCm, y: e.base.y }, { x: e.base.x + e.radioCm, y: e.base.y + e.altoCm }]));
  const x0 = Math.min(...puntos.map((p) => p.x)), x1 = Math.max(...puntos.map((p) => p.x)), y0 = Math.min(...puntos.map((p) => p.y)), y1 = Math.max(...puntos.map((p) => p.y));
  const escala = 52 / Math.max(1, x1 - x0, y1 - y0);
  const px = (x: number) => 4 + (x - x0) * escala, py = (y: number) => 56 - (y - y0) * escala;
  return (
    <svg viewBox="0 0 60 60" width="52" height="52" aria-hidden>
      {elementos.map((e, i) => e.forma === "panel"
        ? <polygon key={i} points={e.contorno.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")} fill={e.hex} stroke="rgba(0,0,0,.2)" strokeWidth={0.5} />
        : e.forma === "caja"
          ? <rect key={i} x={px(e.centro.x - e.tamano.x / 2)} y={py(e.centro.y + e.tamano.y / 2)} width={Math.max(1, e.tamano.x * escala)} height={Math.max(1, e.tamano.y * escala)} fill={e.hex} stroke="rgba(0,0,0,.2)" strokeWidth={0.5} />
          : <rect key={i} x={px(e.base.x - e.radioCm)} y={py(e.base.y + e.altoCm)} width={e.radioCm * 2 * escala} height={e.altoCm * escala} rx={1} fill={e.hex} stroke="rgba(0,0,0,.2)" strokeWidth={0.5} />)}
    </svg>
  );
}

/** Dónde entra por defecto: los de piso, delante de la pared del fondo; la cortina y el letrero, en la pared. */
function colocacionDe(escena: Escena, f: FondoCatalogo): Colocacion {
  if (f.lugar === "pared") return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: f.id === "letrero" ? 150 : 0 };
  return { en: "piso", xCm: 0, zCm: Math.round(-escena.sala.fondoCm / 2 + (f.id === "tapete_redondo" || f.id === "pedestales" || f.id === "mesa_mantel" ? 120 : 15)), giroGrados: 0 };
}

const piezaDe = (f: FondoCatalogo): Pieza => ({ tipo: "escenografia", elementos: f.elementos() });

/**
 * «Fondos y muebles» (pestaña Utilería): los paneles, pedestales, mesa, tapete, cortina y letrero de las fotos. Se
 * arrastran al visor (con el ratón) o se tocan y entran en su sitio de siempre; luego se mueven y se recolorean como
 * cualquier pieza de escenografía.
 */
export const FondosYMuebles = memo(function FondosYMuebles({ escena, onEscena, onSeleccion, filtro = "" }: { escena: Escena; onEscena: (e: Escena) => void; onSeleccion?: (id: string | null) => void; filtro?: string }) {
  const arrastre = useArrastreDesdePanel();
  const [aviso, setAviso] = useState<string | null>(null);
  const visibles = FONDOS_CATALOGO.filter((f) => coincide(filtro, f.nombre, f.descripcion, "fondo mueble escenografia"));
  if (!visibles.length) return null;
  const poner = (f: FondoCatalogo) => {
    const id = idNuevo(escena, f.id.replace(/_/g, "-"));
    onEscena({ ...escena, nodos: [...escena.nodos, { id, nombre: f.nombre, pieza: piezaDe(f), colocacion: colocacionDe(escena, f) }] });
    onSeleccion?.(id);
    setAviso(`Listo: «${f.nombre}» quedó en la escena. Arrástralo para moverlo.`);
  };
  return (
    <section className="flex flex-col gap-2" aria-label="Fondos y muebles">
      <h3 className="taller-rotulo">Fondos y muebles <span className="font-normal normal-case tracking-normal">· no son globos: no cotizan</span></h3>
      <div className="grid grid-cols-3 gap-2">
        {visibles.map((f) => (
          <button key={f.id} type="button" title={`${f.descripcion}${arrastre.arrastrable ? " Arrástralo al visor o tócalo." : ""}`}
            onPointerDown={(e) => arrastre.apretar(e, () => ({ pieza: piezaDe(f), nombre: f.nombre, idBase: f.id.replace(/_/g, "-") }))}
            onClick={(e) => { if (!arrastre.fueArrastre(e)) poner(f); }}
            className={`${TARJETA} cursor-grab select-none active:cursor-grabbing`}>
            <span className={MINI} aria-hidden><DibujoFondo elementos={f.elementos()} /></span>
            <span>{f.nombre}</span>
          </button>
        ))}
      </div>
      {aviso && <p role="status" className="text-xs text-taller-suave">{aviso}</p>}
    </section>
  );
});
