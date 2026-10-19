"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Info, Printer, X } from "lucide-react";
import type { ArmadoGuirnaldaResuelto } from "@/lib/plan/armado-guirnalda";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import type { EstructuraResuelta, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { medidasCliente, productoCliente, ubicacionCliente } from "@/lib/plan/presentacion-cliente";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import type { ColorLeyenda } from "../patron/leyenda";
import { LeyendaPatron, MuestraNumero } from "../patron/LeyendaPatron";
import { GraficaGuirnalda } from "./GraficaGuirnalda";
import { colorDeCodigo, formaTexto, horas, metros, NOMBRE_INSUMO, NOMBRE_POSICION, NOMBRE_SOPORTE, racimosEnOrden, racimosTexto } from "./leyenda-guirnalda";

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

export type PropsHojaArmadoGuirnalda = {
  resuelto: ArmadoGuirnaldaResuelto;
  leyenda: readonly ColorLeyenda[];
  estructura: EstructuraResuelta;
  declarada?: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  /** El patrón de color aplicado de la pieza, si tiene: su hoja se funde en esta. */
  patron?: PatronColorResuelto;
  /** Nombre de la pieza anfitriona cuando la guirnalda va sobre otra. */
  anfitriona?: string;
  tituloPlan?: string;
};

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** Muestras numeradas de una lista de códigos, con su texto para el lector de pantalla. */
function Codigos({ codigos, leyenda }: { codigos: readonly number[]; leyenda: readonly ColorLeyenda[] }) {
  const colores = codigos.map((codigo) => colorDeCodigo(leyenda, codigo));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="sr-only">{colores.map((color) => `${color.etiqueta} (${color.numero})`).join(", ")}</span>
      {colores.map((color, indice) => (
        <span key={indice} aria-hidden="true" className="inline-flex items-center gap-1">
          {indice > 0 && <span className="text-texto-tenue">·</span>}
          <MuestraNumero color={color} tamano="sm" />
        </span>
      ))}
    </span>
  );
}

/** "8 × (1) · 6 × (6)": cantidades por código, con su texto. */
function Cantidades({ codigos, leyenda }: { codigos: ReadonlyArray<{ codigo: number; cantidad: number }>; leyenda: readonly ColorLeyenda[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {codigos.map(({ codigo, cantidad }) => {
        const color = colorDeCodigo(leyenda, codigo);
        return (
          <span key={codigo} className="inline-flex items-center gap-1 text-[13px] tabular-nums">
            {cantidad} ×<MuestraNumero color={color} tamano="sm" /><span className="sr-only">{color.etiqueta} ({codigo})</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Hoja de armado imprimible de una guirnalda (ADR-0032, E6). Es UNA sola
 * hoja: la del patrón y la del armado se funden. Lleva la gráfica con la
 * forma real, la leyenda de códigos por material y tamaño, los racimos de
 * izquierda a derecha (la rejilla del patrón: el racimo `i` es su fila `i`),
 * el relleno, los remates y los sueltos, los insumos que no se cotizan (metros
 * de tira y de cuerda, ganchos o pegante, pesas), la duración estimada, el
 * paso a paso de Python y, si la pieza tiene patrón, su nombre y sus consejos.
 * Todo sale del armado resuelto; aquí solo se ordena para leer.
 */
export function HojaArmadoGuirnalda({ resuelto, leyenda, estructura, declarada, oficial, patron, anfitriona, tituloPlan }: PropsHojaArmadoGuirnalda) {
  const nombrePieza = oficial?.nombre ?? productoCliente(estructura.nombre);
  const { armado } = resuelto;
  const repeticiones = Math.max(1, resuelto.repeticiones);
  const medidas = medidasCliente(estructura.tipo, declarada?.medidas);
  const soporte = armado.soporte === "sobre_estructura" && anfitriona ? `Sobre ${anfitriona}` : NOMBRE_SOPORTE[armado.soporte].nombre;
  const detalles = [
    medidas,
    resuelto.largo_cuerda_m !== resuelto.largo_m ? `cuerda de ${metros(resuelto.largo_cuerda_m)}` : null,
    repeticiones > 1 ? `${repeticiones} guirnaldas iguales` : null,
    racimosTexto(armado, resuelto.racimos.length),
    `${numero.format(resuelto.globos_por_instancia)} globos por guirnalda`,
  ].filter(Boolean);
  const racimos = racimosEnOrden(resuelto, leyenda);
  return (
    <article className="hoja-armado @container space-y-5 text-texto" aria-label={`Hoja de armado: ${nombrePieza}`}>
      <header className="hoja-armado-bloque space-y-1.5 border-b border-borde pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-acento">Hoja de armado{tituloPlan ? ` · ${tituloPlan}` : ""}</p>
        <h2 className="text-xl font-semibold tracking-tight">{nombrePieza} <span className="font-normal text-texto-suave">{ubicacionCliente(estructura)}</span></h2>
        <p className="text-[13px] text-texto-suave">{detalles.join(" · ")}</p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">{resuelto.nombre}</span>
          {resuelto.descripcion && <span className="text-texto-suave">{resuelto.descripcion}</span>}
        </p>
        <p className="text-[13px] text-texto-suave"><span className="font-semibold text-texto">Soporte:</span> {soporte} · <span className="font-semibold text-texto">Forma:</span> {formaTexto(armado)}</p>
        {patron && (
          <p data-testid="hoja-guirnalda-patron" className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="rounded-full bg-superficie-2 px-2.5 py-0.5 text-xs font-semibold text-texto">Patrón: {patron.nombre}</span>
            {patron.descripcion && <span className="text-texto-suave">{patron.descripcion}</span>}
          </p>
        )}
        {[...resuelto.avisos, ...(patron?.avisos ?? [])].length > 0 && (
          <ul aria-label="Avisos del armado" className="space-y-0.5 pt-1 text-xs text-texto-suave">
            {[...new Set([...resuelto.avisos, ...(patron?.avisos ?? [])])].map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
          </ul>
        )}
      </header>

      <section className="hoja-armado-bloque min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">Cómo se arma</h3>
        <div className="grid h-72 place-items-center rounded-2xl border border-borde-suave bg-superficie-suave p-3 print:h-64">
          <GraficaGuirnalda resuelto={resuelto} leyenda={leyenda} etiqueta={`${nombrePieza}: ${resuelto.nombre.toLowerCase()}`} className="size-full" animar={false} />
        </div>
      </section>

      <div className="hoja-armado-columnas grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="hoja-armado-bloque min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Leyenda</h3>
          <LeyendaPatron leyenda={leyenda} etiqueta="Leyenda del armado" className="pb-1" />
          <table className="w-full text-[13px]" data-testid="leyenda-armado-guirnalda">
            <thead className="text-left text-xs text-texto-suave">
              <tr><th className="py-1 font-medium">Código</th><th className="py-1 font-medium">Globo</th><th className="py-1 text-right font-medium">Por guirnalda</th><th className="py-1 text-right font-medium">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-borde-suave">
              {[...resuelto.leyenda].sort((a, b) => a.codigo - b.codigo).map((entrada) => (
                <tr key={entrada.codigo}>
                  <td className="py-1.5"><MuestraNumero color={colorDeCodigo(leyenda, entrada.codigo)} tamano="sm" /><span className="sr-only">{entrada.codigo}</span></td>
                  <td className="py-1.5">{colorDeCodigo(leyenda, entrada.codigo).etiqueta}</td>
                  <td className="py-1.5 text-right tabular-nums">{numero.format(entrada.unidades_por_instancia)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{numero.format(entrada.unidades_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="hoja-armado-bloque min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Insumos (no se cotizan)</h3>
          {resuelto.insumos.length > 0 ? (
            <table className="w-full text-[13px]" data-testid="insumos-armado-guirnalda-tabla">
              <thead className="text-left text-xs text-texto-suave">
                <tr><th className="py-1 font-medium">Insumo</th><th className="py-1 text-right font-medium">Cantidad</th><th className="py-1 pl-2 font-medium">Detalle</th></tr>
              </thead>
              <tbody className="divide-y divide-borde-suave">
                {resuelto.insumos.map((insumo) => (
                  <tr key={insumo.insumo}>
                    <td className="py-1.5">{NOMBRE_INSUMO[insumo.insumo]}</td>
                    <td className="py-1.5 text-right tabular-nums">{insumo.estimado ? "≈ " : ""}{numero.format(insumo.cantidad)} {insumo.unidad}</td>
                    <td className="py-1.5 pl-2 text-texto-suave">{insumo.detalle}{insumo.estimado ? <span className="ml-1 rounded-full bg-aviso-suave px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-aviso">estimado</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-[13px] text-texto-suave">Este armado no necesita insumos aparte.</p>}
          <p className="text-[13px]" data-testid="duracion-armado-guirnalda-hoja">
            <span className="font-semibold">Duración estimada:</span> ≈ {horas(resuelto.duracion_estimada)} de armado e instalación{repeticiones > 1 ? ` (las ${repeticiones} guirnaldas)` : ""} <span className="text-texto-suave">(estimado)</span>
          </p>
        </section>
      </div>

      <section className="hoja-armado-bloque space-y-2">
        <h3 className="text-sm font-semibold">Racimos, de izquierda a derecha</h3>
        <ol className="divide-y divide-borde-suave rounded-2xl border border-borde-suave" data-testid="racimos-armado-guirnalda">
          {racimos.map((racimo) => (
            <li key={racimo.numero} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="w-24 shrink-0 text-[13px] font-semibold tabular-nums">Racimo {racimo.numero}</span>
              <Codigos codigos={racimo.codigos} leyenda={leyenda} />
              {racimo.remates.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-superficie-2 py-0.5 pl-2 pr-0.5 text-[11px] text-texto-suave">
                  remate <Codigos codigos={racimo.remates} leyenda={leyenda} />
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {(resuelto.relleno || resuelto.remates.length > 0 || resuelto.sueltos.length > 0) && (
        <section className="hoja-armado-bloque space-y-2">
          <h3 className="text-sm font-semibold">Relleno, remates y sueltos</h3>
          <dl className="space-y-1.5 text-[13px]" data-testid="extras-armado-guirnalda">
            {resuelto.relleno && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <dt className="font-semibold">Relleno entre racimos ({resuelto.relleno.total}):</dt>
                <dd><Cantidades codigos={resuelto.relleno.codigos} leyenda={leyenda} /></dd>
              </div>
            )}
            {resuelto.remates.map((remate, indice) => (
              <div key={indice} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <dt className="font-semibold">Remate {NOMBRE_POSICION[remate.posicion].toLowerCase()}:</dt>
                <dd className="inline-flex flex-wrap items-center gap-1.5">
                  <Cantidades codigos={[{ codigo: remate.codigo, cantidad: remate.cantidad }]} leyenda={leyenda} />
                  <span className="text-texto-suave">junto {remate.racimos.length === 1 ? "al racimo" : "a los racimos"} {remate.racimos.join(", ")}</span>
                </dd>
              </div>
            ))}
            {resuelto.sueltos.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <dt className="font-semibold">Sueltos entre racimos:</dt>
                <dd><Cantidades codigos={resuelto.sueltos} leyenda={leyenda} /></dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {resuelto.pasos.length > 0 && (
        <section className="hoja-armado-bloque space-y-2">
          <h3 className="text-sm font-semibold">Paso a paso</h3>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-texto-suave marker:font-semibold marker:text-acento" data-testid="pasos-armado-guirnalda">
            {resuelto.pasos.map((paso) => <li key={paso}>{paso}</li>)}
          </ol>
        </section>
      )}

      {patron && patron.instrucciones.length > 0 && (
        <section className="hoja-armado-bloque space-y-2">
          <h3 className="text-sm font-semibold">Consejos del patrón</h3>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-texto-suave marker:text-acento">
            {patron.instrucciones.map((instruccion) => <li key={instruccion}>{instruccion}</li>)}
          </ul>
        </section>
      )}
    </article>
  );
}

/**
 * La hoja en un diálogo (pantalla completa en móvil) con "Imprimir": las
 * mismas clases de impresión que las hojas del patrón y del bouquet, así las
 * reglas `@media print` de `globals.css` dejan en el papel solo la hoja.
 */
export function DialogoHojaArmadoGuirnalda({ abierto, onAbiertoChange, ...hoja }: PropsHojaArmadoGuirnalda & { abierto: boolean; onAbiertoChange: (abierto: boolean) => void }) {
  const focoRetorno = useFocoDeRetorno();
  return (
    <Dialog.Root open={abierto} onOpenChange={onAbiertoChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="hoja-armado-fondo fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          {...focoRetorno}
          aria-describedby={undefined}
          data-testid="dialogo-hoja-armado-guirnalda"
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
          <div tabIndex={0} role="region" aria-label="Contenido de la hoja de armado" className="hoja-armado-scroll scroll-suave min-h-0 flex-1 overflow-y-auto px-4 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento md:px-8 md:py-6">
            <HojaArmadoGuirnalda {...hoja} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
