"use client";

import { Shuffle, Sparkles, Trash2, Pencil } from "lucide-react";
import type { ReglaDecoracion } from "@/lib/globos3d/decoraciones";
import { DECORACIONES_PREDEFINIDAS, TIPOS_DECORACION, armarDecoracion, predefinidasDe, type Decoracion, type TipoDecoracion } from "@/lib/globos3d/figuras";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import type { MezclaDecoraciones } from "@/lib/globos3d/mezcla";
import { ACTIVO, BOTON, Deslizador, EditorFlor, INACTIVO, type DondeDecoracion } from "./PanelFlor";
import { EditorEstrella, EditorFlorCorazones, EditorFlorTubito, EditorMono } from "./EditoresFiguras";
import type { TipoPared } from "./PanelPared";

/**
 * El nombre de una decoración: el de la predefinida si no se ha tocado; si no, el del tipo con su color
 * principal (el de más piezas), para que el nombre no mienta después de cambiarle el color.
 */
export function nombreDecoracion(decoracion: Decoracion): string {
  const clave = JSON.stringify(decoracion);
  const igual = DECORACIONES_PREDEFINIDAS.find((d) => JSON.stringify(d.decoracion) === clave);
  if (igual) return igual.nombre;
  const principal = [...armarDecoracion(decoracion).materiales].sort((x, y) => y.cantidad - x.cantidad)[0];
  const color = principal ? referenciaPorCodigo(principal.codigo)?.nombreCompleto : undefined;
  return `${TIPOS_DECORACION.find((t) => t.id === decoracion.tipo)?.nombre ?? "Decoración"}${color ? ` ${color}` : " (editada)"}`;
}

function EditorDecoracion({ decoracion, onDecoracion }: { decoracion: Decoracion; onDecoracion: (d: Decoracion) => void }) {
  switch (decoracion.tipo) {
    case "flor": return <EditorFlor flor={decoracion.propiedades} onFlor={(propiedades) => onDecoracion({ tipo: "flor", propiedades })} />;
    case "flor_tubito": return <EditorFlorTubito valor={decoracion.propiedades} onCambio={(propiedades) => onDecoracion({ tipo: "flor_tubito", propiedades })} />;
    case "mono": return <EditorMono valor={decoracion.propiedades} onCambio={(propiedades) => onDecoracion({ tipo: "mono", propiedades })} />;
    case "estrella": return <EditorEstrella valor={decoracion.propiedades} onCambio={(propiedades) => onDecoracion({ tipo: "estrella", propiedades })} />;
    case "flor_corazones": return <EditorFlorCorazones valor={decoracion.propiedades} onCambio={(propiedades) => onDecoracion({ tipo: "flor_corazones", propiedades })} />;
  }
}

type Props = {
  /** La decoración del editor: la suelta o, si `editando` no es null, la de ese elemento de la mezcla. */
  decoracion: Decoracion;
  onDecoracion: (d: Decoracion) => void;
  editando: number | null;
  onEditando: (i: number | null) => void;
  donde: DondeDecoracion;
  onDonde: (d: DondeDecoracion) => void;
  regla: ReglaDecoracion;
  onRegla: (r: ReglaDecoracion) => void;
  usarMezcla: boolean;
  onUsarMezcla: (v: boolean) => void;
  mezcla: MezclaDecoraciones;
  onMezcla: (m: MezclaDecoraciones) => void;
  tipoPared: TipoPared;
  /** Cuántas de cada elemento de la mezcla quedaron puestas (las que cupieron). */
  puestas: readonly number[];
  onCelebra: () => void;
};

/**
 * Pestaña Decoración: qué decoración (tipo, predefinidas y todas sus propiedades) y dónde va (sola, en la
 * columna, en el arco o en la pared). En la pared se pueden mezclar varias decoraciones y repartirlas en las
 * anclas por proporciones o en ciclo, con semilla fija; «Pared de Celebra ed. 27» deja todo como la foto.
 */
export function PanelDecoracion(props: Props) {
  const { decoracion, onDecoracion, editando, onEditando, donde, onDonde, regla, onRegla, usarMezcla, onUsarMezcla, mezcla, onMezcla, tipoPared, puestas, onCelebra } = props;
  const enMezcla = donde === "pared" && usarMezcla;
  const elegirTipo = (tipo: TipoDecoracion) => { if (tipo !== decoracion.tipo) onDecoracion(predefinidasDe(tipo)[0]!.decoracion); };
  const ponElemento = (i: number, cambio: Partial<MezclaDecoraciones["elementos"][number]>) => onMezcla({ ...mezcla, elementos: mezcla.elementos.map((e, k) => (k === i ? { ...e, ...cambio } : e)) });

  return (
    <>
      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <button type="button" onClick={onCelebra} className={`inline-flex items-center justify-center gap-2 ${BOTON} ${INACTIVO}`}>
          <Sparkles className="size-4 text-acento" aria-hidden /> Pared de Celebra ed. 27
        </button>
        <p className="text-xs text-texto-suave">Malla de trenzas rosada alternando R-12 y R-9, con sus 25 decoraciones cada una en su sitio de la foto (p. 42).</p>
      </section>

      {!enMezcla && (
        <>
          <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Decoración</h2>
        <div className="grid grid-cols-2 gap-1">
          {TIPOS_DECORACION.map((t) => (
            <button key={t.id} type="button" title={t.descripcion} onClick={() => elegirTipo(t.id)} aria-pressed={decoracion.tipo === t.id} className={`${BOTON} ${decoracion.tipo === t.id ? ACTIVO : INACTIVO}`}>{t.nombre}</button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">{TIPOS_DECORACION.find((t) => t.id === decoracion.tipo)?.descripcion}</p>
        <div className="grid grid-cols-2 gap-1">
          {predefinidasDe(decoracion.tipo).map((d) => (
            <button key={d.id} type="button" title={d.descripcion} onClick={() => onDecoracion(d.decoracion)} className={`${BOTON} ${JSON.stringify(d.decoracion) === JSON.stringify(decoracion) ? ACTIVO : INACTIVO}`}>{d.nombre}</button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">Elige una para empezar; después cambia cualquier propiedad.</p>
          </section>
          <EditorDecoracion decoracion={decoracion} onDecoracion={onDecoracion} />
        </>
      )}

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Dónde va</h2>
        <div className="grid grid-cols-2 gap-1">
          {([["sola", "Sola"], ["columna", "En la columna"], ["arco", "En el arco"], ["pared", "En la pared"]] as const).map(([valor, etiqueta]) => (
            <button key={valor} type="button" onClick={() => onDonde(valor)} aria-pressed={donde === valor} className={`${BOTON} ${donde === valor ? ACTIVO : INACTIVO}`}>{etiqueta}</button>
          ))}
        </div>
        {donde === "pared" && (
          <label className="flex items-center gap-2 text-sm text-texto" htmlFor="usar-mezcla">
            <input id="usar-mezcla" type="checkbox" checked={usarMezcla} onChange={(e) => onUsarMezcla(e.target.checked)} /> Mezclar varias decoraciones
          </label>
        )}
        {donde !== "sola" && !enMezcla && (
          <>
            <Deslizador id="regla-cada" etiqueta={donde === "pared" ? (tipoPared === "malla" ? "Cada cuántas flores de la malla" : "Cada cuántos cuartetos") : "Cada cuántos cuartetos"} valor={regla.cadaNiveles} min={1} max={6} paso={1} texto={regla.cadaNiveles === 1 ? "en todas" : `1 de cada ${regla.cadaNiveles}`} onCambio={(v) => onRegla({ ...regla, cadaNiveles: v })} />
            {donde !== "pared" && <div className="grid grid-cols-3 gap-1">
              {([1, 2, 4] as const).map((n) => (
                <button key={n} type="button" onClick={() => onRegla({ ...regla, caras: n })} aria-pressed={regla.caras === n} className={`${BOTON} ${regla.caras === n ? ACTIVO : INACTIVO}`}>{n === 1 ? "1 cara" : `${n} caras`}</button>
              ))}
            </div>}
            <p className="text-xs text-texto-suave">
              {donde === "pared" ? (tipoPared === "malla" ? "Van en los centros de flor de la malla, al frente." : "Van en el eje de las trenzas, al frente, alternando entre trenzas vecinas.") : "Van en los huecos entre globos."} La columna, el arco y la pared son los que armaste en sus pestañas.
            </p>
          </>
        )}
      </section>

      {enMezcla && (
        <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
          <h2 className="text-sm font-semibold text-texto">Mezcla en la pared</h2>
          <ul className="flex flex-col gap-1.5">
            {mezcla.elementos.map((e, i) => (
              <li key={i} className={`rounded-xl p-2 ring-1 ${editando === i ? "ring-acento" : "ring-borde"}`}>
                <div className="flex items-center justify-between gap-2 text-xs text-texto">
                  <span className="min-w-0 truncate font-semibold">{e.nombre}</span>
                  <span className="shrink-0 font-mono text-texto-suave">{puestas[i] ?? 0} puestas</span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => onEditando(editando === i ? null : i)} aria-pressed={editando === i} aria-label={`Editar ${e.nombre}`} title="Editar sus propiedades" className="grid size-11 place-items-center rounded-lg ring-1 ring-borde hover:bg-superficie-suave lg:size-8"><Pencil className="size-3.5" aria-hidden /></button>
                    <button type="button" onClick={() => { onMezcla({ ...mezcla, elementos: mezcla.elementos.filter((_, k) => k !== i) }); onEditando(null); }} aria-label={`Quitar ${e.nombre}`} title="Quitar de la mezcla" className="grid size-11 place-items-center rounded-lg ring-1 ring-borde hover:bg-superficie-suave lg:size-8"><Trash2 className="size-3.5" aria-hidden /></button>
                  </span>
                </div>
                {editando === i && (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-xs text-texto-suave">Cambia sus propiedades: se ve al instante en las {puestas[i] ?? 0} de la pared.</p>
                    <EditorDecoracion decoracion={decoracion} onDecoracion={onDecoracion} />
                    <button type="button" onClick={() => onEditando(null)} className={`${BOTON} ${INACTIVO}`}>Listo</button>
                  </div>
                )}
                {mezcla.modo !== "fijo" && <Deslizador id={`peso-${i}`} etiqueta={mezcla.modo === "proporcional" ? "Peso" : "Seguidas en el ciclo"} valor={e.peso} min={0} max={10} paso={1} texto={`${e.peso}`} onCambio={(v) => ponElemento(i, { peso: v })} />}
              </li>
            ))}
          </ul>
          {editando === null && (
            <details className="rounded-xl p-2 ring-1 ring-borde">
              <summary className="cursor-pointer text-sm font-semibold text-texto">Añadir otra decoración</summary>
              <div className="mt-2 flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-texto">Cuál</h3>
        <div className="grid grid-cols-2 gap-1">
          {TIPOS_DECORACION.map((t) => (
            <button key={t.id} type="button" title={t.descripcion} onClick={() => elegirTipo(t.id)} aria-pressed={decoracion.tipo === t.id} className={`${BOTON} ${decoracion.tipo === t.id ? ACTIVO : INACTIVO}`}>{t.nombre}</button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">{TIPOS_DECORACION.find((t) => t.id === decoracion.tipo)?.descripcion}</p>
        <div className="grid grid-cols-2 gap-1">
          {predefinidasDe(decoracion.tipo).map((d) => (
            <button key={d.id} type="button" title={d.descripcion} onClick={() => onDecoracion(d.decoracion)} className={`${BOTON} ${JSON.stringify(d.decoracion) === JSON.stringify(decoracion) ? ACTIVO : INACTIVO}`}>{d.nombre}</button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">Elige una para empezar; después cambia cualquier propiedad.</p>
                <EditorDecoracion decoracion={decoracion} onDecoracion={onDecoracion} />
                <button type="button" onClick={() => onMezcla({ ...mezcla, modo: mezcla.modo === "fijo" ? "proporcional" : mezcla.modo, elementos: [...mezcla.elementos, { nombre: nombreDecoracion(decoracion), decoracion, peso: 1 }] })}
                  className={`${BOTON} ${ACTIVO}`}>Añadir a la mezcla</button>
              </div>
            </details>
          )}
          <div className={`grid gap-1 ${mezcla.fijas?.length ? "grid-cols-3" : "grid-cols-2"}`}>
            {([...(mezcla.fijas?.length ? [["fijo", "Como la foto"] as const] : []), ["proporcional", "Por proporciones"], ["ciclico", "En ciclo"]] as const).map(([valor, etiqueta]) => (
              <button key={valor} type="button" onClick={() => onMezcla({ ...mezcla, modo: valor })} aria-pressed={mezcla.modo === valor} className={`${BOTON} ${mezcla.modo === valor ? ACTIVO : INACTIVO}`}>{etiqueta}</button>
            ))}
          </div>
          <p className="text-xs text-texto-suave">{mezcla.modo === "fijo" ? "Cada decoración en su sitio exacto de la foto. Para repartir otras o cambiar cuántas van, pasa a «Por proporciones»." : mezcla.modo === "proporcional" ? "Reparte el total según los pesos, en anclas al azar (siempre igual con la misma semilla); las grandes primero." : "Recorre las anclas de arriba abajo y pone las decoraciones en orden, una tras otra."}</p>
          {mezcla.modo !== "fijo" && (<>
          <Deslizador id="mezcla-total" etiqueta="Total" valor={mezcla.total} min={1} max={80} paso={1} texto={`${mezcla.total} decoraciones`} onCambio={(v) => onMezcla({ ...mezcla, total: v })} />
          <Deslizador id="mezcla-separacion" etiqueta="Separación entre bordes" valor={mezcla.separacionCm} min={-15} max={30} paso={1} texto={mezcla.separacionCm < 0 ? `se pisan ${-mezcla.separacionCm} cm` : `${mezcla.separacionCm} cm`} onCambio={(v) => onMezcla({ ...mezcla, separacionCm: v })} />
          <div className="flex items-center gap-2">
            <label htmlFor="mezcla-semilla" className="text-xs font-semibold text-texto">Semilla</label>
            <input id="mezcla-semilla" type="number" min={0} step={1} value={mezcla.semilla} onChange={(e) => onMezcla({ ...mezcla, semilla: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="min-h-11 w-24 rounded-lg bg-superficie px-2 font-mono text-base text-texto ring-1 ring-borde lg:min-h-10 lg:text-sm" />
            <button type="button" onClick={() => onMezcla({ ...mezcla, semilla: mezcla.semilla + 1 })} className={`inline-flex items-center gap-1 ${BOTON} ${INACTIVO}`}><Shuffle className="size-4" aria-hidden /> Otra</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-texto" htmlFor="mezcla-giro">
            <input id="mezcla-giro" type="checkbox" checked={mezcla.giroAleatorio} onChange={(e) => onMezcla({ ...mezcla, giroAleatorio: e.target.checked })} /> Girar las flores al azar (el moño y la estrella quedan derechos)
          </label>
          </>)}
        </section>
      )}
    </>
  );
}
