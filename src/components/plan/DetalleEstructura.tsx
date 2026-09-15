"use client";

/* Catalog images come from runtime URLs and already carry explicit dimensions. */
/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import type { EstructuraResuelta, LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import {
  acabadoCliente,
  cantidadCliente,
  esEstructuraDeGlobos,
  medidasCliente,
  metrosCliente,
  productoCliente,
  productoConTamanoCliente,
  pulgadasCliente,
  tonoCliente,
  ubicacionCliente,
} from "@/lib/plan/presentacion-cliente";
import { IconoEstructura } from "./IconoEstructura";
import { BarraTamanos, tramosPorTamano } from "./BarraTamanos";
import { RecortePieza } from "@/components/referencia/RecortePieza";
import type { CajaNormalizada } from "@/components/referencia/recorte";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

type Props = {
  idBase: string;
  estructura: EstructuraResuelta;
  declarada?: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  abierto: boolean;
  onAlternar: () => void;
  recorte?: { src: string; caja: CajaNormalizada } | null;
  lineas: LineaMaterial[];
  imagenDe: (linea: LineaMaterial) => string | undefined;
  fotoAusente: (linea: LineaMaterial) => boolean;
  /** Consumption value of this piece's balloons, when every line has a price. */
  sumaCop: number | null;
  editable: boolean;
  onAgregar: () => void;
  onEditar: (linea: LineaMaterial) => void;
  onQuitar: (linea: LineaMaterial) => void;
  /** "Quitar" only where the structure keeps a material afterwards (`lineaQuitable`); default: every line. */
  puedeQuitar?: (linea: LineaMaterial) => boolean;
  onVerProducto: (linea: LineaMaterial, disparador: HTMLButtonElement) => void;
  /** Extras per line (training reference count). */
  extraLinea?: (linea: LineaMaterial) => ReactNode;
  modoDev?: boolean;
};

/** Measurement tiles for the structure, only those present in the plan. */
function mosaicosMedidas(tipo: string, medidas: EstructuraDeclarada["medidas"] | undefined): Array<{ etiqueta: string; valor: string }> {
  if (!medidas) return [];
  if (tipo === "guirnalda") {
    const largo = medidas.largo_m ?? medidas.ancho_m;
    return largo != null ? [{ etiqueta: "Largo", valor: metrosCliente(largo) }] : [];
  }
  const mosaicos: Array<{ etiqueta: string; valor: string }> = [];
  if (medidas.ancho_m != null) mosaicos.push({ etiqueta: tipo === "centro_mesa" ? "Diámetro" : "Ancho", valor: metrosCliente(medidas.ancho_m) });
  if (medidas.alto_m != null) mosaicos.push({ etiqueta: "Alto", valor: metrosCliente(medidas.alto_m) });
  if (medidas.largo_m != null) mosaicos.push({ etiqueta: ["arco", "semiarco", "columna"].includes(tipo) ? "Fondo" : "Largo", valor: metrosCliente(medidas.largo_m) });
  return mosaicos;
}

/** "unos 85 globos" with the number emphasized; other phrasings stay as text. */
function CantidadTexto({ texto }: { texto: string }) {
  const partes = /^(unos )([\d.]+)( .+)$/.exec(texto);
  if (!partes) return <>{texto}</>;
  return <>{partes[1]}<strong className="font-semibold text-texto">{partes[2]}</strong>{partes[3]}</>;
}

/**
 * One structure of the proposal, expandable (maqueta DetallePieza): icon,
 * measurements, the reason, the size mix and the products with real photos,
 * with the existing edit and remove actions. The body stays in the DOM while
 * closed (height 0, `inert`) so it is still part of the static render.
 */
export function DetalleEstructura({
  idBase, estructura, declarada, oficial, abierto, onAlternar, recorte, lineas, imagenDe, fotoAusente, sumaCop,
  editable, onAgregar, onEditar, onQuitar, puedeQuitar, onVerProducto, extraLinea, modoDev = false,
}: Props) {
  const reducir = useReducedMotion();
  const nombreVisible = oficial?.nombre ?? productoCliente(estructura.nombre);
  const medidasTexto = medidasCliente(estructura.tipo, declarada?.medidas);
  const cantidad = cantidadCliente(estructura.total_unidades, estructura.repeticiones, estructura.tipo);
  const deGlobos = esEstructuraDeGlobos(estructura.tipo);
  const tramos = tramosPorTamano(estructura.mezcla_real.map((linea) => ({ pulgadas: linea.diam_pulg, unidades: linea.unidades })));
  const mosaicos = [
    ...mosaicosMedidas(estructura.tipo, declarada?.medidas),
    ...(estructura.repeticiones > 1 ? [{ etiqueta: "Piezas iguales", valor: String(estructura.repeticiones) }] : []),
    { etiqueta: deGlobos ? "Globos" : "Piezas", valor: `unos ${Math.round(estructura.total_unidades)}` },
  ];
  const pequenosRellenan = tramos.length >= 2 && tramos[0]!.unidades > tramos[tramos.length - 1]!.unidades;
  const idCuerpo = `${idBase}-cuerpo`;

  return (
    <li className={`overflow-hidden rounded-2xl border bg-superficie transition-colors ${abierto ? "border-borde shadow-[0_1px_2px_var(--sombra)]" : "border-borde-suave"}`}>
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={idCuerpo}
        onClick={onAlternar}
        className="flex w-full items-center gap-3.5 p-3 text-left hover:bg-superficie-suave focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento sm:p-4"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-acento-suave text-acento sm:size-14" title={oficial?.descripcion}>
          {oficial ? <IconoEstructura id={oficial.id} espejo={estructura.ubicacion === "lateral_derecho"} className="size-8 sm:size-9" /> : <span aria-hidden className="size-3 rounded-full bg-acento/60" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-texto sm:text-base">{nombreVisible} <span className="font-normal text-texto-suave">{ubicacionCliente(estructura)}</span></span>
          <span className="mt-0.5 block text-[13px] text-texto-suave">
            {medidasTexto && <>{medidasTexto} · </>}
            <CantidadTexto texto={cantidad} />
          </span>
        </span>
        {recorte && <RecortePieza src={recorte.src} caja={recorte.caja} alt="" revelar={false} className="hidden h-15 w-11 shrink-0 rounded-lg min-[420px]:block" />}
        <ChevronDown aria-hidden="true" className={`size-4.5 shrink-0 text-texto-suave transition-transform duration-200 ${abierto ? "rotate-180" : ""}`} />
      </button>

      <motion.div
        id={idCuerpo}
        inert={!abierto}
        initial={false}
        animate={{ height: abierto ? "auto" : 0, opacity: abierto ? 1 : 0 }}
        transition={reducir ? { duration: 0 } : { height: { duration: 0.38, ease: [0.23, 1, 0.32, 1] }, opacity: { duration: 0.25, delay: abierto ? 0.08 : 0 } }}
        style={{ overflow: "hidden" }}
      >
        <div className="space-y-4 border-t border-borde-suave px-3 pb-4 pt-4 sm:px-4">
          <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
            {mosaicos.map((mosaico) => (
              <div key={mosaico.etiqueta} className="rounded-xl bg-superficie-suave px-3 py-2">
                <dt className="text-xs text-texto-suave">{mosaico.etiqueta}</dt>
                <dd className="text-[15px] font-semibold tabular-nums text-texto">{mosaico.valor}</dd>
              </div>
            ))}
          </dl>

          {declarada?.porque && <p className="text-sm leading-relaxed text-texto-suave">{declarada.porque}</p>}

          {tramos.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-[13px] font-semibold text-texto">Mezcla de tamaños</p>
                {pequenosRellenan && <p className="text-xs text-texto-suave">Más globos pequeños para rellenar, pocos grandes para dar volumen</p>}
              </div>
              <BarraTamanos tramos={tramos} variante="detalle" retraso={0.1} />
              {modoDev && <p className="mt-1 text-[11px] text-texto-suave">{estructura.nombre} · {estructura.mezcla_real.map((linea) => `R-${linea.diam_pulg} · ${linea.unidades} (${Math.round(linea.pct)}%)`).join(" · ")}</p>}
            </div>
          )}

          <div>
            <p className="text-[13px] font-semibold text-texto">{deGlobos ? "Globos que lleva" : "Piezas que lleva"}</p>
            <ul className="mt-2 space-y-2">
              {lineas.map((linea) => {
                const imagen = imagenDe(linea);
                const acabado = acabadoCliente(linea.acabado, linea.titulo);
                const detalle = [linea.tamano_codigo ? pulgadasCliente(linea.tamano_codigo) : null, linea.color ? [tonoCliente(linea.color, linea.titulo), acabado].filter(Boolean).join(" ") : null].filter(Boolean).join(" · ");
                const nombreAccesible = productoConTamanoCliente(linea.titulo, linea.tamano_codigo);
                return (
                  <li key={linea.variant_id} className="flex items-center gap-2 rounded-xl border border-borde-suave bg-superficie p-2 pr-2.5">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={(evento) => onVerProducto(linea, evento.currentTarget)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                    >
                      {imagen ? (
                        <img src={imagen} alt="" width={44} height={44} loading="lazy" className="size-11 shrink-0 rounded-lg bg-white object-contain" />
                      ) : (
                        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-lg bg-superficie-2 text-center text-[9px] leading-tight text-texto-suave">{fotoAusente(linea) ? "Sin foto" : "Cargando…"}</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-texto">{productoCliente(linea.titulo)}</span>
                        <span className="mt-0.5 block truncate text-xs text-texto-suave">{detalle}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-texto">
                        {linea.unidades}<span className="sr-only"> {linea.unidades === 1 ? "unidad" : "unidades"}</span>
                      </span>
                    </button>
                    {extraLinea?.(linea)}
                    {editable && (
                      <span className="flex shrink-0 items-center">
                        <button type="button" title={`Modificar ${nombreAccesible}`} aria-label={`Modificar ${nombreAccesible}`} onClick={() => onEditar(linea)} className="grid size-8 place-items-center rounded-lg text-texto-suave hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-acento">
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </button>
                        {(puedeQuitar?.(linea) ?? true) && (
                          <button type="button" title={`Quitar ${nombreAccesible}`} aria-label={`Quitar ${nombreAccesible}`} onClick={() => onQuitar(linea)} className="grid size-8 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento">
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {(editable || sumaCop != null) && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {editable ? (
                <button type="button" onClick={onAgregar} className="ui-pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-borde px-3 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  <Plus className="size-4" aria-hidden="true" />{deGlobos ? "Agregar un globo" : "Agregar una pieza"}
                </button>
              ) : <span />}
              {sumaCop != null && (
                <p className="text-[13px] text-texto-suave" title="Precio por globo de cada paquete; los paquetes se compran una sola vez para toda la decoración.">
                  Esta pieza suma unos <strong className="font-semibold tabular-nums text-texto">{pesos.format(sumaCop)}</strong>
                </p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </li>
  );
}
