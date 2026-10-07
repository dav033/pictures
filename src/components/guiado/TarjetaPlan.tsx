"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Calculator, Check, ChevronDown, GraduationCap, MapPin, PenLine, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import { z } from "zod";
import { Lightbox } from "@/components/Lightbox";
import { BarraTamanos, tramosPorTamano } from "@/components/plan/BarraTamanos";
import type { CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import { ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { ComprarMateriales } from "./ComprarMateriales";
import { CostosMateriales } from "./CostosMateriales";
import { EsqueletoImagen } from "./Esqueletos";
import { GraficaMotorGuiada } from "./GraficaMotorGuiada";
import { PanelPlegable } from "./Plegable";
import { decoracionDePlan, type ContextoCompra } from "./plan-compra";
import { colorCliente, medidasEnPalabras, textoGlobos } from "./formato";
import { DUR, EASE_REBOTE, EASE_SALIDA, RESORTE, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";

export type AccionPlan = "ver" | "costear" | "comprar" | "aprender" | "contratar" | "cambiar";
export type EstadoImagen = "nada" | "cargando" | "lista" | "error";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
type CotizacionPlan = z.infer<typeof CotizacionPlanGuiadoSchema>;
type Uso = "personal" | "negocio";

type Props = {
  plan: PlanGuiado;
  cotizacion?: CotizacionPlan;
  /** URL de la imagen «Ver cómo quedaría», si ya se dibujó. */
  imagen?: string | null;
  estadoImagen: EstadoImagen;
  /** Costeo abierto para ESTE plan (no global): personal, negocio o ninguno. */
  usoCosteo: Uso | null;
  compraAbierta: boolean;
  /** El plan vigente (el último). Las versiones anteriores quedan atenuadas y sin acciones. */
  vigente: boolean;
  /** Hay un turno en curso: las acciones se desactivan. */
  ocupado: boolean;
  /** Acciones que el cliente ya usó con este plan: llevan un check pequeño. */
  hechas: readonly AccionPlan[];
  /** Total del plan anterior (tras «Cambiar algo»): el contador anima desde ahí y muestra la diferencia. */
  totalAnterior?: number;
  contextoCompra: ContextoCompra;
  /** ver, comprar, aprender, contratar, cambiar. «costear» abre aquí el selector y llega por onCosteo. */
  onAccion: (accion: Exclude<AccionPlan, "costear">) => void;
  onCosteo: (uso: Uso) => void;
  /** Sin precio: «Buscar un proveedor cerca». */
  onProveedores: () => void;
  /** «Buscar un distribuidor cerca» desde Comprar. */
  onDistribuidor: () => void;
};

const LineaPlanSchema = z.object({ color: z.string().nullish(), diam_pulg: z.number().nullish(), tamano_codigo: z.string().nullish(), unidades: z.number() }).passthrough();

/** Globos de una pieza tal como los resolvió Python, agrupados por color y por tamaño (solo para mostrarlos). */
function globosDePieza(plan: PlanGuiado, estructuraId: string): { porColor: Array<{ color: string; cantidad: number }>; porTamano: Array<{ pulgadas: number | null; unidades: number }> } {
  const lineas = plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId)?.lineas ?? [];
  const porColor = new Map<string, number>();
  const porTamano: Array<{ pulgadas: number | null; unidades: number }> = [];
  for (const linea of lineas) {
    const leida = LineaPlanSchema.safeParse(linea);
    if (!leida.success) continue;
    const color = leida.data.color?.trim() || "otro color";
    porColor.set(color, (porColor.get(color) ?? 0) + leida.data.unidades);
    const codigo = leida.data.tamano_codigo ? Number.parseFloat(leida.data.tamano_codigo.replace(/^R-?/i, "")) : Number.NaN;
    porTamano.push({ pulgadas: leida.data.diam_pulg ?? (Number.isFinite(codigo) ? codigo : null), unidades: leida.data.unidades });
  }
  return { porColor: [...porColor.entries()].map(([color, cantidad]) => ({ color, cantidad })), porTamano };
}

function hexDe(color: string): string | undefined {
  if (color.startsWith("#")) return color;
  return HEX_COLORES_V2[color.toLocaleLowerCase("es") as keyof typeof HEX_COLORES_V2];
}

function idOficial(valor: unknown): EstructuraOficialId | null {
  return typeof valor === "string" && (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(valor) ? valor as EstructuraOficialId : null;
}

/**
 * «Tu plan»: lo que lleva la decoración (piezas, medidas, mezcla de tamaños, globos por color, total) y qué hacer
 * con él, con una acción principal clara («Ver cómo quedaría») y el resto a mano. Las cantidades son de Python.
 */
export function TarjetaPlan(props: Props) {
  const { plan, cotizacion, imagen, estadoImagen, usoCosteo, compraAbierta, vigente, ocupado, hechas, totalAnterior, contextoCompra, onAccion, onCosteo, onProveedores, onDistribuidor } = props;
  const reducido = useReducedMotion();
  const desglose = useMemo(() => generarPasosPlan(plan), [plan]);
  const piezas = plan.plan.estructuras;
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [costeoVisible, setCosteoVisible] = useState<boolean | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const costeoAbierto = costeoVisible ?? usoCosteo !== null;
  const bloqueado = ocupado || estadoImagen === "cargando";
  const paleta = (plan.plan.concepto.paleta.length ? plan.plan.concepto.paleta : [...new Set(desglose.globos.map((globo) => globo.color))]).slice(0, 6);
  const decoracionCompra = useMemo(
    () => (cotizacion ? decoracionDePlan(plan, cotizacion, contextoCompra) : null),
    // El contexto llega como objeto nuevo en cada render: se compara por sus campos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, cotizacion, contextoCompra.evento, contextoCompra.tematica, contextoCompra.edad],
  );
  const hecha = (accion: AccionPlan) => hechas.includes(accion);
  const etiquetaPrincipal = estadoImagen === "error" ? "Reintentar imagen" : estadoImagen === "lista" ? "Dibujar otra versión" : "Ver cómo quedaría";

  return (
    <motion.article
      layout="position"
      variants={grupoConRitmo(0.08)}
      initial="oculto"
      animate="visible"
      aria-label={`Tu plan: ${plan.plan.concepto.titulo}`}
      className={`mt-3 w-full rounded-3xl border border-borde-suave bg-superficie p-4 shadow-[0_1px_2px_var(--sombra),0_16px_40px_var(--sombra)] transition-opacity sm:p-5 ${vigente ? "" : "opacity-70"}`}
    >
      {/* Cabecera */}
      <motion.header variants={hijoEscalonado}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-acento">Tu plan</p>
          {!vigente && <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-[0.7rem] font-medium text-texto-suave">Versión anterior</span>}
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-lg font-semibold leading-snug text-texto">{plan.plan.concepto.titulo}</h3>
          {paleta.length > 0 && (
            <motion.span className="flex shrink-0 pl-1.5 pt-1" aria-label={`Colores: ${paleta.map(colorCliente).join(", ")}`} role="img" variants={grupoConRitmo(0.04, 0.15)}>
              {paleta.map((color) => (
                <motion.span
                  key={color}
                  title={colorCliente(color)}
                  variants={{ oculto: { scale: 0 }, visible: { scale: 1, transition: { duration: 0.35, ease: EASE_REBOTE } } }}
                  className="-ml-1.5 size-5 rounded-full ring-2 ring-superficie"
                  style={{ backgroundColor: hexDe(color) ?? "#9ca3af" }}
                />
              ))}
            </motion.span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-4xl font-semibold tracking-tight text-texto tabular-nums"><ContadorGlobos total={desglose.total} desde={totalAnterior ?? 0} /></span>
          <span className="text-base text-texto-suave">{desglose.total === 1 ? "globo" : "globos"}</span>
          {totalAnterior !== undefined && <PastillaDiferencia diferencia={desglose.total - totalAnterior} />}
        </div>
        <p className="mt-0.5 text-sm text-texto-suave">
          {piezas.reduce((suma, pieza) => suma + pieza.repeticiones, 0)} {piezas.reduce((suma, pieza) => suma + pieza.repeticiones, 0) === 1 ? "pieza" : "piezas"}: {piezas.map((pieza) => `${pieza.repeticiones > 1 ? `${pieza.repeticiones} × ` : ""}${pieza.nombre}`).join(", ")}
        </p>
      </motion.header>

      {/* Piezas */}
      <motion.ul variants={hijoEscalonado} className="mt-4 space-y-2.5">
        {piezas.map((pieza, indice) => {
          const globos = globosDePieza(plan, pieza.estructura_id);
          const tramos = tramosPorTamano(globos.porTamano);
          const medidas = medidasEnPalabras(pieza.medidas);
          const mezclaReal = plan.estructuras.find((resuelta) => resuelta.estructura_id === pieza.estructura_id)?.mezcla_real;
          return (
            <li key={pieza.estructura_id} className="grid grid-cols-[5rem_1fr] gap-3 rounded-2xl bg-superficie-suave p-3 sm:grid-cols-[6rem_1fr]">
              <span className="grid size-20 place-items-center overflow-hidden rounded-xl bg-superficie-2 p-1.5 text-acento sm:size-24">
                <GraficaMotorGuiada plan={plan.plan} pieza={pieza} mezclaReal={mezclaReal} id={idOficial(pieza.estructura_oficial) ?? "arco"} nombre={pieza.nombre} />
              </span>
              <div className="min-w-0">
                <p className="font-medium leading-snug text-texto">{pieza.repeticiones > 1 ? `${pieza.repeticiones} × ` : ""}{pieza.nombre}</p>
                <p className="text-xs text-texto-suave">{medidas ?? "Medida según el espacio"}</p>
                {tramos.length > 0 && <BarraTamanos tramos={tramos} retraso={0.25 + indice * 0.12} className="mt-2" descripcion={`Globos de ${tramos.map((tramo) => tramo.pulgadas).join(", ")} pulgadas`} />}
                {globos.porColor.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Globos por color">
                    {globos.porColor.map((globo) => (
                      <li key={globo.color} className="inline-flex items-center gap-1.5 rounded-full bg-superficie px-2 py-0.5 text-xs text-texto tabular-nums ring-1 ring-borde-suave">
                        <span className="size-3 rounded-full ring-1 ring-borde" style={{ backgroundColor: hexDe(globo.color) ?? "#9ca3af" }} aria-hidden />
                        {colorCliente(globo.color)} {globo.cantidad.toLocaleString("es-CO")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </motion.ul>

      {/* Ver detalle */}
      <motion.div variants={hijoEscalonado} className="mt-2">
        <button
          type="button"
          aria-expanded={detalleAbierto}
          onClick={() => setDetalleAbierto((valor) => !valor)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
        >
          {detalleAbierto ? "Ocultar detalle" : "Ver detalle"}
          <motion.span animate={{ rotate: detalleAbierto ? 180 : 0 }} transition={{ duration: DUR.corta }} className="inline-flex"><ChevronDown className="size-4" aria-hidden /></motion.span>
        </button>
        <PanelPlegable abierto={detalleAbierto}>
          <div className="space-y-3 pb-1 pt-1 text-sm">
            <ul className="space-y-1 text-texto">
              {desglose.globos.map((globo) => <li key={`${globo.color}-${globo.tamano}`}>{textoGlobos(globo.cantidad, globo.color, globo.tamano)}</li>)}
            </ul>
            {desglose.guias.length > 0 && (
              <div>
                <p className="font-medium text-texto">Tamaños por pieza</p>
                <ul className="mt-1 space-y-1 text-texto-suave">
                  {desglose.guias.map((item) => <li key={item.estructura_id}><span className="text-texto">{item.nombre}:</span> {item.globos.map((globo) => textoGlobos(globo.cantidad, globo.color, globo.tamano)).join(", ")}</li>)}
                </ul>
              </div>
            )}
          </div>
        </PanelPlegable>
      </motion.div>

      {/* Imagen */}
      <AnimatePresence initial={false}>
        {(estadoImagen === "cargando" || (estadoImagen === "lista" && imagen) || estadoImagen === "error") && (
          <motion.div key="imagen" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE_SALIDA }} className="overflow-hidden">
            <div className="pt-3">
              {estadoImagen === "cargando" && <EsqueletoImagen />}
              {estadoImagen === "lista" && imagen && (
                <>
                  <button type="button" onClick={() => setLightbox(true)} aria-label="Ver la imagen en grande" className="block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
                    <motion.img
                      key={imagen}
                      src={imagen}
                      alt="Cómo quedaría tu decoración"
                      initial={reducido ? false : { opacity: 0, scale: 1.02, filter: "blur(8px)" }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      transition={{ duration: 0.6, ease: EASE_SALIDA }}
                      className="aspect-[4/3] w-full rounded-xl object-cover"
                    />
                  </button>
                  <p className="mt-2 text-xs text-texto-suave">Imagen de referencia creada con IA</p>
                  <Lightbox src={imagen} open={lightbox} onClose={() => setLightbox(false)} />
                </>
              )}
              {estadoImagen === "error" && <p className="rounded-xl bg-aviso-suave px-3 py-2 text-sm text-texto">No pude dibujarla esta vez. Tu plan sigue guardado.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Acciones */}
      {vigente && (
        <motion.div variants={hijoEscalonado} className="mt-4 space-y-2">
          <motion.button
            type="button"
            disabled={bloqueado}
            onClick={() => onAccion("ver")}
            whileTap={bloqueado ? undefined : { scale: 0.97 }}
            transition={RESORTE}
            className="relative flex min-h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-acento px-4 font-semibold text-sobre-acento shadow-[0_8px_20px_var(--sombra-acento)] transition-[background-color,opacity] hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie disabled:opacity-60"
          >
            {!reducido && estadoImagen === "nada" && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-sobre-acento/25 to-transparent"
                initial={{ x: "-100%" }}
                animate={{ x: "350%" }}
                transition={{ duration: 0.9, delay: 0.7, ease: "easeInOut" }}
              />
            )}
            {hecha("ver") && estadoImagen !== "error" ? <Check className="size-5" aria-hidden /> : <Sparkles className="size-5" aria-hidden />}
            {estadoImagen === "cargando" ? "Dibujando…" : etiquetaPrincipal}
          </motion.button>
          <div className="grid grid-cols-2 gap-2">
            <BotonSecundario icono={<Calculator className="size-4" />} hecha={hecha("costear")} activo={costeoAbierto} deshabilitado={bloqueado} onClick={() => setCosteoVisible(!costeoAbierto)}>Cuánto cuesta</BotonSecundario>
            <BotonSecundario icono={<ShoppingBag className="size-4" />} hecha={hecha("comprar")} activo={compraAbierta} deshabilitado={bloqueado} onClick={() => onAccion("comprar")}>Comprar</BotonSecundario>
            <BotonSecundario icono={<GraduationCap className="size-4" />} hecha={hecha("aprender")} deshabilitado={bloqueado} onClick={() => onAccion("aprender")}>Aprender a hacerlo</BotonSecundario>
            <BotonSecundario icono={<UserRound className="size-4" />} hecha={hecha("contratar")} deshabilitado={bloqueado} onClick={() => onAccion("contratar")}>Contratar decorador</BotonSecundario>
          </div>
          <button
            type="button"
            disabled={bloqueado}
            onClick={() => onAccion("cambiar")}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-acento transition-colors hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50"
          >
            {hecha("cambiar") ? <Check className="size-4" aria-hidden /> : <PenLine className="size-4" aria-hidden />}
            Cambiar algo
          </button>
        </motion.div>
      )}

      {/* Costeo */}
      {vigente && (
        <PanelPlegable abierto={costeoAbierto}>
          <div className="pt-3">
            <p className="mb-2 text-sm font-medium text-texto">¿Para qué es la decoración?</p>
            <div role="radiogroup" aria-label="Para qué es la decoración" className="grid grid-cols-2 gap-1 rounded-2xl bg-superficie-2 p-1">
              {(["personal", "negocio"] as const).map((uso) => {
                const marcado = usoCosteo === uso;
                return (
                  <button
                    key={uso}
                    type="button"
                    role="radio"
                    aria-checked={marcado}
                    disabled={ocupado}
                    onClick={() => onCosteo(uso)}
                    className={`relative min-h-11 rounded-xl px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-60 ${marcado ? "text-texto" : "text-texto-suave hover:text-texto"}`}
                  >
                    {marcado && <motion.span layoutId={`segmento-uso-${plan.plan_hash}`} transition={RESORTE} className="absolute inset-0 rounded-xl bg-superficie shadow-[0_1px_3px_var(--sombra)]" />}
                    <span className="relative">{uso === "personal" ? "Uso personal" : "Para mi negocio"}</span>
                  </button>
                );
              })}
            </div>
            <AnimatePresence initial={false} mode="wait">
              {usoCosteo && (
                <motion.div key={usoCosteo} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE_SALIDA }} className="overflow-hidden">
                  {cotizacion
                    ? <CostosMateriales cotizacion={cotizacion} uso={usoCosteo} clave={`plan-${plan.plan_hash}`} onProveedores={onProveedores} mensajePendiente="Todavía no tengo el precio de estos materiales." />
                    : <SinPrecio etiqueta="Buscar un proveedor cerca" onClick={onProveedores} />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </PanelPlegable>
      )}

      {/* Comprar */}
      <PanelPlegable abierto={compraAbierta}>
        {decoracionCompra
          ? <ComprarMateriales decoracion={decoracionCompra} onDistribuidor={onDistribuidor} />
          : <SinPrecio etiqueta="Buscar un distribuidor cerca" onClick={onDistribuidor} />}
      </PanelPlegable>
    </motion.article>
  );
}

function BotonSecundario({ icono, children, hecha, activo = false, deshabilitado, onClick }: { icono: ReactNode; children: string; hecha: boolean; activo?: boolean; deshabilitado: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      disabled={deshabilitado}
      onClick={onClick}
      aria-expanded={activo || undefined}
      whileTap={deshabilitado ? undefined : { scale: 0.97 }}
      transition={RESORTE}
      className={`relative flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50 ${activo ? "border-acento bg-acento-suave text-acento" : "border-borde-suave bg-superficie text-texto hover:border-acento/60"}`}
    >
      <span className="shrink-0 text-acento" aria-hidden>{icono}</span>
      <span className="min-w-0 leading-tight">{children}</span>
      {hecha && <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-exito-suave text-exito" aria-label="Ya lo viste"><Check className="size-3" aria-hidden /></span>}
    </motion.button>
  );
}

function SinPrecio({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <div className="mt-3 rounded-2xl bg-superficie-suave p-4">
      <p className="text-sm text-texto">Todavía no tengo el precio de estos materiales.</p>
      <button type="button" onClick={onClick} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-acento px-4 text-sm font-semibold text-sobre-acento transition-colors hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
        <MapPin className="size-4" aria-hidden />{etiqueta}
      </button>
    </div>
  );
}

/** Total de globos que cuenta hasta su valor (o salta directo con movimiento reducido). */
function ContadorGlobos({ total, desde }: { total: number; desde: number }) {
  const reducido = useReducedMotion();
  const valor = useMotionValue(desde);
  const texto = useTransform(valor, (actual) => Math.round(actual).toLocaleString("es-CO"));
  useEffect(() => {
    if (reducido) { valor.jump(total); return; }
    const control = animate(valor, total, { duration: 1.1, ease: EASE_SALIDA });
    return () => control.stop();
  }, [total, reducido, valor]);
  return <><span className="sr-only">{total.toLocaleString("es-CO")}</span><motion.span aria-hidden>{texto}</motion.span></>;
}

/** «+12» / «−8» junto al total tras «Cambiar algo»; se desvanece a los 2 s. */
function PastillaDiferencia({ diferencia }: { diferencia: number }) {
  const [visible, setVisible] = useState(diferencia !== 0);
  useEffect(() => {
    if (diferencia === 0) return;
    const temporizador = window.setTimeout(() => setVisible(false), 2000);
    return () => window.clearTimeout(temporizador);
  }, [diferencia]);
  return (
    <AnimatePresence>
      {visible && diferencia !== 0 && (
        <motion.span
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.corta }}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${diferencia > 0 ? "bg-exito-suave text-exito" : "bg-aviso-suave text-aviso"}`}
          aria-label={`${diferencia > 0 ? "Más" : "Menos"} ${Math.abs(diferencia)} globos que antes`}
        >
          {diferencia > 0 ? `+${diferencia}` : `−${Math.abs(diferencia)}`}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
