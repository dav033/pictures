"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { Escena } from "@/lib/globos3d/escena";
import type { Miniatura } from "@/lib/globos3d/decoraciones-escena";
import { agregarMuralTechoArbol, GRUPOS_MURAL_TECHO_ARBOL, muralesTechoArbolesConMiniatura } from "@/lib/globos3d/catalogo-murales-techo-arboles";
import { ACTIVO, BOTON } from "./PanelFlor";
import { coincide } from "./ui-taller";

/** Dibujo de la pieza: globos como elipses y tubitos como trazos. */
const MiniaturaPiezaSvg = memo(function MiniaturaPiezaSvg({ miniatura, nombre }: { miniatura: Miniatura; nombre: string }) {
  const { caja, formas } = miniatura;
  return (
    <svg viewBox={`${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`} role="img" aria-label={`Dibujo de ${nombre}`} className="size-14">
      {formas.map((f, i) => f.tipo === "tubito"
        ? <polyline key={i} points={f.puntos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke={f.hex} strokeWidth={Math.max(f.grosor, caja.ancho / 120)} strokeLinecap="round" strokeLinejoin="round" />
        : <ellipse key={i} cx={f.cx} cy={f.cy} rx={f.rx} ry={f.ry} transform={`rotate(${f.giroGrados.toFixed(1)} ${f.cx} ${f.cy})`} fill={f.hex} stroke="rgba(0,0,0,.22)" strokeWidth={caja.ancho / 300} />)}
    </svg>
  );
});

type Props = {
  escena: Escena;
  onEscena: (e: Escena) => void;
  onSeleccion?: (id: string | null) => void;
  /** Lo escrito en el buscador de «Añadir». */
  filtro?: string;
  /** Cuántas coinciden con la búsqueda (para el contador del buscador). */
  onCuenta?: (n: number) => void;
};

const DONDE: Readonly<Record<string, string>> = { murales: "en la pared del fondo, apoyado en el piso", techo: "pegada al techo", arboles: "de pie en el piso" };

/**
 * Grupos «Murales», «Techo» y «Árboles y palmeras» de «Decoraciones pequeñas»: murales pixelados (una matriz de colores
 * en malla de globos), decoraciones de techo (red, festones en catenaria, tiras colgantes, helio) y palmeras y árboles
 * de globos. Cada uno se pone donde va (pared, techo o piso) y queda elegido para moverlo con «Dónde va».
 */
export const MuralesTechoArboles = memo(function MuralesTechoArboles({ escena, onEscena, onSeleccion, filtro = "", onCuenta }: Props) {
  const [elegida, setElegida] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const piezas = useMemo(() => muralesTechoArbolesConMiniatura(), []);
  const cuenta = useMemo(() => piezas.filter((p) => coincide(filtro, p.nombre, p.descripcion, GRUPOS_MURAL_TECHO_ARBOL.find((g) => g.id === p.grupo)?.nombre)).length, [piezas, filtro]);
  useEffect(() => { onCuenta?.(cuenta); }, [cuenta, onCuenta]);

  const poner = (id: string) => {
    const p = piezas.find((x) => x.id === id);
    if (!p) return;
    const { escena: nueva, id: nodo } = agregarMuralTechoArbol(escena, p);
    onEscena(nueva);
    onSeleccion?.(nodo);
    setAviso(`Listo: «${p.nombre}» quedó ${DONDE[p.grupo]} y la dejé elegida para que la muevas (arrástrala o usa «Lugar»).`);
  };

  return (
    <>
      {GRUPOS_MURAL_TECHO_ARBOL.map((g) => {
        const delGrupo = piezas.filter((p) => p.grupo === g.id && coincide(filtro, p.nombre, p.descripcion, g.nombre));
        if (!delGrupo.length) return null;
        const abierta = delGrupo.find((p) => p.id === elegida);
        return (
          <div key={g.id} className="flex flex-col gap-1" aria-label={g.nombre}>
            <h3 className="taller-rotulo">{g.nombre}</h3>
            <div className="grid grid-cols-3 gap-1">
              {delGrupo.map((p) => {
                const activa = p.id === elegida;
                return (
                  <button key={p.id} type="button" aria-pressed={activa} aria-expanded={activa} title={p.descripcion} onClick={() => { setElegida(activa ? null : p.id); setAviso(null); }}
                    className={`flex min-h-24 flex-col items-center gap-0.5 rounded-xl p-1.5 text-center ring-1 transition-colors ${activa ? "bg-superficie-suave ring-2 ring-acento" : "bg-superficie ring-borde hover:bg-superficie-suave"}`}>
                    <MiniaturaPiezaSvg miniatura={p.miniatura} nombre={p.nombre} />
                    <span className="text-[0.7rem] leading-tight text-texto">{p.nombre}</span>
                    <span className="text-[0.65rem] text-texto-suave">{p.globos} globos</span>
                  </button>
                );
              })}
            </div>
            {abierta && (
              <div className="flex flex-col gap-2 rounded-xl bg-superficie-suave p-2 ring-1 ring-acento/60" aria-label={`Dónde poner ${abierta.nombre}`}>
                <p className="text-xs text-texto"><b>{abierta.nombre}</b> · {abierta.globos} globos. <span className="text-texto-suave">{abierta.descripcion}</span></p>
                <button type="button" onClick={() => poner(abierta.id)} className={`${BOTON} ${ACTIVO} text-xs`}>Ponerla {DONDE[abierta.grupo]}</button>
                {aviso && <p role="status" className="rounded-lg bg-superficie p-2 text-xs text-texto ring-1 ring-borde">{aviso}</p>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});
