"use client";

import { muebleDe } from "@/lib/globos3d/mobiliario-catalogo";
import { piezaDeMueble, type OpcionesGuardadas, type PiezaEscenografia } from "@/lib/globos3d/mobiliario-pieza";
import type { Pieza } from "@/lib/globos3d/piezas";
import { Deslizador } from "./PanelFlor";

const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;
const ACABADOS = [["mate", "Mate"], ["satinado", "Satinado"], ["brillante", "Brillante"], ["madera", "Madera"], ["metal", "Metal"], ["tela", "Tela"]] as const;

/** ¿Es un mueble paramétrico (con medidas y colores que se pueden cambiar)? */
export const esMuebleEditable = (p: Pieza): p is PiezaEscenografia & { mueble: { id: string; opciones: OpcionesGuardadas } } => p.tipo === "escenografia" && Boolean(p.mueble?.opciones && muebleDe(p.mueble.id));

/** Medidas (ancho, fondo, alto totales), colores con su para qué, acabado y texto de un mueble del catálogo: cada cambio lo rearma. */
export function EditorMueble({ pieza, onPieza }: { pieza: PiezaEscenografia & { mueble: { id: string; opciones: OpcionesGuardadas } }; onPieza: (p: Pieza) => void }) {
  const m = muebleDe(pieza.mueble.id);
  if (!m) return null;
  const o = pieza.mueble.opciones;
  const pon = (cambio: Partial<OpcionesGuardadas>) => onPieza(piezaDeMueble(m, { ...o, ...cambio }));
  const rango = (base: number) => ({ min: Math.max(2, Math.round(base * 0.4)), max: Math.round(base * 2.5) });
  const { medidas } = m;
  return (
    <div className="flex flex-col gap-2.5" aria-label={`Medidas y colores de ${m.nombre}`}>
      <Deslizador id="mueble-ancho" etiqueta="Ancho" valor={o.anchoCm} {...rango(medidas.anchoCm)} paso={5} texto={metros(o.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
      {m.lugar === "piso" && <Deslizador id="mueble-fondo" etiqueta="Fondo" valor={o.fondoCm} {...rango(medidas.fondoCm)} paso={5} texto={metros(o.fondoCm)} onCambio={(v) => pon({ fondoCm: v })} />}
      <Deslizador id="mueble-alto" etiqueta="Alto" valor={o.altoCm} {...rango(medidas.altoCm)} paso={5} texto={metros(o.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
      <div className="grid grid-cols-2 gap-2">
        {m.coloresDe.map((para, i) => (
          <label key={para} className="flex items-center gap-2 text-xs text-texto">
            <input type="color" value={o.colores[i] ?? m.colores[i] ?? "#cccccc"} aria-label={`Color: ${para}`} onChange={(e) => pon({ colores: Array.from({ length: Math.max(o.colores.length, i + 1) }, (_, k) => (k === i ? e.target.value : o.colores[k] ?? m.colores[k] ?? "#cccccc")) })} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />
            <span className="min-w-0 truncate">{para}</span>
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2 text-xs text-texto">Material del primer color
        <select value={o.acabado ?? ""} onChange={(e) => { const { acabado: _viejo, ...resto } = o; onPieza(piezaDeMueble(m, e.target.value ? { ...resto, acabado: ACABADOS.find(([id]) => id === e.target.value)?.[0] } : resto)); }} className="rounded-md bg-superficie-suave px-2 py-1 text-xs">
          <option value="">Como viene</option>
          {ACABADOS.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
      </label>
      {m.conTexto && (
        <label className="flex flex-col gap-1 text-xs text-texto">Texto
          <input type="text" maxLength={40} value={o.texto ?? "Happy Birthday"} onChange={(e) => pon({ texto: e.target.value })} className="rounded-md bg-superficie-suave px-2 py-1.5 text-sm" />
        </label>
      )}
    </div>
  );
}
