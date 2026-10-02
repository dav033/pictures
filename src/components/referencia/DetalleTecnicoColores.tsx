"use client";

import { ChevronDown } from "lucide-react";
import type { AnalisisColorSempertex, ColorDePieza } from "@/lib/plan/analisis-color";
import { nivelDeParecido, type NivelParecido } from "@/lib/plan/presentacion-color";

/**
 * Lo que se midió, sin traducir: el id de cada pieza, su croquis, los píxeles, el hex, la referencia y el
 * Pantone, el acabado como lo escribe el catálogo, el tono y el croma, las distancias y las marcas internas.
 *
 * Es la vista de auditoría del análisis de color. El cliente no la necesita para decidir nada, así que vive
 * cerrada detrás de «Ver detalle técnico» al final del bloque (`ColoresSempertex.tsx`); está para poder
 * comparar lo que mide con lo que se ve y para depurar, sin que se pierda nada.
 *
 * Lo que se enseña a propósito, y no se esconde: el **ΔE** de cada candidata (un ΔE alto significa que el color
 * medido no se parece a ninguna referencia, casi siempre porque ese grupo de píxeles es sombra o fondo), y las
 * marcas de *ambigua* (dos referencias indistinguibles para la foto), *neutro* (un blanco o un gris no se
 * identifica por tono) y *débil* (ese color ocupa muy poco).
 */

const pct = (valor: number) => `${Math.round(valor * 100)} %`;

/** El color del número según cuánto se parece; los umbrales son los de `nivelDeParecido`, los mismos que ve el cliente. */
const TONO_DEL_NIVEL: Readonly<Record<NivelParecido, string>> = {
  muy_parecido: "text-emerald-600 dark:text-emerald-400",
  parecido: "text-amber-600 dark:text-amber-400",
  aproximado: "text-rose-600 dark:text-rose-400",
};

function tonoDeDistancia(distancia: number): string {
  return TONO_DEL_NIVEL[nivelDeParecido(distancia)];
}

function Marca({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-current/30 px-1 py-px text-[10px] uppercase tracking-wide opacity-80">
      {children}
    </span>
  );
}

function PiezaTecnica({ pieza }: { pieza: ColorDePieza }) {
  return (
    <li className="border-t border-black/10 py-3 first:border-t-0 dark:border-white/10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs opacity-70">
        <span className="font-medium opacity-100">{pieza.elementId}</span>
        <span>{pieza.tipo || "sin tipo"}</span>
        <span>
          croquis: {pieza.croquis.forma} ({pct(pieza.croquis.parteDeLaCaja)} de la caja)
        </span>
        <span>
          {pieza.pixeles.medidos.toLocaleString("es")} px medidos de {pieza.pixeles.deLaCaja.toLocaleString("es")}
        </span>
        {pieza.colores[0]?.cruce.familias.length ? (
          <span>acabado visto: {pieza.colores[0].cruce.familias.join(" o ")}</span>
        ) : null}
      </div>

      {pieza.colores.length === 0 ? (
        <p className="mt-2 text-xs opacity-60">Sin colores medibles en esta pieza.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {pieza.colores.map((color) => {
            const mejor = color.cruce.candidatas[0];
            return (
              <li key={color.hex} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-px size-9 shrink-0 rounded-md border border-black/15 dark:border-white/20"
                  style={{ backgroundColor: color.hex }}
                />
                <div className="min-w-0 text-xs">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <code className="font-mono opacity-70">{color.hex}</code>
                    <span className="opacity-60">{pct(color.parte)}</span>
                    {color.cruce.sinReferencia ? (
                      <>
                        {/* Con la más cercana tan lejos, nombrarla sería inventar: casi siempre es sombra o fondo. */}
                        <span className="font-medium opacity-70">Ningún globo del catálogo se parece</span>
                        <span className={tonoDeDistancia(mejor.distancia)}>la más cercana, a {mejor.distancia}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">
                          {mejor.nombreCompleto} · {mejor.codigo}
                        </span>
                        {mejor.pms ? <span className="opacity-70">PMS {mejor.pms}</span> : <span className="opacity-50">sin PMS</span>}
                        <span className="opacity-70">{mejor.acabado}</span>
                        <span className={tonoDeDistancia(mejor.distancia)}>
                          tono {mejor.tono}° · croma ×{mejor.razonCroma}
                        </span>
                        {color.cruce.porNombre ? <Marca>lo nombró el análisis</Marca> : null}
                        {color.cruce.ambigua && !color.cruce.porNombre ? <Marca>ambigua</Marca> : null}
                        {color.cruce.neutro ? <Marca>neutro</Marca> : null}
                      </>
                    )}
                  </div>
                  {color.cruce.candidatas.length > 1 ? (
                    <p className="mt-0.5 opacity-55">
                      {color.cruce.sinReferencia ? "lo más cercano, y queda lejos: " : "también: "}
                      {color.cruce.candidatas.map((otra, indice) =>
                        color.cruce.sinReferencia || indice > 0 ? (
                          <span key={otra.codigo}>
                            {indice > 0 ? " · " : ""}
                            {otra.nombreCompleto} ({otra.distancia})
                          </span>
                        ) : null,
                      )}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pieza.avisos.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-[11px] opacity-60">
          {pieza.avisos.map((aviso) => (
            <li key={aviso}>— {aviso}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function DetalleTecnicoColores({ analisis, className = "" }: { analisis: AnalisisColorSempertex; className?: string }) {
  return (
    // Cerrado por defecto. Sin <details> anidados dentro: la prueba lo separa del resto por su cierre. Cerrado es
    // un enlace más del renglón de plegables; abierto ocupa el ancho entero.
    <details data-detalle-tecnico="" className={`group open:basis-full ${className}`}>
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
        Ver detalle técnico
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mb-2 rounded-xl px-3.5 pb-2 pt-3 text-texto ring-1 ring-borde-suave ring-inset">
        <p className="text-[11px] opacity-55">
          De 2 a 5 colores por pieza, medidos en su croquis y cruzados con el globo real del catálogo. No decide qué
          se compra.
        </p>
        <ul className="mt-1 flex flex-col">
          {analisis.piezas.map((pieza) => (
            <PiezaTecnica key={pieza.elementId} pieza={pieza} />
          ))}
        </ul>
      </div>
    </details>
  );
}
