"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Anchor, Rows3, Circle, Sparkles } from "lucide-react";
import { FORMATOS_GLOBO, coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import { PATRONES_COLUMNA, type PatronColumna } from "@/lib/globos3d/columnas";
import { FORMAS_ARCO } from "@/lib/globos3d/arcos";
import { MODULOS } from "@/lib/globos3d/modulos";
import { PARED_TRENZAS_INICIAL } from "@/lib/globos3d/pared-trenzas";
import { CELEBRA_27, sitiosDeMezcla, type MezclaDecoraciones } from "@/lib/globos3d/mezcla";
import { COLUMNA_QUINCE_AZUL } from "@/lib/globos3d/organico-presets";
import { arcoOrganico, columnaClasica } from "@/lib/globos3d/escenas-presets";
import { armarPieza, type Pieza } from "@/lib/globos3d/piezas";
import { idNuevo, type Escena, type NodoEscena } from "@/lib/globos3d/escena";
import { decoracionPredefinida, type Decoracion } from "@/lib/globos3d/figuras";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { ACTIVO, BOTON, Deslizador, INACTIVO, SelectorColor } from "./PanelFlor";
import { EditorArcoOrganico, EditorPieza } from "./PanelEscena";
import { PanelPared, PARED_INICIAL, type OpcionesPared } from "./PanelPared";
import { AJUSTES_QUINCE_AZUL, PanelOrganico, ajustesDeOpciones, aplicarAjustes, opcionesDeAjustes, type AjustesOrganico } from "./PanelOrganico";
import { EditorDecoracionCompleto, PanelDecoracion, nombreDecoracion } from "./PanelDecoracion";
import { CHIP, CHIP_ON, centimetros, metros } from "./ui-taller";
import { EditorTrazo } from "./EditorTrazo";

/** Lo que el editor solitario muestra además de la pieza (las anclas de la raíz, todos los globos lado a lado). */
export type VistaSolitario = { verAnclas: boolean; todosLosGlobos: boolean };

type Props = {
  /** La escena aislada del editor solitario (la raíz y sus decoraciones). */
  escena: Escena;
  raizId: string;
  /** La parte elegida (la raíz o una decoración). */
  nodo: NodoEscena;
  onPieza: (pieza: Pieza, agrupar?: string) => void;
  onEscena: (escena: Escena) => void;
  vista: VistaSolitario;
  onVista: (v: VistaSolitario) => void;
};

/** Un grupo de opciones como chips (radio). */
function Chips<T extends string>({ etiqueta, opciones, valor, onCambio, columnas = 3 }: { etiqueta: string; opciones: ReadonlyArray<{ id: T; nombre: string; titulo?: string }>; valor: T; onCambio: (v: T) => void; columnas?: number }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
      {opciones.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === valor} title={o.titulo} onClick={() => onCambio(o.id)} className={`${CHIP} ${o.id === valor ? CHIP_ON : ""} min-w-0 truncate px-2`}>{o.nombre}</button>
      ))}
    </div>
  );
}

/** «Colores en orden»: un puesto por fila (número, muestra, nombre y código); tocar la muestra abre los colores. */
function ColoresEnOrden({ formatoId, colores, cantidad, onColores, titulo = "Colores en orden" }: { formatoId: string; colores: readonly string[]; cantidad: number; onColores: (c: string[]) => void; titulo?: string }) {
  const [abierto, setAbierto] = useState<number | null>(null);
  const lista = Array.from({ length: cantidad }, (_, i) => colores[i] ?? colores[0] ?? "005");
  return (
    <section className="flex flex-col gap-2.5" aria-label={titulo}>
      <h3 className="taller-rotulo">{titulo}</h3>
      {lista.map((codigo, i) => {
        const ref = referenciaPorCodigo(codigo);
        return (
          <div key={i} className="flex items-center gap-2.5">
            <span className="w-3.5 font-mono text-[11px] text-taller-suave">{i + 1}</span>
            <button type="button" onClick={() => setAbierto(abierto === i ? null : i)} aria-expanded={abierto === i} aria-label={`Color ${i + 1}: ${ref?.nombreCompleto ?? codigo} ${codigo}. Cambiarlo`}
              className={`size-[30px] shrink-0 rounded-full border-2 border-taller-panel ${abierto === i ? "shadow-[0_0_0_2px_var(--taller-resalte)]" : "shadow-[0_0_0_1px_var(--taller-borde)]"}`} style={{ background: ref?.hexGlobo ?? "#ccc" }} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{ref?.nombreCompleto ?? codigo} <span className="font-mono text-taller-suave">{codigo}</span></span>
          </div>
        );
      })}
      {abierto !== null && abierto < cantidad && (
        <SelectorColor formatoId={formatoId} valor={lista[abierto]!} onCambio={(c) => onColores(lista.map((x, k) => (k === abierto ? c : x)))} etiqueta={`Color ${abierto + 1}`} />
      )}
    </section>
  );
}

/** El globo de una trenza (formato) y su inflado. */
function GloboTrenza({ formatos, formatoId, infladoCm, onFormato, onInflado }: { formatos: readonly string[]; formatoId: string; infladoCm: number; onFormato: (f: string) => void; onInflado: (v: number) => void }) {
  const f = formatoPorId(formatoId);
  return (
    <>
      <div className="flex justify-between text-[13px]"><span>Globo</span><span className="font-mono text-taller-medio">{formatoId} a {centimetros(infladoCm)}</span></div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Globo">
        {formatos.map((x) => <button key={x} type="button" role="radio" aria-checked={x === formatoId} onClick={() => onFormato(x)} className={`${CHIP} ${x === formatoId ? CHIP_ON : ""}`}>{x}</button>)}
      </div>
      {f && (
        <>
          <Deslizador id="sol-inflado" etiqueta="Inflado" valor={infladoCm} min={Math.round(f.diametroMaxCm * 0.4 * 10) / 10} max={f.diametroMaxCm} paso={0.5} texto={`${centimetros(infladoCm)} de ${centimetros(f.diametroMaxCm)} máx.`} onCambio={onInflado} />
          <button type="button" onClick={() => onInflado(f.infladoDecoracionCm)} className="min-h-8 self-start text-xs text-taller-acento hover:underline">Inflado de decoración ({centimetros(f.infladoDecoracionCm)})</button>
        </>
      )}
    </>
  );
}

/** Formato nuevo de una trenza: su inflado de decoración y solo colores que se fabrican en él. */
function conFormato<T extends { formatoId: string; infladoCm: number; colores: string[] }>(p: T, formatoId: string): T {
  const formato = formatoPorId(formatoId);
  if (!formato) return p;
  const disponibles = coloresDelFormato(formatoId);
  return { ...p, formatoId, infladoCm: formato.infladoDecoracionCm, colores: p.colores.map((c) => (disponibles.some((d) => d.codigo === c) ? c : disponibles[0]?.codigo ?? c)) };
}

/** La trenza recorre todos los colores que recibe: al cambiar de patrón se dejan justo los que pide. */
const coloresPara = (colores: readonly string[], patron: PatronColumna) => {
  const n = PATRONES_COLUMNA.find((p) => p.id === patron)?.colores ?? 1;
  return Array.from({ length: n }, (_, i) => colores[i] ?? ["005", "570", "009", "640"][i - colores.length] ?? "005");
};

const FORMATOS_TRENZA = ["R-5", "R-9", "R-12", "R-18"] as const;
const FORMATOS_MODULO = ["R-5", "R-9", "R-12", "R-18", "R-24", "LOL-6", "LOL-12"] as const;
const PATRONES = PATRONES_COLUMNA.map((p) => ({ id: p.id, nombre: p.nombre, titulo: p.descripcion }));

/** Conversión clásica ↔ orgánica (columna y arco), con el alto, el ancho y los colores que ya tiene. */
function aOrganica(p: Extract<Pieza, { tipo: "columna" }>): Pieza {
  const ajustes: AjustesOrganico = { ...AJUSTES_QUINCE_AZUL, altoCm: Math.max(150, Math.min(280, p.alturaCm)), colores: p.colores.map((codigo, i) => ({ codigo, peso: Math.max(5, 40 - i * 10) })) };
  return { tipo: "organico", opciones: opcionesDeAjustes(ajustes), flores: null };
}
function aClasica(p: Extract<Pieza, { tipo: "organico" }>): Pieza {
  const a = ajustesDeOpciones(p.opciones, p.flores !== null);
  return columnaClasica(Math.max(60, Math.min(300, a.altoCm)), a.colores.slice(0, 4).map((c) => c.codigo));
}

/** Pone una mezcla de decoraciones sobre la pared (cada una apoyada en sus globos, como pieza aparte de la escena). */
function decorarConMezcla(escena: Escena, paredId: string, pieza: Pieza, mezcla: MezclaDecoraciones): Escena {
  const armada = armarPieza(pieza);
  const ancho = pieza.tipo === "pared_trenzas" ? pieza.opciones.anchoCm : pieza.tipo === "pared_malla" ? pieza.anchoCm : armada.caja.max.x - armada.caja.min.x;
  const alto = pieza.tipo === "pared_trenzas" ? pieza.opciones.altoCm : pieza.tipo === "pared_malla" ? pieza.altoCm : armada.caja.max.y - armada.caja.min.y;
  const { anclas, colocaciones } = sitiosDeMezcla({ anclas: armada.anclas, mezcla, limites: { minX: armada.caja.min.x, maxX: armada.caja.min.x + ancho, minY: 0, maxY: alto } });
  // Lo que había de una mezcla anterior se cambia por la nueva.
  let salida: Escena = { ...escena, nodos: escena.nodos.filter((n) => !(n.id.startsWith("mezcla-") && n.colocacion.en === "sobre" && n.colocacion.padreId === paredId)) };
  for (const c of colocaciones) {
    const e = mezcla.elementos[c.elemento];
    const a = anclas[c.ancla];
    if (!e || !a) continue;
    const id = idNuevo(salida, `mezcla-${e.decoracion.tipo.replace(/_/g, "-")}`);
    salida = { ...salida, nodos: [...salida.nodos, { id, nombre: e.nombre, pieza: { tipo: "decoracion", decoracion: structuredClone(e.decoracion) }, colocacion: { en: "sobre", padreId: paredId, puntoCm: a.posicion, normal: a.normal, giroGrados: Math.round((c.giroRad * 180) / Math.PI) } }] };
  }
  return salida;
}

/** La mezcla de decoraciones para una pared (lo de la vieja pestaña Decoración → «En la pared»), aplicada con un botón. */
function MezclaPared({ escena, paredId, pieza, onEscena }: { escena: Escena; paredId: string; pieza: Pieza; onEscena: (e: Escena) => void }) {
  const [mezcla, setMezcla] = useState<MezclaDecoraciones>(() => structuredClone(CELEBRA_27.mezcla));
  const [editando, setEditando] = useState<number | null>(null);
  const [nueva, setNueva] = useState<Decoracion>(() => decoracionPredefinida("flor5"));
  const [aviso, setAviso] = useState<string | null>(null);
  const elemento = editando !== null ? mezcla.elementos[editando] : undefined;
  const decoracion = elemento?.decoracion ?? nueva;
  const cambiarDecoracion = (d: Decoracion) => {
    if (editando === null || !elemento) { setNueva(d); return; }
    setMezcla({ ...mezcla, elementos: mezcla.elementos.map((e, i) => (i === editando ? { ...e, decoracion: d, nombre: nombreDecoracion(d) } : e)) });
  };
  const puestas = escena.nodos.filter((n) => n.id.startsWith("mezcla-") && n.colocacion.en === "sobre" && n.colocacion.padreId === paredId).length;
  const aplicar = () => {
    const salida = decorarConMezcla(escena, paredId, pieza, mezcla);
    onEscena(salida);
    setAviso(`Listo: ${salida.nodos.length - escena.nodos.length + puestas} decoraciones sobre la pared${puestas ? " (cambiaron las de la mezcla anterior)" : ""}.`);
  };
  return (
    <details className="group">
      <summary className="taller-rotulo flex min-h-8 cursor-pointer items-center">Mezcla de decoraciones en la pared</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-xs text-taller-suave">Varias decoraciones repartidas en la pared: como la foto (Celebra ed. 27), por proporciones o en ciclo. «Ponerlas» las cuelga como piezas sobre la pared (se mueven y se quitan una por una).</p>
        <PanelDecoracion decoracion={decoracion} onDecoracion={cambiarDecoracion} editando={elemento ? editando : null} onEditando={setEditando} donde="pared" onDonde={() => {}}
          regla={{ cadaNiveles: 1, caras: 1 }} onRegla={() => {}} usarMezcla onUsarMezcla={() => {}} mezcla={mezcla} onMezcla={setMezcla}
          tipoPared={pieza.tipo === "pared_malla" ? "malla" : "trenzas"} puestas={mezcla.elementos.map((_, i) => escena.nodos.filter((n) => n.id.startsWith("mezcla-") && n.nombre === mezcla.elementos[i]?.nombre).length)} onCelebra={() => {}} soloMezcla />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={aplicar} className={`${BOTON} ${ACTIVO} px-3`}>Poner la mezcla en la pared</button>
          {puestas > 0 && <button type="button" onClick={() => { onEscena({ ...escena, nodos: escena.nodos.filter((n) => !(n.id.startsWith("mezcla-") && n.colocacion.en === "sobre" && n.colocacion.padreId === paredId)) }); setAviso("Quité las decoraciones de la mezcla."); }} className={`${BOTON} ${INACTIVO} px-3`}>Quitar la mezcla ({puestas})</button>}
        </div>
        {aviso && <p role="status" className="text-xs text-taller-texto">{aviso}</p>}
      </div>
    </details>
  );
}

/** El editor de una columna o un arco clásico (o una guirnalda): patrón, medidas, globo y colores en orden. */
function EditorTrenzaCompleto({ pieza, onPieza }: { pieza: Extract<Pieza, { tipo: "columna" | "arco" }>; onPieza: Props["onPieza"] }) {
  const niveles = Math.round((armarPieza(pieza).globos.length || 0) / 4);
  const n = PATRONES_COLUMNA.find((p) => p.id === pieza.patron)?.colores ?? 1;
  return (
    <>
      <section className="flex flex-col gap-2.5" aria-label="Patrón">
        <h3 className="taller-rotulo">Patrón</h3>
        <Chips etiqueta="Patrón" opciones={PATRONES} valor={pieza.patron} onCambio={(patron) => onPieza({ ...pieza, patron, colores: coloresPara(pieza.colores, patron) })} />
        <p className="text-xs text-taller-suave">{PATRONES_COLUMNA.find((p) => p.id === pieza.patron)?.descripcion}</p>
      </section>
      <section className="flex flex-col gap-2.5" aria-label="Medidas y globo">
        {pieza.tipo === "columna" ? (
          <Deslizador id="sol-alto" etiqueta="Alto" valor={pieza.alturaCm} min={40} max={300} paso={5} texto={`${metros(pieza.alturaCm)} · ${niveles} niveles`} onCambio={(v) => onPieza({ ...pieza, alturaCm: v }, "medida")} />
        ) : (
          <>
            <Chips etiqueta="Forma del arco" opciones={FORMAS_ARCO.map((f) => ({ id: f.id, nombre: f.nombre, titulo: f.descripcion }))} valor={pieza.forma} onCambio={(forma) => onPieza({ ...pieza, forma })} />
            <Deslizador id="sol-ancho" etiqueta="Ancho" valor={pieza.anchoCm} min={100} max={500} paso={10} texto={metros(pieza.anchoCm)} onCambio={(v) => onPieza({ ...pieza, anchoCm: v }, "medida")} />
            <Deslizador id="sol-alto" etiqueta="Alto" valor={pieza.altoCm} min={100} max={350} paso={10} texto={`${metros(pieza.altoCm)} · ${niveles} cuartetos`} onCambio={(v) => onPieza({ ...pieza, altoCm: v }, "medida")} />
          </>
        )}
        <GloboTrenza formatos={FORMATOS_TRENZA} formatoId={pieza.formatoId} infladoCm={pieza.infladoCm} onFormato={(f) => onPieza(conFormato(pieza, f))} onInflado={(v) => onPieza({ ...pieza, infladoCm: v }, "inflado")} />
      </section>
      <ColoresEnOrden formatoId={pieza.formatoId} colores={pieza.colores} cantidad={n} onColores={(colores) => onPieza({ ...pieza, colores })} />
    </>
  );
}

/** Módulo: cuál, globo, inflado, el color de cada globo y sus anclas. */
function EditorModulo({ pieza, onPieza, vista, onVista }: { pieza: Extract<Pieza, { tipo: "modulo" }>; onPieza: Props["onPieza"]; vista: VistaSolitario; onVista: Props["onVista"] }) {
  const [ranura, setRanura] = useState<number | null>(null);
  const datos = MODULOS.find((m) => m.id === pieza.modulo) ?? MODULOS[2]!;
  const f = formatoPorId(pieza.formatoId);
  const colores = Array.from({ length: 6 }, (_, i) => pieza.colores[i] ?? pieza.colores[0] ?? "009");
  const anclas = useMemo(() => armarPieza(pieza).anclas.length, [pieza]);
  return (
    <>
      <section className="flex flex-col gap-2.5" aria-label="Módulo">
        <h3 className="taller-rotulo">Cuál</h3>
        <Chips etiqueta="Módulo" columnas={3} opciones={MODULOS.map((m) => ({ id: m.id, nombre: `${m.nombre} ×${m.globos}` }))} valor={pieza.modulo} onCambio={(modulo) => { onPieza({ ...pieza, modulo }); setRanura(null); }} />
        <p className="text-xs text-taller-suave">{datos.armado}</p>
      </section>
      <section className="flex flex-col gap-2.5" aria-label="Globo del módulo">
        <GloboTrenza formatos={FORMATOS_MODULO} formatoId={pieza.formatoId} infladoCm={pieza.infladoCm} onFormato={(id) => onPieza(conFormato(pieza, id))} onInflado={(v) => onPieza({ ...pieza, infladoCm: v }, "inflado")} />
      </section>
      <section className="flex flex-col gap-2.5" aria-label="Color de cada globo">
        <h3 className="taller-rotulo">Color de cada globo</h3>
        <p className="text-xs text-taller-suave">{ranura === null ? "Elige un color para todo el módulo, o toca un globo para cambiar solo ese." : `Elige el color del globo ${ranura + 1}.`}</p>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: datos.globos }, (_, i) => {
            const ref = referenciaPorCodigo(colores[i]!);
            return (
              <button key={i} type="button" onClick={() => setRanura(ranura === i ? null : i)} aria-pressed={ranura === i} aria-label={`Globo ${i + 1}: ${ref?.nombreCompleto ?? colores[i]}`}
                className={`grid size-[30px] place-items-center rounded-full border-2 border-taller-panel font-mono text-[11px] ${ranura === i ? "shadow-[0_0_0_2px_var(--taller-resalte)]" : "shadow-[0_0_0_1px_var(--taller-borde)]"}`}
                style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
            );
          })}
          {ranura !== null && <button type="button" onClick={() => setRanura(null)} className="min-h-8 text-xs text-taller-acento hover:underline">Todo el módulo</button>}
        </div>
        {f && <SelectorColor formatoId={f.id} valor={ranura === null ? colores[0]! : colores[ranura]!} etiqueta={ranura === null ? "Color de todo el módulo" : `Color del globo ${ranura + 1}`}
          onCambio={(c) => onPieza({ ...pieza, colores: colores.map((x, i) => (ranura === null || i === ranura ? c : x)) })} />}
        <label className="flex min-h-8 items-center gap-2 text-sm" htmlFor="sol-anclas">
          <input id="sol-anclas" type="checkbox" checked={vista.verAnclas} onChange={(e) => onVista({ ...vista, verAnclas: e.target.checked })} />
          <Anchor className="size-4 text-taller-acento" aria-hidden /> Ver anclas ({anclas})
        </label>
        <p className="text-xs text-taller-suave">Las anclas son los puntos donde se cuelga una decoración: el centro y los huecos entre globos.</p>
      </section>
    </>
  );
}

/** Globo suelto: formato, inflado, color (por familia) y «todos los tamaños lado a lado». */
function EditorGlobo({ pieza, onPieza, vista, onVista }: { pieza: Extract<Pieza, { tipo: "globo" }>; onPieza: Props["onPieza"]; vista: VistaSolitario; onVista: Props["onVista"] }) {
  const f = formatoPorId(pieza.formatoId) ?? FORMATOS_GLOBO[2]!;
  const elegir = (id: string) => {
    const nuevo = formatoPorId(id);
    if (!nuevo) return;
    const disponibles = coloresDelFormato(id);
    onPieza({ ...pieza, formatoId: id, infladoCm: nuevo.infladoDecoracionCm, codigo: disponibles.some((c) => c.codigo === pieza.codigo) ? pieza.codigo : disponibles[0]?.codigo ?? pieza.codigo });
    onVista({ ...vista, todosLosGlobos: false });
  };
  return (
    <>
      <section className="flex flex-col gap-2.5" aria-label="Formato">
        <h3 className="taller-rotulo">Formato</h3>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Formato">
          {FORMATOS_GLOBO.map((x) => <button key={x.id} type="button" role="radio" aria-checked={!vista.todosLosGlobos && x.id === f.id} title={x.nombre} onClick={() => elegir(x.id)} className={`${CHIP} ${!vista.todosLosGlobos && x.id === f.id ? CHIP_ON : ""}`}>{x.id}</button>)}
        </div>
        <button type="button" onClick={() => onVista({ ...vista, todosLosGlobos: !vista.todosLosGlobos })} aria-pressed={vista.todosLosGlobos} className={`${CHIP} ${vista.todosLosGlobos ? CHIP_ON : ""} inline-flex items-center justify-center gap-2`}>
          {vista.todosLosGlobos ? <Circle className="size-4" aria-hidden /> : <Rows3 className="size-4" aria-hidden />}{vista.todosLosGlobos ? "Ver un solo globo" : "Todos los tamaños lado a lado"}
        </button>
        <p className="text-xs text-taller-suave">{f.descripcion}</p>
      </section>
      {!vista.todosLosGlobos && (
        <section className="flex flex-col gap-2.5" aria-label="Inflado">
          <Deslizador id="sol-inflado-globo" etiqueta="Inflado" valor={pieza.infladoCm} min={Math.round(f.diametroMaxCm * 0.4 * 10) / 10} max={f.diametroMaxCm} paso={0.5} texto={`${centimetros(pieza.infladoCm)} de ${centimetros(f.diametroMaxCm)} máx.`} onCambio={(v) => onPieza({ ...pieza, infladoCm: v }, "inflado")} />
          <button type="button" onClick={() => onPieza({ ...pieza, infladoCm: f.infladoDecoracionCm })} className="min-h-8 self-start text-xs text-taller-acento hover:underline">Inflado de decoración ({centimetros(f.infladoDecoracionCm)})</button>
          {f.largoCm ? <p className="font-mono text-xs text-taller-suave">{centimetros(pieza.infladoCm)} de grosor × {centimetros(f.largoCm)} de largo</p> : null}
        </section>
      )}
      <section className="flex flex-col gap-2.5" aria-label="Color">
        <h3 className="taller-rotulo">Color <span className="font-normal normal-case tracking-normal">· {coloresDelFormato(f.id).length} en {f.id}</span></h3>
        <SelectorColor formatoId={f.id} valor={pieza.codigo} onCambio={(codigo) => onPieza({ ...pieza, codigo })} etiqueta={`Color del ${f.id}`} />
        <p className="text-xs text-taller-suave">{referenciaPorCodigo(pieza.codigo)?.nombreCompleto} {pieza.codigo} · {referenciaPorCodigo(pieza.codigo)?.acabado}. Medidas nominales del catálogo Sempertex; el color es el del globo inflado.</p>
      </section>
    </>
  );
}

/** Pieza orgánica: el panel de la vieja pestaña Orgánico sobre sus opciones (semilla, densidad, colores, flores…). */
function EditorOrganico({ pieza, onPieza }: { pieza: Extract<Pieza, { tipo: "organico" }>; onPieza: Props["onPieza"] }) {
  const ajustes = useMemo(() => ajustesDeOpciones(pieza.opciones, pieza.flores !== null), [pieza]);
  return (
    <section className="flex flex-col gap-3 [&>section]:rounded-none [&>section]:bg-transparent [&>section]:p-0 [&>section]:ring-0" aria-label="Pieza orgánica">
      <PanelOrganico valor={ajustes} conForma={ajustes.esColumna} conPedestal={false}
        onCambio={(a) => {
          // «Columna azul de XV»: la columna entera del preset (con sus flores).
          if (a === AJUSTES_QUINCE_AZUL) { onPieza({ ...pieza, opciones: opcionesDeAjustes(a), flores: structuredClone(COLUMNA_QUINCE_AZUL.flores) }); return; }
          onPieza({ ...pieza, opciones: aplicarAjustes(pieza.opciones, ajustes, a), flores: a.conFlores ? pieza.flores ?? structuredClone(COLUMNA_QUINCE_AZUL.flores) : null }, "organico");
        }} />
      <p className="text-xs text-taller-suave">El pedestal es una pieza aparte (escenografía): muévelo o quítalo desde la escena. Cada cambio rearma la pieza (medio segundo).</p>
    </section>
  );
}

/** Pared: el panel de la vieja pestaña Pared (malla o trenzas, Celebra 27, ver anclas) y la mezcla de decoraciones. */
function EditorParedCompleto({ pieza, escena, raizId, onPieza, onEscena, vista, onVista }: { pieza: Extract<Pieza, { tipo: "pared_malla" | "pared_trenzas" }>; escena: Escena; raizId: string; onPieza: Props["onPieza"]; onEscena: Props["onEscena"]; vista: VistaSolitario; onVista: Props["onVista"] }) {
  const malla: OpcionesPared = pieza.tipo === "pared_malla" ? { formatoId: pieza.formatoId === "LOL-6" ? "LOL-6" : "LOL-12", infladoCm: pieza.infladoCm, anchoCm: pieza.anchoCm, altoCm: pieza.altoCm, patron: pieza.patron, colores: pieza.colores, union: pieza.union } : PARED_INICIAL;
  const trenzas = pieza.tipo === "pared_trenzas" ? pieza.opciones : PARED_TRENZAS_INICIAL;
  const anclas = useMemo(() => armarPieza(pieza).anclas.length, [pieza]);
  const deMalla = (v: OpcionesPared): Pieza => ({ tipo: "pared_malla", ...v });
  return (
    <>
      <section className="flex flex-col gap-3 [&>section]:rounded-none [&>section]:bg-transparent [&>section]:p-0 [&>section]:ring-0" aria-label="Pared">
        <PanelPared tipo={pieza.tipo === "pared_malla" ? "malla" : "trenzas"} onTipo={(t) => onPieza(t === "malla" ? deMalla(malla) : { tipo: "pared_trenzas", opciones: structuredClone(trenzas) })}
          valor={malla} onCambio={(v) => onPieza(deMalla(v), "pared")} trenzas={trenzas} onTrenzas={(opciones) => onPieza({ tipo: "pared_trenzas", opciones }, "pared")}
          verAnclas={vista.verAnclas} onVerAnclas={(v) => onVista({ ...vista, verAnclas: v })} anclas={anclas}
          onCelebra={() => {
            const celebra: Pieza = { tipo: "pared_trenzas", opciones: structuredClone(CELEBRA_27.pared) };
            const conPared: Escena = { ...escena, nodos: escena.nodos.map((n) => (n.id === raizId ? { ...n, pieza: celebra } : n)) };
            onEscena(decorarConMezcla(conPared, raizId, celebra, CELEBRA_27.mezcla));
          }} />
      </section>
      <section><MezclaPared escena={escena} paredId={raizId} pieza={pieza} onEscena={onEscena} /></section>
    </>
  );
}

/**
 * Los parámetros completos de la parte elegida en el editor solitario: el generador de su tipo (lo que antes vivía en
 * las pestañas Globos, Módulos, Columna, Arco, Pared, Decoración y Orgánico). Columna y arco se pueden pasar de clásica
 * a orgánica (con su alto, su ancho y sus colores).
 */
export function ParametrosPieza({ escena, raizId, nodo, onPieza, onEscena, vista, onVista }: Props): ReactNode {
  const p = nodo.pieza;
  const tipoColumna = (p.tipo === "columna" || (p.tipo === "organico" && ajustesDeOpciones(p.opciones, false).esColumna)) && nodo.id === raizId;
  const tipoArco = (p.tipo === "arco" || p.tipo === "arco_organico") && nodo.id === raizId;
  const cabecera = (
    <section className="flex flex-col gap-2.5">
      {tipoColumna && (
        <Chips etiqueta="Tipo de columna" columnas={2} opciones={[{ id: "clasica", nombre: "Clásica · cuartetos" }, { id: "organica", nombre: "Orgánica" }]} valor={p.tipo === "columna" ? "clasica" : "organica"}
          onCambio={(t) => { if (t === "organica" && p.tipo === "columna") onPieza(aOrganica(p)); if (t === "clasica" && p.tipo === "organico") onPieza(aClasica(p)); }} />
      )}
      {tipoArco && (
        <Chips etiqueta="Tipo de arco" columnas={2} opciones={[{ id: "clasico", nombre: "Clásico · cuartetos" }, { id: "organico", nombre: "Orgánico" }]} valor={p.tipo === "arco" ? "clasico" : "organico"}
          onCambio={(t) => {
            if (t === "organico" && p.tipo === "arco") { const o = arcoOrganico(p.anchoCm, Math.max(150, p.altoCm)); if (o.tipo === "arco_organico") onPieza({ ...o, arco: { ...o.arco, colores: p.colores.map((codigo, i) => ({ codigo, peso: Math.max(10, 45 - i * 10) })) } }); }
            if (t === "clasico" && p.tipo === "arco_organico") onPieza({ tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm: Math.min(500, p.arco.anchoCm), altoCm: Math.min(350, p.arco.altoCm), patron: p.arco.colores.length >= 4 ? "espiral" : p.arco.colores.length === 2 ? "dos_colores" : "un_color", colores: coloresPara(p.arco.colores.map((c) => c.codigo), p.arco.colores.length >= 4 ? "espiral" : p.arco.colores.length === 2 ? "dos_colores" : "un_color") });
          }} />
      )}
    </section>
  );
  const cuerpo = (() => {
    switch (p.tipo) {
      case "columna": case "arco": return <EditorTrenzaCompleto pieza={p} onPieza={onPieza} />;
      case "guirnalda": {
        const g = p.guirnalda;
        const pon = (cambio: Partial<typeof g>, agrupar?: string) => onPieza({ ...p, guirnalda: { ...g, ...cambio } }, agrupar);
        return (
          <>
            <section className="flex flex-col gap-2.5" aria-label="Patrón">
              <h3 className="taller-rotulo">Patrón</h3>
              <Chips etiqueta="Patrón" opciones={PATRONES} valor={g.patron as PatronColumna} onCambio={(patron) => pon({ patron, colores: coloresPara(g.colores, patron) })} />
            </section>
            <section className="flex flex-col gap-2.5" aria-label="Medidas y globo">
              {g.recorrido ? <p className="text-xs text-taller-suave">Sigue una curva libre: el largo y la caída no aplican.</p> : (
                <>
                  <Deslizador id="sol-largo" etiqueta="Largo (de punta a punta)" valor={g.anchoCm} min={100} max={800} paso={10} texto={metros(g.anchoCm)} onCambio={(v) => pon({ anchoCm: v }, "medida")} />
                  <Deslizador id="sol-caida" etiqueta="Caída en el medio" valor={g.caidaCm} min={0} max={150} paso={5} texto={g.caidaCm === 0 ? "recta" : metros(g.caidaCm)} onCambio={(v) => pon({ caidaCm: v }, "medida")} />
                </>
              )}
              <GloboTrenza formatos={["R-5", "R-9", "R-12"]} formatoId={g.formatoId} infladoCm={g.infladoCm} onFormato={(f) => onPieza({ ...p, guirnalda: conFormato(g, f) })} onInflado={(v) => pon({ infladoCm: v }, "inflado")} />
            </section>
            <ColoresEnOrden formatoId={g.formatoId} colores={g.colores} cantidad={PATRONES_COLUMNA.find((x) => x.id === g.patron)?.colores ?? 1} onColores={(colores) => pon({ colores })} />
          </>
        );
      }
      case "arco_organico":
        return <section className="flex flex-col gap-2.5" aria-label="Arco orgánico"><EditorArcoOrganico pieza={p} onPieza={(x) => onPieza(x, "organico")} /></section>;
      case "organico": return p.generador?.tipo === "trazo" ? <EditorTrazo pieza={p} trazo={p.generador.trazo} onPieza={onPieza} /> : <EditorOrganico pieza={p} onPieza={onPieza} />;
      case "pared_malla": case "pared_trenzas":
        return <EditorParedCompleto pieza={p} escena={escena} raizId={raizId} onPieza={onPieza} onEscena={onEscena} vista={vista} onVista={onVista} />;
      case "decoracion":
        return <EditorDecoracionCompleto decoracion={p.decoracion} onDecoracion={(decoracion) => onPieza({ ...p, decoracion }, "decoracion")} />;
      case "modulo": return <EditorModulo pieza={p} onPieza={onPieza} vista={vista} onVista={onVista} />;
      case "globo": return <EditorGlobo pieza={p} onPieza={onPieza} vista={vista} onVista={onVista} />;
      default: return <section className="[&>section]:rounded-none [&>section]:bg-transparent [&>section]:p-0 [&>section]:ring-0"><EditorPieza pieza={p} onPieza={onPieza} /></section>;
    }
  })();
  return (
    <>
      {(tipoColumna || tipoArco) && cabecera}
      {cuerpo}
      {p.tipo === "decoracion" && <section><p className="flex items-center gap-1.5 text-xs text-taller-suave"><Sparkles className="size-3.5" aria-hidden />Para colgarla de otra pieza o repetirla cada N anclas, usa «Lugar» en la escena.</p></section>}
    </>
  );
}
