"use client";

import { ChevronDown, Info } from "lucide-react";
import type { AnalisisColorSempertex } from "@/lib/plan/analisis-color";
import {
  bloqueAbiertoPorDefecto,
  notasDelBloque,
  resumenDeColores,
  vistaDeColores,
  type NivelParecido,
  type VistaColor,
  type VistaPieza,
} from "@/lib/plan/presentacion-color";
import { DetalleTecnicoColores } from "./DetalleTecnicoColores";
import { muestraDeGlobo } from "./textos-analisis";

/**
 * Los colores de la foto, contados para quien la subió: por cada pieza, qué globo del catálogo se parece más a
 * cada color de su foto y cuánto. Es una guía para mirar, no decide qué se compra (eso lo siguen decidiendo las
 * etiquetas del analizador, `colores-referencia.ts`).
 *
 * **Compacto a propósito.** Una fila por color (muestra de la foto, muestra del globo, nombre, porcentaje y una
 * píldora de parecido); todo lo demás va plegado al final: otras opciones parecidas, notas de la medición y el
 * detalle técnico. Con más de `MAX_COLORES_BLOQUE_ABIERTO` colores el bloque entero llega cerrado, con un
 * resumen de una línea («7 colores» y las muestras en miniatura); con pocos, abierto, porque no ahorra nada
 * esconderlos.
 *
 * Aquí solo se pinta: qué se dice, con qué palabras y qué se esconde lo decide `presentacion-color.ts`. Lo que
 * suena a depuración —el id interno de la pieza, el croquis, los píxeles, el hex, el Pantone, el tono y el
 * croma, las distancias y las marcas internas— no se ve en el bloque: vive entero, sin traducir, en
 * `DetalleTecnicoColores`.
 */

type Props = {
  analisis: AnalisisColorSempertex | null;
  className?: string;
};

/** Colores de la píldora de parecido. Siempre van con palabra y puntos: el color nunca es la única señal. */
const CLASE_DEL_NIVEL: Readonly<Record<NivelParecido, string>> = {
  muy_parecido: "bg-exito-suave text-exito",
  parecido: "bg-aviso-suave text-aviso",
  aproximado: "bg-superficie-2 text-texto",
};

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento";
const SIN_MARCADOR = "list-none [&::-webkit-details-marker]:hidden";

/** Una muestra pequeña. El color es dato (la foto, el catálogo), no del tema: el anillo sí usa tokens. */
function Punto({ fondo, className = "size-5" }: { fondo: string; className?: string }) {
  return <span aria-hidden="true" className={`${className} shrink-0 rounded-full ring-1 ring-borde ring-inset`} style={{ background: fondo }} />;
}

function Parecido({ parecido }: { parecido: NonNullable<VistaColor["parecido"]> }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${CLASE_DEL_NIVEL[parecido.nivel]}`}>
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3].map((punto) => (
          <span key={punto} className={`size-1.5 rounded-full ${punto <= parecido.puntos ? "bg-current" : "ring-1 ring-current ring-inset"}`} />
        ))}
      </span>
      {parecido.texto}
    </span>
  );
}

function NotaDeColor({ texto }: { texto: string }) {
  return (
    <span className="inline-flex max-w-full items-start gap-1 rounded-full bg-superficie-2 px-2 py-0.5 text-xs leading-snug text-texto">
      <Info className="mt-0.5 size-3 shrink-0 text-texto-suave" aria-hidden="true" />
      {texto}
    </span>
  );
}

/** Una fila por color: las dos muestras, el globo con su referencia, cuánto ocupa y las píldoras. */
function FilaDeColor({ color }: { color: VistaColor }) {
  const { globo, parecido } = color;
  const titulo = globo ? `${globo.nombre} · Ref. ${globo.codigo} · ${globo.acabado}` : undefined;
  return (
    <li data-color="" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-1">
      <span className="flex shrink-0 items-center gap-1" title={globo ? "Tu foto, y el globo sugerido" : "Tu foto"}>
        <Punto fondo={color.hexEnFoto} />
        {globo ? <Punto fondo={muestraDeGlobo(globo.hexGlobo, globo.acabadoOriginal)} /> : null}
        <span className="sr-only">{globo ? "En tu foto, y globo sugerido:" : "En tu foto:"}</span>
      </span>
      {globo ? (
        <span className="min-w-0 flex-1 basis-36 text-[13px] leading-snug text-texto" title={titulo}>
          <span className="font-medium">{globo.nombre}</span>
          <span className="text-texto-suave">
            {" "}
            Ref. {globo.codigo}
            <span className="sr-only sm:not-sr-only"> · {globo.acabado}</span>
          </span>
        </span>
      ) : null}
      <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-texto-suave" title={color.textoPorcentaje}>
        <span aria-hidden="true" className="hidden h-1 w-8 overflow-hidden sm:block rounded-full bg-superficie-2">
          <span className="block h-full rounded-full bg-acento" style={{ width: `${color.porcentaje}%` }} />
        </span>
        <span className="whitespace-nowrap">
          {color.porcentajeCorto}
          <span className="sr-only"> de la pieza</span>
        </span>
      </span>
      {parecido || color.notas.length > 0 ? (
        <span className="flex w-full flex-wrap items-center gap-1.5 pl-[3.25rem] sm:w-auto sm:pl-0">
          {parecido ? <Parecido parecido={parecido} /> : null}
          {color.notas.map((nota) => (
            <NotaDeColor key={nota} texto={nota} />
          ))}
        </span>
      ) : null}
    </li>
  );
}

function Pieza({ pieza }: { pieza: VistaPieza }) {
  return (
    <li className="border-t border-borde-suave pt-2 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-semibold text-texto-suave">{pieza.nombre}</h4>
      {pieza.sinColores ? (
        <p className="py-1.5 text-xs text-texto-suave">{pieza.sinColores}</p>
      ) : (
        <ul>
          {pieza.colores.map((color) => (
            <FilaDeColor key={color.clave} color={color} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Plegable({ marca, titulo, children }: { marca: string; titulo: string; children: React.ReactNode }) {
  return (
    <details data-plegable={marca} className="group open:basis-full">
      <summary className={`flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-md text-xs font-medium text-acento ${SIN_MARCADOR} ${FOCO}`}>
        {titulo}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}

function OtrasOpciones({ piezas }: { piezas: VistaPieza[] }) {
  const conOtras = piezas
    .map((pieza) => ({ pieza, colores: pieza.colores.filter((color) => color.otras.length > 0) }))
    .filter(({ colores }) => colores.length > 0);
  if (conOtras.length === 0) return null;
  const variasPiezas = piezas.length > 1;
  return (
    <Plegable marca="otras" titulo="Otras opciones parecidas">
      <div className="flex flex-col gap-2 pb-2">
        {conOtras.map(({ pieza, colores }) => (
          <div key={pieza.clave}>
            {variasPiezas ? <p className="mb-1 text-xs font-semibold text-texto-suave">{pieza.nombre}</p> : null}
            <ul className="flex flex-col gap-1.5">
              {colores.map((color) => (
                <li key={color.clave} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="flex items-center gap-1.5 text-texto-suave">
                    <Punto fondo={color.hexEnFoto} className="size-4" />
                    {color.etiquetaOtras}:
                  </span>
                  {color.otras.map((otra) => (
                    <span key={otra.codigo} className="inline-flex items-center gap-1.5 rounded-full bg-superficie-suave py-0.5 pl-1 pr-2 text-texto ring-1 ring-borde-suave ring-inset">
                      <Punto fondo={muestraDeGlobo(otra.hexGlobo, otra.acabadoOriginal)} className="size-4" />
                      {otra.nombre}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Plegable>
  );
}

function NotasDeLaMedicion({ piezas }: { piezas: VistaPieza[] }) {
  const notas = notasDelBloque(piezas);
  if (notas.length === 0) return null;
  return (
    <Plegable marca="notas" titulo={notas.length === 1 ? "1 nota sobre la medición" : `${notas.length} notas sobre la medición`}>
      <ul className="flex flex-col gap-1 pb-2">
        {notas.map(({ pieza, aviso }) => (
          <li key={`${pieza ?? ""}${aviso}`} className="flex gap-1.5 text-xs leading-snug text-texto-suave">
            <Info className="mt-0.5 size-3 shrink-0 text-texto-tenue" aria-hidden="true" />
            <span>
              {pieza ? <span className="font-medium">{pieza}: </span> : null}
              {aviso}
            </span>
          </li>
        ))}
      </ul>
    </Plegable>
  );
}

export function ColoresSempertex({ analisis, className = "" }: Props) {
  if (!analisis || analisis.piezas.length === 0) return null;
  const piezas = vistaDeColores(analisis);
  const resumen = resumenDeColores(piezas);
  return (
    <section aria-label="Colores de tu foto" className={className}>
      <details
        data-bloque-colores=""
        open={bloqueAbiertoPorDefecto(piezas)}
        className="group/bloque rounded-2xl border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra)]"
      >
        <summary className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-2xl px-3.5 ${SIN_MARCADOR} ${FOCO}`}>
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold text-texto">Colores de tu foto</h3>
            {resumen.texto ? <span className="text-xs text-texto-suave">{resumen.texto}</span> : null}
          </span>
          <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
            {resumen.muestras.map((globo) => (
              <Punto key={globo.codigo} fondo={muestraDeGlobo(globo.hexGlobo, globo.acabadoOriginal)} className="size-4" />
            ))}
          </span>
          <ChevronDown className="size-4 shrink-0 text-texto-suave transition-transform group-open/bloque:rotate-180" aria-hidden="true" />
        </summary>
        <div className="px-3.5 pb-2">
          <p className="text-xs leading-snug text-texto-suave">
            Globos del catálogo que más se parecen a tu foto. Es solo una guía: no cambia lo que se compra.
          </p>
          <p className="mt-0.5 text-xs leading-snug text-texto-tenue">En cada fila: tu foto, y a su lado el globo sugerido.</p>
          <ul className="mt-2 flex flex-col gap-1">
            {piezas.map((pieza) => (
              <Pieza key={pieza.clave} pieza={pieza} />
            ))}
          </ul>
          {/* Los tres plegables comparten renglón mientras están cerrados; el que se abre ocupa el ancho entero. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-5">
            <OtrasOpciones piezas={piezas} />
            <NotasDeLaMedicion piezas={piezas} />
            <DetalleTecnicoColores analisis={analisis} />
          </div>
        </div>
      </details>
    </section>
  );
}
