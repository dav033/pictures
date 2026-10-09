"use client";

import { muebleDe } from "@/lib/globos3d/mobiliario-catalogo";
import { ACABADOS_MUEBLE, limitesDeMueble, NOMBRE_ACABADO_MUEBLE, piezaDeMueble, type OpcionesGuardadas, type PiezaEscenografia } from "@/lib/globos3d/mobiliario-pieza";
import { avisoDeTexto } from "@/lib/globos3d/rotulos";
import type { Pieza } from "@/lib/globos3d/piezas";
import { CampoTexto } from "./CampoTexto";
import { EditorRotulo } from "./EditorRotulo";
import { Deslizador } from "./PanelFlor";

const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;
const ACABADOS = ACABADOS_MUEBLE.map((a) => [a, NOMBRE_ACABADO_MUEBLE[a]] as const);
/** El color con que arranca un color opcional (el vidrio, el sobremantel) al añadirlo. */
const COLOR_OPCIONAL = "#dfe9ee";

/** ¿Es un mueble paramétrico (con medidas y colores que se pueden cambiar)? */
export const esMuebleEditable = (p: Pieza): p is PiezaEscenografia & { mueble: { id: string; opciones: OpcionesGuardadas } } => p.tipo === "escenografia" && Boolean(p.mueble?.opciones && muebleDe(p.mueble.id));

/**
 * Medidas (ancho, fondo, alto totales; el fondo solo si el mueble lo respeta), colores con su para qué (los opcionales se
 * añaden y se quitan), acabado y texto de un mueble del catálogo: cada cambio lo rearma.
 */
export function EditorMueble({ pieza, onPieza }: { pieza: PiezaEscenografia & { mueble: { id: string; opciones: OpcionesGuardadas } }; onPieza: (p: Pieza) => void }) {
  const m = muebleDe(pieza.mueble.id);
  if (!m) return null;
  const o = pieza.mueble.opciones;
  const rotulo = pieza.mueble.rotulo;
  const pon = (cambio: Partial<OpcionesGuardadas>) => onPieza(piezaDeMueble(m, { ...o, ...cambio }, rotulo));
  const acabados = m.acabadosPropios ?? ACABADOS;
  const l = limitesDeMueble(m);
  const conFondo = (m.fondo ?? "libre") === "libre" && m.lugar === "piso";
  const color = (i: number) => o.colores[i] ?? m.colores[i] ?? COLOR_OPCIONAL;
  const ponColor = (i: number, hex: string) => {
    // Si todos eran el primero (la alfombra sin ribete), cambiar el primero cambia todos.
    const todosIguales = Boolean(m.seguirPrimero) && i === 0 && o.colores.every((c) => c === o.colores[0]);
    pon({ colores: Array.from({ length: Math.max(o.colores.length, i + 1) }, (_, k) => (k === i || todosIguales ? hex : color(k))) });
  };
  return (
    <div className="flex flex-col gap-2.5" aria-label={`Medidas y colores de ${m.nombre}`}>
      <Deslizador id="mueble-ancho" etiqueta="Ancho" valor={o.anchoCm} min={l.ancho.min} max={l.ancho.max} paso={5} texto={metros(o.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
      {conFondo && <Deslizador id="mueble-fondo" etiqueta="Fondo" valor={o.fondoCm} min={l.fondo.min} max={l.fondo.max} paso={5} texto={metros(o.fondoCm)} onCambio={(v) => pon({ fondoCm: v })} />}
      <Deslizador id="mueble-alto" etiqueta="Alto" valor={o.altoCm} min={l.alto.min} max={l.alto.max} paso={5} texto={metros(o.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
      <div className="grid grid-cols-2 gap-2">
        {m.coloresDe.map((para, i) => {
          const opcional = i >= m.colores.length;
          if (opcional && i >= o.colores.length) {
            return <button key={para} type="button" onClick={() => ponColor(i, COLOR_OPCIONAL)} className="min-h-8 rounded-md bg-superficie-suave px-2 text-left text-xs text-texto-suave hover:text-texto">+ {para} · sin</button>;
          }
          return (
            <span key={para} className="flex items-center gap-2 text-xs text-texto">
              <input type="color" value={color(i)} aria-label={`Color: ${para}`} onChange={(e) => ponColor(i, e.target.value)} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />
              <span className="min-w-0 truncate">{para}</span>
              {opcional && <button type="button" aria-label={`Quitar ${para}`} onClick={() => pon({ colores: o.colores.slice(0, i) })} className="ml-auto text-texto-suave hover:text-texto">×</button>}
            </span>
          );
        })}
      </div>
      <label className="flex items-center justify-between gap-2 text-xs text-texto">{m.acabadosPropios ? "Material de las letras" : "Material del primer color"}
        <select value={o.acabado ?? ""} onChange={(e) => { const { acabado: _viejo, ...resto } = o; onPieza(piezaDeMueble(m, e.target.value ? { ...resto, acabado: acabados.find(([id]) => id === e.target.value)?.[0] } : resto, rotulo)); }} className="rounded-md bg-superficie-suave px-2 py-1 text-xs">
          <option value="">Como viene</option>
          {acabados.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
      </label>
      {m.conTexto && <CampoTexto etiqueta="Texto" valor={o.texto ?? m.textoPorDefecto ?? ""} lineas={m.lineasTexto ?? 1} maxLength={120} aviso={(t) => avisoDeTexto(t, m.lineasTexto ?? 1)} onTexto={(texto) => pon({ texto })} />}
      {m.rotulable && <EditorRotulo pieza={pieza} onPieza={onPieza} />}
    </div>
  );
}
