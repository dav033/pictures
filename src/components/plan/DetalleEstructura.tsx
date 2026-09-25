"use client";

/* Catalog images come from runtime URLs and already carry explicit dimensions. */
/* eslint-disable @next/next/no-img-element */

import { useState, type ReactNode } from "react";
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
  muestraColor,
  productoCliente,
  productoConTamanoCliente,
  pulgadasCliente,
  tonoCliente,
  ubicacionCliente,
} from "@/lib/plan/presentacion-cliente";
import { IconoEstructura } from "./IconoEstructura";
import { BarraTamanos, tramosPorTamano } from "./BarraTamanos";
import { RecortePieza } from "@/components/referencia/RecortePieza";
import type { Mezcla } from "@/lib/plan/mezclas";
import { RepartoColores } from "./RepartoColores";
import { BalanceTamanos } from "./BalanceTamanos";
import type { PendientesAjustes } from "./cola-ajustes";
import type { CajaNormalizada } from "@/components/referencia/recorte";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import type { ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import { BloquePatron } from "./patron/BloquePatron";
import { BloqueBouquet } from "./bouquet/BloqueBouquet";
import type { VistasEnVivo } from "./vistas-en-vivo";
import type { ColorLeyenda } from "./patron/leyenda";

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
  /** Saves a new color split of the piece (shares in `materiales` order); resolves the reason when it was not saved. */
  onRepartir?: (participaciones: number[]) => Promise<string | null>;
  /** Saves another size mix for the piece; resolves the reason when it was not saved. */
  onCambiarMezcla?: (mezcla: Mezcla) => Promise<string | null>;
  /** A dialog edit of the card is in flight: the interactive controls wait. */
  ocupado?: boolean;
  /** The card's count of slider changes not in the plan yet (approving waits for them). */
  pendientes?: PendientesAjustes;
  /**
   * Color pattern block (ADR-0028): the applied expansion from Python, its
   * numbered legend and the ways into the editor and the assembly sheet.
   * Absent for pieces that cannot carry a pattern.
   */
  patron?: {
    /** The plan's applied pattern. */
    resuelto?: PatronColorResuelto;
    leyenda: readonly ColorLeyenda[];
    onEditar?: () => void;
    onHojaArmado?: () => void;
    /** Other edits are still saving: the editor opens once the plan they sign is in. */
    ocupado?: boolean;
  };
  /**
   * Bouquet assembly block (ADR-0030): Python's resolved assembly, its
   * numbered legend and the ways into the editor and the assembly sheet.
   * Only for bouquets; a bouquet never carries a pattern, so at most one of
   * the two blocks shows.
   */
  armado?: {
    /** The plan's assembly for this bouquet. */
    resuelto?: ArmadoBouquetResuelto;
    leyenda: readonly ColorLeyenda[];
    onEditar?: () => void;
    onHojaArmado?: () => void;
    /** Other edits are still saving: the editor opens once the plan they sign is in. */
    ocupado?: boolean;
  };
  /**
   * Live drawing of the colors slider on a confetti pattern (ADR-0028 §10):
   * Python draws each split while it moves; the slider leaves it in `vistas`
   * (by structure) and the pattern block and the card's summary strip show
   * it until the signed plan arrives.
   */
  vistaReparto?: {
    pedir: (participaciones: readonly number[], signal: AbortSignal) => Promise<PatronColorResuelto>;
    vistas: VistasEnVivo<PatronColorResuelto>;
  };
};

/** Pieces whose balloons come from the geometry, so their colors and sizes can be rebalanced. */
const TIPOS_GEOMETRICOS = new Set(["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"]);

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

/** "12″" for a size chip. */
function tamanoCorto(linea: LineaMaterial): string {
  const pulgadas = linea.diam_pulg ?? Number(/(\d+(?:[.,]\d+)?)/.exec(linea.tamano_codigo ?? "")?.[1]?.replace(",", "."));
  return Number.isFinite(pulgadas) && pulgadas ? `${pulgadas}″` : linea.tamano_codigo ?? "";
}

/**
 * Lines of the same catalog product in the same color are one family: the
 * sizes are variants of it. Grouped so a piece with five sizes of "Fashion
 * Rosado" reads as one row instead of five (2026-09-24). Sizes stay in
 * ascending order.
 */
function familiasDeLineas(lineas: readonly LineaMaterial[]): Array<{ clave: string; lineas: LineaMaterial[]; unidades: number }> {
  const familias = new Map<string, { clave: string; lineas: LineaMaterial[]; unidades: number }>();
  for (const linea of lineas) {
    const clave = `${linea.product_id}|${linea.color ?? ""}`;
    const familia = familias.get(clave) ?? { clave, lineas: [], unidades: 0 };
    familia.lineas.push(linea);
    familia.unidades += linea.unidades;
    familias.set(clave, familia);
  }
  for (const familia of familias.values()) familia.lineas.sort((a, b) => (a.diam_pulg ?? 0) - (b.diam_pulg ?? 0));
  return [...familias.values()];
}

type AccionesLinea = Pick<Props, "imagenDe" | "fotoAusente" | "editable" | "onEditar" | "onQuitar" | "puedeQuitar" | "onVerProducto" | "extraLinea">;

/** One size of one product, with its photo, units and the edit/remove actions. */
function FilaLinea({ linea, detalle, compacta = false, imagenDe, fotoAusente, editable, onEditar, onQuitar, puedeQuitar, onVerProducto, extraLinea }: { linea: LineaMaterial; detalle: string; compacta?: boolean } & AccionesLinea) {
  const imagen = imagenDe(linea);
  const nombreAccesible = productoConTamanoCliente(linea.titulo, linea.tamano_codigo);
  return (
    <div className={`flex items-center gap-2 rounded-xl border border-borde-suave bg-superficie pr-2.5 ${compacta ? "p-1.5" : "p-2"}`}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(evento) => onVerProducto(linea, evento.currentTarget)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
      >
        {compacta ? null : imagen ? (
          <img src={imagen} alt="" width={44} height={44} loading="lazy" className="size-11 shrink-0 rounded-lg bg-white object-contain" />
        ) : (
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-lg bg-superficie-2 text-center text-[9px] leading-tight text-texto-suave">{fotoAusente(linea) ? "Sin foto" : "Cargando…"}</span>
        )}
        <span className="min-w-0 flex-1">
          {compacta ? (
            <span className="block truncate text-[13px] text-texto">{detalle}</span>
          ) : (
            <>
              <span className="block truncate text-sm font-medium text-texto">{productoCliente(linea.titulo)}</span>
              <span className="mt-0.5 block truncate text-xs text-texto-suave">{detalle}</span>
            </>
          )}
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
    </div>
  );
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
  onRepartir, onCambiarMezcla, ocupado = false, pendientes, patron, armado, vistaReparto,
}: Props) {
  const reducir = useReducedMotion();
  const [familiasAbiertas, setFamiliasAbiertas] = useState<ReadonlySet<string>>(() => new Set());
  const alternarFamilia = (clave: string) => setFamiliasAbiertas((actuales) => {
    const siguientes = new Set(actuales);
    if (siguientes.has(clave)) siguientes.delete(clave);
    else siguientes.add(clave);
    return siguientes;
  });
  const acciones = { imagenDe, fotoAusente, editable, onEditar, onQuitar, puedeQuitar, onVerProducto, extraLinea };
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
  // With a pattern, the grid decides how much of each color goes in; only confetti still takes a color split.
  const confeti = declarada?.patron_color?.base.modo === "aleatorio";
  const repartoLibre = !declarada?.patron_color || confeti;
  const proporcion = declarada?.medidas.alto_m && declarada.medidas.ancho_m ? declarada.medidas.alto_m / declarada.medidas.ancho_m : undefined;
  const idCuerpo = `${idBase}-cuerpo`;
  const ajustable = editable && declarada && TIPOS_GEOMETRICOS.has(estructura.tipo);
  // On a confetti the slider changes the drawing: it goes inside the pattern block, next to (on a phone, right under) it.
  const repartoEnBloque = confeti && Boolean(patron?.resuelto);
  const reparto = ajustable && onRepartir && repartoLibre && declarada.materiales.length >= 2 && declarada.materiales.every((material) => typeof material.participacion === "number") ? (
    <RepartoColores
      // Same materials, same control: it follows the shares the resolver signs. Adding or removing a color starts it over.
      key={declarada.materiales.map((material) => material.variant_id ?? material.product_id).join("|")}
      colores={declarada.materiales.map((material) => ({
        etiqueta: material.color ? tonoCliente(material.color, material.product_id) : productoCliente(material.product_id),
        fondo: muestraColor(material.color ?? "", null).fondo,
        participacion: material.participacion ?? 0,
      }))}
      totalGlobos={estructura.total_unidades}
      ocupado={ocupado}
      onGuardar={onRepartir}
      pendientes={pendientes}
      vistaPrevia={confeti ? vistaReparto?.pedir : undefined}
      onVistaPrevia={vistaReparto ? (vista) => vistaReparto.vistas.fijar(estructura.estructura_id, vista) : undefined}
      conteo={patron?.resuelto?.conteo}
      avisosPlan={patron?.resuelto?.avisos}
      incrustado={repartoEnBloque}
    />
  ) : null;

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

          {patron && (
            <BloquePatron
              resuelto={patron.resuelto}
              enVivo={vistaReparto ? { vistas: vistaReparto.vistas, id: estructura.estructura_id } : undefined}
              reparto={repartoEnBloque ? reparto : undefined}
              leyenda={patron.leyenda}
              tipo={estructura.tipo}
              oficialId={oficial?.id ?? declarada?.estructura_oficial}
              espejo={estructura.ubicacion === "lateral_derecho"}
              proporcion={proporcion}
              repeticiones={estructura.repeticiones}
              nombrePieza={nombreVisible}
              onEditar={patron.onEditar}
              onHojaArmado={patron.onHojaArmado}
              ocupado={ocupado || Boolean(patron.ocupado)}
              modoDev={modoDev}
            />
          )}

          {armado && (
            <BloqueBouquet
              resuelto={armado.resuelto}
              leyenda={armado.leyenda}
              nombrePieza={nombreVisible}
              onEditar={armado.onEditar}
              onHojaArmado={armado.onHojaArmado}
              ocupado={ocupado || Boolean(armado.ocupado)}
              modoDev={modoDev}
            />
          )}

          {ajustable && ((reparto && !repartoEnBloque) || onCambiarMezcla) && (
            <div className="space-y-2.5">
              {!repartoEnBloque && reparto}
              {onCambiarMezcla && (
                <BalanceTamanos mezcla={declarada.mezcla} totalGlobos={estructura.total_unidades} ocupado={ocupado} onGuardar={onCambiarMezcla} pendientes={pendientes} />
              )}
            </div>
          )}

          <div>
            <p className="text-[13px] font-semibold text-texto">{deGlobos ? "Globos que lleva" : "Piezas que lleva"}</p>
            <ul className="mt-2 space-y-2">
              {familiasDeLineas(lineas).map((familia) => {
                const primera = familia.lineas[0]!;
                const acabado = acabadoCliente(primera.acabado, primera.titulo);
                const tono = primera.color ? [tonoCliente(primera.color, primera.titulo), acabado].filter(Boolean).join(" ") : null;
                if (familia.lineas.length === 1) {
                  return (
                    <li key={familia.clave}>
                      <FilaLinea linea={primera} detalle={[primera.tamano_codigo ? pulgadasCliente(primera.tamano_codigo) : null, tono].filter(Boolean).join(" · ")} {...acciones} />
                    </li>
                  );
                }
                const abiertaFamilia = familiasAbiertas.has(familia.clave);
                const imagen = familia.lineas.map(imagenDe).find(Boolean);
                const idTamanos = `${idBase}-familia-${familia.clave.replace(/[^a-z0-9]/gi, "")}`;
                return (
                  <li key={familia.clave} className="rounded-xl border border-borde-suave bg-superficie">
                    <button
                      type="button"
                      aria-expanded={abiertaFamilia}
                      aria-controls={idTamanos}
                      onClick={() => alternarFamilia(familia.clave)}
                      className="flex w-full min-w-0 items-center gap-3 rounded-xl p-2 pr-2.5 text-left hover:bg-superficie-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                    >
                      {imagen ? (
                        <img src={imagen} alt="" width={44} height={44} loading="lazy" className="size-11 shrink-0 rounded-lg bg-white object-contain" />
                      ) : (
                        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-lg bg-superficie-2 text-center text-[9px] leading-tight text-texto-suave">{familia.lineas.every(fotoAusente) ? "Sin foto" : "Cargando…"}</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-texto">{productoCliente(primera.titulo)}</span>
                        {tono && <span className="mt-0.5 block truncate text-xs text-texto-suave">{tono}</span>}
                        {/* Every size of the family at a glance: the list used to repeat the product once per size. */}
                        <span className="mt-1 flex flex-wrap gap-1" aria-label={`Tamaños: ${familia.lineas.map((linea) => `${tamanoCorto(linea)} ${linea.unidades}`).join(", ")}`}>
                          {familia.lineas.map((linea) => (
                            <span key={linea.variant_id} aria-hidden="true" className="rounded-full bg-superficie-suave px-1.5 py-px text-[11px] tabular-nums text-texto-suave ring-1 ring-borde-suave ring-inset">
                              <span className="font-semibold text-texto">{tamanoCorto(linea)}</span> {linea.unidades}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-texto">{familia.unidades}<span className="sr-only"> unidades en total</span></span>
                        <span className="block text-[11px] text-texto-suave">{familia.lineas.length} tamaños</span>
                      </span>
                      <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-texto-suave transition-transform duration-200 ${abiertaFamilia ? "rotate-180" : ""}`} />
                    </button>
                    <motion.ul
                      id={idTamanos}
                      inert={!abiertaFamilia}
                      initial={false}
                      animate={{ height: abiertaFamilia ? "auto" : 0, opacity: abiertaFamilia ? 1 : 0 }}
                      transition={reducir ? { duration: 0 } : { height: { duration: 0.3, ease: [0.23, 1, 0.32, 1] }, opacity: { duration: 0.2 } }}
                      style={{ overflow: "hidden" }}
                      aria-label={`Tamaños de ${productoCliente(primera.titulo)}`}
                      className="space-y-1.5 px-2"
                    >
                      {familia.lineas.map((linea, posicion) => (
                        <li key={linea.variant_id} className={posicion === familia.lineas.length - 1 ? "pb-2" : undefined}>
                          <FilaLinea linea={linea} detalle={linea.tamano_codigo ? pulgadasCliente(linea.tamano_codigo) : tamanoCorto(linea)} compacta {...acciones} />
                        </li>
                      ))}
                    </motion.ul>
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
