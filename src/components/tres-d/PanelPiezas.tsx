"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus } from "lucide-react";
import type { Escena, EscenaArmada, NodoArmado, NodoEscena } from "@/lib/globos3d/escena";
import { IconoTipo, NOMBRE_TIPO, padreDe } from "./tipos-pieza";
import { BTN, FILA, FILA_ON } from "./ui-taller";

const numero = (cm: number) => (cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 });
/** «6 × 5 × 3,2 m». */
export const medidasSala = (escena: Escena) => `${numero(escena.sala.anchoCm)} × ${numero(escena.sala.fondoCm)} × ${numero(escena.sala.altoCm)} m`;

type Props = {
  escena: Escena;
  armada: EscenaArmada | null;
  seleccion: string | null;
  onSeleccion: (id: string | null) => void;
  /** Cambiar el nombre de una pieza. */
  onRenombrar: (id: string, nombre: string) => void;
  ocultos: ReadonlySet<string>;
  onOcultar: (id: string) => void;
  onAnadir: () => void;
  /** «Colores de la escena» (la paleta, con su deshacer). */
  paleta: ReactNode;
  onSala: () => void;
  /** En la hoja del teléfono (sin el título). */
  enHoja?: boolean;
};

type Rama = { nodo: NodoEscena; hijos: Rama[] };

/** El árbol de la escena: cada estructura con lo que cuelga de ella (o va sobre ella) debajo. */
function arbol(escena: Escena): Rama[] {
  const ids = new Set(escena.nodos.map((n) => n.id));
  const porPadre = new Map<string, NodoEscena[]>();
  const raices: NodoEscena[] = [];
  for (const n of escena.nodos) {
    const padre = padreDe(n);
    if (padre && ids.has(padre) && padre !== n.id) porPadre.set(padre, [...(porPadre.get(padre) ?? []), n]);
    else raices.push(n);
  }
  const vistos = new Set<string>();
  const rama = (nodo: NodoEscena): Rama => {
    vistos.add(nodo.id);
    return { nodo, hijos: (porPadre.get(nodo.id) ?? []).filter((h) => !vistos.has(h.id)).map(rama) };
  };
  const salida = raices.map(rama);
  // Lo que cuelga en círculo (no debería pasar): a la raíz, para que no se pierda.
  for (const n of escena.nodos) if (!vistos.has(n.id)) salida.push(rama(n));
  return salida;
}

const FilaPieza = memo(function FilaPieza({ nodo, hecho, nivel, tieneHijos, abierta, elegida, oculta, onAbrir, onSeleccion, onRenombrar, onOcultar }: {
  nodo: NodoEscena; hecho: NodoArmado | undefined; nivel: number; tieneHijos: boolean; abierta: boolean; elegida: boolean; oculta: boolean;
  onAbrir: (id: string) => void; onSeleccion: (id: string | null) => void; onRenombrar: (id: string, nombre: string) => void; onOcultar: (id: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const copias = hecho && hecho.copias > 1 ? ` ×${hecho.copias}` : "";
  return (
    <div className={`group ${FILA} ${elegida ? FILA_ON : ""} ${oculta ? "opacity-60" : ""} pr-1`} style={{ paddingLeft: `${8 + nivel * 24}px` }}>
      {tieneHijos ? (
        <button type="button" onClick={() => onAbrir(nodo.id)} aria-expanded={abierta} aria-label={`${abierta ? "Plegar" : "Desplegar"} lo que cuelga de ${nodo.nombre}`}
          className={`grid size-5 shrink-0 place-items-center rounded ${elegida ? "text-taller-acento" : "text-taller-suave"} hover:text-taller-texto`}>
          {abierta ? <ChevronDown className="size-[15px]" aria-hidden /> : <ChevronRight className="size-[15px]" aria-hidden />}
        </button>
      ) : <span className="w-5 shrink-0" aria-hidden />}
      <span className={elegida ? "text-taller-acento" : nivel > 0 ? "text-taller-deco" : "text-taller-acento"} aria-hidden><IconoTipo pieza={nodo.pieza} /></span>
      {editando ? (
        <input autoFocus defaultValue={nodo.nombre} aria-label={`Nuevo nombre de ${nodo.nombre}`}
          onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== nodo.nombre) onRenombrar(nodo.id, v); setEditando(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); setEditando(false); } }}
          className="h-7 min-w-0 flex-1 rounded border border-taller-resalte bg-taller-tarjeta px-1.5 text-[13px] text-taller-texto outline-none" />
      ) : (
        <button type="button" onClick={() => onSeleccion(elegida ? null : nodo.id)} onDoubleClick={() => setEditando(true)}
          onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); setEditando(true); } }}
          aria-pressed={elegida} title={`${NOMBRE_TIPO[nodo.pieza.tipo]} · ${hecho?.globos.length ?? 0} globos. Doble clic o F2 para cambiarle el nombre.`}
          className="min-w-0 flex-1 truncate py-2 text-left outline-none">
          {nodo.nombre}{copias}
          {hecho?.avisos.length ? <span className="sr-only">. Aviso: {hecho.avisos.join(" ")}</span> : null}
        </button>
      )}
      {hecho?.avisos.length ? <span className="text-taller-peligro" title={hecho.avisos.join(" ")} aria-hidden>!</span> : null}
      <button type="button" onClick={() => onOcultar(nodo.id)} aria-pressed={oculta} aria-label={oculta ? `Mostrar ${nodo.nombre}` : `Ocultar ${nodo.nombre}`} title={oculta ? "Mostrar en el visor" : "Ocultar en el visor (sigue en la lista de compra)"}
        className={`grid size-7 shrink-0 place-items-center rounded text-taller-suave hover:text-taller-texto focus-visible:opacity-100 ${oculta ? "" : "opacity-0 group-hover:opacity-100"}`}>
        {oculta ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
      </button>
      <span className={`w-8 shrink-0 text-right font-mono text-[11px] ${elegida ? "text-taller-acento" : "text-taller-suave"}`}>{hecho?.globos.length ?? ""}</span>
    </div>
  );
});

/**
 * Panel «Piezas»: el árbol de la escena (cada estructura y lo que cuelga de ella, con cuántos globos lleva), para elegir,
 * renombrar (doble clic o F2) u ocultar; abajo «Colores de la escena» y la sala.
 */
export const PanelPiezas = memo(function PanelPiezas({ escena, armada, seleccion, onSeleccion, onRenombrar, ocultos, onOcultar, onAnadir, paleta, onSala, enHoja = false }: Props) {
  const ramas = useMemo(() => arbol(escena), [escena]);
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(() => new Set());
  // La elegida y las que la sostienen se ven siempre desplegadas.
  const abiertasVistas = useMemo(() => {
    const s = new Set(abiertas);
    let id = seleccion;
    const porId = new Map(escena.nodos.map((n) => [n.id, n]));
    for (let k = 0; id && k < 20; k++) { s.add(id); const n = porId.get(id); id = n ? padreDe(n) : null; }
    return s;
  }, [abiertas, seleccion, escena]);
  const porId = useMemo(() => new Map((armada?.porNodo ?? []).map((n) => [n.id, n])), [armada]);
  const alAbrir = (id: string) => setAbiertas((a) => { const s = new Set(a); if (abiertasVistas.has(id)) s.delete(id); else s.add(id); return s; });

  const pintar = (r: Rama, nivel: number): ReactNode => {
    const abierta = abiertasVistas.has(r.nodo.id);
    return (
      <li key={r.nodo.id}>
        <FilaPieza nodo={r.nodo} hecho={porId.get(r.nodo.id)} nivel={nivel} tieneHijos={r.hijos.length > 0} abierta={abierta} elegida={r.nodo.id === seleccion} oculta={ocultos.has(r.nodo.id)}
          onAbrir={alAbrir} onSeleccion={onSeleccion} onRenombrar={onRenombrar} onOcultar={onOcultar} />
        {abierta && r.hijos.length > 0 && <ul className="flex flex-col gap-0.5">{r.hijos.map((h) => pintar(h, nivel + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        {!enHoja ? <h2 className="text-[15px] font-semibold">Piezas</h2> : <span className="text-xs text-taller-suave">{escena.nodos.length} piezas · {armada?.globos.length ?? 0} globos</span>}
        <button type="button" onClick={onAnadir} className={`${BTN} h-[30px] text-xs`}><Plus className="size-[15px]" aria-hidden />Añadir</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <nav aria-label="Piezas de la escena" className="px-2">
          {ramas.length === 0
            ? <p className="px-2 py-3 text-xs text-taller-suave">La sala está vacía: añade una pieza con «Añadir» o elige una plantilla.</p>
            : <ul className="flex flex-col gap-0.5">{ramas.map((r) => pintar(r, 0))}</ul>}
        </nav>
        <div className="mx-4 mt-4 border-t border-taller-linea" />
        <div className="px-4 pb-3 pt-3">{paleta}</div>
      </div>
      <div className="flex items-center justify-between border-t border-taller-linea px-4 py-3 text-xs text-taller-suave">
        <span>Sala {medidasSala(escena)}</span>
        <button type="button" onClick={onSala} className="min-h-7 text-taller-acento hover:underline">Cambiar</button>
      </div>
    </div>
  );
});
