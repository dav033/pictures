"use client";

/* Catalog images come from runtime URLs (Shopify CDN) and are not routed through next/image. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { muestraColor, productoCliente, pulgadasCliente } from "@/lib/plan/presentacion-cliente";
import type { LineaMaterial } from "@/lib/plan/resuelto";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import { ExploradorCatalogo } from "./ExploradorCatalogo";
import { PARTICIPACION_MAXIMA, PARTICIPACION_MINIMA, miniaturaDeCatalogo, type EdicionAjuste, type ModoAjuste } from "./ajuste-propuesta";
import { useAjustePropuesta, type AjustePropuesta, type PiezaAjustable } from "./usarAjustePropuesta";

/** Dónde se abre el modal: la pieza y, si el cliente tocó «Modificar», el globo que cambia. */
export type AperturaAjuste = { modo: ModoAjuste; estructuraId: string; objetivoVariantId: string | null };

export type PropsModalAjustarPropuesta = {
  /** La tarjeta guarda aquí la función que abre el modal: abrirlo no repinta la tarjeta, que es grande. */
  abrirRef: MutableRefObject<((apertura: AperturaAjuste) => void) | null>;
  piezas: readonly PiezaAjustable[];
  lineasDe: (estructuraId: string) => readonly LineaMaterial[];
  imagenDeLinea: (linea: LineaMaterial) => string | undefined;
  approvalToken?: string;
  /** Variantes que la propuesta ya compra: una opción que ya está en la propuesta se aplica con la misma variante. */
  variantIdsDelPlan: ReadonlySet<string>;
  /** Id del contenido del diálogo: el botón «Ajustar plan» lo nombra en `aria-controls`. */
  idContenido: string;
  onAplicar: (edicion: EdicionAjuste, aviso: string) => Promise<string | null>;
};

const CAMPO = "w-full rounded-lg border border-borde bg-superficie px-3 text-sm text-texto focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento";

const PESTANAS: ReadonlyArray<{ modo: ModoAjuste; texto: string }> = [
  { modo: "reemplazar", texto: "Cambiar un globo" },
  { modo: "agregar", texto: "Agregar un globo" },
];

function Foto({ src, alt, tamano }: { src: string | undefined | null; alt: string; tamano: string }) {
  const [fallida, setFallida] = useState(false);
  return src && !fallida
    ? <img src={miniaturaDeCatalogo(src, 160)} alt={alt} width={64} height={64} loading="lazy" decoding="async" onError={() => setFallida(true)} className={`${tamano} shrink-0 rounded-lg bg-superficie-2 object-contain`} />
    : <span aria-hidden="true" className={`${tamano} shrink-0 rounded-lg bg-superficie-2`} />;
}

function Muestra({ color }: { color: string }) {
  const muestra = muestraColor(color, null);
  return <span aria-hidden="true" className={`size-3.5 shrink-0 rounded-full ${muestra.conBorde ? "ring-1 ring-borde" : "ring-1 ring-black/10"}`} style={{ background: muestra.fondo }} />;
}

function Pestanas({ ajuste, idBase }: { ajuste: AjustePropuesta; idBase: string }) {
  function alTeclear(evento: KeyboardEvent<HTMLDivElement>): void {
    if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
    evento.preventDefault();
    const siguiente = PESTANAS.find((pestana) => pestana.modo !== ajuste.modo)!;
    ajuste.elegirModo(siguiente.modo);
    document.getElementById(`${idBase}-pestana-${siguiente.modo}`)?.focus();
  }
  return (
    <div role="tablist" aria-label="Qué quieres hacer" onKeyDown={alTeclear} className="grid grid-cols-2 gap-1 rounded-xl bg-superficie-2 p-1">
      {PESTANAS.map(({ modo, texto }) => {
        const activa = ajuste.modo === modo;
        return (
          <button
            key={modo}
            id={`${idBase}-pestana-${modo}`}
            type="button"
            role="tab"
            aria-selected={activa}
            aria-controls={`${idBase}-panel`}
            tabIndex={activa ? 0 : -1}
            onClick={() => ajuste.elegirModo(modo)}
            className={`min-h-11 rounded-lg px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento sm:min-h-8 ${activa ? "bg-superficie font-semibold text-acento shadow-sm" : "text-texto-suave hover:text-texto"}`}
          >
            {texto}
          </button>
        );
      })}
    </div>
  );
}

function GlobosQueSeCambian({ ajuste, imagenDeLinea, idBase }: { ajuste: AjustePropuesta; imagenDeLinea: (linea: LineaMaterial) => string | undefined; idBase: string }) {
  return (
    <section aria-labelledby={`${idBase}-que-cambias`} className="space-y-1.5">
      <h3 id={`${idBase}-que-cambias`} className="text-xs font-semibold text-texto">¿Qué globo cambias?</h3>
      {ajuste.lineas.length === 0 ? (
        <p className="rounded-lg bg-superficie-2 px-3 py-2 text-xs text-texto-suave">Esta pieza no tiene globos que cambiar. Prueba con «Agregar un globo».</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {ajuste.lineas.map((linea) => {
            const activa = ajuste.objetivoVariantId === linea.variant_id;
            const nombre = productoCliente(linea.titulo);
            const detalle = [linea.tamano_codigo ? pulgadasCliente(linea.tamano_codigo) : null, linea.color].filter(Boolean).join(" · ");
            return (
              <li key={linea.variant_id}>
                <button type="button" aria-pressed={activa} aria-label={`${nombre}${detalle ? `, ${detalle}` : ""}`} onClick={() => ajuste.elegirObjetivo(linea.variant_id)} className={`flex min-h-11 w-full items-center gap-2 rounded-xl p-1.5 text-left ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento ${activa ? "bg-acento-suave ring-2 ring-acento" : "bg-superficie ring-borde hover:bg-superficie-suave"}`}>
                  <Foto src={imagenDeLinea(linea)} alt="" tamano="size-11" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-xs font-semibold leading-snug text-texto">{nombre}</span>
                    {detalle && <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-texto-suave">{linea.color && <Muestra color={linea.color} />}{detalle}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PieDelModal({ ajuste, idBase }: { ajuste: AjustePropuesta; idBase: string }) {
  const { elegido } = ajuste;
  const variante = elegido?.variante;
  const verbo = ajuste.modo === "agregar" ? "Agregar a la pieza" : "Cambiar el globo";
  const idMotivo = `${idBase}-motivo`;
  return (
    <div className="shrink-0 space-y-2 border-t border-borde-suave bg-superficie px-3 py-2.5 sm:px-5">
      {ajuste.errorAplicar && <p role="alert" className="rounded-lg bg-error-suave px-3 py-2 text-xs font-medium text-error">{ajuste.errorAplicar}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-5">
      <div className="max-h-[34dvh] min-w-0 flex-1 space-y-2 overflow-y-auto sm:max-h-none sm:overflow-visible">
        <div className="flex items-center gap-2.5">
          <Foto src={elegido?.producto.imagen} alt={elegido ? elegido.producto.nombre : ""} tamano="size-10" />
          <div className="min-w-0 flex-1 text-xs">
            {elegido && variante ? (
              <>
                <p className="line-clamp-2 font-semibold leading-snug text-texto">{elegido.producto.nombre}</p>
                <p className="mt-0.5 truncate text-texto-suave">{[variante.tamano, ajuste.color || variante.colores.join(", ") || null].filter(Boolean).join(" · ")}</p>
              </>
            ) : (
              <p className="text-texto-suave">Todavía no elegiste ningún globo. Toca una de las opciones del catálogo.</p>
            )}
            {ajuste.modo === "reemplazar" && ajuste.lineaObjetivo && <p className="mt-0.5 truncate text-texto-suave">Reemplaza: {productoCliente(ajuste.lineaObjetivo.titulo)}{ajuste.lineaObjetivo.tamano_codigo ? ` · ${pulgadasCliente(ajuste.lineaObjetivo.tamano_codigo)}` : ""}</p>}
          </div>
        </div>

        {variante && variante.colores.length > 1 && (
          <fieldset>
            <legend className="text-xs text-texto-suave">¿De qué color lo cuentas en la pieza?</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {variante.colores.map((color) => {
                const activo = ajuste.color === color;
                return (
                  <button key={color} type="button" aria-pressed={activo} onClick={() => ajuste.setColor(activo ? "" : color)} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-acento sm:min-h-8 ${activo ? "bg-acento-suave font-semibold text-acento ring-acento" : "text-texto ring-borde hover:bg-superficie-suave"}`}>
                    <Muestra color={color} />
                    {muestraColor(color, null).etiqueta}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        {variante && variante.colores.length === 0 && (
          <label className="block text-xs text-texto-suave">Color (opcional)
            <input name="color-variante-plan" autoComplete="off" value={ajuste.color} onChange={(evento) => ajuste.setColor(evento.target.value)} placeholder="Según catálogo…" className={`${CAMPO} mt-1 h-11 sm:h-9`} />
          </label>
        )}

        {variante && ajuste.modo === "agregar" && (
          <label className="block text-xs text-texto-suave">
            <span className="flex items-center justify-between">Cuánto de la pieza lleva este globo<output className="font-semibold tabular-nums text-texto">{ajuste.participacion}%</output></span>
            <input name="participacion-variante-plan" type="range" min={PARTICIPACION_MINIMA} max={PARTICIPACION_MAXIMA} step="1" value={ajuste.participacion} onChange={(evento) => ajuste.setParticipacion(evento.target.value)} className="mt-1 h-6 w-full accent-[var(--acento)]" />
            <span className="flex justify-between text-[11px] text-texto-tenue"><span>Un toque</span><span>Protagonista</span></span>
          </label>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 sm:w-64">
        {ajuste.motivo && !ajuste.guardando && <p id={idMotivo} className="text-xs text-texto-suave">{ajuste.motivo}</p>}
        <button
          type="button"
          data-testid="guardar-edicion-plan"
          disabled={ajuste.motivo !== null || ajuste.guardando}
          aria-describedby={ajuste.motivo && !ajuste.guardando ? idMotivo : undefined}
          onClick={() => void ajuste.aplicar()}
          className="ui-pressable h-11 w-full rounded-xl bg-acento px-5 text-sm font-semibold text-sobre-acento disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
        >
          {ajuste.guardando ? "Guardando…" : verbo}
        </button>
      </div>
      </div>
    </div>
  );
}

type PropsDialogo = Omit<PropsModalAjustarPropuesta, "abrirRef"> & { inicial: AperturaAjuste; onCerrar: () => void };

/**
 * «Ajusta la propuesta»: agregar o cambiar un globo de una pieza eligiendo entre todo el catálogo, con fotos.
 * No guarda por su cuenta: `onAplicar` publica la edición en la propuesta y devuelve el motivo si falló; el modal
 * lo muestra aquí mismo y no se cierra hasta que haya salido bien.
 */
function DialogoAjuste({ piezas, lineasDe, imagenDeLinea, inicial, approvalToken, variantIdsDelPlan, idContenido, onAplicar, onCerrar }: PropsDialogo) {
  const idBase = useId();
  const reducir = useReducedMotion();
  const focoRetorno = useFocoDeRetorno();
  const campoBusqueda = useRef<HTMLInputElement | null>(null);
  const ajuste = useAjustePropuesta({ piezas, lineasDe, inicial, approvalToken, variantIdsDelPlan, onAplicar, onAplicado: onCerrar });
  const { guardando } = ajuste;

  return (
    <Dialog.Root open onOpenChange={(abierto) => { if (!abierto && !guardando) onCerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          asChild
          id={idContenido}
          onOpenAutoFocus={(evento) => { focoRetorno.onOpenAutoFocus(); evento.preventDefault(); campoBusqueda.current?.focus(); }}
          onCloseAutoFocus={focoRetorno.onCloseAutoFocus}
          onEscapeKeyDown={(evento) => { if (guardando) evento.preventDefault(); }}
          onInteractOutside={(evento) => { if (guardando) evento.preventDefault(); }}
        >
          <motion.div
            initial={reducir ? false : { opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-x-1.5 bottom-1.5 top-1.5 z-50 mx-auto flex max-w-[70rem] flex-col overflow-hidden rounded-2xl border border-borde-suave bg-superficie shadow-[0_24px_64px_var(--sombra)] sm:inset-x-4 sm:bottom-auto sm:top-1/2 sm:h-[min(50rem,calc(100dvh-2rem))] sm:-translate-y-1/2 sm:rounded-3xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 px-3 pb-2 pt-3 sm:px-5 sm:pt-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold tracking-tight text-texto sm:text-lg">Ajusta la propuesta</Dialog.Title>
                <Dialog.Description className="sr-only sm:not-sr-only sm:mt-0.5 sm:text-xs sm:text-texto-suave">Elige un globo de todo el catálogo, con su foto, y agrégalo o cámbialo en una pieza. El total se actualiza al instante.</Dialog.Description>
              </div>
              <Dialog.Close disabled={guardando} aria-label="Cerrar" className="grid size-11 shrink-0 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento sm:size-9">
                <X className="size-5" aria-hidden="true" />
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-5">
              <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
                <label className="block text-xs font-semibold text-texto">¿En qué pieza?
                  <select name="estructura-plan" value={ajuste.estructuraId} onChange={(evento) => ajuste.elegirPieza(evento.target.value)} className={`${CAMPO} mt-1 h-11 font-normal sm:h-9`}>
                    {piezas.map((pieza) => <option key={pieza.id} value={pieza.id}>{pieza.nombre}</option>)}
                  </select>
                </label>
                <Pestanas ajuste={ajuste} idBase={idBase} />
              </div>
              <div id={`${idBase}-panel`} role="tabpanel" aria-labelledby={`${idBase}-pestana-${ajuste.modo}`} className="space-y-3">
                {ajuste.modo === "reemplazar" && <GlobosQueSeCambian ajuste={ajuste} imagenDeLinea={imagenDeLinea} idBase={idBase} />}
                <ExploradorCatalogo ajuste={ajuste} campoBusqueda={campoBusqueda} />
              </div>
            </div>

            <PieDelModal ajuste={ajuste} idBase={idBase} />
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * El modal tal como lo monta la tarjeta: siempre presente y sin pintar nada hasta que se abre. Guarda en `abrirRef`
 * la función que lo abre, así abrirlo solo repinta esto y no la tarjeta entera.
 */
export function ModalAjustarPropuesta({ abrirRef, ...resto }: PropsModalAjustarPropuesta) {
  const [apertura, setApertura] = useState<AperturaAjuste | null>(null);
  useEffect(() => {
    abrirRef.current = setApertura;
    return () => { abrirRef.current = null; };
  }, [abrirRef]);
  if (!apertura) return null;
  return <DialogoAjuste {...resto} inicial={apertura} onCerrar={() => setApertura(null)} />;
}
