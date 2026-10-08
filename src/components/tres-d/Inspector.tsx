"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Copy, Ellipsis, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { FORMAS_ARCO } from "@/lib/globos3d/arcos";
import { PATRONES_COLUMNA } from "@/lib/globos3d/columnas";
import { PATRONES_MALLA } from "@/lib/globos3d/paredes";
import { PATRONES_TRENZAS } from "@/lib/globos3d/pared-trenzas";
import { MODULOS } from "@/lib/globos3d/modulos";
import { formatoPorId } from "@/lib/globos3d/formatos";
import { TIPOS_DECORACION } from "@/lib/globos3d/figuras";
import { reemplazarColor } from "@/lib/globos3d/recolorear";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { NOMBRE_PARED, type Colocacion, type Escena, type EscenaArmada, type NodoArmado, type NodoEscena } from "@/lib/globos3d/escena";
import type { Pieza } from "@/lib/globos3d/piezas";
import { Deslizador } from "./PanelFlor";
import { EditorLugar } from "./PanelEscena";
import { PaletaEscena } from "./PaletaEscena";
import { IconoTipo, padreDe, subtituloPieza } from "./tipos-pieza";
import { BTN_ICO, BTN_PRI, DATO, centimetros, metros } from "./ui-taller";

type Props = {
  escena: Escena;
  armada: EscenaArmada | null;
  /** La pieza elegida (con la colocación en vivo mientras se arrastra) o `null`: propiedades de la escena. */
  nodo: NodoEscena | null;
  /** Una copia de un reparto en anclas que se tocó en el visor. */
  copia: number | null;
  onNodo: (id: string, cambio: Partial<NodoEscena>, agrupar?: string) => void;
  onSeleccion: (id: string | null) => void;
  onEditarSola: (id: string) => void;
  onDuplicar: (id: string) => void;
  onEliminar: (id: string) => void;
  /** Si al eliminar hay que preguntar (lleva decoraciones): cuántas. */
  confirmarEliminar: { id: string; decoraciones: number } | null;
  onConfirmarEliminar: (conDecoraciones: boolean | null) => void;
  onColgarOtra: (id: string) => void;
  onEditarSostiene: (id: string) => void;
  /** «Colores de la escena» (sin pieza elegida). */
  paletaEscena: ReactNode;
  /** Lo de la biblioteca (ver sola, guardar) para la pieza o la escena. */
  biblioteca: ReactNode;
  nombreEscena: string;
  onSala: () => void;
  onPlantillas: () => void;
  /** En la hoja del teléfono: sin las secciones largas plegadas. */
  enHoja?: boolean;
  /** «⋯ Más acciones» (en el teléfono): el menú de la pieza. */
  onMas?: (id: string) => void;
};

const nf = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** Un recuadro de dato (rótulo chico y valor). */
function Dato({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <div className={DATO}><div className="text-[11px] text-taller-suave">{rotulo}</div><div className="mt-0.5 truncate text-[13px]">{children}</div></div>;
}

/** Un dato numérico editable (cm o grados), en mono. */
function DatoNumero({ id, rotulo, valor, unidad, min, max, onCambio }: { id: string; rotulo: string; valor: number; unidad: string; min: number; max: number; onCambio: (v: number) => void }) {
  return (
    <label htmlFor={id} className={`${DATO} block`}>
      <span className="block text-[11px] text-taller-suave">{rotulo}</span>
      <span className="flex items-baseline gap-0.5">
        <input id={id} type="number" inputMode="numeric" value={Math.round(valor)} min={min} max={max} step={unidad === "°" ? 5 : 5}
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onCambio(Math.max(min, Math.min(max, v))); }}
          className="w-full min-w-0 bg-transparent font-mono text-[13px] text-taller-texto outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
        <span className="text-[11px] text-taller-suave">{unidad}</span>
      </span>
    </label>
  );
}

/** Lo esencial de las medidas de cada tipo: el deslizador principal y dos datos. */
function Medidas({ pieza, hecho, onPieza }: { pieza: Pieza; hecho: NodoArmado | undefined; onPieza: (p: Pieza) => void }) {
  const caja = hecho?.caja;
  const alto = caja ? caja.max.y - caja.min.y : 0, ancho = caja ? Math.max(caja.max.x - caja.min.x, caja.max.z - caja.min.z) : 0;
  const globo = (formatoId: string, infladoCm: number) => <>{formatoId} · <span className="font-mono">{nf(infladoCm)} cm</span></>;
  switch (pieza.tipo) {
    case "columna":
      return (
        <>
          <Deslizador id="insp-alto" etiqueta="Alto" valor={pieza.alturaCm} min={60} max={300} paso={5} texto={metros(pieza.alturaCm)} onCambio={(v) => onPieza({ ...pieza, alturaCm: v })} />
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Globo">{globo(pieza.formatoId, pieza.infladoCm)}</Dato><Dato rotulo="Patrón">{PATRONES_COLUMNA.find((p) => p.id === pieza.patron)?.nombre}</Dato></div>
        </>
      );
    case "arco":
      return (
        <>
          <Deslizador id="insp-ancho" etiqueta="Ancho" valor={pieza.anchoCm} min={100} max={500} paso={10} texto={metros(pieza.anchoCm)} onCambio={(v) => onPieza({ ...pieza, anchoCm: v })} />
          <Deslizador id="insp-alto" etiqueta="Alto" valor={pieza.altoCm} min={100} max={350} paso={10} texto={metros(pieza.altoCm)} onCambio={(v) => onPieza({ ...pieza, altoCm: v })} />
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Globo">{globo(pieza.formatoId, pieza.infladoCm)}</Dato><Dato rotulo="Forma">{FORMAS_ARCO.find((f) => f.id === pieza.forma)?.nombre}</Dato></div>
        </>
      );
    case "arco_organico":
      return (
        <>
          <Deslizador id="insp-ancho" etiqueta="Ancho entre patas" valor={pieza.arco.anchoCm} min={150} max={500} paso={10} texto={metros(pieza.arco.anchoCm)} onCambio={(v) => onPieza({ ...pieza, arco: { ...pieza.arco, anchoCm: v } })} />
          <Deslizador id="insp-alto" etiqueta="Alto" valor={pieza.arco.altoCm} min={150} max={320} paso={10} texto={metros(pieza.arco.altoCm)} onCambio={(v) => onPieza({ ...pieza, arco: { ...pieza.arco, altoCm: v } })} />
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Grosor en las patas"><span className="font-mono">{Math.round(pieza.arco.radioBaseCm * 2)} cm</span></Dato><Dato rotulo="Flores">{pieza.arco.flores ? "Con flores" : "Sin flores"}</Dato></div>
        </>
      );
    case "guirnalda": {
      const g = pieza.guirnalda;
      return (
        <>
          {!g.recorrido && <Deslizador id="insp-largo" etiqueta="Largo" valor={g.anchoCm} min={100} max={800} paso={10} texto={metros(g.anchoCm)} onCambio={(v) => onPieza({ ...pieza, guirnalda: { ...g, anchoCm: v } })} />}
          {!g.recorrido && <Deslizador id="insp-caida" etiqueta="Caída en el medio" valor={g.caidaCm} min={0} max={150} paso={5} texto={g.caidaCm === 0 ? "recta" : metros(g.caidaCm)} onCambio={(v) => onPieza({ ...pieza, guirnalda: { ...g, caidaCm: v } })} />}
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Globo">{globo(g.formatoId, g.infladoCm)}</Dato><Dato rotulo="Patrón">{PATRONES_COLUMNA.find((p) => p.id === g.patron)?.nombre ?? g.patron}</Dato></div>
        </>
      );
    }
    case "pared_malla":
      return (
        <>
          <Deslizador id="insp-ancho" etiqueta="Ancho" valor={pieza.anchoCm} min={100} max={600} paso={10} texto={metros(pieza.anchoCm)} onCambio={(v) => onPieza({ ...pieza, anchoCm: v })} />
          <Deslizador id="insp-alto" etiqueta="Alto" valor={pieza.altoCm} min={100} max={300} paso={10} texto={metros(pieza.altoCm)} onCambio={(v) => onPieza({ ...pieza, altoCm: v })} />
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Eslabón">{globo(pieza.formatoId, pieza.infladoCm)}</Dato><Dato rotulo="Patrón">{PATRONES_MALLA.find((p) => p.id === pieza.patron)?.nombre}</Dato></div>
        </>
      );
    case "pared_trenzas": {
      const o = pieza.opciones;
      return (
        <>
          <Deslizador id="insp-ancho" etiqueta="Ancho" valor={o.anchoCm} min={50} max={600} paso={10} texto={metros(o.anchoCm)} onCambio={(v) => onPieza({ ...pieza, opciones: { ...o, anchoCm: v } })} />
          <Deslizador id="insp-alto" etiqueta="Alto" valor={o.altoCm} min={60} max={350} paso={5} texto={metros(o.altoCm)} onCambio={(v) => onPieza({ ...pieza, opciones: { ...o, altoCm: v } })} />
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Cuartetos">{o.grande.formatoId} y {o.chico.formatoId}</Dato><Dato rotulo="Patrón">{PATRONES_TRENZAS.find((p) => p.id === o.patron)?.nombre}</Dato></div>
        </>
      );
    }
    case "modulo":
      return (
        <>
          <Deslizador id="insp-inflado" etiqueta="Inflado" valor={pieza.infladoCm} min={Math.round((formatoPorId(pieza.formatoId)?.diametroMaxCm ?? 30) * 0.4)} max={formatoPorId(pieza.formatoId)?.diametroMaxCm ?? 30} paso={0.5} texto={centimetros(pieza.infladoCm)} onCambio={(v) => onPieza({ ...pieza, infladoCm: v })} />
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Módulo">{MODULOS.find((m) => m.id === pieza.modulo)?.nombre}</Dato><Dato rotulo="Globo">{pieza.formatoId}</Dato></div>
        </>
      );
    case "globo": {
      const f = formatoPorId(pieza.formatoId);
      return (
        <>
          {f && <Deslizador id="insp-inflado" etiqueta="Inflado" valor={pieza.infladoCm} min={Math.round(f.diametroMaxCm * 0.4 * 10) / 10} max={f.diametroMaxCm} paso={0.5} texto={`${centimetros(pieza.infladoCm)} de ${centimetros(f.diametroMaxCm)} máx.`} onCambio={(v) => onPieza({ ...pieza, infladoCm: v })} />}
          <div className="grid grid-cols-2 gap-2"><Dato rotulo="Formato">{f?.nombre ?? pieza.formatoId}</Dato><Dato rotulo="Color">{referenciaPorCodigo(pieza.codigo)?.nombreCompleto ?? pieza.codigo}</Dato></div>
        </>
      );
    }
    case "decoracion":
      return <div className="grid grid-cols-2 gap-2"><Dato rotulo="Tipo">{TIPOS_DECORACION.find((t) => t.id === pieza.decoracion.tipo)?.nombre ?? "Decoración"}</Dato><Dato rotulo="Ancho"><span className="font-mono">{nf(ancho)} cm</span></Dato></div>;
    default:
      return <div className="grid grid-cols-2 gap-2"><Dato rotulo="Alto"><span className="font-mono">{metros(alto)}</span></Dato><Dato rotulo="Ancho"><span className="font-mono">{metros(ancho)}</span></Dato></div>;
  }
}

/** X / fondo / giro (o lo que corresponda a dónde está), editables. */
function Lugar({ nodo, escena, armada, onNodo }: { nodo: NodoEscena; escena: Escena; armada: EscenaArmada; onNodo: (cambio: Partial<NodoEscena>, agrupar?: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const c = nodo.colocacion;
  const { sala } = escena;
  const pon = (cambio: Partial<Colocacion>) => onNodo({ colocacion: { ...c, ...cambio } as Colocacion }, `lugar-${nodo.id}`);
  const medioX = Math.round(sala.anchoCm / 2), medioZ = Math.round(sala.fondoCm / 2);
  let datos: ReactNode;
  let ayuda: string;
  if (c.en === "piso") {
    datos = <><DatoNumero id="lugar-x" rotulo="X" valor={c.xCm} unidad="cm" min={-medioX} max={medioX} onCambio={(v) => pon({ xCm: v })} /><DatoNumero id="lugar-z" rotulo="Fondo" valor={c.zCm} unidad="cm" min={-medioZ} max={medioZ} onCambio={(v) => pon({ zCm: v })} /><DatoNumero id="lugar-giro" rotulo="Giro" valor={c.giroGrados} unidad="°" min={-180} max={180} onCambio={(v) => pon({ giroGrados: v })} /></>;
    ayuda = "En el piso · arrástrala en el visor o usa las flechas";
  } else if (c.en === "pared") {
    datos = <><DatoNumero id="lugar-largo" rotulo="A lo largo" valor={c.aLoLargoCm} unidad="cm" min={-medioX} max={medioX} onCambio={(v) => pon({ aLoLargoCm: v })} /><DatoNumero id="lugar-altura" rotulo="Altura" valor={c.alturaCm} unidad="cm" min={0} max={sala.altoCm} onCambio={(v) => pon({ alturaCm: v })} /><Dato rotulo="Pared">{NOMBRE_PARED[c.pared].replace("Pared ", "").replace("del ", "")}</Dato></>;
    ayuda = `${NOMBRE_PARED[c.pared]} · flechas ← → a lo largo, ↑ ↓ en altura`;
  } else if (c.en === "techo") {
    datos = <><DatoNumero id="lugar-x" rotulo="X" valor={c.xCm} unidad="cm" min={-medioX} max={medioX} onCambio={(v) => pon({ xCm: v })} /><DatoNumero id="lugar-z" rotulo="Fondo" valor={c.zCm} unidad="cm" min={-medioZ} max={medioZ} onCambio={(v) => pon({ zCm: v })} /><DatoNumero id="lugar-cuelga" rotulo="Cuelga" valor={c.cuelgaCm} unidad="cm" min={0} max={Math.max(0, sala.altoCm - 40)} onCambio={(v) => pon({ cuelgaCm: v })} /></>;
    ayuda = "Del techo · RePág / AvPág suben y bajan";
  } else if (c.en === "libre") {
    datos = <><DatoNumero id="lugar-x" rotulo="X" valor={c.xCm} unidad="cm" min={-medioX} max={medioX} onCambio={(v) => pon({ xCm: v })} /><DatoNumero id="lugar-y" rotulo="Altura" valor={c.yCm} unidad="cm" min={0} max={sala.altoCm} onCambio={(v) => pon({ yCm: v })} /><DatoNumero id="lugar-z" rotulo="Fondo" valor={c.zCm} unidad="cm" min={-medioZ} max={medioZ} onCambio={(v) => pon({ zCm: v })} /></>;
    ayuda = "Suelta en el salón · ↑ ↓ en altura, RePág / AvPág al frente y al fondo";
  } else if (c.en === "ancla") {
    const anclas = armada.porNodo.find((n) => n.id === c.padreId)?.anclas.length ?? 0;
    datos = <><DatoNumero id="lugar-ancla" rotulo="Ancla" valor={c.ancla + 1} unidad={`de ${anclas}`} min={1} max={Math.max(1, anclas)} onCambio={(v) => pon({ ancla: v - 1 })} /><DatoNumero id="lugar-cada" rotulo="Repetir cada" valor={c.cada} unidad="anclas" min={0} max={Math.min(Math.max(anclas, 1), 40)} onCambio={(v) => pon({ cada: v })} /><DatoNumero id="lugar-giro" rotulo="Giro" valor={c.giroGrados} unidad="°" min={-180} max={180} onCambio={(v) => pon({ giroGrados: v })} /></>;
    ayuda = `Colgada de «${escena.nodos.find((n) => n.id === c.padreId)?.nombre ?? "?"}» · ← → la pasan de ancla`;
  } else {
    datos = <><Dato rotulo="Sobre">{escena.nodos.find((n) => n.id === c.padreId)?.nombre ?? "?"}</Dato><DatoNumero id="lugar-giro" rotulo="Giro" valor={c.giroGrados} unidad="°" min={-180} max={180} onCambio={(v) => pon({ giroGrados: v })} /></>;
    ayuda = "Apoyada en sus globos · arrástrala por la superficie";
  }
  return (
    <section className="flex flex-col gap-2.5" aria-label="Lugar">
      <h3 className="taller-rotulo">Lugar</h3>
      <div className="grid grid-cols-3 gap-2 text-[13px]">{datos}</div>
      <p className="text-xs text-taller-suave">{ayuda}</p>
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="inline-flex min-h-8 items-center gap-1 self-start text-xs text-taller-acento hover:underline">
        {abierto ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}Cambiar dónde va
      </button>
      {abierto && <EditorLugar nodo={nodo} escena={escena} armada={armada} onNodo={(cambio) => onNodo(cambio, `donde-${nodo.id}`)} />}
    </section>
  );
}

/** «18 × R-12 Metal Dorado 570». */
function LineasMateriales({ materiales }: { materiales: ReadonlyArray<{ formatoId: string; codigo: string; cantidad: number }> }) {
  return (
    <ul className="mt-1.5 font-mono text-[11px] leading-relaxed text-taller-suave">
      {[...materiales].sort((a, b) => b.cantidad - a.cantidad).map((m) => <li key={`${m.formatoId}|${m.codigo}`}>{m.cantidad} × {m.formatoId} {referenciaPorCodigo(m.codigo)?.nombreCompleto ?? m.codigo} {m.codigo}</li>)}
    </ul>
  );
}

/**
 * Inspector (columna derecha): la pieza elegida —tipo, nombre, Editar sola / Duplicar / Eliminar, medidas, colores de
 * la pieza, lugar, decoraciones colgadas y su lista de compra— o, sin pieza, la escena (colores y sala).
 */
export function Inspector(props: Props) {
  const { escena, armada, nodo, copia, onNodo, onSeleccion, onEditarSola, onDuplicar, onEliminar, confirmarEliminar, onConfirmarEliminar, onColgarOtra, onEditarSostiene, paletaEscena, biblioteca, nombreEscena, onSala, onPlantillas, enHoja = false, onMas } = props;
  const [avisoColor, setAvisoColor] = useState<{ id: string; texto: string | null } | null>(null);

  if (!nodo || !armada) {
    return (
      <div className="taller-seccionado flex flex-col">
        <section className="flex flex-col gap-1">
          <div className="taller-rotulo text-taller-acento">Escena</div>
          <h2 className="mt-1.5 text-lg font-semibold leading-tight">{nombreEscena}</h2>
          <p className="text-xs text-taller-suave"><span className="font-mono">{escena.nodos.length}</span> piezas · <span className="font-mono">{armada?.globos.length ?? 0}</span> globos{armada?.flores.length ? ` · ${armada.flores.length} flores` : ""}</p>
          <p className="mt-2 text-xs leading-snug text-taller-suave">Elige una pieza en el visor o en «Piezas» para ver sus medidas, colores y lugar. Clic derecho (o mantener el dedo) abre su menú.</p>
        </section>
        <section>{paletaEscena}</section>
        <section className="flex flex-col gap-2" aria-label="Sala">
          <h3 className="taller-rotulo">Sala</h3>
          <div className="grid grid-cols-3 gap-2"><Dato rotulo="Ancho"><span className="font-mono">{metros(escena.sala.anchoCm)}</span></Dato><Dato rotulo="Fondo"><span className="font-mono">{metros(escena.sala.fondoCm)}</span></Dato><Dato rotulo="Alto"><span className="font-mono">{metros(escena.sala.altoCm)}</span></Dato></div>
          <div className="flex gap-3 text-xs"><button type="button" onClick={onSala} className="min-h-8 text-taller-acento hover:underline">Cambiar la sala</button><button type="button" onClick={onPlantillas} className="min-h-8 text-taller-acento hover:underline">Empezar de una plantilla</button></div>
        </section>
        <section>{biblioteca}</section>
      </div>
    );
  }

  const hecho = armada.porNodo.find((n) => n.id === nodo.id);
  const hijos = escena.nodos.filter((n) => padreDe(n) === nodo.id);
  const padreId = padreDe(nodo);
  const padre = padreId ? escena.nodos.find((n) => n.id === padreId) : undefined;
  const ponPieza = (pieza: Pieza) => onNodo(nodo.id, { pieza }, `pieza-${nodo.id}`);
  const recolorear = (de: string, a: string) => {
    const r = reemplazarColor(nodo.pieza, de, a);
    if (r.cambios) onNodo(nodo.id, { pieza: r.valor });
    const nombre = referenciaPorCodigo(a)?.nombreCompleto ?? a;
    setAvisoColor({ id: nodo.id, texto: r.omitidos.length ? `${nombre} no se fabrica en ${r.omitidos.join(", ")}: esos globos quedan como estaban.` : r.cambios ? null : "No había nada de ese color para cambiar." });
  };
  const confirmar = confirmarEliminar?.id === nodo.id ? confirmarEliminar : null;
  const globos = hecho?.globos.length ?? 0;

  return (
    <div className="taller-seccionado flex min-h-full flex-col">
      <section className="flex flex-col">
        <div className="taller-rotulo text-taller-acento">{subtituloPieza(nodo.pieza)}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <label htmlFor="insp-nombre" className="sr-only">Nombre de la pieza</label>
          <input id="insp-nombre" value={nodo.nombre} onChange={(e) => onNodo(nodo.id, { nombre: e.target.value }, `nombre-${nodo.id}`)}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-0 text-lg font-semibold text-taller-texto outline-none hover:border-taller-borde focus:border-taller-resalte focus:px-1.5" />
          {onMas && <button type="button" onClick={() => onMas(nodo.id)} aria-label="Más acciones" title="Más acciones" className={`${BTN_ICO} size-11`}><Ellipsis className="size-5" aria-hidden /></button>}
        </div>
        {hecho?.avisos.map((a) => <p key={a} role="status" className="mt-1 text-xs text-taller-peligro">{a}</p>)}
        {copia !== null && hecho && hecho.copias > 1 && <p className="mt-1 text-xs text-taller-suave">Copia {copia + 1} de {hecho.copias} elegida: las flechas, Q/E y Supr van solo a esa.</p>}
        <div className="mt-3.5 flex gap-2">
          <button type="button" onClick={() => onEditarSola(nodo.id)} className={`${BTN_PRI} flex-1 justify-center`} title="Abre la pieza sola con todos sus parámetros (Enter)">
            <Pencil className="size-[18px]" aria-hidden />Editar sola
          </button>
          <button type="button" onClick={() => onDuplicar(nodo.id)} aria-label="Duplicar" title="Duplicar (Ctrl+D)" className={BTN_ICO}><Copy className="size-[18px]" aria-hidden /></button>
          <button type="button" onClick={() => onEliminar(nodo.id)} aria-label="Eliminar" title="Eliminar (Supr)" className={`${BTN_ICO} text-taller-peligro`}><Trash2 className="size-[18px]" aria-hidden /></button>
        </div>
        {confirmar && (
          <div role="alertdialog" aria-label={`¿Quitar «${nodo.nombre}» con sus decoraciones?`} className="mt-2.5 flex flex-col gap-1.5 rounded-[10px] border border-taller-borde bg-taller-tarjeta p-2.5 text-xs">
            <p>«{nodo.nombre}» lleva {confirmar.decoraciones} decoraciones. ¿Quitarla con ellas?</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" autoFocus onClick={() => onConfirmarEliminar(true)} className="min-h-8 rounded-lg border border-taller-borde px-2 text-taller-peligro hover:bg-taller-encima">Sí, con ellas</button>
              <button type="button" onClick={() => onConfirmarEliminar(false)} className="min-h-8 rounded-lg border border-taller-borde px-2 hover:bg-taller-encima">Solo la estructura</button>
              <button type="button" onClick={() => onConfirmarEliminar(null)} className="min-h-8 rounded-lg px-2 text-taller-suave hover:text-taller-texto">Cancelar</button>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Medidas">
        <h3 className="taller-rotulo">Medidas</h3>
        <Medidas pieza={nodo.pieza} hecho={hecho} onPieza={ponPieza} />
      </section>

      {hecho && hecho.materiales.length > 0 && (
        <section>
          <PaletaEscena variante="muestras" titulo="Colores de la pieza" grupos={[{ id: "todo", nombre: "", materiales: hecho.materiales }]}
            onReemplazar={(de, a) => recolorear(de, a)} aviso={avisoColor?.id === nodo.id ? avisoColor.texto : null} puedeDeshacer={false} onDeshacer={() => {}}
            extra={<button type="button" onClick={() => onEditarSola(nodo.id)} aria-label="Más colores y patrón: editar sola" title="Más colores y patrón (Editar sola)"
              className="grid size-[30px] place-items-center rounded-full border border-dashed border-taller-medio text-taller-medio hover:text-taller-texto"><Plus className="size-3.5" aria-hidden /></button>} />
        </section>
      )}

      <section><Lugar nodo={nodo} escena={escena} armada={armada} onNodo={(cambio, agrupar) => onNodo(nodo.id, cambio, agrupar)} /></section>

      <section className="flex flex-col gap-2.5" aria-label="Decoraciones colgadas">
        <div className="flex items-center justify-between">
          <h3 className="taller-rotulo">{padre ? "Cuelga de" : "Decoraciones colgadas"}</h3>
          {!padre && <button type="button" onClick={() => onColgarOtra(nodo.id)} className="min-h-7 text-xs text-taller-acento hover:underline">{hijos.length ? "Colgar otra" : "Colgar una"}</button>}
        </div>
        {padre ? (
          <div className="flex flex-col gap-1.5">
            <button type="button" onClick={() => onSeleccion(padre.id)} className="flex items-center gap-2.5 rounded-[10px] border border-taller-borde bg-taller-tarjeta px-2.5 py-2 text-left text-[13px] hover:border-taller-resalte">
              <span className="text-taller-acento"><IconoTipo pieza={padre.pieza} /></span><span className="min-w-0 flex-1 truncate">{padre.nombre}</span>
            </button>
            <button type="button" onClick={() => onEditarSostiene(nodo.id)} className="inline-flex min-h-8 items-center gap-1.5 self-start text-xs text-taller-acento hover:underline"><Wrench className="size-3.5" aria-hidden />Editar la estructura que la sostiene</button>
          </div>
        ) : hijos.length === 0 ? <p className="text-xs text-taller-suave">Nada colgado todavía.</p> : (
          <ul className="flex flex-col gap-1.5">
            {hijos.map((h) => {
              const hh = armada.porNodo.find((x) => x.id === h.id);
              const c = h.colocacion;
              return (
                <li key={h.id}>
                  <button type="button" onClick={() => onSeleccion(h.id)} className="flex w-full items-center gap-2.5 rounded-[10px] border border-taller-borde bg-taller-tarjeta px-2.5 py-2 text-left text-[13px] hover:border-taller-resalte">
                    <span className="text-taller-deco"><IconoTipo pieza={h.pieza} className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1 truncate">{h.nombre}</span>
                    <span className="shrink-0 text-xs text-taller-suave">{c.en === "ancla" ? `${c.cada > 0 ? `cada ${c.cada} anclas · ` : ""}×${hh?.copias ?? 1}` : "sobre sus globos"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!enHoja && <section>{biblioteca}</section>}

      <div className="flex-1 border-0" aria-hidden />
      <section className="!bg-taller-barra" aria-label="Lista de compra de esta pieza">
        <div className="flex justify-between text-[13px]"><span className="font-medium">Esta pieza</span><span><span className="font-mono">{globos}</span> globos</span></div>
        {hecho && <LineasMateriales materiales={hecho.materiales} />}
      </section>
    </div>
  );
}
