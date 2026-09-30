"use client";

/* Reference photos are local data URLs of the customer's attachment. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { PiezaVistaEnReferencia } from "@/lib/plan/presentacion-cliente";
import { Sparkles } from "lucide-react";
import { MuestrasColor } from "@/components/propuesta/MuestrasColor";
import { EstadoError } from "@/components/propuesta/EstadoError";
import { imagenDeReferencia, urlImagen } from "./recorte";
import { vistaAnalisisFoto, type EstadoAnalisisFoto } from "./textos-analisis";
import { ubicarEtiquetas, type PosicionEtiqueta, type TamanoFoto } from "./etiquetas-analisis";
import { EscanerFoto } from "./EscanerFoto";

export type { EstadoAnalisisFoto } from "./textos-analisis";

type ImagenReferencia = { id?: string; base64: string; mime: string };

type Props = {
  imagenes: ImagenReferencia[];
  estado: EstadoAnalisisFoto;
  blueprint: ReferenceBlueprintV2 | null;
  error?: string | null;
  onReintentar?: () => void;
  reintentando?: boolean;
  /** Opens the example gallery; without it the "no balloons" state only explains. */
  onElegirEjemplo?: () => void;
  className?: string;
};

const EASE = [0.23, 1, 0.32, 1] as const;

function idDeImagen(indice: number, imagen: ImagenReferencia): string {
  return imagen.id && /^REF_\d+$/.test(imagen.id) ? imagen.id : `REF_${String(indice + 1).padStart(2, "0")}`;
}

function PuntosEspera() {
  const reducir = useReducedMotion();
  return (
    <span aria-hidden="true" className="inline-flex gap-[3px]">
      {[0, 1, 2].map((indice) => (
        <motion.span
          key={indice}
          className="size-1 rounded-full bg-acento"
          animate={reducir ? { opacity: 0.7 } : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: indice * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

const ESQUINAS_PIEZA = [
  { clase: "-left-px -top-px border-l-[3px] border-t-[3px] rounded-tl-[14px]", x: -6, y: -6 },
  { clase: "-right-px -top-px border-r-[3px] border-t-[3px] rounded-tr-[14px]", x: 6, y: -6 },
  { clase: "-left-px -bottom-px border-l-[3px] border-b-[3px] rounded-bl-[14px]", x: -6, y: 6 },
  { clase: "-right-px -bottom-px border-r-[3px] border-b-[3px] rounded-br-[14px]", x: 6, y: 6 },
] as const;

function RecuadroPieza({ pieza, numero, orden, posicion }: { pieza: PiezaVistaEnReferencia; numero: number; orden: number; posicion: PosicionEtiqueta }) {
  const reducir = useReducedMotion();
  const { x, y, width, height } = pieza.bbox;
  const retraso = reducir ? 0 : 0.15 + orden * 0.4;
  return (
    <>
      {/* Lock-on: the brackets close in on the piece, the frame settles and a light sweeps it once. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
        initial={reducir ? false : { opacity: 0, scale: 1.12 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, delay: retraso, ease: EASE }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[14px] border border-white/60 bg-linear-to-br from-acento/25 via-acento/5 to-acento-2/15 shadow-[inset_0_0_28px_color-mix(in_srgb,var(--acento)_45%,transparent),0_0_0_1px_rgb(0_0_0/0.12),0_0_24px_color-mix(in_srgb,var(--acento)_35%,transparent)]">
          {!reducir && (
            <motion.span
              className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/35 to-transparent"
              initial={{ x: "0%" }}
              animate={{ x: "400%" }}
              transition={{ duration: 0.9, delay: retraso + 0.35, ease: "easeInOut" }}
            />
          )}
        </div>
        {ESQUINAS_PIEZA.map((esquina) => (
          <motion.span
            key={esquina.clase}
            className={`absolute size-4 border-white drop-shadow-[0_0_5px_var(--acento)] ${esquina.clase}`}
            initial={reducir ? false : { opacity: 0, x: esquina.x, y: esquina.y }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.45, delay: retraso + 0.1, ease: EASE }}
          />
        ))}
      </motion.div>
      <motion.p
        className="absolute z-10 flex max-w-full -translate-y-full items-center gap-1.5 rounded-full bg-superficie/90 py-1 pl-1 pr-2.5 text-xs shadow-[0_8px_24px_rgb(0_0_0/0.3)] ring-1 ring-white/15 backdrop-blur-md sm:gap-2 sm:py-1.5 sm:pl-1.5 sm:pr-3 sm:text-[13px]"
        data-etiqueta-pieza={numero}
        style={{
          // Overlapping boxes stack their labels instead of covering each other (etiquetas-analisis.ts).
          left: `calc(${posicion.izquierda * 100}% + 6px)`,
          top: `calc(${posicion.inferior * 100}% - 8px)`,
          maxWidth: `calc(${posicion.anchoMaximo * 100}% - 12px)`,
        }}
        initial={reducir ? false : { opacity: 0, y: 10, scale: 0.85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 20, delay: retraso + 0.45 }}
      >
        <span className="relative grid size-5 shrink-0 place-items-center rounded-full bg-linear-to-br from-acento to-acento-2 text-[11px] font-semibold text-white shadow-[0_0_10px_var(--sombra-acento)]">
          {numero}
          {/* One ring bursts out of the number when the piece is found. */}
          {!reducir && (
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-acento"
              initial={{ opacity: 0.9, scale: 1 }}
              animate={{ opacity: 0, scale: 2.4 }}
              transition={{ duration: 0.7, delay: retraso + 0.55, ease: "easeOut" }}
            />
          )}
        </span>
        <span className="min-w-0 truncate font-semibold text-texto">{pieza.nombre}</span>
        {pieza.ubicacionCorta && posicion.conExtra && <span className="shrink-0 text-texto-suave">{pieza.ubicacionCorta}</span>}
      </motion.p>
    </>
  );
}

/** What the assistant says it is doing while it looks, one step after another. */
const PASOS_ANALISIS = ["Buscando las piezas de globos", "Midiendo proporciones", "Leyendo los colores", "Reconociendo el espacio"] as const;

function FraseAnalisis({ titulo }: { titulo: string }) {
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const intervalo = window.setInterval(() => setPaso((previo) => previo + 1), 2200);
    return () => window.clearInterval(intervalo);
  }, []);
  const frases = [titulo, ...PASOS_ANALISIS];
  const frase = frases[paso % frases.length]!;
  return (
    <span className="relative inline-grid overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={frase}
          initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {frase}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Animated analysis of the customer's reference photo (maqueta FotoAnalisis):
 * a scan while it looks, then one box per detected piece from
 * `reference_bbox` with a numbered label, the observed colors and the
 * ambience chips. Without balloon pieces it says so instead of "Listo"
 * (hallazgo #17), and a failure offers a real retry.
 */
export function AnalisisFoto({ imagenes, estado, blueprint, error, onReintentar, reintentando = false, onElegirEjemplo, className = "" }: Props) {
  const reducir = useReducedMotion();
  const [seleccion, setSeleccion] = useState(0);
  const fotoRef = useRef<HTMLImageElement>(null);
  const [tamanoFoto, setTamanoFoto] = useState<TamanoFoto | undefined>(undefined);
  useEffect(() => {
    const foto = fotoRef.current;
    if (!foto || typeof ResizeObserver === "undefined") return;
    const medir = () => {
      if (foto.clientWidth > 0 && foto.clientHeight > 0) setTamanoFoto((previo) => previo?.ancho === foto.clientWidth && previo.alto === foto.clientHeight ? previo : { ancho: foto.clientWidth, alto: foto.clientHeight });
    };
    const observador = new ResizeObserver(medir);
    observador.observe(foto);
    medir();
    return () => observador.disconnect();
  }, [seleccion, imagenes.length]);
  const indice = Math.min(seleccion, Math.max(0, imagenes.length - 1));
  const imagen = imagenes[indice];
  if (!imagen) return null;
  const src = urlImagen(imagen);
  const vista = vistaAnalisisFoto(estado, blueprint, error);
  const piezasImagen = (vista.caso === "listo" ? vista.piezas : [])
    .map((pieza, orden) => ({ pieza, numero: orden + 1 }))
    .filter(({ pieza }) => imagenDeReferencia(imagenes, pieza.sourceImageId) === imagen);
  const posiciones = ubicarEtiquetas(piezasImagen.map(({ pieza }) => ({ bbox: pieza.bbox, caracteres: pieza.nombre.length, caracteresExtra: pieza.ubicacionCorta ? pieza.ubicacionCorta.length + 2 : 0 })), tamanoFoto);
  const colores = vista.caso === "listo" || vista.caso === "sin_globos" ? vista.colores : [];
  const ambientacion = vista.caso === "listo" ? vista.ambientacion : [];
  const conVelo = vista.caso === "analizando" || vista.caso === "error" || vista.caso === "sin_elementos";

  return (
    <motion.section
      aria-label="Análisis de tu foto de referencia"
      initial={reducir ? false : { opacity: 0, y: 14, filter: "blur(5px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: EASE }}
      className={`overflow-hidden rounded-[20px] border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_12px_32px_var(--sombra)] ${className}`}
    >
      <div className="relative flex justify-center overflow-hidden bg-superficie-2">
        {/* Blurred copy fills the sides of narrow photos; the boxes sit on the sharp one. */}
        <img src={src} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl" />
        <div className="relative inline-block max-w-full overflow-hidden">
          <img ref={fotoRef} src={src} alt="Tu foto de referencia" draggable={false} className="block h-auto max-h-[min(480px,60vh)] w-auto max-w-full" />
          <AnimatePresence>
            {conVelo && (
              <motion.div key="velo" aria-hidden="true" className="absolute inset-0 bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: vista.caso === "analizando" ? 0.1 : 0.55 }} exit={{ opacity: 0, transition: { duration: 0.6 } }} />
            )}
            {estado === "analizando" && <EscanerFoto key="escaneo" src={src} />}
          </AnimatePresence>
          {piezasImagen.map(({ pieza, numero }, orden) => <RecuadroPieza key={pieza.elementId} pieza={pieza} numero={numero} orden={orden} posicion={posiciones[orden]!} />)}
          {vista.caso === "listo" && vista.piezas.length > 0 && (
            <motion.p
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-2.5 z-20 inline-flex items-center gap-1.5 rounded-full bg-acento px-2.5 py-1 text-xs font-semibold text-sobre-acento shadow-[0_6px_20px_var(--sombra-acento)] sm:text-[13px]"
              initial={reducir ? false : { opacity: 0, y: -8, scale: 0.7 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              // After the last box has drawn: the count lands as a small reward.
              transition={{ type: "spring", stiffness: 420, damping: 16, delay: reducir ? 0 : 0.15 + Math.max(0, piezasImagen.length - 1) * 0.4 + 1.1 }}
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {vista.piezas.length === 1 ? "Encontré 1 pieza" : `Encontré ${vista.piezas.length} piezas`}
            </motion.p>
          )}
        </div>
        {imagenes.length > 1 && (
          <div className="absolute bottom-2 right-2 flex gap-1.5" role="group" aria-label="Fotos de referencia">
            {imagenes.map((otra, posicion) => (
              <button
                key={`${idDeImagen(posicion, otra)}-${posicion}`}
                type="button"
                aria-pressed={posicion === indice}
                aria-label={`Ver foto ${posicion + 1}`}
                onClick={() => setSeleccion(posicion)}
                className={`size-10 overflow-hidden rounded-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${posicion === indice ? "border-white" : "border-transparent opacity-70"}`}
              >
                <img src={urlImagen(otra)} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3.5 px-4 pb-5 pt-4 sm:px-5.5">
        {vista.caso === "error" || vista.caso === "sin_elementos" ? (
          <EstadoError
            className="border-0 p-0 shadow-none"
            titulo={vista.titulo}
            mensaje={vista.mensaje}
            accion={onReintentar ? { texto: reintentando ? "Reintentando…" : "Reintentar", onClick: onReintentar, disabled: reintentando } : undefined}
            accionSecundaria={onElegirEjemplo ? { texto: "Elegir otra foto", onClick: onElegirEjemplo } : undefined}
          />
        ) : (
          <div role="status" aria-live="polite" className="min-h-[22px]">
            <AnimatePresence mode="wait" initial={false}>
              {vista.caso === "analizando" ? (
                <motion.p key="mirando" className="flex items-center gap-2 text-[15px] font-medium text-texto" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                  <FraseAnalisis titulo={vista.titulo} />
                  <PuntosEspera />
                </motion.p>
              ) : vista.caso === "sin_globos" ? (
                <motion.div key="sin-globos" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <p className="text-[15px] font-medium text-texto">{vista.titulo}</p>
                  <p className="mt-1 text-[13px] leading-snug text-texto-suave">{vista.mensaje}</p>
                  {onElegirEjemplo && (
                    <button type="button" onClick={onElegirEjemplo} className="ui-pressable mt-3 inline-flex h-9 items-center rounded-xl border border-borde bg-superficie px-3.5 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                      Elegir una foto de ejemplo
                    </button>
                  )}
                </motion.div>
              ) : (
                <motion.p key="resumen" className="text-[15px] font-medium leading-snug text-texto" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: reducir ? 0 : 0.35 }}>
                  {vista.resumen}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}
        {(colores.length > 0 || ambientacion.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
            <MuestrasColor muestras={colores} variante="etiquetadas" retraso={reducir ? 0 : 0.9} etiqueta="Colores que veo en tu foto" />
            {ambientacion.length > 0 && (
              <ul className="flex flex-wrap items-center gap-1.5" aria-label="Ambientación que veo en tu foto">
                {ambientacion.map((chip, posicion) => (
                  <motion.li
                    key={chip}
                    initial={reducir ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: reducir ? 0 : 1.4 + posicion * 0.2 }}
                    className="rounded-full bg-superficie-suave px-2.5 py-1 text-xs text-texto-suave ring-1 ring-borde-suave ring-inset"
                  >
                    {chip}
                  </motion.li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </motion.section>
  );
}
