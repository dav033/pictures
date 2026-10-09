"use client";

import { useState } from "react";
import { ArrowDownToLine, ChevronRight, PanelTop } from "lucide-react";
import { coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import { PATRONES_COLUMNA, type PatronColumna } from "@/lib/globos3d/columnas";
import { FORMAS_ARCO } from "@/lib/globos3d/arcos";
import { PATRONES_MALLA } from "@/lib/globos3d/paredes";
import { DECORACIONES_PREDEFINIDAS } from "@/lib/globos3d/figuras";
import { COLUMNA_QUINCE_AZUL } from "@/lib/globos3d/organico-presets";
import type { ColorOrganico } from "@/lib/globos3d/organico";
import type { Pieza } from "@/lib/globos3d/piezas";
import {
  NOMBRE_PARED, descendientes, marcoDePared,
  type Colocacion, type Escena, type EscenaArmada, type LugarColocacion, type NodoEscena, type ParedSala, type Sala,
} from "@/lib/globos3d/escena";
import { EditorMueble, esMuebleEditable } from "./EditorMueble";
import { EditorRotulo, esRotulable } from "./EditorRotulo";
import { ACTIVO, BOTON, Deslizador, INACTIVO, SelectorColor } from "./PanelFlor";
import { NOMBRE_TIPO } from "./tipos-pieza";
import { SALA_MAXIMA_CM } from "@/lib/globos3d/limites-escena";

const m = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;
const TARJETA = "flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde";

const LUGARES: ReadonlyArray<{ id: LugarColocacion; nombre: string }> = [
  { id: "piso", nombre: "En el piso" }, { id: "pared", nombre: "En una pared" }, { id: "techo", nombre: "Del techo" }, { id: "ancla", nombre: "En otra pieza" }, { id: "libre", nombre: "Suelta (x, y, z)" },
];

/** Dónde está una pieza, en palabras. */
export function dondeEsta(nodo: NodoEscena, escena: Escena): string {
  const c = nodo.colocacion;
  if (c.en === "piso") return "en el piso";
  if (c.en === "pared") return NOMBRE_PARED[c.pared].replace("Pared", "en la pared");
  if (c.en === "techo") return `colgada del techo a ${m(c.cuelgaCm)}`;
  if (c.en === "libre") return "suelta en el salón";
  if (c.en === "sobre") return `sobre «${escena.nodos.find((n) => n.id === c.padreId)?.nombre ?? "?"}»`;
  return `en «${escena.nodos.find((n) => n.id === c.padreId)?.nombre ?? "?"}»`;
}

/** Dónde está exactamente (lo que mueven el arrastre y las flechas), en metros y grados. */
export function coordenadas(c: Colocacion): string {
  if (c.en === "piso") return `x ${m(c.xCm)} · z ${m(c.zCm)} · giro ${c.giroGrados}°`;
  if (c.en === "pared") return `a lo largo ${m(c.aLoLargoCm)} · altura ${m(c.alturaCm)}`;
  if (c.en === "techo") return `x ${m(c.xCm)} · z ${m(c.zCm)} · cuelga ${m(c.cuelgaCm)} · giro ${c.giroGrados}°`;
  if (c.en === "libre") return `x ${m(c.xCm)} · y ${m(c.yCm)} · z ${m(c.zCm)} · giro ${c.giroGrados}°`;
  if (c.en === "sobre") return `sobre la superficie · giro ${c.giroGrados}°`;
  return `ancla ${c.ancla + 1}${c.cada > 0 ? `, 1 de cada ${c.cada}` : ""}${c.omitir?.length ? ` (sin ${c.omitir.length})` : ""} · giro ${c.giroGrados}°`;
}

// ----------------------------------------------------------------------------------------------------------
// Dónde va la pieza elegida (inspector: «Cambiar dónde va»)
// ----------------------------------------------------------------------------------------------------------

/**
 * Dónde va una pieza: en el piso, en una pared, del techo, colgada de otra pieza (ancla, repetida cada N) o suelta, con
 * sus deslizadores. Lo que mueven el arrastre del visor y las flechas, en controles.
 */
export function EditorLugar({ nodo, escena, armada, onNodo }: { nodo: NodoEscena; escena: Escena; armada: EscenaArmada; onNodo: (cambio: Partial<NodoEscena>) => void }) {
  const c = nodo.colocacion;
  const { sala } = escena;
  const hecho = armada.porNodo.find((n) => n.id === nodo.id);
  const caja = hecho?.caja;
  const cx = caja ? Math.round((caja.min.x + caja.max.x) / 2) : 0, cz = caja ? Math.round((caja.min.z + caja.max.z) / 2) : 0;
  // Piezas de las que se puede colgar esta: con anclas y que no cuelguen de ella.
  const propias = descendientes(escena, nodo.id);
  const padres = escena.nodos.filter((n) => !propias.has(n.id) && (armada.porNodo.find((x) => x.id === n.id)?.anclas.length ?? 0) > 0);

  const mover = (lugar: LugarColocacion) => {
    if (lugar === c.en) return;
    const limitar = (v: number, max: number) => Math.max(-max, Math.min(max, v));
    if (lugar === "piso") onNodo({ colocacion: { en: "piso", xCm: limitar(cx, sala.anchoCm / 2), zCm: limitar(cz, sala.fondoCm / 2), giroGrados: 0 } });
    else if (lugar === "pared") onNodo({ colocacion: { en: "pared", pared: "fondo", aLoLargoCm: limitar(cx, sala.anchoCm / 2), alturaCm: 0 } });
    else if (lugar === "techo") onNodo({ colocacion: { en: "techo", xCm: limitar(cx, sala.anchoCm / 2), zCm: limitar(cz, sala.fondoCm / 2), cuelgaCm: 40, giroGrados: 0, volteada: nodo.pieza.tipo === "decoracion" } });
    else if (lugar === "libre") {
      // Donde está ahora: su origen pasa al centro de su caja (y luego se afina con los deslizadores).
      const cy = caja ? Math.round((caja.min.y + caja.max.y) / 2) : Math.round(sala.altoCm / 2);
      onNodo({ colocacion: { en: "libre", xCm: limitar(cx, sala.anchoCm / 2), yCm: Math.max(0, Math.min(sala.altoCm, cy)), zCm: limitar(cz, sala.fondoCm / 2), giroGrados: 0 } });
    } else if (padres[0]) onNodo({ colocacion: { en: "ancla", padreId: padres[0].id, ancla: 0, cada: 0, giroGrados: 0 } });
  };

  return (
    <>
      <div className="flex flex-col gap-2" aria-label={`Dónde va ${nodo.nombre}`}>
        <h3 className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs font-semibold text-texto">Dónde va <span className="font-mono font-normal text-texto-suave" aria-live="polite">{coordenadas(c)}</span></h3>
        <div className="grid grid-cols-2 gap-1">
          {LUGARES.map((l) => {
            const sinPadre = l.id === "ancla" && padres.length === 0;
            return (
              <button key={l.id} type="button" onClick={() => mover(l.id)} disabled={sinPadre} aria-pressed={c.en === l.id}
                title={sinPadre ? "No hay otra pieza con anclas donde colgarla (columnas, arcos, paredes y guirnaldas las tienen)." : undefined}
                className={`${BOTON} ${c.en === l.id ? ACTIVO : INACTIVO} disabled:opacity-50`}>{l.nombre}</button>
            );
          })}
        </div>
        {c.en === "piso" && (
          <>
            <Deslizador id="piso-x" etiqueta="Izquierda ↔ derecha" valor={c.xCm} min={-Math.round(sala.anchoCm / 2)} max={Math.round(sala.anchoCm / 2)} paso={5} texto={m(c.xCm)} onCambio={(v) => onNodo({ colocacion: { ...c, xCm: v } })} />
            <Deslizador id="piso-z" etiqueta="Fondo ↔ frente" valor={c.zCm} min={-Math.round(sala.fondoCm / 2)} max={Math.round(sala.fondoCm / 2)} paso={5} texto={m(c.zCm)} onCambio={(v) => onNodo({ colocacion: { ...c, zCm: v } })} />
            <Deslizador id="piso-giro" etiqueta="Giro" valor={c.giroGrados} min={-180} max={180} paso={5} texto={`${c.giroGrados}°`} onCambio={(v) => onNodo({ colocacion: { ...c, giroGrados: v } })} />
          </>
        )}
        {c.en === "pared" && (
          <>
            <div className="grid grid-cols-3 gap-1">
              {(["izquierda", "fondo", "derecha"] as const satisfies readonly ParedSala[]).map((p) => (
                <button key={p} type="button" onClick={() => onNodo({ colocacion: { ...c, pared: p, aLoLargoCm: 0 } })} aria-pressed={c.pared === p} className={`${BOTON} ${c.pared === p ? ACTIVO : INACTIVO} text-xs`}>{NOMBRE_PARED[p].replace("Pared ", "").replace("del ", "")}</button>
              ))}
            </div>
            <Deslizador id="pared-largo" etiqueta="A lo largo de la pared" valor={c.aLoLargoCm} min={-Math.round(marcoDePared(sala, c.pared).largoCm / 2)} max={Math.round(marcoDePared(sala, c.pared).largoCm / 2)} paso={5} texto={m(c.aLoLargoCm)} onCambio={(v) => onNodo({ colocacion: { ...c, aLoLargoCm: v } })} />
            <Deslizador id="pared-altura" etiqueta="Altura del borde de abajo" valor={c.alturaCm} min={0} max={sala.altoCm} paso={5} texto={m(c.alturaCm)} onCambio={(v) => onNodo({ colocacion: { ...c, alturaCm: v } })} />
            <p className="text-[0.7rem] text-texto-suave">Su espalda queda pegada a la pared y su frente mira al salón.</p>
          </>
        )}
        {c.en === "techo" && (
          <>
            <Deslizador id="techo-x" etiqueta="Izquierda ↔ derecha" valor={c.xCm} min={-Math.round(sala.anchoCm / 2)} max={Math.round(sala.anchoCm / 2)} paso={5} texto={m(c.xCm)} onCambio={(v) => onNodo({ colocacion: { ...c, xCm: v } })} />
            <Deslizador id="techo-z" etiqueta="Fondo ↔ frente" valor={c.zCm} min={-Math.round(sala.fondoCm / 2)} max={Math.round(sala.fondoCm / 2)} paso={5} texto={m(c.zCm)} onCambio={(v) => onNodo({ colocacion: { ...c, zCm: v } })} />
            <Deslizador id="techo-cuelga" etiqueta="Cuánto cuelga (hilo)" valor={c.cuelgaCm} min={0} max={Math.max(0, sala.altoCm - 40)} paso={5} texto={m(c.cuelgaCm)} onCambio={(v) => onNodo({ colocacion: { ...c, cuelgaCm: v } })} />
            <Deslizador id="techo-giro" etiqueta="Giro" valor={c.giroGrados} min={-180} max={180} paso={5} texto={`${c.giroGrados}°`} onCambio={(v) => onNodo({ colocacion: { ...c, giroGrados: v } })} />
            <label className="flex items-center gap-2 text-sm text-texto" htmlFor="techo-volteada">
              <input id="techo-volteada" type="checkbox" checked={c.volteada} onChange={(e) => onNodo({ colocacion: { ...c, volteada: e.target.checked } })} /> Cabeza abajo (mirando al piso)
            </label>
          </>
        )}
        {c.en === "libre" && (
          <>
            <Deslizador id="libre-x" etiqueta="Izquierda ↔ derecha" valor={c.xCm} min={-Math.round(sala.anchoCm / 2)} max={Math.round(sala.anchoCm / 2)} paso={1} texto={m(c.xCm)} onCambio={(v) => onNodo({ colocacion: { ...c, xCm: v } })} />
            <Deslizador id="libre-y" etiqueta="Altura" valor={c.yCm} min={0} max={Math.round(sala.altoCm)} paso={1} texto={m(c.yCm)} onCambio={(v) => onNodo({ colocacion: { ...c, yCm: v } })} />
            <Deslizador id="libre-z" etiqueta="Fondo ↔ frente" valor={c.zCm} min={-Math.round(sala.fondoCm / 2)} max={Math.round(sala.fondoCm / 2)} paso={1} texto={m(c.zCm)} onCambio={(v) => onNodo({ colocacion: { ...c, zCm: v } })} />
            <Deslizador id="libre-giro" etiqueta="Giro" valor={c.giroGrados} min={-180} max={180} paso={5} texto={`${c.giroGrados}°`} onCambio={(v) => onNodo({ colocacion: { ...c, giroGrados: v } })} />
            <p className="text-[0.7rem] text-texto-suave">De frente al salón, pegada a lo que tenga delante o detrás (un racimo, un arco, la mesa).</p>
          </>
        )}
        {c.en === "sobre" && (
          <>
            <p className="text-xs text-texto">Sobre <b>«{escena.nodos.find((n) => n.id === c.padreId)?.nombre ?? "(pieza que ya no está)"}»</b>, apoyada en sus globos.</p>
            <Deslizador id="sobre-giro" etiqueta="Giro sobre sí misma" valor={c.giroGrados} min={-180} max={180} paso={5} texto={`${c.giroGrados}°`} onCambio={(v) => onNodo({ colocacion: { ...c, giroGrados: v } })} />
            <p className="text-[0.7rem] text-texto-suave">Arrástrala en el visor por la superficie (o a otra pieza o pared). Con el teclado: flechas la deslizan, Q/E la giran, Supr la quita.</p>
          </>
        )}
        {c.en === "ancla" && (() => {
          const anclas = armada.porNodo.find((x) => x.id === c.padreId)?.anclas.length ?? 0;
          return (
            <>
              <label htmlFor="ancla-padre" className="text-xs font-semibold text-texto">Colgada de</label>
              <select id="ancla-padre" value={c.padreId} onChange={(e) => onNodo({ colocacion: { ...c, padreId: e.target.value, ancla: 0 } })} className="min-h-11 rounded-lg bg-superficie-suave px-2 text-base text-texto ring-1 ring-borde lg:min-h-10 lg:text-sm">
                {padres.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                {!padres.some((p) => p.id === c.padreId) && <option value={c.padreId}>(pieza que ya no está)</option>}
              </select>
              {anclas > 0 && (
                <>
                  <Deslizador id="ancla-indice" etiqueta="Ancla" valor={Math.min(c.ancla, anclas - 1)} min={0} max={anclas - 1} paso={1} texto={`${Math.min(c.ancla, anclas - 1) + 1} de ${anclas}`} onCambio={(v) => onNodo({ colocacion: { ...c, ancla: v } })} />
                  <Deslizador id="ancla-cada" etiqueta="Repetir" valor={c.cada} min={0} max={Math.min(anclas, 40)} paso={1} texto={c.cada === 0 ? "solo en esa" : `1 de cada ${c.cada} (${hecho?.copias ?? 0})`} onCambio={(v) => onNodo({ colocacion: { ...c, cada: v } })} />
                </>
              )}
              <Deslizador id="ancla-giro" etiqueta="Giro sobre sí misma" valor={c.giroGrados} min={-180} max={180} paso={5} texto={`${c.giroGrados}°`} onCambio={(v) => onNodo({ colocacion: { ...c, giroGrados: v } })} />
              <p className="text-[0.7rem] text-texto-suave">Los puntos morados del visor son las anclas de esa pieza: ahí se amarra.</p>
            </>
          );
        })()}
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------------------------------------
// Propiedades de cada tipo de pieza
// ----------------------------------------------------------------------------------------------------------

/** Colores por puesto de un patrón (1, 2 o 4): toca un puesto y elige su color. */
export function ColoresPorPuesto({ id, formatoId, colores, cantidad, onColores }: { id: string; formatoId: string; colores: readonly string[]; cantidad: number; onColores: (c: string[]) => void }) {
  const [puesto, setPuesto] = useState(0);
  const lista = Array.from({ length: cantidad }, (_, i) => colores[i] ?? colores[0] ?? "005");
  const elegido = Math.min(puesto, cantidad - 1);
  return (
    <div className="flex flex-col gap-1">
      {cantidad > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {lista.map((codigo, i) => {
            const ref = coloresDelFormato(formatoId).find((x) => x.codigo === codigo);
            return (
              <button key={i} type="button" onClick={() => setPuesto(i)} aria-pressed={elegido === i} aria-label={`Color ${i + 1}: ${ref?.nombreCompleto ?? codigo}`} title={`Color ${i + 1}: ${ref?.nombreCompleto ?? codigo}`}
                className={`grid size-11 place-items-center rounded-full font-mono text-[0.65rem] ring-2 lg:size-8 ring-offset-1 ring-offset-superficie ${elegido === i ? "ring-acento" : "ring-borde"}`}
                style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
            );
          })}
          <span className="text-[0.7rem] text-texto-suave">Elige el puesto y luego su color.</span>
        </div>
      )}
      <SelectorColor formatoId={formatoId} valor={lista[elegido]!} onCambio={(codigo) => onColores(lista.map((x, i) => (i === elegido ? codigo : x)))} etiqueta={`${id}: color ${elegido + 1}`} />
    </div>
  );
}

/** Formato de una trenza: ajusta el inflado y deja solo colores que se fabrican en él. */
export function conFormatoTrenza<T extends { formatoId: string; infladoCm: number; colores: string[] }>(p: T, formatoId: string): T {
  const formato = formatoPorId(formatoId);
  if (!formato) return p;
  const disponibles = coloresDelFormato(formatoId);
  return { ...p, formatoId, infladoCm: formato.infladoDecoracionCm, colores: p.colores.map((c) => (disponibles.some((d) => d.codigo === c) ? c : disponibles[0]?.codigo ?? c)) };
}

function Trenza({ id, formatoId, patron, colores, formatos, onFormato, onPatron, onColores }: {
  id: string; formatoId: string; patron: PatronColumna; colores: string[]; formatos: readonly string[];
  onFormato: (f: string) => void; onPatron: (p: PatronColumna, colores: string[]) => void; onColores: (c: string[]) => void;
}) {
  // La trenza recorre todos los colores que recibe: al cambiar de patrón se dejan justo los que pide.
  const ajustar = (n: number) => Array.from({ length: n }, (_, i) => colores[i] ?? ["005", "570", "009", "640"][i - colores.length] ?? "005");
  const datos = PATRONES_COLUMNA.find((p) => p.id === patron) ?? PATRONES_COLUMNA[0]!;
  return (
    <>
      <div className="grid grid-cols-4 gap-1">
        {formatos.map((f) => <button key={f} type="button" onClick={() => onFormato(f)} aria-pressed={f === formatoId} className={`${BOTON} ${f === formatoId ? ACTIVO : INACTIVO} text-xs`}>{f}</button>)}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {PATRONES_COLUMNA.map((p) => (
          <button key={p.id} type="button" title={p.descripcion} onClick={() => onPatron(p.id, ajustar(p.colores))}
            aria-pressed={p.id === patron} className={`${BOTON} ${p.id === patron ? ACTIVO : INACTIVO} text-xs`}>{p.nombre}</button>
        ))}
      </div>
      <ColoresPorPuesto id={id} formatoId={formatoId} colores={colores} cantidad={datos.colores} onColores={onColores} />
    </>
  );
}

/** Propiedades de una pieza por su tipo (lo que no tiene un editor propio en el editor solitario). */
export function EditorPieza({ pieza, onPieza }: { pieza: Pieza; onPieza: (p: Pieza) => void }) {
  return (
    <section className={TARJETA} aria-label="Propiedades de la pieza">
      <h2 className="text-sm font-semibold text-texto">{NOMBRE_TIPO[pieza.tipo]}</h2>
      {pieza.tipo === "columna" && (
        <>
          <Deslizador id="col-alto" etiqueta="Altura" valor={pieza.alturaCm} min={60} max={300} paso={5} texto={m(pieza.alturaCm)} onCambio={(v) => onPieza({ ...pieza, alturaCm: v })} />
          <Trenza id="Columna" formatoId={pieza.formatoId} patron={pieza.patron} colores={pieza.colores} formatos={["R-5", "R-9", "R-12", "R-18"]}
            onFormato={(f) => onPieza(conFormatoTrenza(pieza, f))} onPatron={(patron, colores) => onPieza({ ...pieza, patron, colores })} onColores={(colores) => onPieza({ ...pieza, colores })} />
        </>
      )}
      {pieza.tipo === "arco" && (
        <>
          <div className="grid grid-cols-3 gap-1">
            {FORMAS_ARCO.map((f) => <button key={f.id} type="button" title={f.descripcion} onClick={() => onPieza({ ...pieza, forma: f.id })} aria-pressed={f.id === pieza.forma} className={`${BOTON} ${f.id === pieza.forma ? ACTIVO : INACTIVO} text-xs`}>{f.nombre}</button>)}
          </div>
          <Deslizador id="arco-ancho" etiqueta="Ancho" valor={pieza.anchoCm} min={100} max={500} paso={10} texto={m(pieza.anchoCm)} onCambio={(v) => onPieza({ ...pieza, anchoCm: v })} />
          <Deslizador id="arco-alto" etiqueta="Alto" valor={pieza.altoCm} min={100} max={350} paso={10} texto={m(pieza.altoCm)} onCambio={(v) => onPieza({ ...pieza, altoCm: v })} />
          <Trenza id="Arco" formatoId={pieza.formatoId} patron={pieza.patron} colores={pieza.colores} formatos={["R-5", "R-9", "R-12", "R-18"]}
            onFormato={(f) => onPieza(conFormatoTrenza(pieza, f))} onPatron={(patron, colores) => onPieza({ ...pieza, patron, colores })} onColores={(colores) => onPieza({ ...pieza, colores })} />
        </>
      )}
      {pieza.tipo === "guirnalda" && (() => {
        const g = pieza.guirnalda;
        const pon = (cambio: Partial<typeof g>) => onPieza({ ...pieza, guirnalda: { ...g, ...cambio } });
        return (
          <>
            {g.recorrido ? <p className="text-[0.7rem] text-texto-suave">Sigue una curva libre: el ancho y la caída no aplican.</p> : (
              <>
                <Deslizador id="gui-ancho" etiqueta="Largo (de punta a punta)" valor={g.anchoCm} min={100} max={800} paso={10} texto={m(g.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
                <Deslizador id="gui-caida" etiqueta="Caída en el medio" valor={g.caidaCm} min={0} max={150} paso={5} texto={g.caidaCm === 0 ? "recta" : m(g.caidaCm)} onCambio={(v) => pon({ caidaCm: v })} />
              </>
            )}
            <Trenza id="Guirnalda" formatoId={g.formatoId} patron={g.patron} colores={g.colores} formatos={["R-5", "R-9", "R-12"]}
              onFormato={(f) => pon(conFormatoTrenza(g, f))} onPatron={(patron, colores) => pon({ patron, colores })} onColores={(colores) => pon({ colores })} />
          </>
        );
      })()}
      {pieza.tipo === "arco_organico" && <EditorArcoOrganico pieza={pieza} onPieza={onPieza} />}
      {pieza.tipo === "pared_malla" && (() => {
        const datos = PATRONES_MALLA.find((p) => p.id === pieza.patron) ?? PATRONES_MALLA[0]!;
        return (
          <>
            <Deslizador id="malla-ancho" etiqueta="Ancho" valor={pieza.anchoCm} min={100} max={600} paso={10} texto={m(pieza.anchoCm)} onCambio={(v) => onPieza({ ...pieza, anchoCm: v })} />
            <Deslizador id="malla-alto" etiqueta="Alto" valor={pieza.altoCm} min={100} max={300} paso={10} texto={m(pieza.altoCm)} onCambio={(v) => onPieza({ ...pieza, altoCm: v })} />
            <div className="grid grid-cols-2 gap-1">
              {PATRONES_MALLA.map((p) => <button key={p.id} type="button" title={p.descripcion} onClick={() => onPieza({ ...pieza, patron: p.id, colores: Array.from({ length: p.colores }, (_, i) => pieza.colores[i] ?? ["005", "650", "012", "009"][i] ?? "005") })} aria-pressed={p.id === pieza.patron} className={`${BOTON} ${p.id === pieza.patron ? ACTIVO : INACTIVO} text-xs`}>{p.nombre}</button>)}
            </div>
            <ColoresPorPuesto id="Pared" formatoId={pieza.formatoId} colores={pieza.colores} cantidad={datos.colores} onColores={(colores) => onPieza({ ...pieza, colores })} />
          </>
        );
      })()}
      {pieza.tipo === "pared_trenzas" && (
        <>
          <Deslizador id="trenzas-ancho" etiqueta="Ancho" valor={pieza.opciones.anchoCm} min={100} max={600} paso={10} texto={m(pieza.opciones.anchoCm)} onCambio={(v) => onPieza({ ...pieza, opciones: { ...pieza.opciones, anchoCm: v } })} />
          <Deslizador id="trenzas-alto" etiqueta="Alto" valor={pieza.opciones.altoCm} min={100} max={300} paso={10} texto={m(pieza.opciones.altoCm)} onCambio={(v) => onPieza({ ...pieza, opciones: { ...pieza.opciones, altoCm: v } })} />
          <p className="text-[0.7rem] text-texto-suave">Sus colores se cambian con «Colores de la escena».</p>
        </>
      )}
      {pieza.tipo === "decoracion" && (
        <>
          <div className="grid grid-cols-2 gap-1">
            {DECORACIONES_PREDEFINIDAS.map((d) => {
              const activa = JSON.stringify(d.decoracion) === JSON.stringify(pieza.decoracion);
              return <button key={d.id} type="button" title={d.descripcion} onClick={() => onPieza({ tipo: "decoracion", decoracion: structuredClone(d.decoracion) })} aria-pressed={activa} className={`${BOTON} ${activa ? ACTIVO : INACTIVO} py-1 text-xs`}>{d.nombre}</button>;
            })}
          </div>
          <p className="text-[0.7rem] text-texto-suave">Para cambiar sus colores usa «Colores de la escena»; para afinar pétalos y lazos, «Editar sola».</p>
        </>
      )}
      {pieza.tipo === "organico" && <p className="text-[0.7rem] text-texto-suave">Pieza orgánica armada: muévela con «Lugar» y cambia sus colores con «Colores de la escena».</p>}
      {(pieza.tipo === "forma" || pieza.tipo === "letras" || pieza.tipo === "metalizado" || pieza.tipo === "mural" || pieza.tipo === "techo" || pieza.tipo === "arbol_globos") && (
        <p className="text-[0.7rem] text-texto-suave">Pieza armada desde una idea o un modelo: muévela con «Lugar», cambia sus colores con «Colores de la pieza» o pídele a la IA que la cambie («haz las letras de 1 m»).</p>
      )}
      {pieza.tipo === "globo" && <p className="text-[0.7rem] text-texto-suave">Un {pieza.formatoId} suelto de {m(pieza.infladoCm)}: cambia su color con «Colores de la escena».</p>}
      {esMuebleEditable(pieza) && <EditorMueble pieza={pieza} onPieza={onPieza} />}
      {esRotulable(pieza) && !esMuebleEditable(pieza) && <EditorRotulo pieza={pieza} onPieza={onPieza} />}
      {pieza.tipo === "escenografia" && !esMuebleEditable(pieza) && (pieza.productos?.length
        ? <p className="text-[0.7rem] text-texto-suave">Utilería de fiesta (no es globo): {pieza.productos.map((p) => `${p.cantidad} × ${p.nombre}${p.variante ? ` (${p.variante})` : ""}`).join(", ")}. Sale en «Productos de fiesta» de la lista de compra; muévela con «Lugar».</p>
        : <p className="text-[0.7rem] text-texto-suave">Escenografía (no son globos ni cuentan en los materiales): muévela con «Lugar».</p>)}
    </section>
  );
}

export function EditorArcoOrganico({ pieza, onPieza }: { pieza: Extract<Pieza, { tipo: "arco_organico" }>; onPieza: (p: Pieza) => void }) {
  const a = pieza.arco;
  const pon = (cambio: Partial<typeof a>) => onPieza({ ...pieza, arco: { ...a, ...cambio } });
  const ponColor = (i: number, cambio: Partial<ColorOrganico>) => pon({ colores: a.colores.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });
  const totalPeso = a.colores.reduce((s, c) => s + c.peso, 0) || 1;
  return (
    <>
      <Deslizador id="aorg-ancho" etiqueta="Ancho entre patas" valor={a.anchoCm} min={150} max={500} paso={10} texto={m(a.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
      <Deslizador id="aorg-alto" etiqueta="Alto" valor={a.altoCm} min={150} max={320} paso={10} texto={m(a.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
      <Deslizador id="aorg-base" etiqueta="Grosor en las patas" valor={a.radioBaseCm} min={22} max={55} paso={1} texto={`${Math.round(a.radioBaseCm * 2)} cm`} onCambio={(v) => pon({ radioBaseCm: v, radioPuntaCm: Math.min(a.radioPuntaCm, v) })} />
      <Deslizador id="aorg-punta" etiqueta="Grosor arriba" valor={a.radioPuntaCm} min={16} max={a.radioBaseCm} paso={1} texto={`${Math.round(a.radioPuntaCm * 2)} cm`} onCambio={(v) => pon({ radioPuntaCm: v })} />
      <Deslizador id="aorg-densidad" etiqueta="Densidad" valor={a.densidad} min={0.8} max={1.3} paso={0.05} texto={`${Math.round(a.densidad * 100)} %`} onCambio={(v) => pon({ densidad: v })} />
      <Deslizador id="aorg-semilla" etiqueta="Variante (azar)" valor={a.semilla} min={1} max={40} paso={1} texto={`#${a.semilla}`} onCambio={(v) => pon({ semilla: v })} />
      <label className="flex items-center gap-2 text-sm text-texto" htmlFor="aorg-flores">
        <input id="aorg-flores" type="checkbox" checked={Boolean(a.flores)} onChange={(e) => pon(e.target.checked ? { flores: structuredClone(COLUMNA_QUINCE_AZUL.flores), huecosFlores: 14 } : { flores: null, huecosFlores: 0 })} /> Flores artificiales en los huecos
      </label>
      <h3 className="text-xs font-semibold text-texto">Mezcla de colores</h3>
      {a.colores.map((c, i) => <ColorDelArco key={i} indice={i} color={c} porcentaje={Math.round((c.peso / totalPeso) * 100)} onCambio={(cambio) => ponColor(i, cambio)} />)}
      <p className="text-[0.7rem] text-texto-suave">Cada cambio rearma el arco (tarda medio segundo).</p>
    </>
  );
}

/**
 * Un color de la mezcla del arco orgánico, plegado. Lo de dentro (el peso y los ~70 colores) se pinta solo al abrirlo:
 * así elegir el arco en la escena no pinta cientos de botones que no se ven.
 */
function ColorDelArco({ indice, color, porcentaje, onCambio }: { indice: number; color: ColorOrganico; porcentaje: number; onCambio: (cambio: Partial<ColorOrganico>) => void }) {
  const [abierto, setAbierto] = useState(false);
  const ref = coloresDelFormato("R-12").find((x) => x.codigo === color.codigo);
  return (
    <details className="group rounded-xl bg-superficie-suave p-2" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-texto [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-90" aria-hidden />
        <span className="size-5 rounded-full ring-1 ring-borde" style={{ background: ref?.hexGlobo }} />
        {ref?.nombreCompleto ?? color.codigo}
        <span className="ml-auto font-mono text-xs text-texto-suave">{porcentaje} %</span>
      </summary>
      {abierto && (
        <div className="mt-2 flex flex-col gap-2">
          <Deslizador id={`aorg-peso-${indice}`} etiqueta="Peso" valor={color.peso} min={0} max={80} paso={1} texto={`${color.peso}`} onCambio={(v) => onCambio({ peso: v })} />
          <SelectorColor formatoId="R-12" valor={color.codigo} onCambio={(codigo) => onCambio({ codigo })} etiqueta={`Color ${indice + 1} del arco`} />
        </div>
      )}
    </details>
  );
}

// ----------------------------------------------------------------------------------------------------------
// Sala
// ----------------------------------------------------------------------------------------------------------

/** La sala: medidas, qué superficies se ven y sus tonos. `plegable`: dentro de un «details» (si no, abierta). */
export function EditorSala({ sala, onSala, plegable = true }: { sala: Sala; onSala: (s: Sala) => void; plegable?: boolean }) {
  const pon = (cambio: Partial<Sala>) => onSala({ ...sala, ...cambio });
  const verSuperficie = (clave: keyof Sala["mostrar"], etiqueta: string) => (
    <label key={clave} className="flex items-center gap-2 text-sm text-texto" htmlFor={`sala-${clave}`}>
      <input id={`sala-${clave}`} type="checkbox" checked={sala.mostrar[clave]} onChange={(e) => pon({ mostrar: { ...sala.mostrar, [clave]: e.target.checked } })} /> {etiqueta}
    </label>
  );
  const tono = (clave: keyof Sala["tonos"], etiqueta: string) => (
    <label key={clave} className="flex flex-col items-center gap-1 text-[0.7rem] text-texto-suave" htmlFor={`tono-${clave}`}>
      <input id={`tono-${clave}`} type="color" value={sala.tonos[clave]} onChange={(e) => pon({ tonos: { ...sala.tonos, [clave]: e.target.value } })} className="h-9 w-12 cursor-pointer rounded-lg ring-1 ring-borde" />
      {etiqueta}
    </label>
  );
  const contenido = (
    <div className="flex flex-col gap-3">
      <Deslizador id="sala-ancho" etiqueta="Ancho" valor={sala.anchoCm} min={300} max={SALA_MAXIMA_CM.ancho} paso={20} texto={m(sala.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
      <Deslizador id="sala-fondo" etiqueta="Fondo" valor={sala.fondoCm} min={300} max={SALA_MAXIMA_CM.fondo} paso={20} texto={m(sala.fondoCm)} onCambio={(v) => pon({ fondoCm: v })} />
      <Deslizador id="sala-alto" etiqueta="Alto (al techo)" valor={sala.altoCm} min={240} max={SALA_MAXIMA_CM.alto} paso={10} texto={m(sala.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-semibold text-texto">Qué se ve</legend>
        <div className="grid grid-cols-2 gap-1">
          {verSuperficie("piso", "Piso")}
          {verSuperficie("fondo", "Pared del fondo")}
          {verSuperficie("laterales", "Paredes laterales")}
          {verSuperficie("techo", "Techo")}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs font-semibold text-texto">Tonos</legend>
        <div className="flex gap-3">{tono("piso", "Piso")}{tono("paredes", "Paredes")}{tono("techo", "Techo")}</div>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-semibold text-texto">Ambiente</legend>
        <div className="grid grid-cols-2 gap-1">
          <label className="flex items-center gap-2 text-sm text-texto" htmlFor="sala-madera">
            <input id="sala-madera" type="checkbox" checked={sala.ambiente?.piso === "madera"} onChange={(e) => pon({ ambiente: { ...sala.ambiente, piso: e.target.checked ? "madera" : "liso" } })} /> Piso de madera
          </label>
          <label className="flex items-center gap-2 text-sm text-texto" htmlFor="sala-luces">
            <input id="sala-luces" type="checkbox" checked={sala.ambiente?.luces ?? false} onChange={(e) => pon({ ambiente: { ...sala.ambiente, luces: e.target.checked } })} /> Luces del techo (y luz cálida)
          </label>
          <label className="flex items-center gap-2 text-sm text-texto" htmlFor="sala-ventana">
            <input id="sala-ventana" type="checkbox" checked={sala.ambiente?.ventana ?? false} disabled={!sala.mostrar.laterales} onChange={(e) => pon({ ambiente: { ...sala.ambiente, ventana: e.target.checked } })} /> Ventana a la derecha{!sala.mostrar.laterales && <span className="text-[0.7rem] text-texto-suave"> (pide paredes laterales)</span>}
          </label>
        </div>
      </fieldset>
      <p className="flex items-start gap-1 text-[0.7rem] text-texto-suave"><ArrowDownToLine className="mt-0.5 size-3 shrink-0" aria-hidden /> Al girar la cámara por detrás de una pared o por encima del techo, esa superficie se oculta sola para que veas dentro.</p>
    </div>
  );
  if (!plegable) return contenido;
  return (
    <details className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-texto"><PanelTop className="size-4 text-acento" aria-hidden /> Sala <span className="font-normal text-texto-suave">· {m(sala.anchoCm)} × {m(sala.fondoCm)} × {m(sala.altoCm)}</span></summary>
      <div className="mt-2">{contenido}</div>
    </details>
  );
}
