"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Check, Expand, Feather, LoaderCircle, Minus, Palette, PenLine, Plus, RefreshCw, RotateCcw, Ruler, Shapes, Trash2, X } from "lucide-react";
import { Ayuda } from "@/components/ui/Ayuda";
import { DUR, EASE_SALIDA, RESORTE } from "../animacion/movimiento";
import { AYUDAS } from "../ayudas-guiada";
import {
  admiteColorNuevo,
  cambiaTodasLasPiezas,
  globosEnTexto,
  motivoSinColorNuevo,
  piezaDelCambio,
  piezasAjustables,
  piezasDelCambio,
  type CambioPlan,
  type ColorPieza,
  type GloboParaPlan,
  type MedidaEditable,
  type PiezaAjustable,
  type PlanGuiado,
} from "./ajuste-plan-guiado";
import { planConImpresos, type GloboCatalogo } from "./selector-globos";
import { SelectorGlobos } from "./SelectorGlobos";
import { registrarAjuste, type AjustePlanGuiado, type EstadoAjuste } from "./usarAjustePlanGuiado";

type Props = {
  plan: PlanGuiado;
  ajuste: AjustePlanGuiado;
  /** Hay un turno del chat o una imagen en curso: los mandos esperan. */
  ocupado: boolean;
  /** Las sugerencias que rehace el asistente («Otros colores», «Agregar una pieza», «Hacerla más sencilla»). */
  onSugerencia?: (texto: string) => void;
  /** Abre la pieza grande con su dibujo para cambiar su forma («Modificar esta pieza»). */
  onModificarPieza?: (estructuraId: string) => void;
  /** Las piezas que se pueden abrir así (las arma un motor). */
  modificables?: ReadonlySet<string>;
};

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
function recalculandoEn(plan: PlanGuiado, estado: EstadoAjuste, estructuraId: string | null): boolean {
  if (estado.fase !== "guardando") return false;
  if (cambiaTodasLasPiezas(estado.cambio) || estructuraId === null) return true;
  const piezas = piezasDelCambio(plan, estado.cambio);
  return piezas === null || piezas.includes(estructuraId);
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

/** «Cambiar» abre el catálogo para ESE color (en todo el plan, o en una pieza y su pareja); «Añadir» para uno nuevo. */
type Seleccion =
  | { modo: "cambiar"; color: string; etiqueta: string; productId?: string; estructuraId?: string; pareja?: { estructuraId: string; titulo: string } | null; fuera: ReadonlySet<string> }
  | { modo: "agregar"; fuera: ReadonlySet<string> };

function globoParaPlan(globo: GloboCatalogo): GloboParaPlan {
  return { productId: globo.productId, color: globo.color, variantIds: globo.variantIds, nombre: globo.nombre };
}

/**
 * «Ajustar mi plan»: todo lo que se cambia sin escribir. Arriba, los cambios rápidos (otros colores, otra pieza, más
 * grande, más sencilla); luego los colores del plan (cambiar uno por otro globo del catálogo, añadir otro) y cada pieza
 * con CUÁNTOS globos lleva de cada color (escribir la cifra o − / + de a uno), sus medidas (escribirlas o agrandar /
 * achicar un 10 %) y quitarla. Cada toque lo rehace Python sobre el plan firmado (como la propuesta clásica) y los
 * mandos esperan hasta que llega el plan nuevo: las cifras que se ven son siempre las suyas.
 */
export function AjustarPlan({ plan, ajuste, ocupado, onSugerencia, onModificarPieza, modificables }: Props) {
  const piezas = useMemo(() => piezasAjustables(plan), [plan]);
  // El «?» de cantidad y % va en la primera pieza con una cifra que se escribe (una sola vez en todo el editor).
  const piezaConAyudaCantidad = piezas.findIndex((pieza) => pieza.colores.some((color) => color.cantidad));
  const { estado } = ajuste;
  const bloqueado = ocupado || ajuste.guardando;
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [sesionSelector, setSesionSelector] = useState(0);
  // null = lo que toca por defecto: marcado solo si la pieza y su pareja son hoy iguales (`pareja.iguales`). Una vez que
  // el cliente lo toca, manda lo suyo.
  const [aLasDos, setALasDos] = useState<boolean | null>(null);
  const [aLasDosSelector, setALasDosSelector] = useState(true);
  const [pistaColores, setPistaColores] = useState(false);
  const coloresRef = useRef<HTMLElement>(null);
  const conImpresos = useMemo(() => planConImpresos(plan.estructuras.flatMap((estructura) => (estructura.lineas as ReadonlyArray<{ titulo?: unknown }>).map((linea) => (typeof linea.titulo === "string" ? linea.titulo : null)))), [plan]);
  const ventas = ajuste.catalogo.fase === "listo" ? ajuste.catalogo.colores : [];

  const abrirSelector = (siguiente: Seleccion) => {
    ajuste.cargarColores();
    setALasDosSelector(true);
    setSesionSelector((valor) => valor + 1);
    setSeleccion(siguiente);
    registrarAjuste("ajuste.selector_abrir", siguiente.modo === "cambiar" ? { modo: siguiente.modo, color: siguiente.color, estructura_id: siguiente.estructuraId ?? null } : { modo: siguiente.modo });
  };

  const elegirGlobo = (globo: GloboCatalogo) => {
    const actual = seleccion;
    setSeleccion(null);
    if (!actual) return;
    registrarAjuste("ajuste.selector_elegir", { modo: actual.modo, product_id: globo.productId, color: globo.color, nombre: globo.nombre, tamanos: globo.tamanos });
    if (actual.modo === "agregar") {
      void ajuste.aplicar({ tipo: "agregar-color", color: globo.color, globo: globoParaPlan(globo) });
      return;
    }
    const estructuraIds = actual.estructuraId ? [actual.estructuraId, ...(actual.pareja && aLasDosSelector ? [actual.pareja.estructuraId] : [])] : undefined;
    void ajuste.aplicar({ tipo: "reemplazar-color", color: actual.color, ...(actual.productId ? { productIdAnterior: actual.productId } : {}), ...(estructuraIds ? { estructuraIds } : {}), globo: globoParaPlan(globo) });
  };

  const otrosColores = () => {
    setPistaColores(true);
    coloresRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="space-y-3 pb-1 pt-2">
      <p className="text-sm text-texto-suave">Cambia cuántos globos lleva cada color, cámbialo por otro globo del catálogo o ajusta las medidas. Cada cambio lo recalculo al momento.</p>
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

      <section aria-label="Cambios rápidos" className="flex flex-wrap gap-1.5">
        <BotonAccion icono={<Palette className="size-4" aria-hidden />} titulo="Otros colores" detalle="Cambia un color por otro" deshabilitado={bloqueado} onClick={otrosColores} />
        {onSugerencia && <BotonAccion icono={<Shapes className="size-4" aria-hidden />} titulo="Agregar una pieza" detalle="Te sugiero una que combine" deshabilitado={bloqueado} onClick={() => { registrarAjuste("ajuste.sugerencia", { texto: "Agregar una pieza" }); onSugerencia("Agregar una pieza"); }} />}
        <BotonAccion icono={<Expand className="size-4" aria-hidden />} titulo="Hacerla más grande" detalle="Todas las piezas, un 10 %" deshabilitado={bloqueado} onClick={() => void ajuste.aplicar({ tipo: "tamano-todo", direccion: 1 })} />
        {onSugerencia && <BotonAccion icono={<Feather className="size-4" aria-hidden />} titulo="Hacerla más sencilla" detalle="Menos globos y colores" deshabilitado={bloqueado} onClick={() => { registrarAjuste("ajuste.sugerencia", { texto: "Hacerla más sencilla" }); onSugerencia("Hacerla más sencilla"); }} />}
      </section>
      <EstadoDelBloque ajuste={ajuste} estructuraId={null} soloDelPlan bloqueado={bloqueado} />

      <section ref={coloresRef} aria-label="Colores de tu plan" className={`scroll-mt-3 rounded-2xl bg-superficie-suave p-2.5 ring-inset transition-shadow sm:p-3 ${pistaColores ? "ring-2 ring-acento/60" : "ring-1 ring-borde-suave"}`}>
        <ColoresDelPlan
          plan={plan}
          piezas={piezas}
          ajuste={ajuste}
          bloqueado={bloqueado}
          pista={pistaColores}
          onCerrarPista={() => setPistaColores(false)}
          onPaletaNueva={onSugerencia ? () => { setPistaColores(false); registrarAjuste("ajuste.sugerencia", { texto: "Otros colores" }); onSugerencia("Otros colores"); } : undefined}
          onCambiar={(color, etiqueta, productId) => abrirSelector({ modo: "cambiar", color, etiqueta, ...(productId ? { productId } : {}), fuera: new Set(productId ? [`${productId}|${color.toLocaleLowerCase("es")}`] : []) })}
          onAgregar={() => abrirSelector({ modo: "agregar", fuera: new Set(plan.plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => `${material.product_id}|${(material.color ?? "").toLocaleLowerCase("es")}`))) })}
        />
      </section>

      <AnimatePresence initial={false}>
        {piezas.map((pieza, posicion) => (
          <motion.section
            key={pieza.estructuraId}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: DUR.media, ease: EASE_SALIDA }}
            aria-label={`Ajustes de ${pieza.titulo}`}
            className="overflow-hidden rounded-2xl bg-superficie-suave p-2 ring-1 ring-borde-suave ring-inset sm:p-3"
          >
            <BloquePieza
              plan={plan}
              pieza={pieza}
              ajuste={ajuste}
              bloqueado={bloqueado}
              aLasDos={aLasDos ?? Boolean(pieza.pareja?.iguales)}
              onALasDos={setALasDos}
              ayudaCantidad={posicion === piezaConAyudaCantidad}
              onCambiar={(color) => abrirSelector({ modo: "cambiar", color: color.color, etiqueta: color.etiqueta, productId: color.productId, estructuraId: pieza.estructuraId, pareja: pieza.pareja, fuera: new Set([`${color.productId}|${color.color}`]) })}
              {...(onModificarPieza && modificables?.has(pieza.estructuraId) ? { onModificar: () => onModificarPieza(pieza.estructuraId) } : {})}
            />
          </motion.section>
        ))}
      </AnimatePresence>

      <SelectorGlobos
        abierto={seleccion !== null}
        sesion={sesionSelector}
        titulo={seleccion?.modo === "cambiar" ? `Cambiar ${seleccion.etiqueta.toLocaleLowerCase("es")} por…` : "Añadir un color"}
        detalle={seleccion?.modo === "cambiar"
          ? `El globo que elijas toma su lugar en todas sus medidas${seleccion.estructuraId ? "" : ", en todo el plan"}. Las medidas y los demás colores quedan igual.`
          : "Lo sumo a tus piezas con una parte pequeña; después ajustas cuántos lleva. Sus medidas quedan igual."}
        accion={(globo) => (seleccion?.modo === "cambiar" ? `Cambiar por ${globo.nombre}` : `Añadir ${globo.nombre}`)}
        approvalToken={plan.approval_token}
        ventas={ventas}
        conImpresos={conImpresos}
        fuera={seleccion?.fuera ?? new Set()}
        {...(seleccion?.modo === "cambiar" && seleccion.pareja ? { extra: <InterruptorPareja activo={aLasDosSelector} onCambio={setALasDosSelector} pareja={seleccion.pareja.titulo} nota="el mismo globo en las dos" /> } : {})}
        onElegir={elegirGlobo}
        onCerrar={() => setSeleccion(null)}
      />
    </div>
  );
}

/** Un cambio rápido como chip (los mismos de antes bajo la tarjeta); lo que hace va en su nombre accesible. */
function BotonAccion({ icono, titulo, detalle, deshabilitado, onClick }: { icono: ReactNode; titulo: string; detalle: string; deshabilitado: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      disabled={deshabilitado}
      onClick={onClick}
      title={detalle}
      aria-label={`${titulo}: ${detalle.toLocaleLowerCase("es")}`}
      whileTap={deshabilitado ? undefined : { scale: 0.96 }}
      transition={RESORTE}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-superficie py-1 pl-1.5 pr-3.5 text-sm font-medium text-texto ring-1 ring-borde-suave transition-colors hover:bg-acento-suave hover:ring-acento/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-acento-suave text-acento">{icono}</span>
      {titulo}
    </motion.button>
  );
}

function ColoresDelPlan({ plan, piezas, ajuste, bloqueado, pista, onCerrarPista, onPaletaNueva, onCambiar, onAgregar }: {
  plan: PlanGuiado;
  piezas: readonly PiezaAjustable[];
  ajuste: AjustePlanGuiado;
  bloqueado: boolean;
  pista: boolean;
  onCerrarPista: () => void;
  onPaletaNueva: (() => void) | undefined;
  onCambiar: (color: string, etiqueta: string, productId?: string) => void;
  onAgregar: () => void;
}) {
  // Un renglón por GLOBO del plan (producto y color: un blanco perlado junto al blanco de siempre son dos), con el
  // nombre y el tono de sus filas en las piezas y sus globos en todo el plan (los de Python, sumando las piezas).
  const colores = useMemo(() => {
    const porGlobo = new Map<string, { color: string; productId: string; producto: string | null; etiqueta: string; fondo: string; globos: number }>();
    for (const pieza of piezas) {
      for (const color of pieza.colores) {
        const clave = `${color.productId}|${color.color.toLocaleLowerCase("es")}`;
        const actual = porGlobo.get(clave);
        porGlobo.set(clave, actual ? { ...actual, globos: actual.globos + color.globos } : { color: color.color, productId: color.productId, producto: color.producto, etiqueta: color.etiqueta, fondo: color.fondo, globos: color.globos });
      }
    }
    const lista = [...porGlobo.values()];
    const total = lista.reduce((suma, color) => suma + color.globos, 0) || 1;
    // Mismo nombre en dos globos distintos: se distinguen por el producto («Blanco · Silk Blanco Nácar»).
    const repetidos = new Set(lista.map((color) => color.etiqueta).filter((etiqueta, indice, todas) => todas.indexOf(etiqueta) !== indice));
    return lista.map((color) => ({ ...color, clave: `${color.productId}|${color.color}`, porcentaje: Math.round((color.globos / total) * 100), unico: !repetidos.has(color.etiqueta) }));
  }, [piezas]);
  const recalculando = recalculandoEn(plan, ajuste.estado, null);
  const motivo = motivoSinColorNuevo(plan);
  return (
    <>
      <div className="flex min-h-11 items-center gap-2">
        <Palette className="size-4 shrink-0 text-acento" aria-hidden />
        <h4 className="min-w-0 font-medium text-texto">Colores de tu plan</h4>
        <Ayuda {...AYUDAS.coloresPorcentaje} />
      </div>
      <AnimatePresence initial={false}>
        {pista && (
          <motion.div key="pista" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: DUR.corta, ease: EASE_SALIDA }} className="overflow-hidden">
            <div className="mb-2 rounded-xl bg-acento-suave px-3 py-2.5 text-sm text-texto">
              <p>Toca <span className="font-semibold">Cambiar</span> en un color para elegir otro globo del catálogo; lo demás queda igual.</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {onPaletaNueva && <button type="button" disabled={bloqueado} onClick={onPaletaNueva} className="min-h-11 rounded-xl bg-superficie px-3 text-sm font-medium text-acento ring-1 ring-acento/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50">Prefiero que me propongas otra paleta</button>}
                <button type="button" onClick={onCerrarPista} className="min-h-11 rounded-xl px-2 text-sm text-texto-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">Entendido</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <BarraColores colores={colores} cargando={recalculando} />
      <ul className="mt-2 space-y-1.5" aria-label="Colores de tu plan">
        <AnimatePresence initial={false}>
          {colores.map((color) => {
            return (
            <motion.li
              key={color.clave}
              layout="position"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: DUR.media, ease: EASE_SALIDA }}
              className="flex min-h-12 items-center gap-2 rounded-xl bg-superficie py-1 pl-2.5 pr-1 ring-1 ring-borde-suave ring-inset"
            >
              <span className={`size-4 shrink-0 rounded-full ${anilloDe(color.fondo)}`} style={{ backgroundColor: color.fondo }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-texto">{color.etiqueta}{color.unico || !color.producto ? "" : <span className="font-normal text-texto-suave"> · {color.producto}</span>}</span>
                <span className="block text-xs tabular-nums text-texto-suave">
                  {recalculando ? <span className="brillo-carga inline-block h-3 w-24 rounded align-middle" aria-hidden /> : <>{globosEnTexto(color.globos)} · <CifraAnimada valor={color.porcentaje} sufijo=" %" /></>}
                </span>
              </span>
              <BotonCambiar etiqueta={`Cambiar ${color.etiqueta.toLocaleLowerCase("es")} por otro globo`} deshabilitado={bloqueado} onClick={() => onCambiar(color.color, color.etiqueta, color.productId)} />
            </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {admiteColorNuevo(plan) ? (
        <div className="mt-2 flex items-center gap-2.5">
          <motion.button
            type="button"
            disabled={bloqueado}
            onClick={onAgregar}
            whileTap={bloqueado ? undefined : { scale: 0.97 }}
            transition={RESORTE}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed border-acento/50 px-3 text-sm font-semibold text-acento hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden />Añadir un color
          </motion.button>
          <Ayuda {...AYUDAS.cambiarAnadirColor} />
        </div>
      ) : motivo ? (
        <p className="mt-2 text-xs text-texto-suave">{motivo}</p>
      ) : null}
      <EstadoDelBloque ajuste={ajuste} estructuraId={null} bloqueado={bloqueado} />
    </>
  );
}

function BotonCambiar({ etiqueta, deshabilitado, onClick }: { etiqueta: string; deshabilitado: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
      whileTap={deshabilitado ? undefined : { scale: 0.94 }}
      transition={RESORTE}
      className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-superficie-2 px-2.5 text-xs font-semibold text-acento transition-colors hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-40"
    >
      <RefreshCw className="size-3.5" aria-hidden />Cambiar
    </motion.button>
  );
}

/**
 * «Hacer lo mismo en la otra». `nota`: lo que pasa con la pareja, que solo es «quedan iguales» si hoy lo son (con
 * cifras distintas la pareja recibe la misma diferencia, no la misma cifra; probador 141).
 */
function InterruptorPareja({ activo, onCambio, pareja, nota = "quedan iguales" }: { activo: boolean; onCambio: (valor: boolean) => void; pareja: string; nota?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl bg-acento-suave/60 px-3 py-1.5 text-sm text-texto">
      <input type="checkbox" checked={activo} onChange={(evento) => onCambio(evento.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-acento/50 ${activo ? "bg-acento" : "bg-borde"}`}>
        <motion.span className="absolute top-0.5 size-5 rounded-full bg-superficie shadow" animate={{ left: activo ? 18 : 2 }} transition={RESORTE} />
      </span>
      <span className="min-w-0">Hacer lo mismo en <span className="font-medium">{pareja.toLocaleLowerCase("es")}</span> <span className="text-texto-suave">({nota})</span></span>
    </label>
  );
}

function BloquePieza({ plan, pieza, ajuste, bloqueado, aLasDos, onALasDos, onCambiar, onModificar, ayudaCantidad = false }: {
  plan: PlanGuiado;
  pieza: PiezaAjustable;
  ajuste: AjustePlanGuiado;
  bloqueado: boolean;
  aLasDos: boolean;
  onALasDos: (valor: boolean) => void;
  onCambiar: (color: ColorPieza) => void;
  onModificar?: () => void;
  /** Esta pieza lleva el «?» de cantidad y %, en su primer color con cifra escribible. */
  ayudaCantidad?: boolean;
}) {
  const recalculando = recalculandoEn(plan, ajuste.estado, pieza.estructuraId);
  const colorConAyuda = ayudaCantidad ? pieza.colores.findIndex((color) => color.cantidad) : -1;
  const pareja = pieza.pareja !== null && aLasDos;
  const aplicar = (cambio: CambioPlan) => void ajuste.aplicar(cambio);
  const [confirmando, setConfirmando] = useState(false);
  return (
    <>
      <div className="flex min-h-11 items-center gap-2">
        <h4 className="min-w-0 flex-1 font-medium leading-tight text-texto">
          <span className="block truncate">{pieza.titulo}</span>
          <span className="block text-xs font-normal tabular-nums text-texto-suave">{recalculando ? "Calculando…" : globosEnTexto(pieza.globos)}</span>
        </h4>
        {pieza.puedeQuitarPieza && !confirmando && (
          <button type="button" disabled={bloqueado} onClick={() => setConfirmando(true)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-texto-suave transition-colors hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50">
            <Trash2 className="size-4" aria-hidden />Quitar
          </button>
        )}
      </div>
      {/* «Quitar pieza» pide un segundo toque y dice qué pasa: solo se va esta pieza, lo demás queda igual. */}
      <AnimatePresence initial={false}>
        {confirmando && (
          <motion.div key="confirmar" role="group" aria-label={`Quitar ${pieza.conArticulo}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: DUR.corta, ease: EASE_SALIDA }} className="overflow-hidden">
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
      {pieza.pareja && <div className="mb-2"><InterruptorPareja activo={aLasDos} onCambio={onALasDos} pareja={pieza.pareja.titulo} nota={pieza.pareja.iguales ? "quedan iguales" : "hoy no son iguales: cambia lo mismo"} /></div>}

      <BarraColores colores={pieza.colores} cargando={recalculando} />
      <ul className="mt-2 space-y-1.5" aria-label={`Colores de ${pieza.titulo}`}>
        <AnimatePresence initial={false}>
          {pieza.colores.map((color, posicion) => (
            <motion.li key={`${color.indice}-${color.color}`} layout="position" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96, height: 0 }} transition={{ duration: DUR.media, ease: EASE_SALIDA }}>
              <FilaColor color={color} pieza={pieza} pareja={pareja} cargando={recalculando} bloqueado={bloqueado} onCambio={aplicar} onCambiar={() => onCambiar(color)} ayuda={posicion === colorConAyuda} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {pieza.motivoFijo && <p className="mt-1.5 text-xs text-texto-suave">{pieza.motivoFijo}{onModificar ? " Puedes moverlos en «Cambiar la forma»." : ""}</p>}

      {pieza.medidas.length > 0 && <MedidasPieza key={`${plan.plan_hash}-${pieza.estructuraId}`} pieza={pieza} pareja={pareja} cargando={recalculando} bloqueado={bloqueado} onCambio={aplicar} />}
      {onModificar && (
        <button type="button" disabled={bloqueado} onClick={onModificar} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-sm font-medium text-acento hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50">
          <PenLine className="size-4" aria-hidden />Cambiar la forma (con el dibujo)
        </button>
      )}
      <EstadoDelBloque ajuste={ajuste} estructuraId={pieza.estructuraId} bloqueado={bloqueado} />
    </>
  );
}

/** «Calculando…» o el fallo con «Reintentar», junto al mando que se tocó (la pieza, los colores o los cambios rápidos). */
function EstadoDelBloque({ ajuste, estructuraId, bloqueado, soloDelPlan = false }: { ajuste: AjustePlanGuiado; estructuraId: string | null; bloqueado: boolean; soloDelPlan?: boolean }) {
  const { estado } = ajuste;
  const delPlanEntero = estado.fase !== "quieto" && estado.cambio.tipo === "tamano-todo";
  const propio = estado.fase !== "quieto" && (soloDelPlan ? delPlanEntero : !delPlanEntero && piezaDelCambio(estado.cambio) === estructuraId);
  return (
    <AnimatePresence initial={false}>
      {propio && estado.fase === "guardando" && (
        <motion.p key="guardando" role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: DUR.corta, ease: EASE_SALIDA }} className="mt-2 flex items-center gap-2 overflow-hidden text-sm text-texto-suave">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-acento" aria-hidden />
          {estado.aviso}
        </motion.p>
      )}
      {propio && estado.fase === "error" && (
        <motion.div key="error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: DUR.corta, ease: EASE_SALIDA }} className="overflow-hidden">
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

/** «12″ 60 · 5″ 30»: los globos del color por tamaño (los de Python). */
function porTamanoEnTexto(color: ColorPieza): string {
  return color.tamanos.map((tamano) => `${tamano.pulgadas}″ ${tamano.unidades}`).join(" · ");
}

function FilaColor({ color, pieza, pareja, cargando, bloqueado, onCambio, onCambiar, ayuda = false }: { color: ColorPieza; pieza: PiezaAjustable; pareja: boolean; cargando: boolean; bloqueado: boolean; onCambio: (cambio: CambioPlan) => void; onCambiar: () => void; ayuda?: boolean }) {
  const nombre = color.etiqueta.toLocaleLowerCase("es");
  const conPareja = pareja ? { pareja: true } : {};
  // Tres líneas que caben en 390 px: el color (con su parte y quitar), cuántos lleva (y «Cambiar») y sus tamaños.
  return (
    <div className="rounded-xl bg-superficie px-2 py-2 ring-1 ring-borde-suave ring-inset">
      <div className="flex min-h-8 items-center gap-2">
        <span className={`size-4 shrink-0 rounded-full ${anilloDe(color.fondo)}`} style={{ backgroundColor: color.fondo }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-texto" title={color.producto ?? undefined}>{color.etiqueta}</span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-texto-suave">{cargando ? <span className="brillo-carga inline-block h-3.5 w-9 rounded align-middle" aria-hidden /> : <CifraAnimada valor={color.porcentaje} sufijo=" %" />}</span>
        {ayuda && <Ayuda {...AYUDAS.cantidadPorcentaje} />}
        {color.puedeQuitar && (
          <BotonIcono etiqueta={`Quitar ${nombre}`} tenue deshabilitado={bloqueado} onClick={() => onCambio({ tipo: "quitar-color", estructuraId: pieza.estructuraId, indice: color.indice, ...conPareja })}><X className="size-4" aria-hidden /></BotonIcono>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {color.cantidad ? (
          <CantidadGlobos color={color} cargando={cargando} bloqueado={bloqueado} onCantidad={(objetivo) => onCambio({ tipo: "cantidad", estructuraId: pieza.estructuraId, indice: color.indice, objetivo, desde: color.globos, ...conPareja })} />
        ) : pieza.modoColores === "posiciones" ? (
          <span className="flex items-center rounded-full bg-superficie-2 p-0.5 ring-1 ring-borde-suave">
            <BotonIcono compacto etiqueta={`Menos ${nombre} en el patrón`} deshabilitado={bloqueado || !color.puedeMenos} onClick={() => onCambio({ tipo: "protagonismo", estructuraId: pieza.estructuraId, indice: color.indice, direccion: -1, ...conPareja })}><Minus className="size-4" aria-hidden /></BotonIcono>
            <span className="min-w-12 text-center text-base font-semibold tabular-nums text-texto">{cargando ? "…" : color.globos}</span>
            <BotonIcono compacto etiqueta={`Más ${nombre} en el patrón`} deshabilitado={bloqueado || !color.puedeMas} onClick={() => onCambio({ tipo: "protagonismo", estructuraId: pieza.estructuraId, indice: color.indice, direccion: 1, ...conPareja })}><Plus className="size-4" aria-hidden /></BotonIcono>
          </span>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-texto">{cargando ? "…" : globosEnTexto(color.globos)}</span>
        )}
        <span className="ml-auto"><BotonCambiar etiqueta={`Cambiar ${nombre} de ${pieza.titulo.toLocaleLowerCase("es")} por otro globo`} deshabilitado={bloqueado} onClick={onCambiar} /></span>
      </div>
      <p className="mt-1 text-[11px] leading-snug tabular-nums text-texto-suave">
        {cargando ? "Calculando…" : <>{globosEnTexto(color.globos)}{color.tamanos.length > 0 ? ` · ${porTamanoEnTexto(color)}` : ""}{pieza.modoColores === "posiciones" ? " · el patrón los reparte por franjas" : ""}</>}
      </p>
    </div>
  );
}

/**
 * Cuántos globos lleva un color: − y + de a uno, o escribir la cifra (Enter o al salir). La cifra que queda es la de
 * Python; mientras se escribe no se pide nada.
 */
function CantidadGlobos({ color, cargando, bloqueado, onCantidad }: { color: ColorPieza; cargando: boolean; bloqueado: boolean; onCantidad: (objetivo: number) => void }) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const rango = color.cantidad!;
  const nombre = color.etiqueta.toLocaleLowerCase("es");
  const confirmar = () => {
    if (borrador === null) return;
    const valor = Number.parseInt(borrador.replace(/\D/g, ""), 10);
    setBorrador(null);
    if (!Number.isFinite(valor) || valor === color.globos) return;
    onCantidad(Math.min(rango.maximo, Math.max(rango.minimo, valor)));
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center rounded-full bg-superficie-2 p-0.5 ring-1 ring-borde-suave">
        <BotonIcono compacto etiqueta={`Un globo ${nombre} menos`} deshabilitado={bloqueado || color.globos <= rango.minimo} onClick={() => onCantidad(color.globos - 1)}><Minus className="size-4" aria-hidden /></BotonIcono>
        {cargando ? (
          <span className="brillo-carga mx-0.5 inline-block h-9 w-14 rounded-lg" aria-hidden />
        ) : (
          <input
            type="text"
            inputMode="numeric"
            aria-label={`Globos ${nombre} (entre ${rango.minimo} y ${rango.maximo})`}
            value={borrador ?? String(color.globos)}
            disabled={bloqueado}
            onFocus={(evento) => { setBorrador(String(color.globos)); evento.currentTarget.select(); }}
            onChange={(evento) => setBorrador(evento.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            onBlur={confirmar}
            onKeyDown={(evento) => {
              if (evento.key === "Enter") evento.currentTarget.blur();
              if (evento.key === "Escape") { setBorrador(null); evento.currentTarget.blur(); }
            }}
            className="mx-0.5 h-9 w-14 rounded-lg bg-superficie text-center text-base font-semibold tabular-nums text-texto ring-1 ring-borde-suave focus:outline-none focus:ring-2 focus:ring-acento disabled:opacity-60"
          />
        )}
        <BotonIcono compacto etiqueta={`Un globo ${nombre} más`} deshabilitado={bloqueado || color.globos >= rango.maximo} onClick={() => onCantidad(color.globos + 1)}><Plus className="size-4" aria-hidden /></BotonIcono>
      </span>
    </span>
  );
}

function numeroEnTexto(valor: number): string {
  return String(Math.round(valor * 100) / 100).replace(".", ",");
}

/**
 * Las medidas de la pieza, las mismas de la tarjeta: se escriben en metros (y «Aplicar») o se agrandan / achican un
 * 10 %. Python arma la pieza con esa medida y la cuenta; la que queda escrita es la que armó.
 */
function MedidasPieza({ pieza, pareja, cargando, bloqueado, onCambio }: { pieza: PiezaAjustable; pareja: boolean; cargando: boolean; bloqueado: boolean; onCambio: (cambio: CambioPlan) => void }) {
  const [borradores, setBorradores] = useState<Partial<Record<MedidaEditable["campo"], string>>>({});
  const conPareja = pareja ? { pareja: true } : {};
  const pedidas = Object.fromEntries(pieza.medidas.flatMap((medida) => {
    const texto = borradores[medida.campo];
    if (texto === undefined) return [];
    const valor = Number.parseFloat(texto.replace(",", "."));
    return Number.isFinite(valor) && valor > 0 && Math.abs(valor - medida.valor) >= 0.01 ? [[medida.campo, valor]] : [];
  })) as Partial<Record<MedidaEditable["campo"], number>>;
  const hayCambio = Object.keys(pedidas).length > 0;
  const fuera = pieza.medidas.find((medida) => pedidas[medida.campo] !== undefined && (pedidas[medida.campo]! < medida.minimo * 0.5 || pedidas[medida.campo]! > medida.maximo * 1.5));
  return (
    <div className="mt-2.5 border-t border-borde-suave pt-2.5">
      <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
        <Ruler className="mb-2.5 size-4 shrink-0 text-texto-suave" aria-hidden />
        {pieza.medidas.map((medida, posicion) => (
          <span key={medida.campo} className="flex items-end gap-1.5">
            {posicion > 0 && <span className="mb-2 text-texto-suave" aria-hidden>×</span>}
            <label className="flex flex-col">
              <span className="text-[0.7rem] font-medium uppercase tracking-wide text-texto-suave">{medida.etiqueta}</span>
              <span className="flex items-center gap-1">
                {cargando ? <span className="brillo-carga inline-block h-9 w-16 rounded-lg" aria-hidden /> : (
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${medida.etiqueta} en metros`}
                    value={borradores[medida.campo] ?? numeroEnTexto(medida.valor)}
                    disabled={bloqueado}
                    onFocus={(evento) => evento.currentTarget.select()}
                    onChange={(evento) => { const valor = evento.target.value.replace(/[^\d.,]/g, "").slice(0, 5); setBorradores((actuales) => ({ ...actuales, [medida.campo]: valor })); }}
                    onKeyDown={(evento) => { if (evento.key === "Enter" && hayCambio && !fuera) { onCambio({ tipo: "medidas", estructuraId: pieza.estructuraId, medidas: pedidas, ...conPareja }); evento.currentTarget.blur(); } }}
                    className="h-9 w-16 rounded-lg bg-superficie text-center text-base font-semibold tabular-nums text-texto ring-1 ring-borde-suave focus:outline-none focus:ring-2 focus:ring-acento disabled:opacity-60"
                  />
                )}
                <span className="text-sm text-texto-suave">m</span>
              </span>
            </label>
          </span>
        ))}
        {hayCambio ? (
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => setBorradores({})} className="min-h-11 rounded-xl px-2.5 text-sm text-texto-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40">Deshacer</button>
            <motion.button type="button" disabled={bloqueado || Boolean(fuera)} whileTap={{ scale: 0.96 }} transition={RESORTE} onClick={() => onCambio({ tipo: "medidas", estructuraId: pieza.estructuraId, medidas: pedidas, ...conPareja })} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-acento px-3.5 text-sm font-semibold text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50">
              <Check className="size-4" aria-hidden />Aplicar
            </motion.button>
          </span>
        ) : pieza.tamano && (
          <span className="ml-auto flex gap-1.5">
            <BotonTexto etiqueta="Achicar un 10 %" deshabilitado={bloqueado || !pieza.tamano.puedeAchicar} onClick={() => onCambio({ tipo: "tamano", estructuraId: pieza.estructuraId, direccion: -1, ...conPareja })} icono={<Minus className="size-4" aria-hidden />}>10 %</BotonTexto>
            <BotonTexto etiqueta="Agrandar un 10 %" deshabilitado={bloqueado || !pieza.tamano.puedeAgrandar} onClick={() => onCambio({ tipo: "tamano", estructuraId: pieza.estructuraId, direccion: 1, ...conPareja })} icono={<Plus className="size-4" aria-hidden />}>10 %</BotonTexto>
          </span>
        )}
      </div>
      {fuera && <p className="mt-1 text-xs text-aviso">{`${fuera.etiqueta}: entre ${numeroEnTexto(fuera.minimo)} y ${numeroEnTexto(fuera.maximo)} m.`}</p>}
      {!hayCambio && <p className="mt-1 text-xs text-texto-suave">Escribe la medida en metros o usa − / + 10 %. La pieza se arma globo a globo y puede quedar unos centímetros distinta.</p>}
    </div>
  );
}

function BotonIcono({ etiqueta, deshabilitado, tenue = false, compacto = false, onClick, children }: { etiqueta: string; deshabilitado: boolean; tenue?: boolean; compacto?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
      whileTap={deshabilitado ? undefined : { scale: 0.88 }}
      transition={RESORTE}
      className={`grid ${compacto ? "size-9" : "size-10"} shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-35 ${tenue ? "text-texto-suave hover:bg-error-suave hover:text-error" : "text-texto hover:bg-acento-suave hover:text-acento"}`}
    >
      {children}
    </motion.button>
  );
}

function BotonTexto({ etiqueta, deshabilitado, onClick, icono, children }: { etiqueta: string; deshabilitado: boolean; onClick: () => void; icono: ReactNode; children: string }) {
  return (
    <motion.button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
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

