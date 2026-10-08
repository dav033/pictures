"use client";

import { useState } from "react";
import { Anchor, Sparkles } from "lucide-react";
import { coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import { PATRONES_MALLA, type PatronMalla } from "@/lib/globos3d/paredes";
import { ANCHO_TRENZA_POR_SUMA, PASO_ALTERNADO_POR_DIAMETRO, PATRONES_TRENZAS, type OpcionesParedTrenzas, type TamanoCuarteto } from "@/lib/globos3d/pared-trenzas";
import { Deslizador, SelectorColor } from "./PanelFlor";

/** Los dos murales del taller: la malla Link-O-Loon tipo flor y las trenzas de cuartetos alternando tamaños. */
export type TipoPared = "malla" | "trenzas";

export type OpcionesPared = {
  formatoId: "LOL-6" | "LOL-12";
  infladoCm: number;
  anchoCm: number;
  altoCm: number;
  patron: PatronMalla;
  colores: string[];
  union: { infladoCm: number; codigo: string };
};

/** Los valores del mural flor de Celebra ed. 2 (LOL Violeta, Lila, Fucsia y Rosado; uniones Pastel Rosado). */
export const PARED_INICIAL: OpcionesPared = { formatoId: "LOL-12", infladoCm: 24, anchoCm: 300, altoCm: 225, patron: "rombos", colores: ["051", "650", "012", "009"], union: { infladoCm: 10, codigo: "609" } };

const BOTON = "min-h-11 rounded-xl px-2 text-sm ring-1 transition-colors";
const ACTIVO = "bg-acento text-sobre-acento ring-acento";
const INACTIVO = "bg-superficie text-texto ring-borde hover:bg-superficie-suave";
/** Colores para los puestos nuevos al pasar a un patrón de más colores: distintos de los que ya hay, para que se note. */
const CONTRASTES = ["009", "005", "012", "050", "031", "020"];
function completarColores(actuales: readonly string[], n: number, formatoId: string): string[] {
  const salida = [...actuales];
  for (const c of [...CONTRASTES, ...coloresDelFormato(formatoId).map((x) => x.codigo)]) {
    if (salida.length >= n) break;
    if (!salida.includes(c) && coloresDelFormato(formatoId).some((x) => x.codigo === c)) salida.push(c);
  }
  return salida;
}
const m = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;

type Props = {
  tipo: TipoPared;
  onTipo: (t: TipoPared) => void;
  valor: OpcionesPared;
  onCambio: (v: OpcionesPared) => void;
  trenzas: OpcionesParedTrenzas;
  onTrenzas: (v: OpcionesParedTrenzas) => void;
  verAnclas: boolean;
  onVerAnclas: (v: boolean) => void;
  anclas: number;
  onCelebra: () => void;
};

/** Pestaña Pared: el tipo de mural y su editor. */
export function PanelPared({ tipo, onTipo, valor, onCambio, trenzas, onTrenzas, verAnclas, onVerAnclas, anclas, onCelebra }: Props) {
  return (
    <>
      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Tipo de pared</h2>
        <div className="grid grid-cols-2 gap-1">
          {([["malla", "Malla LOL tipo flor"], ["trenzas", "Trenzas alternando tamaños"]] as const).map(([id, nombre]) => (
            <button key={id} type="button" onClick={() => onTipo(id)} aria-pressed={tipo === id} className={`${BOTON} ${tipo === id ? ACTIVO : INACTIVO}`}>{nombre}</button>
          ))}
        </div>
        <button type="button" onClick={onCelebra} className={`inline-flex items-center justify-center gap-2 ${BOTON} ${INACTIVO}`}>
          <Sparkles className="size-4 text-acento" aria-hidden /> Pared de Celebra ed. 27 con sus decoraciones
        </button>
        <label className="flex items-center gap-2 text-sm text-texto" htmlFor="pared-anclas">
          <input id="pared-anclas" type="checkbox" checked={verAnclas} onChange={(e) => onVerAnclas(e.target.checked)} />
          <Anchor className="size-4 text-acento" aria-hidden /> Ver anclas ({anclas})
        </label>
      </section>
      {tipo === "malla" ? <PanelMalla valor={valor} onCambio={onCambio} /> : <PanelTrenzas valor={trenzas} onCambio={onTrenzas} />}
    </>
  );
}

const FORMATOS_CUARTETO = ["R-5", "R-9", "R-12", "R-18"] as const;

/** Formato e inflado de uno de los dos cuartetos (grande o chico). */
function TamanoEditor({ id, titulo, valor, onCambio }: { id: string; titulo: string; valor: TamanoCuarteto; onCambio: (v: TamanoCuarteto) => void }) {
  const f = formatoPorId(valor.formatoId) ?? formatoPorId("R-12")!;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-texto">{titulo}</p>
      <div className="grid grid-cols-4 gap-1">
        {FORMATOS_CUARTETO.map((fid) => (
          <button key={fid} type="button" onClick={() => onCambio({ formatoId: fid, infladoCm: formatoPorId(fid)!.infladoDecoracionCm })} aria-pressed={valor.formatoId === fid} className={`${BOTON} ${valor.formatoId === fid ? ACTIVO : INACTIVO}`}>{fid}</button>
        ))}
      </div>
      <Deslizador id={`${id}-inflado`} etiqueta="Inflado" valor={valor.infladoCm} min={Math.round(f.diametroMaxCm * 0.5)} max={f.diametroMaxCm} paso={0.5} texto={`${valor.infladoCm} cm`} onCambio={(v) => onCambio({ ...valor, infladoCm: v })} />
    </div>
  );
}

/**
 * Editor de la pared de trenzas alternando tamaños: medidas, los dos cuartetos (formato e inflado), con cuál
 * empieza la primera trenza, patrón y colores. Muestra el paso y el ancho de trenza que salen de la regla del PDF.
 */
function PanelTrenzas({ valor, onCambio }: { valor: OpcionesParedTrenzas; onCambio: (v: OpcionesParedTrenzas) => void }) {
  const [puesto, setPuesto] = useState(0);
  const pon = (cambio: Partial<OpcionesParedTrenzas>) => onCambio({ ...valor, ...cambio });
  const patron = PATRONES_TRENZAS.find((p) => p.id === valor.patron) ?? PATRONES_TRENZAS[0]!;
  const puestoValido = puesto < patron.colores ? puesto : 0;
  const paso = ((valor.grande.infladoCm + valor.chico.infladoCm) / 2) * PASO_ALTERNADO_POR_DIAMETRO;
  const anchoTrenza = (valor.grande.infladoCm + valor.chico.infladoCm) * ANCHO_TRENZA_POR_SUMA;
  // En «por tamaño» el color 2 lo llevan los chicos: se ofrecen los de su formato; si no, los del grande.
  const formatoColor = valor.patron === "por_tamano" && puestoValido === 1 ? valor.chico.formatoId : valor.grande.formatoId;
  const colores = Array.from({ length: patron.colores }, (_, i) => valor.colores[i] ?? valor.colores[0] ?? "609");
  const nf = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: 1 });

  return (
    <>
      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Trenzas alternando tamaños</h2>
        <p className="text-xs text-texto-suave">Trenzas de cuartetos lado a lado, alternando grande y chico; la vecina empieza con el tamaño opuesto para encajar. De frente el chico muestra 3 globos y el grande 2.</p>
        <Deslizador id="trenzas-ancho" etiqueta="Ancho" valor={valor.anchoCm} min={50} max={500} paso={10} texto={m(valor.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
        <Deslizador id="trenzas-alto" etiqueta="Alto" valor={valor.altoCm} min={60} max={350} paso={5} texto={m(valor.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
        <TamanoEditor id="trenzas-grande" titulo="Cuarteto grande" valor={valor.grande} onCambio={(grande) => pon({ grande })} />
        <TamanoEditor id="trenzas-chico" titulo="Cuarteto chico" valor={valor.chico} onCambio={(chico) => pon({ chico })} />
        <p className="font-mono text-xs text-texto-suave">Paso {nf(paso)} cm ({nf(100 / paso)} cuartetos por metro) · {nf(anchoTrenza)} cm por trenza</p>
        <div className="grid grid-cols-2 gap-1">
          {(["grande", "chico"] as const).map((t) => (
            <button key={t} type="button" onClick={() => pon({ empiezaCon: t })} aria-pressed={valor.empiezaCon === t} className={`${BOTON} ${valor.empiezaCon === t ? ACTIVO : INACTIVO}`}>Empieza con el {t}</button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Colores</h2>
        <div className="grid grid-cols-2 gap-1">
          {PATRONES_TRENZAS.map((p) => (
            <button key={p.id} type="button" onClick={() => { pon({ patron: p.id, colores: completarColores(valor.colores, Math.max(p.colores, valor.colores.length), valor.grande.formatoId) }); setPuesto(0); }} aria-pressed={valor.patron === p.id} className={`${BOTON} ${valor.patron === p.id ? ACTIVO : INACTIVO}`}>{p.nombre}</button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">{patron.descripcion}</p>
        {patron.colores > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            {colores.map((codigo, i) => {
              const ref = coloresDelFormato(valor.grande.formatoId).find((c) => c.codigo === codigo) ?? coloresDelFormato(valor.chico.formatoId).find((c) => c.codigo === codigo);
              return (
                <button key={i} type="button" onClick={() => setPuesto(i)} aria-pressed={puestoValido === i} aria-label={`Color ${i + 1}: ${ref?.nombreCompleto ?? codigo}`} title={`Color ${i + 1}: ${ref?.nombreCompleto ?? codigo}`}
                  className={`grid size-10 place-items-center rounded-full font-mono text-xs ring-2 ring-offset-2 ring-offset-superficie ${puestoValido === i ? "ring-acento" : "ring-borde"}`}
                  style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
              );
            })}
          </div>
        )}
        <SelectorColor formatoId={formatoColor} valor={colores[puestoValido] ?? ""} onCambio={(codigo) => pon({ colores: colores.map((c, i) => (i === puestoValido ? codigo : c)) })} etiqueta={`Color ${puestoValido + 1} de la pared`} />
      </section>
    </>
  );
}

/** Editor de la malla Link-O-Loon tipo flor: medidas, eslabón, patrón y colores de las flores y de las uniones. */
function PanelMalla({ valor, onCambio }: { valor: OpcionesPared; onCambio: (v: OpcionesPared) => void }) {
  const [puesto, setPuesto] = useState<number | "union">(0);
  const patron = PATRONES_MALLA.find((p) => p.id === valor.patron) ?? PATRONES_MALLA[0]!;
  const fLol = formatoPorId(valor.formatoId)!;
  const pon = (cambio: Partial<OpcionesPared>) => onCambio({ ...valor, ...cambio });
  const elegirFormato = (formatoId: OpcionesPared["formatoId"]) => {
    const f = formatoPorId(formatoId)!;
    const existen = coloresDelFormato(formatoId);
    pon({ formatoId, infladoCm: f.id === "LOL-6" ? 12 : 24, colores: valor.colores.map((c) => (existen.some((e) => e.codigo === c) ? c : existen[0]?.codigo ?? c)) });
  };
  const puestoValido = puesto === "union" || puesto < patron.colores ? puesto : 0;

  return (
    <>
      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Malla Link-O-Loon tipo flor</h2>
        <p className="text-xs text-texto-suave">Cadenetas en diagonal con una pareja de unión en cada cruce; cada 4 eslabones forman una flor.</p>
        <Deslizador id="pared-ancho" etiqueta="Ancho" valor={valor.anchoCm} min={80} max={500} paso={10} texto={m(valor.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
        <Deslizador id="pared-alto" etiqueta="Alto" valor={valor.altoCm} min={80} max={350} paso={10} texto={m(valor.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
        <div className="grid grid-cols-2 gap-1">
          {(["LOL-6", "LOL-12"] as const).map((id) => (
            <button key={id} type="button" onClick={() => elegirFormato(id)} aria-pressed={valor.formatoId === id} className={`${BOTON} ${valor.formatoId === id ? ACTIVO : INACTIVO}`}>{id}</button>
          ))}
        </div>
        <Deslizador id="pared-inflado" etiqueta="Inflado del eslabón" valor={valor.infladoCm} min={Math.round(fLol.diametroMaxCm * 0.6)} max={fLol.diametroMaxCm} paso={0.5} texto={`${valor.infladoCm} cm`} onCambio={(v) => pon({ infladoCm: v })} />
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Colores</h2>
        <div className="grid grid-cols-2 gap-1">
          {PATRONES_MALLA.map((p) => (
            <button key={p.id} type="button" onClick={() => { pon({ patron: p.id }); setPuesto(0); }} aria-pressed={valor.patron === p.id} className={`${BOTON} ${valor.patron === p.id ? ACTIVO : INACTIVO}`}>{p.nombre}</button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">{patron.descripcion}</p>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: patron.colores }, (_, i) => {
            const ref = coloresDelFormato(valor.formatoId).find((c) => c.codigo === valor.colores[i]);
            return (
              <button key={i} type="button" onClick={() => setPuesto(i)} aria-pressed={puestoValido === i} title={`Flores ${i + 1}: ${ref?.nombreCompleto ?? ""}`} aria-label={`Color de flores ${i + 1}: ${ref?.nombreCompleto ?? ""}`}
                className={`grid size-10 place-items-center rounded-full font-mono text-xs ring-2 ring-offset-2 ring-offset-superficie ${puestoValido === i ? "ring-acento" : "ring-borde"}`}
                style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
            );
          })}
          <button type="button" onClick={() => setPuesto("union")} aria-pressed={puestoValido === "union"} title="Parejas de unión"
            className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs ring-2 ring-offset-2 ring-offset-superficie ${puestoValido === "union" ? "ring-acento" : "ring-borde"}`}>
            <span className="size-4 rounded-full" style={{ background: coloresDelFormato("R-5").find((c) => c.codigo === valor.union.codigo)?.hexGlobo }} /> Uniones R-5
          </button>
        </div>
        {puestoValido === "union" ? (
          <>
            <Deslizador id="union-inflado" etiqueta="Inflado de las uniones" valor={valor.union.infladoCm} min={6} max={12.5} paso={0.5} texto={`${valor.union.infladoCm} cm`} onCambio={(v) => pon({ union: { ...valor.union, infladoCm: v } })} />
            <SelectorColor formatoId="R-5" valor={valor.union.codigo} onCambio={(codigo) => pon({ union: { ...valor.union, codigo } })} etiqueta="Color de las uniones" />
          </>
        ) : (
          <SelectorColor formatoId={valor.formatoId} valor={valor.colores[puestoValido] ?? ""} onCambio={(codigo) => pon({ colores: valor.colores.map((c, i) => (i === puestoValido ? codigo : c)) })} etiqueta={`Color de las flores ${puestoValido + 1}`} />
        )}
      </section>
    </>
  );
}
