"use client";

import { memo, useMemo, useState } from "react";
import { idNuevo, type Escena } from "@/lib/globos3d/escena";
import { FONDOS_CATALOGO } from "@/lib/globos3d/fondos-escenografia";
import { colocacionPorDefecto } from "@/lib/globos3d/mobiliario-colocar";
import { piezaDeEntrada } from "@/lib/globos3d/mobiliario-pieza";
import type { FondoCatalogo } from "@/lib/globos3d/mobiliario-tipos";
import { useArrastreDesdePanel } from "./arrastre-decoracion";
import { DibujoFondo } from "./DibujoFondo";
import { MINI, TARJETA, coincide } from "./ui-taller";

const GRUPOS = [
  { id: "fondo", titulo: "Fondos y tapetes" }, { id: "asiento", titulo: "Sillas y asientos" }, { id: "mesa", titulo: "Mesas" }, { id: "decorado", titulo: "Decorado de pie" },
] as const;

const medidasDe = (f: FondoCatalogo) => (f.clase === "mueble" ? f.medidas : { anchoCm: 100, fondoCm: 100, altoCm: 100 });

/**
 * «Fondos y muebles» (pestaña Utilería): los paneles, pedestales, tapete, cortina y letrero de las fotos y el mobiliario de
 * eventos (sillas, mesas, sofás, aros y arcos metálicos, carrito de dulces…), por grupos. Se arrastran al visor (con el
 * ratón) o se tocan y entran en su sitio de siempre (corridos si ya hay algo ahí, y encima de la mesa lo que va en una); luego
 * se mueven con el arrastre y los muebles se cambian de medida y color en su inspector, como cualquier pieza.
 */
export const FondosYMuebles = memo(function FondosYMuebles({ escena, onEscena, onSeleccion, filtro = "" }: { escena: Escena; onEscena: (e: Escena) => void; onSeleccion?: (id: string | null) => void; filtro?: string }) {
  const arrastre = useArrastreDesdePanel();
  const [aviso, setAviso] = useState<string | null>(null);
  const visibles = useMemo(() => FONDOS_CATALOGO.filter((f) => coincide(filtro, f.nombre, f.descripcion, "fondo mueble mobiliario escenografia silla mesa")), [filtro]);
  if (!visibles.length) return null;
  const poner = (f: FondoCatalogo) => {
    const id = idNuevo(escena, f.id.replace(/_/g, "-"));
    onEscena({ ...escena, nodos: [...escena.nodos, { id, nombre: f.nombre, pieza: piezaDeEntrada(f), colocacion: colocacionPorDefecto(escena, f, medidasDe(f)) }] });
    onSeleccion?.(id);
    setAviso(`Listo: «${f.nombre}» quedó en la escena. Arrástralo para moverlo.`);
  };
  return (
    <section className="flex flex-col gap-2" aria-label="Fondos y muebles">
      <h3 className="taller-rotulo">Fondos y muebles <span className="font-normal normal-case tracking-normal">· no son globos: no cotizan</span></h3>
      {GRUPOS.map((g) => {
        const delGrupo = visibles.filter((f) => (f.grupo ?? "fondo") === g.id);
        if (!delGrupo.length) return null;
        return (
          <div key={g.id} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-taller-suave">{g.titulo}</h4>
            <div className="grid grid-cols-3 gap-2">
              {delGrupo.map((f) => (
                <button key={f.id} type="button" title={`${f.descripcion}${arrastre.arrastrable ? " Arrástralo al visor o tócalo." : ""}`}
                  onPointerDown={(e) => arrastre.apretar(e, () => ({ pieza: piezaDeEntrada(f), nombre: f.nombre, idBase: f.id.replace(/_/g, "-") }))}
                  onClick={(e) => { if (!arrastre.fueArrastre(e)) poner(f); }}
                  className={`${TARJETA} cursor-grab select-none active:cursor-grabbing`}>
                  <span className={MINI} aria-hidden><DibujoFondo id={f.id} elementos={f.elementos} /></span>
                  <span>{f.nombre}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {aviso && <p role="status" className="text-xs text-taller-suave">{aviso}</p>}
    </section>
  );
});
