"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Info, Printer, X } from "lucide-react";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import type { EstructuraResuelta, LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { medidasCliente, productoCliente, ubicacionCliente, type MuestraColor } from "@/lib/plan/presentacion-cliente";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import { colorDe, colorDeLinea, nombreRacimo, rangoFilas, unidadesFila, type ColorLeyenda } from "./leyenda";
import { LeyendaPatron, MuestraNumero } from "./LeyendaPatron";
import { GraficaPatron } from "./GraficaPatron";
import { VistaPatron } from "./VistaPatron";

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

export type PropsHojaArmado = {
  resuelto: PatronColorResuelto;
  leyenda: readonly ColorLeyenda[];
  estructura: EstructuraResuelta;
  declarada?: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  tituloPlan?: string;
};

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/**
 * Globos por fila que caben con su número en el ancho imprimible de una hoja
 * A4 o carta con los márgenes de `@page` (≈ 700 px): 24 globos pequeños y el
 * número de la fila miden ≈ 530 px. Una pared más ancha (18 × 76 en 10 m ×
 * 2,4 m) no cabe ni achicada: en el papel su gráfica va por tramos.
 */
export const GLOBOS_POR_TRAMO_IMPRESO = 24;

/** Tramos parejos de columnas, de izquierda a derecha, de a lo sumo `maximo` (76 → 4 de 19). `hasta` es exclusivo. */
export function tramosDeColumnas(columnas: number, maximo = GLOBOS_POR_TRAMO_IMPRESO): Array<{ desde: number; hasta: number }> {
  const cuantos = Math.max(1, Math.ceil(columnas / maximo));
  const base = Math.floor(columnas / cuantos);
  const resto = columnas % cuantos;
  const tramos: Array<{ desde: number; hasta: number }> = [];
  let desde = 0;
  for (let indice = 0; indice < cuantos; indice += 1) {
    const hasta = desde + base + (indice < resto ? 1 : 0);
    tramos.push({ desde, hasta });
    desde = hasta;
  }
  return tramos;
}

/** Pulgadas de una línea ("12″"); sin tamaño, el código tal cual. */
function tamanoDe(linea: LineaMaterial): { clave: string; texto: string; orden: number } {
  const pulgadas = linea.diam_pulg ?? Number(/(\d+(?:[.,]\d+)?)/.exec(linea.tamano_codigo ?? "")?.[1]?.replace(",", "."));
  if (Number.isFinite(pulgadas) && pulgadas) return { clave: String(pulgadas), texto: `${numero.format(pulgadas)}″`, orden: pulgadas };
  return { clave: linea.tamano_codigo ?? "?", texto: linea.tamano_codigo ?? "Sin tamaño", orden: Number.MAX_SAFE_INTEGER };
}

type ColorComprado = { clave: string; muestra: MuestraColor };
type FilaTamano = { clave: string; texto: string; orden: number; porColor: Map<string, number>; total: number };

/**
 * Globos por tamaño y color, tal como los compra el plan: cada línea resuelta
 * de la estructura va a la columna de su propio color y acabado, en el orden
 * en que aparecen. Un reemplazo compra otro color que el declarado y sale con
 * el suyo; ninguna línea se asigna a un material ni se queda fuera. Solo suma
 * las unidades que Python ya puso en cada línea.
 */
export function tablaPorTamano(lineas: readonly LineaMaterial[]): { colores: ColorComprado[]; filas: FilaTamano[] } {
  const colores = new Map<string, ColorComprado>();
  const filas = new Map<string, FilaTamano>();
  for (const linea of lineas) {
    const color = colorDeLinea(linea);
    if (!colores.has(color.clave)) colores.set(color.clave, color);
    const tamano = tamanoDe(linea);
    const fila = filas.get(tamano.clave) ?? { ...tamano, porColor: new Map<string, number>(), total: 0 };
    fila.porColor.set(color.clave, (fila.porColor.get(color.clave) ?? 0) + linea.unidades);
    fila.total += linea.unidades;
    filas.set(tamano.clave, fila);
  }
  return { colores: [...colores.values()], filas: [...filas.values()].sort((a, b) => a.orden - b.orden) };
}

/**
 * Hoja de armado imprimible de una pieza con patrón: medidas, leyenda, vista,
 * gráfica numerada, paso a paso por racimos (`pasos` de Python), cuántos
 * globos van de cada color y tamaño (lo primero que se prepara) e
 * instrucciones. Todo lo que
 * cuenta sale del plan resuelto; aquí solo se ordena para leer.
 */
export function HojaArmado({ resuelto, leyenda, estructura, declarada, oficial, tituloPlan }: PropsHojaArmado) {
  const nombrePieza = oficial?.nombre ?? productoCliente(estructura.nombre);
  const unidades = unidadesFila(resuelto.geometria);
  const rejilla = resuelto.geometria === "rejilla";
  const medidas = medidasCliente(estructura.tipo, declarada?.medidas);
  const estructuraRacimo = rejilla
    ? `${resuelto.filas} filas de ${resuelto.columnas} globos`
    : `${resuelto.filas} racimos de ${resuelto.columnas} globos (${nombreRacimo(resuelto.columnas)})`;
  const porTamano = tablaPorTamano(estructura.lineas);
  const proporcion = declarada?.medidas?.alto_m && declarada.medidas.ancho_m ? declarada.medidas.alto_m / declarada.medidas.ancho_m : undefined;
  const repeticiones = Math.max(1, resuelto.repeticiones);
  const oficialId = oficial?.id ?? declarada?.estructura_oficial;
  const tramos = tramosDeColumnas(Math.max(0, ...resuelto.celdas.map((fila) => fila.length)));
  return (
    <article className="hoja-armado @container space-y-5 text-texto" aria-label={`Hoja de armado: ${nombrePieza}`}>
      <header className="hoja-armado-bloque space-y-1.5 border-b border-borde pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-acento">Hoja de armado{tituloPlan ? ` · ${tituloPlan}` : ""}</p>
        <h2 className="text-xl font-semibold tracking-tight">{nombrePieza} <span className="font-normal text-texto-suave">{ubicacionCliente(estructura)}</span></h2>
        <p className="text-[13px] text-texto-suave">
          {[medidas, repeticiones > 1 ? `${repeticiones} piezas iguales` : null, estructuraRacimo, `${numero.format(resuelto.globos_por_instancia)} globos por pieza`].filter(Boolean).join(" · ")}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">Patrón: {resuelto.nombre}</span>
          {resuelto.descripcion && <span className="text-texto-suave">{resuelto.descripcion}</span>}
        </p>
        <LeyendaPatron leyenda={leyenda} className="pt-1" />
        {/* Los avisos de Python, tal cual: p. ej. que solo una parte de un color se cambió y la tabla por tamaño lo muestra aparte. */}
        {resuelto.avisos.length > 0 && (
          <ul aria-label="Avisos del patrón" className="space-y-0.5 pt-1 text-xs text-texto-suave">
            {resuelto.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
          </ul>
        )}
      </header>

      {/* Al imprimir va en una sola columna (globals.css): la gráfica toma todo el ancho del papel. */}
      <div className="hoja-armado-columnas grid gap-5 @2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="hoja-armado-bloque min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Cómo se ve</h3>
          <div className="grid h-72 place-items-center rounded-2xl border border-borde-suave bg-superficie-suave p-3 @2xl:h-96 print:h-72">
            <VistaPatron resuelto={resuelto} leyenda={leyenda} tipo={estructura.tipo} oficialId={oficialId} espejo={estructura.ubicacion === "lateral_derecho"} proporcion={proporcion} etiqueta={`${nombrePieza}: patrón ${resuelto.nombre.toLowerCase()}`} className="size-full" animar={false} />
          </div>
        </section>
        {/* `min-w-0`: en un teléfono solo se desplaza la gráfica, no la hoja entera. */}
        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Gráfica numerada</h3>
          <GraficaPatron resuelto={resuelto} leyenda={leyenda} tipo={estructura.tipo} oficialId={oficialId} className={tramos.length > 1 ? "print:hidden" : ""} />
          {tramos.length > 1 && (
            <div data-testid="grafica-por-tramos" className="hidden space-y-4 print:block">
              <p className="text-xs text-texto-suave">En el papel la gráfica va en {tramos.length} tramos, de izquierda a derecha: cada {unidades.singular.toLowerCase()} sigue en el tramo siguiente.</p>
              {tramos.map((tramo, indice) => (
                <div key={tramo.desde} className="space-y-1">
                  <p className="text-xs font-semibold">Tramo {indice + 1} · globos {tramo.desde + 1} a {tramo.hasta} de cada {unidades.singular.toLowerCase()}</p>
                  <GraficaPatron
                    resuelto={{ geometria: resuelto.geometria, celdas: resuelto.celdas.map((fila) => fila.slice(tramo.desde, tramo.hasta)), extras: indice === tramos.length - 1 ? resuelto.extras : [] }}
                    leyenda={leyenda}
                    tipo={estructura.tipo}
                    oficialId={oficialId}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Paso a paso</h3>
        <ol className="divide-y divide-borde-suave rounded-2xl border border-borde-suave">
          {resuelto.pasos.map((paso) => {
            const cuantos = paso.hasta - paso.desde + 1;
            const colores = paso.celdas.map((material) => colorDe(leyenda, material));
            const centro = paso.extras.map((material) => colorDe(leyenda, material).etiqueta).join(", ");
            return (
              <li key={`${paso.desde}-${paso.hasta}`} className="hoja-armado-bloque flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <span className="w-28 shrink-0 text-[13px] font-semibold tabular-nums">{rangoFilas(resuelto.geometria, paso.desde, paso.hasta)}</span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  {/* Los globos son solo dibujo: el lector de pantalla oye los colores en texto (un aria-label en un <span> genérico no se anuncia). */}
                  <span className="sr-only">{colores.map((color) => color.etiqueta).join(", ")}{centro ? `, y al centro ${centro}` : ""}</span>
                  {colores.map((color, indice) => (
                    <span key={indice} aria-hidden="true" className="inline-flex items-center gap-1">
                      {indice > 0 && <span className="text-texto-tenue">·</span>}
                      <MuestraNumero color={color} tamano={rejilla && colores.length > 10 ? "xs" : "sm"} />
                    </span>
                  ))}
                  {paso.extras.map((material, indice) => (
                    <span key={`extra-${indice}`} aria-hidden="true" className="ml-1 inline-flex items-center gap-1 rounded-full bg-superficie-2 py-0.5 pl-2 pr-0.5 text-[11px] text-texto-suave">
                      centro <MuestraNumero color={colorDe(leyenda, material)} tamano="sm" />
                    </span>
                  ))}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-texto-suave">{cuantos > 1 ? `× ${cuantos} ${unidades.plural.toLowerCase()}` : ""}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-5 @2xl:grid-cols-2">
        <section className="hoja-armado-bloque space-y-2">
          <h3 className="text-sm font-semibold">Globos por color</h3>
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-texto-suave">
              <tr><th className="py-1 font-medium">Color</th><th className="py-1 text-right font-medium">Por pieza</th>{repeticiones > 1 && <th className="py-1 text-right font-medium">Total ({repeticiones})</th>}</tr>
            </thead>
            <tbody className="divide-y divide-borde-suave">
              {resuelto.conteo.map((fila) => {
                const color = colorDe(leyenda, fila.material);
                return (
                  <tr key={fila.material}>
                    <td className="py-1.5"><span className="inline-flex items-center gap-2"><MuestraNumero color={color} tamano="sm" />{color.etiqueta}</span></td>
                    <td className="py-1.5 text-right tabular-nums">{numero.format(fila.unidades_por_instancia)}</td>
                    {repeticiones > 1 && <td className="py-1.5 text-right font-semibold tabular-nums">{numero.format(fila.unidades_total)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        {porTamano.filas.length > 0 && (
          <section className="hoja-armado-bloque space-y-2">
            <h3 className="text-sm font-semibold">Globos por tamaño{repeticiones > 1 ? ` (las ${repeticiones} piezas)` : ""}</h3>
            {/* Cada columna es un color tal como se compra (sus líneas), no un número de la leyenda. */}
            <table className="w-full text-[13px]" data-testid="globos-por-tamano">
              <thead className="text-xs text-texto-suave">
                <tr>
                  <th className="py-1 text-left align-bottom font-medium">Tamaño</th>
                  {porTamano.colores.map(({ clave, muestra }) => (
                    <th key={clave} className="py-1 pl-2 text-right align-bottom font-medium leading-tight">
                      <span className="inline-flex items-center justify-end gap-1">
                        <span aria-hidden="true" className={`size-3 shrink-0 rounded-full ${muestra.conBorde ? "ring-1 ring-borde ring-inset" : ""}`} style={{ background: muestra.fondo }} />
                        {muestra.etiqueta}
                      </span>
                    </th>
                  ))}
                  <th className="py-1 pl-2 text-right align-bottom font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde-suave">
                {porTamano.filas.map((fila) => (
                  <tr key={fila.clave}>
                    <td className="py-1.5 font-medium">{fila.texto}</td>
                    {porTamano.colores.map(({ clave }) => <td key={clave} className="py-1.5 pl-2 text-right tabular-nums">{numero.format(fila.porColor.get(clave) ?? 0)}</td>)}
                    <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{numero.format(fila.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {resuelto.instrucciones.length > 0 && (
        <section className="hoja-armado-bloque space-y-2">
          <h3 className="text-sm font-semibold">Consejos de armado</h3>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-texto-suave marker:text-acento">
            {resuelto.instrucciones.map((instruccion) => <li key={instruccion}>{instruccion}</li>)}
          </ul>
        </section>
      )}
    </article>
  );
}

/**
 * La hoja en un diálogo (pantalla completa en móvil) con "Imprimir": las
 * reglas `@media print` de `globals.css` dejan en el papel solo la hoja.
 */
export function DialogoHojaArmado({ abierto, onAbiertoChange, ...hoja }: PropsHojaArmado & { abierto: boolean; onAbiertoChange: (abierto: boolean) => void }) {
  const focoRetorno = useFocoDeRetorno();
  return (
    <Dialog.Root open={abierto} onOpenChange={onAbiertoChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="hoja-armado-fondo fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          {...focoRetorno}
          aria-describedby={undefined}
          data-testid="dialogo-hoja-armado"
          className="hoja-armado-dialogo fixed inset-0 z-50 flex flex-col overflow-hidden bg-superficie md:inset-x-4 md:inset-y-6 md:mx-auto md:max-w-4xl md:rounded-3xl md:border md:border-borde-suave md:shadow-[0_24px_64px_var(--sombra)]"
        >
          <div className="hoja-armado-no-imprimir flex items-center justify-between gap-3 border-b border-borde-suave px-4 py-3 md:px-6">
            <Dialog.Title className="text-base font-semibold text-texto">Hoja de armado</Dialog.Title>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => window.print()} className="ui-button-primary ui-pressable h-10">
                <Printer className="size-4" aria-hidden="true" />Imprimir
              </button>
              <Dialog.Close aria-label="Cerrar hoja de armado" className="grid size-10 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
          </div>
          {/* Desplazable con el teclado (axe: scrollable-region-focusable). */}
          <div tabIndex={0} role="region" aria-label="Contenido de la hoja de armado" className="hoja-armado-scroll scroll-suave min-h-0 flex-1 overflow-y-auto px-4 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento md:px-8 md:py-6">
            <HojaArmado {...hoja} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
