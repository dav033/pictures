"use client";

import type { ReactNode } from "react";
import { coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import type { Pieza } from "@/lib/globos3d/piezas";
import { infladoDeRemate, type RemateGlobo } from "@/lib/globos3d/remate";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { Deslizador, SelectorColor } from "./PanelFlor";
import { CHIP, CHIP_ON, centimetros } from "./ui-taller";

const FORMATOS_REMATE = ["R-9", "R-12", "R-18", "R-24", "R-36"] as const;

/** Los códigos de color que lleva la pieza (para que el globo de arriba combine de entrada). */
function coloresDePieza(p: Pieza): string[] {
  if (p.tipo === "columna") return p.colores;
  if (p.tipo === "organico") return p.opciones.colores.map((c) => c.codigo);
  return [];
}

/** El globo de arriba de una columna (clásica u orgánica): ninguno o un redondo de cualquier tamaño, color e inflado. */
export function EditorRemate({ pieza, onPieza }: { pieza: Pieza; onPieza: (p: Pieza, agrupar?: string) => void }): ReactNode {
  const r = pieza.remate;
  const elegir = (formatoId: string | null) => {
    if (!formatoId) {
      const { remate: _fuera, ...resto } = pieza;
      onPieza(resto as Pieza);
      return;
    }
    const hay = new Set(coloresDelFormato(formatoId).map((c) => c.codigo));
    const codigo = [r?.codigo, ...coloresDePieza(pieza)].find((c): c is string => !!c && hay.has(c)) ?? coloresDelFormato(formatoId)[0]?.codigo ?? "005";
    onPieza({ ...pieza, remate: { formatoId, codigo } });
  };
  const pon = (cambio: Partial<RemateGlobo>, agrupar?: string) => r && onPieza({ ...pieza, remate: { ...r, ...cambio } }, agrupar);
  const f = r ? formatoPorId(r.formatoId) : undefined;
  return (
    <section className="flex flex-col gap-2.5" aria-label="Globo arriba">
      <h3 className="taller-rotulo">Globo arriba</h3>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Globo arriba">
        <button type="button" role="radio" aria-checked={!r} onClick={() => elegir(null)} className={`${CHIP} ${!r ? CHIP_ON : ""}`}>Ninguno</button>
        {FORMATOS_REMATE.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={r?.formatoId === id} onClick={() => elegir(id)} className={`${CHIP} ${r?.formatoId === id ? CHIP_ON : ""}`}>{id}</button>
        ))}
      </div>
      {r && f && (
        <>
          <Deslizador id="sol-inflado-remate" etiqueta="Inflado" valor={infladoDeRemate(r)} min={Math.round(f.diametroMaxCm * 0.4 * 10) / 10} max={f.diametroMaxCm} paso={0.5} texto={`${centimetros(infladoDeRemate(r))} de ${centimetros(f.diametroMaxCm)} máx.`} onCambio={(v) => pon({ infladoCm: v }, "inflado")} />
          <SelectorColor formatoId={f.id} valor={r.codigo} onCambio={(codigo) => pon({ codigo })} etiqueta={`Color del ${f.id} de arriba`} />
          <p className="text-xs text-taller-suave">{referenciaPorCodigo(r.codigo)?.nombreCompleto} {r.codigo}. Va amarrado sobre la punta, con el nudo abajo, y cotiza con la columna.</p>
        </>
      )}
    </section>
  );
}
