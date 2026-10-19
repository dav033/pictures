"use client";

import { useState, type ReactNode } from "react";
import { coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import type { ParteGlobo } from "@/lib/globos3d/decoraciones";
import type { AnilloTubito, PropiedadesEstrella, PropiedadesFlorCorazones, PropiedadesFlorTubito, PropiedadesMono } from "@/lib/globos3d/figuras";
import { ACTIVO, BOTON, Deslizador, FORMATOS_CENTRO, INACTIVO, SelectorColor, cm, conFormato } from "./PanelFlor";

/**
 * Editores por propiedades de las decoraciones de tubito y de corazón (flor de tubito, moño, estrella, flor de
 * corazones). Cada uno edita solo el «qué es»; el «dónde va» lo pone `PanelDecoracion`.
 */
const FORMATOS_TUBITO = ["T-160", "T-260", "T-360"] as const;

/** Un color que exista en el formato nuevo (el mismo si se fabrica, si no el primero de la tabla). */
function colorEn(formatoId: string, codigo: string): string {
  const colores = coloresDelFormato(formatoId);
  return colores.some((c) => c.codigo === codigo) ? codigo : colores[0]?.codigo ?? codigo;
}

function Seccion({ titulo, children }: { titulo: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
      <h2 className="text-sm font-semibold text-texto">{titulo}</h2>
      {children}
    </section>
  );
}

function Botonera<T extends string | number>({ opciones, valor, onCambio, columnas = 3 }: { opciones: ReadonlyArray<readonly [T, string]>; valor: T; onCambio: (v: T) => void; columnas?: number }) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
      {opciones.map(([v, etiqueta]) => (
        <button key={String(v)} type="button" onClick={() => onCambio(v)} aria-pressed={valor === v} className={`${BOTON} ${valor === v ? ACTIVO : INACTIVO}`}>{etiqueta}</button>
      ))}
    </div>
  );
}

/** Formato de tubito y su grosor de inflado (hasta el máximo del formato). */
function GrosorTubito({ id, formatoId, grosorCm, onCambio }: { id: string; formatoId: string; grosorCm: number; onCambio: (formatoId: string, grosorCm: number) => void }) {
  const f = formatoPorId(formatoId) ?? formatoPorId("T-260")!;
  return (
    <>
      <Botonera opciones={FORMATOS_TUBITO.map((t) => [t, t] as const)} valor={formatoId as (typeof FORMATOS_TUBITO)[number]} onCambio={(t) => onCambio(t, Math.min(formatoPorId(t)!.diametroMaxCm, Math.max(formatoPorId(t)!.diametroMaxCm * 0.5, grosorCm)))} />
      <Deslizador id={`${id}-grosor`} etiqueta="Grosor del tubito" valor={grosorCm} min={Math.round(f.diametroMaxCm * 0.5 * 2) / 2} max={f.diametroMaxCm} paso={0.5} texto={cm(grosorCm)} onCambio={(v) => onCambio(formatoId, v)} />
    </>
  );
}

/** Un globito suelto (centro): formato R-5/R-9, inflado y color; con casilla para quitarlo. */
export function EditorGloboSuelto({ id, titulo, parte, onParte, porDefecto }: { id: string; titulo: string; parte: ParteGlobo | null; onParte: (p: ParteGlobo | null) => void; porDefecto: ParteGlobo }) {
  const f = parte ? formatoPorId(parte.formatoId) : undefined;
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
      <label className="flex items-center gap-2 text-sm font-semibold text-texto" htmlFor={`${id}-con`}>
        <input id={`${id}-con`} type="checkbox" checked={Boolean(parte)} onChange={(e) => onParte(e.target.checked ? porDefecto : null)} />
        {titulo}
      </label>
      {parte && f && (
        <>
          <Botonera opciones={FORMATOS_CENTRO.map((t) => [t, t] as const)} valor={parte.formatoId as (typeof FORMATOS_CENTRO)[number]} onCambio={(t) => onParte(conFormato(parte, t))} columnas={2} />
          <Deslizador id={`${id}-inflado`} etiqueta="Inflado" valor={parte.infladoCm} min={Math.round(f.diametroMaxCm * 0.4)} max={f.diametroMaxCm} paso={0.5} texto={cm(parte.infladoCm)} onCambio={(v) => onParte({ ...parte, infladoCm: v })} />
          <SelectorColor formatoId={parte.formatoId} valor={parte.codigo} onCambio={(codigo) => onParte({ ...parte, codigo })} etiqueta={`Color: ${titulo.toLowerCase()}`} />
        </>
      )}
    </section>
  );
}

/** Corona de globitos (anillo alrededor del centro), con casilla para quitarla. */
function EditorCorona({ id, corona, onCorona }: { id: string; corona: (ParteGlobo & { cantidad: number }) | null; onCorona: (c: (ParteGlobo & { cantidad: number }) | null) => void }) {
  const f = corona ? formatoPorId(corona.formatoId) : undefined;
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
      <label className="flex items-center gap-2 text-sm font-semibold text-texto" htmlFor={`${id}-con`}>
        <input id={`${id}-con`} type="checkbox" checked={Boolean(corona)} onChange={(e) => onCorona(e.target.checked ? { formatoId: "R-5", infladoCm: 8, codigo: "968", cantidad: 6 } : null)} />
        Corona <span className="font-normal text-texto-suave">(globitos alrededor del centro)</span>
      </label>
      {corona && f && (
        <>
          <Deslizador id={`${id}-cantidad`} etiqueta="Cantidad" valor={corona.cantidad} min={3} max={8} paso={1} texto={`${corona.cantidad} globitos`} onCambio={(v) => onCorona({ ...corona, cantidad: v })} />
          <Deslizador id={`${id}-inflado`} etiqueta="Inflado" valor={corona.infladoCm} min={Math.round(f.diametroMaxCm * 0.4)} max={f.diametroMaxCm} paso={0.5} texto={cm(corona.infladoCm)} onCambio={(v) => onCorona({ ...corona, infladoCm: v })} />
          <SelectorColor formatoId={corona.formatoId} valor={corona.codigo} onCambio={(codigo) => onCorona({ ...corona, codigo })} etiqueta="Color de la corona" />
        </>
      )}
    </section>
  );
}

/** Colores en ciclo (pétalo a pétalo): de 1 a 4 puestos, cada uno con su color del formato. */
function CicloColores({ formatoId, codigos, onCodigos, etiqueta }: { formatoId: string; codigos: string[]; onCodigos: (c: string[]) => void; etiqueta: string }) {
  const [puesto, setPuesto] = useState(0);
  const valido = Math.min(puesto, codigos.length - 1);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {codigos.map((codigo, i) => {
          const ref = coloresDelFormato(formatoId).find((c) => c.codigo === codigo);
          return (
            <button key={i} type="button" onClick={() => setPuesto(i)} aria-pressed={valido === i} aria-label={`${etiqueta} ${i + 1}: ${ref?.nombreCompleto ?? codigo}`} title={`${etiqueta} ${i + 1}: ${ref?.nombreCompleto ?? codigo}`}
              className={`grid size-11 place-items-center rounded-full font-mono text-xs ring-2 lg:size-9 ring-offset-2 ring-offset-superficie ${valido === i ? "ring-acento" : "ring-borde"}`}
              style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
          );
        })}
        {codigos.length < 4 && <button type="button" onClick={() => { onCodigos([...codigos, codigos[codigos.length - 1] ?? "009"]); setPuesto(codigos.length); }} className={`${BOTON} ${INACTIVO} min-h-11 px-3 lg:min-h-9`} aria-label="Añadir un color al ciclo">+</button>}
        {codigos.length > 1 && <button type="button" onClick={() => { onCodigos(codigos.slice(0, -1)); setPuesto(0); }} className={`${BOTON} ${INACTIVO} min-h-11 px-3 lg:min-h-9`} aria-label="Quitar el último color del ciclo">−</button>}
      </div>
      <SelectorColor formatoId={formatoId} valor={codigos[valido] ?? ""} onCambio={(codigo) => onCodigos(codigos.map((c, i) => (i === valido ? codigo : c)))} etiqueta={`${etiqueta} ${valido + 1}`} />
    </>
  );
}

/** Anillo de pétalos de tubito: estilo, cantidad, largo, ancho, grosor, apertura, giro y colores en ciclo. */
export function EditorAnilloTubito({ id, titulo, anillo, onAnillo }: { id: string; titulo: string; anillo: AnilloTubito; onAnillo: (a: AnilloTubito) => void }) {
  const pon = (cambio: Partial<AnilloTubito>) => onAnillo({ ...anillo, ...cambio });
  return (
    <Seccion titulo={titulo}>
      <Botonera opciones={[["lazo", "En lazo"], ["burbuja", "En burbuja"]] as const} valor={anillo.estilo} onCambio={(estilo) => pon({ estilo })} columnas={2} />
      <Deslizador id={`${id}-cantidad`} etiqueta="Pétalos" valor={anillo.cantidad} min={2} max={12} paso={1} texto={`${anillo.cantidad}`} onCambio={(v) => pon({ cantidad: v })} />
      <GrosorTubito id={id} formatoId={anillo.formatoId} grosorCm={anillo.grosorCm} onCambio={(formatoId, grosorCm) => pon({ formatoId, grosorCm, codigos: anillo.codigos.map((c) => colorEn(formatoId, c)) })} />
      <Deslizador id={`${id}-largo`} etiqueta="Largo del pétalo" valor={anillo.largoCm} min={3} max={30} paso={0.5} texto={cm(anillo.largoCm)} onCambio={(v) => pon({ largoCm: v })} />
      {anillo.estilo === "lazo" && <Deslizador id={`${id}-ancho`} etiqueta="Ancho del lazo" valor={anillo.anchoCm} min={2} max={20} paso={0.5} texto={cm(anillo.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />}
      <Deslizador id={`${id}-apertura`} etiqueta="Apertura" valor={anillo.aperturaGrados} min={0} max={60} paso={1} texto={`${anillo.aperturaGrados}°`} onCambio={(v) => pon({ aperturaGrados: v })} />
      <Deslizador id={`${id}-giro`} etiqueta="Giro" valor={anillo.giroGrados} min={0} max={360} paso={5} texto={`${anillo.giroGrados}°`} onCambio={(v) => pon({ giroGrados: v })} />
      <CicloColores formatoId={anillo.formatoId} codigos={anillo.codigos} onCodigos={(codigos) => pon({ codigos })} etiqueta="Color del pétalo" />
    </Seccion>
  );
}

const INTERIOR_POR_DEFECTO: AnilloTubito = { formatoId: "T-260", grosorCm: 3, codigos: ["009"], cantidad: 5, estilo: "lazo", largoCm: 7, anchoCm: 5, aperturaGrados: 4, giroGrados: 36 };
const CENTRO_POR_DEFECTO: ParteGlobo = { formatoId: "R-5", infladoCm: 7, codigo: "968" };

function Interior({ id, interior, onInterior }: { id: string; interior: AnilloTubito | null; onInterior: (a: AnilloTubito | null) => void }) {
  return (
    <>
      <label className="flex items-center gap-2 rounded-2xl bg-superficie p-3 text-sm font-semibold text-texto ring-1 ring-borde" htmlFor={`${id}-con`}>
        <input id={`${id}-con`} type="checkbox" checked={Boolean(interior)} onChange={(e) => onInterior(e.target.checked ? INTERIOR_POR_DEFECTO : null)} />
        Anillo interior <span className="font-normal text-texto-suave">(lazos de tubito encima)</span>
      </label>
      {interior && <EditorAnilloTubito id={id} titulo="Anillo interior" anillo={interior} onAnillo={onInterior} />}
    </>
  );
}

export function EditorFlorTubito({ valor, onCambio }: { valor: PropiedadesFlorTubito; onCambio: (v: PropiedadesFlorTubito) => void }) {
  return (
    <>
      <EditorAnilloTubito id="ft-petalos" titulo="Pétalos de tubito" anillo={valor.petalos} onAnillo={(petalos) => onCambio({ ...valor, petalos })} />
      <Interior id="ft-interior" interior={valor.interior} onInterior={(interior) => onCambio({ ...valor, interior })} />
      <EditorCorona id="ft-corona" corona={valor.corona} onCorona={(corona) => onCambio({ ...valor, corona })} />
      <EditorGloboSuelto id="ft-centro" titulo="Centro" parte={valor.centro} onParte={(centro) => onCambio({ ...valor, centro })} porDefecto={CENTRO_POR_DEFECTO} />
    </>
  );
}

export function EditorMono({ valor, onCambio }: { valor: PropiedadesMono; onCambio: (v: PropiedadesMono) => void }) {
  const pon = (cambio: Partial<PropiedadesMono>) => onCambio({ ...valor, ...cambio });
  return (
    <>
      <Seccion titulo="Moño de tubito">
        <GrosorTubito id="mono" formatoId={valor.formatoId} grosorCm={valor.grosorCm} onCambio={(formatoId, grosorCm) => pon({ formatoId, grosorCm, codigo: colorEn(formatoId, valor.codigo) })} />
        <Deslizador id="mono-lazos" etiqueta="Lazos por lado" valor={valor.lazosPorLado} min={1} max={3} paso={1} texto={`${valor.lazosPorLado}`} onCambio={(v) => pon({ lazosPorLado: v })} />
        <Deslizador id="mono-largo" etiqueta="Largo del lazo" valor={valor.largoLazoCm} min={6} max={35} paso={0.5} texto={cm(valor.largoLazoCm)} onCambio={(v) => pon({ largoLazoCm: v })} />
        <Deslizador id="mono-ancho" etiqueta="Ancho del lazo" valor={valor.anchoLazoCm} min={3} max={25} paso={0.5} texto={cm(valor.anchoLazoCm)} onCambio={(v) => pon({ anchoLazoCm: v })} />
        {valor.lazosPorLado > 1 && <Deslizador id="mono-abertura" etiqueta="Abanico entre lazos" valor={valor.aberturaGrados} min={10} max={70} paso={1} texto={`${valor.aberturaGrados}°`} onCambio={(v) => pon({ aberturaGrados: v })} />}
        <label className="flex items-center gap-2 text-sm text-texto" htmlFor="mono-colas">
          <input id="mono-colas" type="checkbox" checked={valor.colas} onChange={(e) => pon({ colas: e.target.checked })} /> Colas
        </label>
        {valor.colas && <Deslizador id="mono-cola" etiqueta="Largo de las colas" valor={valor.largoColaCm} min={5} max={40} paso={0.5} texto={cm(valor.largoColaCm)} onCambio={(v) => pon({ largoColaCm: v })} />}
        <SelectorColor formatoId={valor.formatoId} valor={valor.codigo} onCambio={(codigo) => pon({ codigo })} etiqueta="Color del moño" />
      </Seccion>
      <EditorGloboSuelto id="mono-centro" titulo="Globito al centro" parte={valor.centro} onParte={(centro) => pon({ centro })} porDefecto={{ formatoId: "R-5", infladoCm: 7, codigo: "009" }} />
    </>
  );
}

export function EditorEstrella({ valor, onCambio }: { valor: PropiedadesEstrella; onCambio: (v: PropiedadesEstrella) => void }) {
  const pon = (cambio: Partial<PropiedadesEstrella>) => onCambio({ ...valor, ...cambio });
  return (
    <>
      <Seccion titulo="Estrella de tubito">
        <Botonera opciones={[["rayos", "Rayos con perilla"], ["contorno", "Contorno"]] as const} valor={valor.estilo} onCambio={(estilo) => pon({ estilo })} columnas={2} />
        <Deslizador id="estrella-puntas" etiqueta="Puntas" valor={valor.puntas} min={3} max={8} paso={1} texto={`${valor.puntas}`} onCambio={(v) => pon({ puntas: v })} />
        <Deslizador id="estrella-radio" etiqueta="Radio" valor={valor.radioCm} min={6} max={40} paso={0.5} texto={cm(valor.radioCm)} onCambio={(v) => pon({ radioCm: v })} />
        <Deslizador id="estrella-giro" etiqueta="Giro" valor={valor.giroGrados} min={0} max={360} paso={5} texto={`${valor.giroGrados}°`} onCambio={(v) => pon({ giroGrados: v })} />
        <GrosorTubito id="estrella" formatoId={valor.formatoId} grosorCm={valor.grosorCm} onCambio={(formatoId, grosorCm) => pon({ formatoId, grosorCm, codigo: colorEn(formatoId, valor.codigo) })} />
        <SelectorColor formatoId={valor.formatoId} valor={valor.codigo} onCambio={(codigo) => pon({ codigo })} etiqueta="Color de la estrella" />
      </Seccion>
      <EditorGloboSuelto id="estrella-centro" titulo="Globito al centro" parte={valor.centro} onParte={(centro) => pon({ centro })} porDefecto={{ formatoId: "R-5", infladoCm: 6, codigo: "970" }} />
    </>
  );
}

const FORMATOS_CORAZON = ["C-6", "C-12"] as const;

export function EditorFlorCorazones({ valor, onCambio }: { valor: PropiedadesFlorCorazones; onCambio: (v: PropiedadesFlorCorazones) => void }) {
  const { corazones } = valor;
  const f = formatoPorId(corazones.formatoId) ?? formatoPorId("C-6")!;
  const pon = (cambio: Partial<PropiedadesFlorCorazones["corazones"]>) => onCambio({ ...valor, corazones: { ...corazones, ...cambio } });
  return (
    <>
      <Seccion titulo="Corazones">
        <Botonera opciones={FORMATOS_CORAZON.map((t) => [t, t] as const)} valor={corazones.formatoId as (typeof FORMATOS_CORAZON)[number]} onCambio={(t) => onCambio({ ...valor, corazones: conFormato(corazones, t) })} columnas={2} />
        {corazones.formatoId === "C-6" && <p className="text-xs text-texto-suave">El Corazón 6 no está en la tabla oficial de color: solo se ofrece el Fucsia que documenta Celebra ed. 27.</p>}
        <Deslizador id="corazones-cantidad" etiqueta="Cantidad" valor={corazones.cantidad} min={3} max={8} paso={1} texto={`${corazones.cantidad} corazones`} onCambio={(v) => pon({ cantidad: v })} />
        <Deslizador id="corazones-inflado" etiqueta="Inflado (ancho)" valor={corazones.infladoCm} min={Math.round(f.diametroMaxCm * 0.5)} max={f.diametroMaxCm} paso={0.5} texto={cm(corazones.infladoCm)} onCambio={(v) => pon({ infladoCm: v })} />
        <Deslizador id="corazones-apertura" etiqueta="Apertura" valor={corazones.aperturaGrados} min={0} max={45} paso={1} texto={`${corazones.aperturaGrados}°`} onCambio={(v) => pon({ aperturaGrados: v })} />
        <Deslizador id="corazones-giro" etiqueta="Giro" valor={corazones.giroGrados} min={0} max={360} paso={5} texto={`${corazones.giroGrados}°`} onCambio={(v) => pon({ giroGrados: v })} />
        <SelectorColor formatoId={corazones.formatoId} valor={corazones.codigo} onCambio={(codigo) => pon({ codigo })} etiqueta="Color de los corazones" />
      </Seccion>
      <Interior id="fc-interior" interior={valor.interior} onInterior={(interior) => onCambio({ ...valor, interior })} />
      <EditorGloboSuelto id="fc-centro" titulo="Centro" parte={valor.centro} onParte={(centro) => onCambio({ ...valor, centro })} porDefecto={CENTRO_POR_DEFECTO} />
    </>
  );
}
