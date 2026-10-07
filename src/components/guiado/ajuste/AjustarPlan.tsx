"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Check, LoaderCircle, Minus, Palette, Plus, RotateCcw, Ruler, Trash2, X } from "lucide-react";
import { PanelPlegable } from "../Plegable";
import { DUR, EASE_SALIDA, RESORTE } from "../animacion/movimiento";
import {
  admiteColorNuevo,
  coloresDelPlan,
  coloresDelPlanVista,
  etiquetaColor,
  hexDeColor,
  cambiaTodasLasPiezas,
  piezaDelCambio,
  piezasAjustables,
  type CambioPlan,
  type ColorPieza,
  type PiezaAjustable,
  type PlanGuiado,
} from "./ajuste-plan-guiado";
import type { AjustePlanGuiado, EstadoAjuste } from "./usarAjustePlanGuiado";

type Props = {
  plan: PlanGuiado;
  ajuste: AjustePlanGuiado;
  /** Hay un turno del chat o una imagen en curso: los mandos esperan. */
  ocupado: boolean;
};

/** Colores que se ven al abrir «Añadir un color»; los demás, con «Ver más colores». */
const COLORES_A_LA_VISTA = 10;

/** Cifra que cuenta hasta su valor nuevo (o salta directo con movimiento reducido). */
export function CifraAnimada({ valor, sufijo = "" }: { valor: number; sufijo?: string }) {
  const reducido = useReducedMotion();
  const actual = useMotionValue(valor);
  const texto = useTransform(actual, (numero) => `${Math.round(numero).toLocaleString("es-CO")}${sufijo}`);
  useEffect(() => {
    if (reducido) { actual.jump(valor); return; }
    const control = animate(actual, valor, { duration: 0.7, ease: EASE_SALIDA });
    return () => control.stop();
  }, [valor, reducido, actual]);
  return <><span className="sr-only">{`${valor.toLocaleString("es-CO")}${sufijo}`}</span><motion.span aria-hidden>{texto}</motion.span></>;
}

/** Este bloque (una pieza, o `null` para los colores del plan) espera el plan nuevo. */
function recalculandoEn(estado: EstadoAjuste, estructuraId: string | null): boolean {
  if (estado.fase !== "guardando") return false;
  return cambiaTodasLasPiezas(estado.cambio) || piezaDelCambio(estado.cambio) === estructuraId;
}

/** Un color casi negro (o muy oscuro): en tema oscuro su tramo se pierde contra el fondo y necesita su propio borde. */
function esOscuro(hex: string): boolean {
  const valor = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!valor) return false;
  const [r, g, b] = [0, 2, 4].map((inicio) => Number.parseInt(valor.slice(inicio, inicio + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.16;
}

/** Borde del punto de color: uno claro para los colores oscuros, que en tema oscuro casi no se veían. */
function anilloDe(hex: string): string {
  return esOscuro(hex) ? "ring-1 ring-texto/45" : "ring-1 ring-borde";
}

/**
 * «Ajustar mi plan»: lo mínimo para cambiar el plan sin escribir. Arriba, los colores del plan (y añadir uno); luego
 * cada pieza con más o menos de cada color, quitar un color, achicarla o agrandarla, y quitarla. Cada toque rehace el
 * plan con Python (como la propuesta clásica) y los mandos esperan hasta que llega el plan nuevo.
 */
export function AjustarPlan({ plan, ajuste, ocupado }: Props) {
  const piezas = useMemo(() => piezasAjustables(plan), [plan]);
  const { estado } = ajuste;
  const bloqueado = ocupado || ajuste.guardando;
  return (
    <div className="space-y-2.5 pb-1 pt-2">
      <p className="text-sm text-texto-suave">Toca <span className="font-semibold text-texto">+</span> o <span className="font-semibold text-texto">−</span> para dar más o menos color. Cada cambio vuelve a calcular tus globos.</p>
      {/* Sin salida animada: mientras se calcula el siguiente cambio no queda un hueco donde estaba el «Listo». */}
      {estado.fase === "quieto" && estado.ultimo && (
        <motion.p
          key={estado.ultimo}
          role="status"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.media, ease: EASE_SALIDA }}
          className="flex items-start gap-2 rounded-xl bg-exito-suave px-3 py-2 text-sm text-texto"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-exito" aria-hidden />
          <span>{estado.ultimo}</span>
        </motion.p>
      )}

      <section aria-label="Colores de tu plan" className="rounded-2xl bg-superficie-suave p-2.5 ring-1 ring-borde-suave ring-inset sm:p-3">
        <ColoresDelPlan plan={plan} ajuste={ajuste} bloqueado={bloqueado} />
      </section>

      <AnimatePresence initial={false}>
        {piezas.map((pieza) => (
          <motion.section
            key={pieza.estructuraId}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: DUR.media, ease: EASE_SALIDA }}
            aria-label={`Ajustes de ${pieza.titulo}`}
            className="overflow-hidden rounded-2xl bg-superficie-suave p-2.5 ring-1 ring-borde-suave ring-inset sm:p-3"
          >
            <BloquePieza pieza={pieza} ajuste={ajuste} bloqueado={bloqueado} />
          </motion.section>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ColoresDelPlan({ plan, ajuste, bloqueado }: { plan: PlanGuiado; ajuste: AjustePlanGuiado; bloqueado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [todos, setTodos] = useState(false);
  const colores = useMemo(() => coloresDelPlanVista(plan), [plan]);
  const { estado, catalogo } = ajuste;
  // Cualquier cambio mueve la parte de cada color en el plan entero.
  const recalculando = estado.fase === "guardando";
  const admite = admiteColorNuevo(plan);
  const disponibles = ajuste.coloresDisponibles(coloresDelPlan(plan));
  const visibles = todos ? disponibles : disponibles.slice(0, COLORES_A_LA_VISTA);
  return (
    <>
      <div className="flex min-h-11 items-center gap-2">
        <Palette className="size-4 shrink-0 text-acento" aria-hidden />
        <h4 className="min-w-0 flex-1 font-medium text-texto">Colores de tu plan</h4>
      </div>
      <BarraColores colores={colores} cargando={recalculando} />
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Colores de tu plan">
        <AnimatePresence initial={false}>
          {colores.map((color) => (
            <motion.li
              key={color.color}
              layout="position"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: DUR.media, ease: EASE_SALIDA }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-superficie px-2.5 text-sm text-texto ring-1 ring-borde-suave ring-inset"
            >
              <span className={`size-3.5 rounded-full ${anilloDe(color.fondo)}`} style={{ backgroundColor: color.fondo }} aria-hidden />
              {color.etiqueta}
              <span className="font-semibold tabular-nums">{recalculando ? <span className="brillo-carga inline-block h-3.5 w-8 rounded align-middle" aria-hidden /> : <CifraAnimada valor={color.porcentaje} sufijo=" %" />}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {admite ? (
        <div className="mt-1.5">
          <button
            type="button"
            aria-expanded={abierto}
            disabled={bloqueado && !abierto}
            onClick={() => { setAbierto((valor) => !valor); ajuste.cargarColores(); }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50"
          >
            <motion.span animate={{ rotate: abierto ? 45 : 0 }} transition={RESORTE} className="inline-flex"><Plus className="size-4" aria-hidden /></motion.span>
            {abierto ? "Cerrar" : "Añadir un color"}
          </button>
          <PanelPlegable abierto={abierto}>
            <div className="pb-1">
              <p className="mb-2 text-xs text-texto-suave">Lo añado a tus piezas sin cambiar sus tamaños; tarda unos segundos.</p>
              {catalogo.fase === "cargando" || catalogo.fase === "nada" ? (
                <div className="flex flex-wrap gap-1.5" aria-label="Cargando colores">
                  {Array.from({ length: 6 }, (_, indice) => <span key={indice} className="brillo-carga h-11 w-24 rounded-full" aria-hidden />)}
                </div>
              ) : catalogo.fase === "error" ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-texto-suave">
                  {catalogo.mensaje}
                  <button type="button" onClick={ajuste.cargarColores} className="min-h-11 rounded-lg px-2 font-medium text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">Reintentar</button>
                </p>
              ) : disponibles.length === 0 ? (
                <p className="text-sm text-texto-suave">No quedan más colores lisos para añadir.</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Colores para añadir">
                    {visibles.map((valor) => (
                      <li key={valor}>
                        <motion.button
                          type="button"
                          disabled={bloqueado}
                          whileTap={bloqueado ? undefined : { scale: 0.95 }}
                          transition={RESORTE}
                          onClick={() => { setAbierto(false); void ajuste.aplicar({ tipo: "agregar-color", color: valor }); }}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-borde bg-superficie px-3 text-sm text-texto transition-colors hover:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50"
                        >
                          <span className={`size-4 rounded-full ${anilloDe(hexDeColor(valor))}`} style={{ backgroundColor: hexDeColor(valor) }} aria-hidden />
                          {etiquetaColor(valor)}
                        </motion.button>
                      </li>
                    ))}
                  </ul>
                  {disponibles.length > COLORES_A_LA_VISTA && (
                    <button type="button" onClick={() => setTodos((valor) => !valor)} className="mt-1 min-h-11 rounded-lg text-sm font-medium text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
                      {todos ? "Ver menos colores" : `Ver ${disponibles.length - COLORES_A_LA_VISTA} colores más`}
                    </button>
                  )}
                </>
              )}
            </div>
          </PanelPlegable>
        </div>
      ) : (
        <p className="mt-2 text-xs text-texto-suave">Tu plan ya tiene cinco colores: quita uno de una pieza para añadir otro.</p>
      )}
      <EstadoDelBloque ajuste={ajuste} estructuraId={null} bloqueado={bloqueado} />
    </>
  );
}

function BloquePieza({ pieza, ajuste, bloqueado }: { pieza: PiezaAjustable; ajuste: AjustePlanGuiado; bloqueado: boolean }) {
  const recalculando = recalculandoEn(ajuste.estado, pieza.estructuraId);
  const aplicar = (cambio: CambioPlan) => void ajuste.aplicar(cambio);
  const [confirmando, setConfirmando] = useState(false);
  return (
    <>
      <div className="flex min-h-11 items-center gap-2">
        <h4 className="min-w-0 flex-1 truncate font-medium text-texto">{pieza.titulo}</h4>
        {pieza.puedeQuitarPieza && !confirmando && (
          <button type="button" disabled={bloqueado} onClick={() => setConfirmando(true)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-texto-suave transition-colors hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50">
            <Trash2 className="size-4" aria-hidden />Quitar pieza
          </button>
        )}
      </div>
      {/* «Quitar pieza» pide un segundo toque y dice qué pasa: solo se va esta pieza, lo demás queda igual. */}
      <AnimatePresence initial={false}>
        {confirmando && (
          <motion.div
            key="confirmar"
            role="group"
            aria-label={`Quitar ${pieza.conArticulo}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DUR.corta, ease: EASE_SALIDA }}
            className="overflow-hidden"
          >
            <div className="mb-1 mt-0.5 rounded-xl bg-error-suave px-3 py-2.5">
              <p className="text-sm text-texto">Quito {pieza.conArticulo}; lo demás queda igual.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={bloqueado} onClick={() => { setConfirmando(false); aplicar({ tipo: "quitar-pieza", estructuraId: pieza.estructuraId }); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-error px-3.5 text-sm font-semibold text-fondo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/50 disabled:opacity-60">
                  <Trash2 className="size-4" aria-hidden />Sí, quitarla
                </button>
                <button type="button" onClick={() => setConfirmando(false)} className="min-h-11 rounded-xl px-3 text-sm font-medium text-texto-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40">No, dejarla</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <BarraColores colores={pieza.colores} cargando={recalculando} />
      <ul className="mt-2 space-y-1.5" aria-label={`Colores de ${pieza.titulo}`}>
        <AnimatePresence initial={false}>
          {pieza.colores.map((color) => (
            <motion.li
              key={`${color.indice}-${color.color}`}
              layout="position"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, height: 0 }}
              transition={{ duration: DUR.media, ease: EASE_SALIDA }}
            >
              <FilaColor color={color} pieza={pieza} cargando={recalculando} bloqueado={bloqueado} onCambio={aplicar} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {pieza.motivoFijo && <p className="mt-1.5 text-xs text-texto-suave">{pieza.motivoFijo}</p>}

      {pieza.tamano && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-borde-suave pt-2.5">
          <Ruler className="size-4 shrink-0 text-texto-suave" aria-hidden />
          <p className="min-w-[8.5rem] flex-1 text-sm text-texto">
            <span className="text-texto-suave">Tamaño </span>
            {recalculando ? <span className="brillo-carga inline-block h-4 w-16 rounded align-middle" aria-hidden /> : <span className="font-medium tabular-nums">{pieza.tamano.texto}</span>}
          </p>
          <div className="ml-auto flex gap-1.5">
            <BotonTexto deshabilitado={bloqueado || !pieza.tamano.puedeAchicar} onClick={() => aplicar({ tipo: "tamano", estructuraId: pieza.estructuraId, direccion: -1 })} icono={<Minus className="size-4" aria-hidden />}>Achicar</BotonTexto>
            <BotonTexto deshabilitado={bloqueado || !pieza.tamano.puedeAgrandar} onClick={() => aplicar({ tipo: "tamano", estructuraId: pieza.estructuraId, direccion: 1 })} icono={<Plus className="size-4" aria-hidden />}>Agrandar</BotonTexto>
          </div>
        </div>
      )}
      <EstadoDelBloque ajuste={ajuste} estructuraId={pieza.estructuraId} bloqueado={bloqueado} />
    </>
  );
}

/** «Calculando…» o el fallo con «Reintentar», junto al mando que se tocó (la pieza, o los colores del plan). */
function EstadoDelBloque({ ajuste, estructuraId, bloqueado }: { ajuste: AjustePlanGuiado; estructuraId: string | null; bloqueado: boolean }) {
  const { estado } = ajuste;
  const propio = estado.fase !== "quieto" && piezaDelCambio(estado.cambio) === estructuraId;
  return (
    <AnimatePresence initial={false}>
      {propio && estado.fase === "guardando" && (
        <motion.p
          key="guardando"
          role="status"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: DUR.corta, ease: EASE_SALIDA }}
          className="mt-2 flex items-center gap-2 overflow-hidden text-sm text-texto-suave"
        >
          <LoaderCircle className="size-4 shrink-0 animate-spin text-acento" aria-hidden />
          {estado.aviso}
        </motion.p>
      )}
      {propio && estado.fase === "error" && (
        <motion.div
          key="error"
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: DUR.corta, ease: EASE_SALIDA }}
          className="overflow-hidden"
        >
          <div className="mt-2 rounded-xl bg-error-suave px-3 py-2.5">
            <p className="text-sm text-texto">{estado.mensaje}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <motion.button type="button" whileTap={{ scale: 0.97 }} transition={RESORTE} disabled={bloqueado} onClick={ajuste.reintentar} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-error px-3.5 text-sm font-semibold text-fondo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/50 disabled:opacity-60">
                <RotateCcw className="size-4" aria-hidden />Reintentar
              </motion.button>
              <button type="button" onClick={ajuste.descartarError} className="min-h-11 rounded-xl px-3 text-sm font-medium text-texto-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40">Dejarlo así</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** La proporción de colores en una barra que se reacomoda sola cuando llega el plan nuevo. */
function BarraColores({ colores, cargando }: { colores: ReadonlyArray<Pick<ColorPieza, "color" | "fondo" | "porcentaje">>; cargando: boolean }) {
  const total = colores.reduce((suma, color) => suma + color.porcentaje, 0);
  if (cargando) return <span className="brillo-carga mt-1 block h-2.5 rounded-full" aria-hidden />;
  if (total <= 0) return null;
  return (
    <div className="mt-1 flex h-2.5 gap-px overflow-hidden rounded-full bg-borde-suave ring-1 ring-borde" aria-hidden>
      {colores.map((color, posicion) => (
        <motion.span
          key={`${posicion}-${color.color}`}
          // Un tramo negro se perdía contra la tarjeta en tema oscuro: lleva su propio borde claro.
          className={`h-full ${esOscuro(color.fondo) ? "ring-1 ring-inset ring-texto/40" : ""}`}
          style={{ backgroundColor: color.fondo }}
          initial={false}
          animate={{ width: `${color.porcentaje}%` }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        />
      ))}
    </div>
  );
}

function FilaColor({ color, pieza, cargando, bloqueado, onCambio }: { color: ColorPieza; pieza: PiezaAjustable; cargando: boolean; bloqueado: boolean; onCambio: (cambio: CambioPlan) => void }) {
  const nombre = color.etiqueta.toLocaleLowerCase("es");
  const conMandos = pieza.modoColores !== "fijo";
  // En un teléfono los mandos bajan a una segunda línea antes que recortar el nombre del color.
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-superficie py-1 pl-2.5 pr-1 ring-1 ring-borde-suave ring-inset">
      <span className="flex min-w-[8.5rem] flex-1 items-center gap-2">
        <span className={`size-4 shrink-0 rounded-full ${anilloDe(color.fondo)}`} style={{ backgroundColor: color.fondo }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-texto">{color.etiqueta}</span>
        <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-texto">
          {cargando ? <span className="brillo-carga ml-auto block h-4 w-9 rounded" aria-hidden /> : <CifraAnimada valor={color.porcentaje} sufijo=" %" />}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {conMandos && (
          <span className="flex items-center rounded-full bg-superficie-2 p-0.5">
            <BotonIcono etiqueta={`Menos ${nombre}`} deshabilitado={bloqueado || !color.puedeMenos} onClick={() => onCambio({ tipo: "protagonismo", estructuraId: pieza.estructuraId, indice: color.indice, direccion: -1 })}><Minus className="size-4" aria-hidden /></BotonIcono>
            <BotonIcono etiqueta={`Más ${nombre}`} deshabilitado={bloqueado || !color.puedeMas} onClick={() => onCambio({ tipo: "protagonismo", estructuraId: pieza.estructuraId, indice: color.indice, direccion: 1 })}><Plus className="size-4" aria-hidden /></BotonIcono>
          </span>
        )}
        {color.puedeQuitar && (
          <BotonIcono etiqueta={`Quitar ${nombre}`} tenue deshabilitado={bloqueado} onClick={() => onCambio({ tipo: "quitar-color", estructuraId: pieza.estructuraId, indice: color.indice })}><X className="size-4" aria-hidden /></BotonIcono>
        )}
      </span>
    </div>
  );
}

function BotonIcono({ etiqueta, deshabilitado, tenue = false, onClick, children }: { etiqueta: string; deshabilitado: boolean; tenue?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
      whileTap={deshabilitado ? undefined : { scale: 0.88 }}
      transition={RESORTE}
      className={`grid size-10 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-35 ${tenue ? "text-texto-suave hover:bg-error-suave hover:text-error" : "text-texto hover:bg-acento-suave hover:text-acento"}`}
    >
      {children}
    </motion.button>
  );
}

function BotonTexto({ deshabilitado, onClick, icono, children }: { deshabilitado: boolean; onClick: () => void; icono: ReactNode; children: string }) {
  return (
    <motion.button
      type="button"
      disabled={deshabilitado}
      onClick={onClick}
      whileTap={deshabilitado ? undefined : { scale: 0.95 }}
      transition={RESORTE}
      className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-borde bg-superficie px-3 text-sm font-medium text-texto transition-colors hover:border-acento hover:text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-40"
    >
      {icono}{children}
    </motion.button>
  );
}
