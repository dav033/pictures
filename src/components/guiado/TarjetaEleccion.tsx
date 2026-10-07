"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Camera } from "lucide-react";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import { detalleDeIdea, type DetalleIdea } from "@/lib/biblioteca-sempertex/detalle-idea";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { listaNatural } from "@/lib/ia/guiado/propuesta-composicion";
import { CifraAnimada } from "./ajuste/AjustarPlan";
import { BotonAgregarIdea, type AccionAgregarIdea, type DatosAgregarIdea } from "./AgregarIdea";
import { DUR, EASE_REBOTE, EASE_SALIDA, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";
import { FilaPieza } from "./FilaPieza";
import { FotoDecoracion } from "./FotoDecoracion";
import { GloboMiniatura } from "./GloboMiniatura";
import { lineasSinPiezaDeIdea, piezasVistaDeIdea, resumenIdea } from "./idea-vista";
import { nombreGlobosCliente } from "./formato";
import { globosPorColor, productoSempertex, rotuloGlobo, tablaGlobos, tamanoDeLinea, type LineaGlobo, type PiezaVista } from "./piezas-vista";
import { PanelPlegable } from "./Plegable";
import { BotonVerDetalle, TablaGlobosPieza } from "./TablaGlobosPieza";

/**
 * «Tu elección»: la idea de la biblioteca que eligió el cliente, con el mismo detalle que «Tu plan» (dueño, 2026-10-06:
 * «aquí debería haber un detalle más amplio de todo»): total de globos, cada pieza con su dibujo, medidas, mezcla de
 * tamaños y sus globos SEMPERTEX por producto («Reflex Dorado 22», no «globos dorados»), y «Ver detalle» con la tabla
 * por pieza (producto × tamaño en pulgadas). Los datos salen de `detalles-ideas.json` (precalculado de la biblioteca
 * y de los planes de Python; aquí no se cuenta nada). Sin detalle, la vista sencilla de siempre con los productos.
 * `agregar`: «Agregar a mi plan» / «Crear mi plan con esta idea» (pedido 3); sin él, la tarjeta es solo informativa.
 * Sus manejadores llegan aparte (`onAgregar`, `onVerPlan`): ver `DatosAgregarIdea`.
 */
export function TarjetaEleccion({ decoracion, agregar: datosAgregar, onAgregar, onVerPlan }: { decoracion: DecoracionSempertex; agregar?: DatosAgregarIdea | undefined; onAgregar?: (() => void) | undefined; onVerPlan?: (() => void) | undefined }) {
  const agregar: AccionAgregarIdea | undefined = datosAgregar && onAgregar ? { ...datosAgregar, onAgregar, onVerPlan } : undefined;
  const detalle = detalleDeIdea(decoracion.id);
  if (detalle) return <EleccionDetallada decoracion={decoracion} detalle={detalle} agregar={agregar} />;
  return <EleccionSencilla decoracion={decoracion} agregar={agregar} />;
}

const NUMERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

function EleccionDetallada({ decoracion, detalle, agregar }: { decoracion: DecoracionSempertex; detalle: DetalleIdea; agregar?: AccionAgregarIdea }) {
  const piezas = useMemo(() => piezasVistaDeIdea(detalle), [detalle]);
  const sinPieza = useMemo(() => lineasSinPiezaDeIdea(detalle), [detalle]);
  const resumen = useMemo(() => resumenIdea(detalle), [detalle]);
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const idDetalle = useId();
  const numeroPiezas = piezas.reduce((suma, pieza) => suma + pieza.repeticiones, 0);
  const ningunaConGlobos = piezas.every((pieza) => pieza.lineas.length === 0);
  const tituloSinPieza = ningunaConGlobos ? "Toda la decoración" : "Además, contados en la foto";
  const avisoFoto = resumen.todoEstimado
    ? "Cantidades estimadas a partir de la foto"
    : resumen.estimados.length > 0 ? "Algunas cantidades, estimadas a partir de la foto" : null;

  return (
    <motion.section
      variants={grupoConRitmo(0.07)}
      initial="oculto"
      animate="visible"
      aria-label={`Tu elección: ${decoracion.titulo}`}
      className="mt-4 w-full overflow-hidden rounded-3xl border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_16px_40px_var(--sombra)]"
    >
      <div className="flex flex-col sm:flex-row">
        <div className="relative aspect-[4/3] shrink-0 bg-superficie-2 sm:aspect-auto sm:min-h-56 sm:w-56">
          <FotoDecoracion decoracion={decoracion} sizes="(max-width: 640px) 100vw, 224px" />
        </div>

        {/* Cabecera: qué es, cuántos globos Sempertex lleva y de qué colores. */}
        <motion.header variants={hijoEscalonado} className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-acento">Tu elección</p>
            {decoracion.origen === "referencia_real" && <span className="rounded-full border border-borde-suave px-2 py-0.5 text-[0.7rem] font-medium text-texto-suave">Referencia</span>}
          </div>
          <h3 className="mt-1 text-lg font-semibold leading-snug text-texto">{decoracion.titulo}</h3>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-4xl font-semibold tracking-tight text-texto tabular-nums"><ContadorGlobos total={resumen.globos} /></span>
            <span className="text-base text-texto-suave">{resumen.globos === 1 ? "globo" : "globos"} Sempertex</span>
          </div>
          {resumen.otros.length > 0 && (
            <p className="text-xs text-texto-suave">y {listaNatural(resumen.otros.map((otro) => `${NUMERO.format(otro.unidades)} ${otro.producto}`))}</p>
          )}
          <p className="mt-1 text-sm text-texto-suave">
            {numeroPiezas} {numeroPiezas === 1 ? "pieza" : "piezas"}: {listaNatural(piezas.map((pieza) => `${pieza.repeticiones > 1 ? `${pieza.repeticiones} × ` : ""}${pieza.nombre}`))}
          </p>
          {resumen.tonos.length > 0 && (
            <motion.span className="mt-2 flex pl-1.5" role="img" aria-label={`Globos: ${resumen.tonos.map((tono) => tono.producto).join(", ")}`} variants={grupoConRitmo(0.04, 0.15)}>
              {resumen.tonos.map((tono) => (
                <motion.span
                  key={tono.hex}
                  title={`Sempertex ${tono.producto}`}
                  variants={{ oculto: { scale: 0 }, visible: { scale: 1, transition: { duration: 0.35, ease: EASE_REBOTE } } }}
                  className="-ml-1.5 size-5 rounded-full ring-2 ring-superficie"
                  style={{ backgroundColor: tono.hex }}
                />
              ))}
            </motion.span>
          )}
          {avisoFoto && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-superficie-2 px-2.5 py-1 text-xs text-texto-suave">
              <Camera className="size-3.5 shrink-0" aria-hidden />
              {avisoFoto}
            </p>
          )}
        </motion.header>
      </div>

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        {/* Piezas: dibujo, medidas, mezcla de tamaños y globos Sempertex de cada una (como en «Tu plan»). */}
        <motion.ul variants={hijoEscalonado} className="space-y-2.5" aria-label="Piezas de la idea">
          {piezas.map((pieza, indice) => (
            <FilaPieza
              key={pieza.id}
              pieza={pieza}
              indice={indice}
              dibujo={<span className="grid size-full place-items-center"><IconoEstructura id={pieza.oficial ?? "arco"} className="h-3/5 w-3/5" /></span>}
            />
          ))}
        </motion.ul>
        {sinPieza.length > 0 && (
          <motion.div variants={hijoEscalonado} className="mt-2.5 rounded-2xl bg-superficie-suave p-3">
            <p className="text-sm font-medium text-texto">{tituloSinPieza}</p>
            <ChipsGlobos lineas={sinPieza} />
          </motion.div>
        )}

        {/* Ver detalle: la tabla de cada pieza (producto Sempertex × tamaño en pulgadas). */}
        <motion.div variants={hijoEscalonado} className="mt-2">
          <BotonVerDetalle abierto={detalleAbierto} onClick={() => setDetalleAbierto((valor) => !valor)} controls={idDetalle} />
          <PanelPlegable abierto={detalleAbierto} id={idDetalle}>
            <DetalleTablas piezas={piezas} sinPieza={sinPieza} tituloSinPieza={tituloSinPieza} globos={resumen.globos} estimados={resumen.estimados} todoEstimado={resumen.todoEstimado} />
          </PanelPlegable>
        </motion.div>

        {agregar && <BotonAgregarIdea {...agregar} />}
      </div>
    </motion.section>
  );
}

/** El total que cuenta desde cero al aparecer (o salta directo con movimiento reducido). */
function ContadorGlobos({ total }: { total: number }) {
  const reducido = useReducedMotion();
  const valor = useMotionValue(0);
  const texto = useTransform(valor, (actual) => NUMERO.format(Math.round(actual)));
  useEffect(() => {
    if (reducido) { valor.jump(total); return; }
    const control = animate(valor, total, { duration: 1.1, ease: EASE_SALIDA });
    return () => control.stop();
  }, [total, reducido, valor]);
  return <><span className="sr-only">{NUMERO.format(total)}</span><motion.span aria-hidden>{texto}</motion.span></>;
}

/** Chips de globos Sempertex (producto y cantidad) para lo que no va en una pieza. */
function ChipsGlobos({ lineas }: { lineas: readonly LineaGlobo[] }) {
  const globos = useMemo(() => globosPorColor(lineas), [lineas]);
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Globos Sempertex">
      <AnimatePresence initial={false}>
        {globos.map((globo) => (
          <motion.li
            key={globo.clave}
            layout="position"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: DUR.media, ease: EASE_REBOTE }}
            title={rotuloGlobo(globo).titulo}
            className="inline-flex items-center gap-1 rounded-2xl bg-superficie py-0.5 pl-1 pr-2 text-xs leading-tight text-texto tabular-nums ring-1 ring-borde-suave"
          >
            <GloboMiniatura hex={globo.hex} acabado={globo.acabado} pulgadas={globo.pulgadas} tamano={16} className="shrink-0" />
            {rotuloGlobo(globo).texto} <span className="font-semibold"><CifraAnimada valor={globo.cantidad} /></span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** «Ver detalle» de la idea: una tabla por pieza (y una para lo que no va en ninguna), el total y de dónde salen. */
function DetalleTablas({ piezas, sinPieza, tituloSinPieza, globos, estimados, todoEstimado }: {
  piezas: readonly PiezaVista[];
  sinPieza: readonly LineaGlobo[];
  tituloSinPieza: string;
  globos: number;
  estimados: readonly string[];
  todoEstimado: boolean;
}) {
  const tablas = useMemo(() => [
    ...piezas.filter((pieza) => pieza.lineas.length > 0).map((pieza) => ({ id: pieza.id, titulo: pieza.nombre, oficial: pieza.oficial, repeticiones: pieza.repeticiones, tabla: tablaGlobos(pieza.lineas) })),
    ...(sinPieza.length ? [{ id: "sin-pieza", titulo: tituloSinPieza, oficial: null, repeticiones: 1, tabla: tablaGlobos(sinPieza) }] : []),
  ], [piezas, sinPieza, tituloSinPieza]);
  const nota = todoEstimado
    ? "Cantidades estimadas a partir de la foto: tómalas como aproximadas."
    : estimados.length > 0
      ? `Estimado a partir de la foto (aproximado): ${listaNatural(estimados.slice(0, 3).map((producto) => `Sempertex ${producto}`))}${estimados.length > 3 ? ` y ${estimados.length - 3} más` : ""}. Lo demás lo calculó el plan.`
      : null;
  return (
    <div className="space-y-4 pb-1 pt-2">
      {tablas.map((item) => <TablaGlobosPieza key={item.id} titulo={item.titulo} oficial={item.oficial} tabla={item.tabla} repeticiones={item.repeticiones} />)}
      {tablas.length > 1 && (
        <p className="text-right text-sm font-semibold text-texto">Toda la idea: <span className="tabular-nums"><CifraAnimada valor={globos} /></span> {globos === 1 ? "globo" : "globos"}</p>
      )}
      {nota && <p className="text-xs leading-relaxed text-texto-suave">{nota}</p>}
    </div>
  );
}

/** Sin detalle precalculado: la lista de materiales de la biblioteca, cada uno con su producto Sempertex. */
function EleccionSencilla({ decoracion, agregar }: { decoracion: DecoracionSempertex; agregar?: AccionAgregarIdea }) {
  const piezas = decoracion.piezas.map((pieza) => `${pieza.cantidad} ${nombrePieza(pieza.estructura, pieza.cantidad)}`);
  return <section className="mt-4 flex flex-col overflow-hidden rounded-2xl border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra)] sm:flex-row" aria-label="Tu elección">
    <div className="relative aspect-[4/3] shrink-0 bg-superficie-2 sm:aspect-auto sm:w-48">
      <FotoDecoracion decoracion={decoracion} sizes="(max-width: 640px) 100vw, 192px" />
    </div>
    <div className="flex-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{decoracion.titulo}</h3>
        {decoracion.origen === "referencia_real" && <span className="shrink-0 rounded-full border border-borde-suave px-2 py-0.5 text-[0.7rem] font-medium text-texto-suave">Referencia</span>}
      </div>
      {piezas.length > 0 && <p className="mt-1 text-sm text-texto-suave">{piezas.join(" · ")}</p>}
      {decoracion.materiales.length > 0 && <ul className="mt-3 space-y-1.5 text-sm">
        {decoracion.materiales.map((material) => <li key={material.variantId} className="flex gap-2"><span className="font-semibold tabular-nums">{textoCantidad(material)}</span><span>{nombreSempertex(material.nota) ?? minusculaInicial(nombreMaterial(material.nota) ?? "globos")}</span></li>)}
      </ul>}
      {decoracion.materiales.some(cantidadContadaEnFoto) && <p className="mt-2 text-xs text-texto-suave">{AVISO_CONTADA_EN_FOTO}</p>}
      {agregar && <BotonAgregarIdea {...agregar} />}
    </div>
  </section>;
}

/** «… Fashion Negro — R-12 / PAQUETE X 50 · R-12 · negro» → «Sempertex Fashion Negro · 12″»; null si no es del catálogo. */
function nombreSempertex(nota: string | undefined): string | null {
  const producto = productoSempertex(nota?.split(" · ")[0]);
  if (!producto) return null;
  const codigo = nota?.split(" · ").slice(1).find((parte) => /^(?:R-?\d|T\d{3}|LOL|C-?\d|\d{1,2}\s*IN)/i.test(parte.trim()));
  const tamano = codigo ? tamanoDeLinea({ tamano_codigo: codigo.trim() }) : null;
  return `Sempertex ${producto}${tamano && tamano.clave !== "OTROS" && tamano.clave !== "TUBITO" ? ` · ${tamano.etiqueta}` : ""}`;
}

const NOMBRES_PIEZA: Readonly<Record<string, [string, string]>> = {
  arco: ["arco", "arcos"], arco_asimetrico: ["arco asimétrico", "arcos asimétricos"], arco_no_denso: ["arco ligero", "arcos ligeros"],
  semiarco: ["medio arco", "medios arcos"], semiarco_asimetrico: ["medio arco asimétrico", "medios arcos asimétricos"],
  columna: ["columna", "columnas"], columna_asimetrica: ["columna asimétrica", "columnas asimétricas"], columna_no_densa: ["columna ligera", "columnas ligeras"],
  pared_densa: ["pared de globos", "paredes de globos"], pared_no_densa: ["pared ligera de globos", "paredes ligeras de globos"], pared_organica: ["pared orgánica", "paredes orgánicas"],
  guirnalda: ["guirnalda", "guirnaldas"], centro_mesa: ["centro de mesa", "centros de mesa"], bouquet: ["bouquet", "bouquets"], figura: ["figura", "figuras"],
  aro_circular: ["aro", "aros"], techo_globos: ["techo de globos", "techos de globos"], racimo_pared: ["racimo de pared", "racimos de pared"],
};

function nombrePieza(estructura: string, cantidad: number): string {
  const nombres = NOMBRES_PIEZA[estructura];
  if (nombres) return cantidad === 1 ? nombres[0] : nombres[1];
  return estructura.replaceAll("_", " ");
}

/**
 * «Globo látex R-12 Rosewood, paquete x50; precio…» → «Globos palo de rosa de 12"». Usa el mismo mapa de colores
 * que el costeo (presentacion-material-guiado.ts: Rosewood → Palo de rosa), para que la idea y su precio digan
 * el mismo color. Sin nota no se inventa nada. (Lo usan «Comprar» y la vista sencilla sin producto de catálogo.)
 */
export function nombreMaterial(nota: string | undefined): string | null {
  if (!nota) return null;
  const primeraParte = nota.split(/[,;]/)[0]!.trim();
  // Solo un tamaño («12"», sin nombre de producto): sigue siendo un globo.
  if (!/\p{L}/u.test(primeraParte)) return nombreGlobosCliente({ nombre: "Globo", tamano: primeraParte });
  // Notas de ejemplo («R-12 Rosewood»): el mapa del costeo. Notas del catálogo real («… — R-12 / PAQUETE X 50 · R-12 ·
  // rosado»): su color de cliente, el mismo que dice el precio personal (formato.ts).
  const base = /\bR-\d+\s+\p{L}/u.test(primeraParte) ? presentacionMaterialGuiado(nota).nombre : primeraParte;
  return nombreGlobosCliente({ nombre: base });
}

type MaterialDecoracion = DecoracionSempertex["materiales"][number];

/** La cantidad (o parte de ella) se contó a mano en la foto: se dice aproximada, no se presenta como exacta. */
export function cantidadContadaEnFoto(material: MaterialDecoracion): boolean {
  return material.origenCantidad === "estimado_foto" || material.origenCantidad === "plan_python_y_foto";
}

/** «≈18» si se contó en la foto; «18» si la resolvió el plan. */
export function textoCantidad(material: MaterialDecoracion): string {
  return `${cantidadContadaEnFoto(material) ? "≈" : ""}${material.cantidad}`;
}

export const AVISO_CONTADA_EN_FOTO = "≈ contado en la foto: cantidad aproximada.";

function minusculaInicial(texto: string): string {
  return texto.charAt(0).toLocaleLowerCase("es") + texto.slice(1);
}
