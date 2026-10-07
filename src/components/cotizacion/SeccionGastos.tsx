"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Hammer, Plus, Receipt, Trash2, Truck, Undo2, type LucideIcon } from "lucide-react";
import { DESCRIPCIONES_SECCION, TITULOS_SECCION, filaEnBlanco, type ErroresFila, type FilaCosto } from "@/lib/cotizacion/borrador-profesional";
import type { FilaQuitada } from "@/lib/cotizacion/deshacer-fila";
import { estadoFilas } from "@/lib/cotizacion/limites-filas";
import { SECCIONES_COSTO, type SeccionCosto } from "@/lib/cotizacion/profesional";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { DUR, EASE_SALIDA } from "@/components/guiado/animacion/movimiento";
import { CONCEPTOS_GASTO, INVITACION_LISTA, cambiosConCantidad, conceptosLibres } from "./conceptos-gasto";
import { FilaGasto } from "./FilaGasto";
import { CLASE_NO_VIGENTE } from "./formato";
import { registrarCotizacion, useRegistroEscrito } from "./registro-cotizacion";

/** Fila y campo que deben recibir el foco: la descripción de una fila nueva, o su valor si ya trae descripción. */
export type FocoFila = { fila: string; campo: "descripcion" | "costo" };

type Props = {
  seccion: SeccionCosto;
  clave: string;
  filas: FilaCosto[];
  /** Qué dice cada celda mala, por id de fila. */
  errores: Record<string, ErroresFila>;
  /** Lo que impide calcular si hay más gastos que el tope. */
  exceso?: string;
  /** El resultado que se ve es el anterior: los importes se atenúan. */
  atenuar: boolean;
  /** Subtotal de una fila según el último cálculo, o `null` si esa fila no formó parte. */
  subtotal: (id: string) => number | null;
  /** Total de la lista según Python, o `null` si la lista no estuvo en el cálculo. */
  total: number | null;
  /** El gasto que acaba de quitarse, para devolverlo. */
  quitada: FilaQuitada | null;
  /** Fila que debe recibir el foco (la que se acaba de agregar). */
  foco: FocoFila | null;
  onFocoListo: () => void;
  onCambiar: (id: string, cambios: Partial<FilaCosto>) => void;
  /** Agrega una fila; con `descripcion`, ya escrita (una idea de un toque). */
  onAgregar: (descripcion?: string) => void;
  onQuitar: (id: string) => void;
  onDeshacer: () => void;
};

const ICONO_SECCION: Record<SeccionCosto, LucideIcon> = {
  mano_de_obra: Hammer,
  equipos_transporte: Truck,
  indirectos: Receipt,
};

const CHIP = "inline-flex shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-acento";

/**
 * Una lista de gastos (tu trabajo, transporte, otros): vacía, invita con ideas
 * de un toque; con filas, cada una compacta con su total de Python a la
 * derecha. Quitar se puede deshacer. Aquí no se suma nada: los totales son
 * los de Python y, mientras no hay uno, se dice qué falta en vez de un «—».
 */
export function SeccionGastos(props: Props) {
  const { seccion, clave, filas, errores, exceso, atenuar, subtotal, total, quitada, foco, onFocoListo } = props;
  const titulo = TITULOS_SECCION[seccion];
  const Icono = ICONO_SECCION[seccion];
  const limite = estadoFilas(filas.length);
  const idAyuda = `${seccion}-${clave}-limite`;
  // Sin el nombre interno de la lista en el id: el marcado no debe decir «indirectos».
  const idTitulo = `gastos-${clave}-${SECCIONES_COSTO.indexOf(seccion)}-titulo`;
  const registrarEscrito = useRegistroEscrito();
  // Las filas que ya estaban (un borrador recuperado) cuentan como vistas: lo que les falte se marca en rojo.
  const [tocadas, setTocadas] = useState<ReadonlySet<string>>(() => new Set(filas.map((fila) => fila.id)));

  useEffect(() => {
    if (!foco || !filas.some((fila) => fila.id === foco.fila)) return;
    document.getElementById(`${seccion}-${clave}-${foco.fila}-${foco.campo}`)?.focus();
    onFocoListo();
  }, [foco, filas, seccion, clave, onFocoListo]);

  const empezadas = filas.filter((fila) => !filaEnBlanco(fila));
  const hayIncompletas = empezadas.some((fila) => errores[fila.id] !== undefined);
  const libres = conceptosLibres(seccion, filas);
  const hayFilaSinDescripcion = filas.some((fila) => !fila.descripcion.trim());

  function agregar(descripcion?: string): void {
    if (limite.llena) return;
    registrarCotizacion("gasto.agregar", { seccion, origen: descripcion ? "idea" : "boton", ...(descripcion ? { concepto: descripcion } : {}) });
    props.onAgregar(descripcion);
  }

  function cambiar(fila: FilaCosto, cambios: Partial<FilaCosto>, campo: string): void {
    const completos = cambiosConCantidad(fila, cambios);
    registrarEscrito(`${fila.id}:${campo}`, "gasto.editar", { seccion, fila: fila.id, campo, valor: String(completos[campo as keyof FilaCosto] ?? "").slice(0, 120) });
    props.onCambiar(fila.id, completos);
  }

  function deshacer(): void {
    if (quitada) registrarCotizacion("gasto.deshacer", { seccion, fila: quitada.fila.id });
    props.onDeshacer();
  }

  /** El aviso «Quitaste…» va donde estaba la fila quitada, para deshacer sin buscarlo. */
  function conDeshacerEnSuSitio(hijos: ReactNode[]): ReactNode[] {
    if (!quitada) return hijos;
    const copia = [...hijos];
    copia.splice(Math.min(quitada.indice, copia.length), 0, <BarraDeshacer key={`deshacer-${quitada.fila.id}`} quitada={quitada} onDeshacer={deshacer} comoFila />);
    return copia;
  }

  return (
    <section className="mt-6" aria-labelledby={idTitulo}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-acento-suave text-acento" aria-hidden="true">
          <Icono className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={idTitulo} className="text-sm font-semibold leading-5 text-texto">{titulo}</h3>
          <p className="text-xs leading-4 text-texto-suave">{DESCRIPCIONES_SECCION[seccion]}</p>
        </div>
        <button
          type="button"
          onClick={() => agregar()}
          disabled={limite.llena}
          aria-label={`Agregar a ${titulo}`}
          aria-describedby={limite.llena ? idAyuda : undefined}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-[13px] font-semibold text-acento @sm:px-3 transition-colors hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:text-texto-suave disabled:hover:bg-transparent"
        >
          <Plus className="size-4" aria-hidden="true" /><span className="hidden @sm:inline">Agregar</span>
        </button>
      </div>
      {(limite.contador || exceso) && (
        <p id={idAyuda} className={`mt-1 text-xs ${exceso ? "text-error" : limite.llena ? "text-aviso" : "text-texto-suave"}`}>
          {exceso ?? `${limite.contador}${limite.motivoSinAgregar ? `. ${limite.motivoSinAgregar}` : ""}`}
        </p>
      )}

      <AnimatePresence initial={false}>
        {filas.length === 0 && quitada && <BarraDeshacer key={`deshacer-${quitada.fila.id}`} quitada={quitada} onDeshacer={deshacer} />}
      </AnimatePresence>

      {filas.length === 0 ? (
        <div className="mt-2.5 rounded-xl border border-dashed border-borde bg-fondo/40 p-3">
          <p className="text-xs text-texto-suave">{INVITACION_LISTA[seccion]}</p>
          <div role="group" aria-label={`Ideas para ${titulo}`} className="mt-2 flex flex-wrap gap-1.5">
            {/* Las tres más comunes; «Otro…» abre una fila en blanco que ofrece todas. */}
            {CONCEPTOS_GASTO[seccion].slice(0, 3).map((concepto) => (
              <button key={concepto} type="button" onClick={() => agregar(concepto)} aria-label={`Agregar ${concepto}`} className={`${CHIP} h-9 bg-superficie text-texto ring-borde hover:bg-acento-suave hover:text-acento hover:ring-acento/40`}>
                <Plus className="size-3.5 text-acento" aria-hidden="true" />{concepto}
              </button>
            ))}
            <button type="button" onClick={() => agregar()} className={`${CHIP} h-9 text-texto-suave ring-transparent hover:bg-acento-suave hover:text-acento`}>
              Otro…
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-2.5 space-y-2" aria-label={titulo}>
          <AnimatePresence initial={false}>
            {conDeshacerEnSuSitio(filas.map((fila) => (
              <FilaGasto
                key={fila.id}
                seccion={seccion}
                base={`${seccion}-${clave}-${fila.id}`}
                titulo={titulo}
                fila={fila}
                errores={errores[fila.id] ?? {}}
                tocada={tocadas.has(fila.id)}
                subtotal={subtotal(fila.id)}
                atenuar={atenuar}
                onCambiar={(cambios, campo) => cambiar(fila, cambios, campo)}
                onConcepto={(concepto) => {
                  registrarCotizacion("gasto.idea", { seccion, fila: fila.id, concepto });
                  props.onCambiar(fila.id, cambiosConCantidad(fila, { descripcion: concepto }));
                  document.getElementById(`${seccion}-${clave}-${fila.id}-costo`)?.focus();
                }}
                onPaso={(sentido, texto) => {
                  registrarCotizacion("gasto.cantidad", { seccion, fila: fila.id, sentido: sentido > 0 ? "mas" : "menos", cantidad: texto });
                  props.onCambiar(fila.id, { cantidad: texto });
                }}
                onQuitar={() => {
                  registrarCotizacion("gasto.quitar", { seccion, fila: fila.id, descripcion: fila.descripcion.slice(0, 120), enBlanco: filaEnBlanco(fila) });
                  props.onQuitar(fila.id);
                }}
                onSalir={() => setTocadas((previas) => (previas.has(fila.id) ? previas : new Set(previas).add(fila.id)))}
              />
            )))}
          </AnimatePresence>
        </ul>
      )}

      {filas.length > 0 && !hayFilaSinDescripcion && libres.length > 0 && !limite.llena && (
        <div role="group" aria-label={`Sumar otro a ${titulo}`} className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none]">
          <span className="shrink-0 text-xs text-texto-suave">Sumar:</span>
          {libres.map((concepto) => (
            <button key={concepto} type="button" onClick={() => agregar(concepto)} aria-label={`Agregar ${concepto}`} className={`${CHIP} h-9 bg-transparent text-texto-suave ring-borde-suave hover:bg-acento-suave hover:text-acento`}>
              <Plus className="size-3" aria-hidden="true" />{concepto}
            </button>
          ))}
        </div>
      )}

      {empezadas.length > 0 && (
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-dashed border-borde-suave px-1 pt-2">
          <span className="text-xs font-medium text-texto-suave">Total</span>
          {total !== null ? (
            <span className={`text-sm font-semibold tabular-nums text-texto ${atenuar ? CLASE_NO_VIGENTE : ""}`}>
              <NumeroAnimado valor={total} formato="pesos" duracion={0.6} />
            </span>
          ) : (
            <span className="text-xs text-texto-suave">{hayIncompletas ? "Completa los datos para sumarlo" : "Calculando…"}</span>
          )}
        </div>
      )}

    </section>
  );
}

/** «Quitaste «Transporte». Deshacer»: en la lista, como una fila más; con la lista vacía, sobre la invitación. */
function BarraDeshacer({ quitada, onDeshacer, comoFila = false }: { quitada: FilaQuitada; onDeshacer: () => void; comoFila?: boolean }) {
  const Envoltura = comoFila ? motion.li : motion.div;
  return (
    <Envoltura
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: DUR.corta, ease: EASE_SALIDA }}
      className={comoFila ? "overflow-hidden" : "mt-2.5 overflow-hidden"}
    >
      <p role="status" className="flex items-center gap-2 rounded-xl border border-dashed border-borde bg-superficie-2 py-0.5 pl-3 pr-1 text-xs text-texto">
        <Trash2 className="size-3.5 shrink-0 text-texto-suave" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Quitaste «{quitada.fila.descripcion.trim() || "un gasto"}».</span>
        <button
          type="button"
          onClick={onDeshacer}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento"
        >
          <Undo2 className="size-3.5" aria-hidden="true" />Deshacer
        </button>
      </p>
    </Envoltura>
  );
}
