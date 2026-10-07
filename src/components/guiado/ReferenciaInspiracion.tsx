"use client";

import { useId, useMemo, useState, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Images, Wand2 } from "lucide-react";
import type { ReferenciaGuiada } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { EASE_REBOTE, EASE_SALIDA, RESORTE, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";
import { GloboMiniatura } from "./GloboMiniatura";
import { conMayusculaInicial } from "./color-globo";
import { lecturaFoto, unirConY, type CajaLeida, type ColorPieza, type PiezaLeida } from "./lectura-foto";

type Props = {
  miniatura: string;
  /** Lo que se leyó en la foto; null mientras se lee o si no se pudo leer. */
  referencia: ReferenciaGuiada | null;
  /** Mientras se lee la foto: franja de escaneo sobre la miniatura. */
  analizando?: boolean;
  /** Sin pasar (o true): con botones. false (historial): solo la lectura. */
  activo?: boolean;
  deshabilitado?: boolean;
  onArmar: () => void;
  /** «Prefiero ver ideas parecidas». */
  onVerIdeas?: () => void;
};

const NUMERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const porcentaje = (parte: number) => `${Math.max(1, Math.round(parte * 100))}%`;

const CONFIANZA: Record<PiezaLeida["confianza"], { texto: string; clase: string }> = {
  alta: { texto: "Se ve clara", clase: "bg-exito-suave text-exito" },
  media: { texto: "Probable", clase: "bg-aviso-suave text-aviso" },
  baja: { texto: "Dudosa", clase: "bg-error-suave text-error" },
};

/**
 * La foto de inspiración con lo que se lee en ella: cada pieza de globos con su recuadro numerado y rotulado
 * sobre la foto y, debajo, su ficha (nombre individual, medidas si las hay, colores con su acabado y su globo
 * Sempertex, tamaños, conteo y remate). Pasar o tocar una ficha resalta su recuadro, y al revés. Todo sale de la
 * lectura (`lecturaFoto`): aquí no se inventa ningún dato.
 */
export function ReferenciaInspiracion({ miniatura, referencia, analizando = false, activo = true, deshabilitado, onArmar, onVerIdeas }: Props) {
  const lectura = useMemo(() => (referencia ? lecturaFoto(referencia.blueprint) : null), [referencia]);
  const [activa, setActiva] = useState<number | null>(null);
  const [aspectoImagen, setAspectoImagen] = useState<number | null>(null);
  const reducido = useReducedMotion();
  const prefijo = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const aspecto = referencia?.aspecto ?? aspectoImagen;
  const piezas = lectura?.piezas ?? [];
  const cajaActiva = activa === null ? null : piezas.find((pieza) => pieza.numero === activa)?.caja ?? null;
  const fraseVeo = referencia ? (referencia.frase.split(/\s*¿/)[0] ?? referencia.frase).trim() : "";
  const idFicha = (numero: number) => `${prefijo}-pieza-${numero}`;

  function tocarCaja(caja: CajaLeida): void {
    const numero = caja.numeros[0];
    if (numero === undefined) return;
    setActiva(numero);
    if (typeof document !== "undefined") document.getElementById(idFicha(numero))?.scrollIntoView({ block: "nearest", behavior: reducido ? "auto" : "smooth" });
  }

  return (
    <section aria-label="Lo que veo en tu foto" className="@container mt-2 w-full max-w-xl overflow-hidden rounded-2xl border border-borde-suave bg-superficie text-left shadow-[0_1px_2px_var(--sombra),0_10px_28px_var(--sombra)]">
      <div className="bg-superficie-2">
        <div
          className="relative mx-auto overflow-hidden"
          style={aspecto ? { aspectRatio: aspecto, width: `min(100%, ${(24 * aspecto).toFixed(2)}rem)` } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local optimizada en el navegador */}
          <img
            src={miniatura}
            alt="Tu foto de inspiración"
            onLoad={(evento) => {
              const { naturalWidth, naturalHeight } = evento.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setAspectoImagen(naturalWidth / naturalHeight);
            }}
            className={aspecto ? "absolute inset-0 size-full object-cover" : "block max-h-80 w-full object-contain"}
          />
          {analizando && (
            <div className="pointer-events-none absolute inset-0 bg-acento/5" aria-hidden>
              <span className="escaner-guiado" />
            </div>
          )}
          {lectura && aspecto && (
            <motion.div className="absolute inset-0" initial="oculto" animate="visible" variants={grupoConRitmo(0.12, 0.15)}>
              {lectura.cajas.map((caja, indice) => (
                <Recuadro
                  key={`${indice}-${caja.numeros.join("-")}`}
                  caja={caja}
                  resaltada={cajaActiva === indice}
                  apagada={cajaActiva !== null && cajaActiva !== indice}
                  onEntrar={() => setActiva(caja.numeros[0] ?? null)}
                  onSalir={() => setActiva(null)}
                  onTocar={() => tocarCaja(caja)}
                />
              ))}
            </motion.div>
          )}
        </div>
      </div>

      <div className="space-y-3.5 p-3 @md:p-4">
        {analizando && !referencia && <p className="text-sm text-texto-suave" role="status">Mirando tu foto…</p>}
        {referencia && (
          <div>
            <p className="text-[15px] font-semibold leading-snug text-texto">{fraseVeo}</p>
            {lectura && (
              <p className="mt-0.5 text-xs text-texto-suave">
                {piezas.length} {piezas.length === 1 ? "pieza" : "piezas"} de globos
                {lectura.globosVisibles ? ` · ≈ ${NUMERO.format(lectura.globosVisibles)} globos a la vista` : ""}
                {lectura.cajas.length > 0 ? " · toca una pieza para verla en la foto" : ""}
              </p>
            )}
            {lectura && lectura.colores.length > 0 && (
              <motion.ul aria-label="Colores que veo" className="mt-2 flex flex-wrap items-center gap-1" initial="oculto" animate="visible" variants={grupoConRitmo(0.05, 0.2)}>
                {lectura.colores.map((color) => (
                  <motion.li key={color.nombre} variants={{ oculto: { scale: 0 }, visible: { scale: 1, transition: { duration: 0.3, ease: EASE_REBOTE } } }}>
                    <GloboMiniatura hex={color.hex} acabado={color.acabado} tamano={30} titulo={conMayusculaInicial(color.nombre)} />
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </div>
        )}

        {lectura && (
          <motion.ol aria-label="Piezas que veo en tu foto" className="grid gap-2 @3xl:grid-cols-2" initial="oculto" animate="visible" variants={grupoConRitmo(0.08, 0.25)}>
            {piezas.map((pieza) => (
              <FichaPieza
                key={pieza.numero}
                id={idFicha(pieza.numero)}
                pieza={pieza}
                resaltada={activa === pieza.numero}
                onActivar={() => setActiva(pieza.numero)}
                onDesactivar={() => setActiva((actual) => (actual === pieza.numero ? null : actual))}
              />
            ))}
          </motion.ol>
        )}

        {lectura && lectura.otros.length > 0 && (
          <p className="text-xs text-texto-suave">También veo {unirConY(lectura.otros)}: no son de globos, así que no entran en el plan.</p>
        )}

        {activo && referencia && (
          <div className="space-y-2 pt-0.5">
            <motion.button
              type="button"
              disabled={deshabilitado}
              onClick={onArmar}
              whileTap={{ scale: 0.97 }}
              transition={RESORTE}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-acento px-3 text-sm font-semibold text-sobre-acento shadow-[0_6px_18px_var(--sombra-acento)] transition-colors hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie disabled:opacity-50"
            >
              <Wand2 className="size-4" aria-hidden />
              {piezas.length > 1 ? `Sí, arma mi plan con estas ${piezas.length} piezas` : piezas.length === 1 ? "Sí, arma mi plan con esta pieza" : "Sí, armémoslo"}
            </motion.button>
            {onVerIdeas && (
              <button type="button" disabled={deshabilitado} onClick={onVerIdeas} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium text-acento transition-colors hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50">
                <Images className="size-4" aria-hidden />
                Prefiero ver ideas parecidas
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** El recuadro de una pieza sobre la foto, con su número y su nombre. Solo el ratón y el dedo lo usan: la ficha es la vía accesible. */
function Recuadro({ caja, resaltada, apagada, onEntrar, onSalir, onTocar }: { caja: CajaLeida; resaltada: boolean; apagada: boolean; onEntrar: () => void; onSalir: () => void; onTocar: () => void }) {
  const aLaDerecha = caja.x + caja.ancho / 2 > 0.62;
  const conRaton = (accion: () => void) => (evento: PointerEvent) => {
    if (evento.pointerType === "mouse") accion();
  };
  return (
    <motion.button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      variants={{ oculto: { opacity: 0, scale: 1.08 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: EASE_SALIDA } } }}
      onPointerEnter={conRaton(onEntrar)}
      onPointerLeave={conRaton(onSalir)}
      onClick={onTocar}
      className="absolute cursor-pointer"
      style={{ left: `${caja.x * 100}%`, top: `${caja.y * 100}%`, width: `${caja.ancho * 100}%`, height: `${caja.alto * 100}%`, zIndex: resaltada ? 2 : 1 }}
    >
      <span
        className={`absolute inset-0 rounded-xl border-2 transition-[opacity,background-color,box-shadow,border-color] duration-200 ${
          resaltada ? "border-white bg-acento/15 shadow-[0_0_0_3px_var(--acento),0_10px_28px_rgb(0_0_0/0.35)]" : "border-acento shadow-[0_0_0_1px_rgb(0_0_0/0.25)]"
        } ${apagada ? "opacity-30" : "opacity-100"}`}
      />
      <span
        // El rótulo no sale de su recuadro (en móvil dos columnas quedan muy juntas): si no cabe, el nombre baja de línea.
        className={`absolute top-1 flex max-w-[calc(100%-0.5rem)] items-start gap-1 rounded-[10px] bg-acento py-0.5 pl-0.5 pr-1.5 text-left text-[11px] leading-[18px] font-semibold text-sobre-acento shadow-[0_2px_8px_rgb(0_0_0/0.3)] transition-opacity duration-200 ${aLaDerecha ? "right-1" : "left-1"} ${apagada ? "opacity-40" : "opacity-100"}`}
      >
        {caja.numeros.map((numero) => (
          <span key={numero} className="grid size-[18px] shrink-0 place-items-center rounded-full bg-black/20 text-[10px] font-bold">{numero}</span>
        ))}
        <span className="min-w-0 break-words">{caja.nombre}</span>
      </span>
    </motion.button>
  );
}

/** La ficha de una pieza: su nombre, cómo es y de qué está hecha según la foto. */
function FichaPieza({ id, pieza, resaltada, onActivar, onDesactivar }: { id: string; pieza: PiezaLeida; resaltada: boolean; onActivar: () => void; onDesactivar: () => void }) {
  const principal = pieza.colores[0];
  const sempertex = pieza.colores.filter((color): color is ColorPieza & { sempertex: NonNullable<ColorPieza["sempertex"]> } => color.sempertex !== null);
  const masDe12 = pieza.tamanos.some((tamano) => tamano.clase === "grande" || tamano.clase === "gigante");
  const confianza = CONFIANZA[pieza.confianza];
  return (
    <motion.li
      id={id}
      variants={hijoEscalonado}
      onMouseEnter={onActivar}
      onMouseLeave={onDesactivar}
      className={`scroll-mt-4 rounded-xl border p-3 transition-[border-color,background-color,box-shadow] duration-200 ${
        resaltada ? "border-acento bg-acento-suave/40 shadow-[0_0_0_3px_var(--sombra-acento)]" : "border-borde-suave bg-superficie"
      }`}
    >
      <button
        type="button"
        aria-pressed={resaltada}
        onClick={onActivar}
        onFocus={onActivar}
        onBlur={onDesactivar}
        className="flex w-full items-start gap-2.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
      >
        <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-acento text-xs font-bold text-sobre-acento">{pieza.numero}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-5 text-texto">{pieza.nombre}</span>
          <span className="block text-xs leading-4 text-texto-suave">{[pieza.tipo, ...pieza.detalles].join(" · ")}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${confianza.clase}`}>{confianza.texto}</span>
      </button>

      <dl className="mt-2.5 grid grid-cols-[4.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-2.5 text-xs">
        {pieza.medidas && (
          <>
            <dt className="pt-0.5 text-texto-suave">Medidas</dt>
            <dd className="font-medium text-texto">{pieza.medidas}</dd>
          </>
        )}
        {pieza.globos && (
          <>
            <dt className="text-texto-suave">Globos</dt>
            <dd className="font-medium text-texto">{pieza.globos}</dd>
          </>
        )}
        {pieza.colores.length > 0 && (
          <>
            <dt className="pt-1 text-texto-suave">Colores</dt>
            <dd className="min-w-0">
              <ul className="flex flex-wrap gap-1.5" aria-label={`Colores de ${pieza.nombre}`}>
                {pieza.colores.map((color) => (
                  <li key={color.nombre} className="inline-flex max-w-full items-center gap-1 rounded-full bg-superficie-2 py-0.5 pl-0.5 pr-2 ring-1 ring-borde-suave ring-inset">
                    <GloboMiniatura hex={color.hex} acabado={color.acabado} tamano={20} />
                    <span className="truncate font-medium text-texto">{conMayusculaInicial(color.nombre)}</span>
                    {color.parte !== null && <span className="tabular-nums text-texto-suave">{porcentaje(color.parte)}</span>}
                  </li>
                ))}
              </ul>
              {sempertex.length > 0 && (
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {sempertex.map((color) => (
                    <span key={color.sempertex.codigo} className="rounded-md bg-acento-suave px-1.5 py-0.5 text-[11px] font-semibold text-acento">
                      Sempertex {color.sempertex.nombre} · {color.sempertex.codigo}
                    </span>
                  ))}
                </p>
              )}
            </dd>
          </>
        )}
        {(pieza.tamanos.length > 0 || pieza.tamanosFrase) && (
          <>
            <dt className="pt-1 text-texto-suave">Tamaños</dt>
            <dd className="min-w-0">
              {pieza.tamanos.length > 0 ? (
                <ul className="flex flex-wrap items-end gap-1.5" aria-label={`Tamaños de ${pieza.nombre}`}>
                  {pieza.tamanos.map((tamano) => (
                    <li key={tamano.clase} className="inline-flex items-end gap-1 rounded-lg bg-superficie-2 py-1 pl-1 pr-2 ring-1 ring-borde-suave ring-inset">
                      <GloboMiniatura hex={principal?.hex ?? "#9ca3af"} acabado={principal?.acabado ?? null} tamano={Math.round(14 + tamano.dibujo * 0.55)} />
                      <span className="leading-tight">
                        <span className="block font-medium text-texto">{tamano.etiqueta} {tamano.pulgadas}</span>
                        <span className="block tabular-nums text-texto-suave">{porcentaje(tamano.proporcion)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pt-0.5 font-medium text-texto">{pieza.tamanosFrase}</p>
              )}
              {masDe12 && <p className="mt-1 text-[11px] text-texto-suave">Lleva globos más grandes que 12″.</p>}
            </dd>
          </>
        )}
        {pieza.remates.length > 0 && (
          <>
            <dt className="text-texto-suave">Remate</dt>
            <dd className="font-medium text-texto">{pieza.remates.join(" · ")}</dd>
          </>
        )}
      </dl>
    </motion.li>
  );
}
