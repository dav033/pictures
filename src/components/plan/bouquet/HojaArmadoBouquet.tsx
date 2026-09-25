"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Info, Printer, X } from "lucide-react";
import type { ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import type { EstructuraResuelta, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { productoCliente, ubicacionCliente } from "@/lib/plan/presentacion-cliente";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import type { ColorLeyenda } from "../patron/leyenda";
import { LeyendaPatron, MuestraNumero } from "../patron/LeyendaPatron";
import { GraficaBouquet } from "./GraficaBouquet";
import { colorDeCodigo, ETIQUETA_DISPOSICION, NOMBRE_ROL, unidadesTexto } from "./leyenda-bouquet";

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

export type PropsHojaArmadoBouquet = {
  resuelto: ArmadoBouquetResuelto;
  leyenda: readonly ColorLeyenda[];
  estructura: EstructuraResuelta;
  declarada?: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  tituloPlan?: string;
};

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });

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

/**
 * Hoja de armado imprimible de un bouquet (ADR-0030): la gráfica por
 * niveles, la leyenda, los niveles de abajo hacia arriba, el remate y los
 * números, lo que necesita y no se cotiza, la duración estimada y el paso a
 * paso de Python. Todo sale del armado resuelto; aquí solo se ordena para leer.
 */
export function HojaArmadoBouquet({ resuelto, leyenda, estructura, declarada, oficial, tituloPlan }: PropsHojaArmadoBouquet) {
  const nombrePieza = oficial?.nombre ?? productoCliente(estructura.nombre);
  const repeticiones = Math.max(1, resuelto.repeticiones);
  const globosPorBouquet = resuelto.leyenda.reduce((suma, entrada) => suma + entrada.unidades_por_grupo, 0);
  const detalles = [
    repeticiones > 1 ? `${repeticiones} piezas iguales` : null,
    resuelto.grupos > 1 ? `${resuelto.grupos} bouquets por pieza, uno por número` : null,
    `${numero.format(globosPorBouquet)} globos por bouquet`,
    declarada?.unidades_declaradas !== undefined ? `${numero.format(declarada.unidades_declaradas)} globos en total` : null,
  ].filter(Boolean);
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
        {resuelto.avisos.length > 0 && (
          <ul aria-label="Avisos del armado" className="space-y-0.5 pt-1 text-xs text-texto-suave">
            {resuelto.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
          </ul>
        )}
      </header>

      <div className="hoja-armado-columnas grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="hoja-armado-bloque min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Cómo se arma</h3>
          <div className="grid h-80 place-items-center rounded-2xl border border-borde-suave bg-superficie-suave p-3 print:h-72">
            <GraficaBouquet resuelto={resuelto} leyenda={leyenda} etiqueta={`${nombrePieza}: ${resuelto.nombre.toLowerCase()}`} className="size-full [&>svg]:size-full" animar={false} />
          </div>
        </section>
        <section className="hoja-armado-bloque min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Leyenda</h3>
          <LeyendaPatron leyenda={leyenda} etiqueta="Leyenda del armado" className="pb-1" />
          <table className="w-full text-[13px]" data-testid="leyenda-armado">
            <thead className="text-left text-xs text-texto-suave">
              <tr><th className="py-1 font-medium">Código</th><th className="py-1 font-medium">Globo</th><th className="py-1 text-right font-medium">Por bouquet</th><th className="py-1 text-right font-medium">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-borde-suave">
              {[...resuelto.leyenda].sort((a, b) => a.codigo - b.codigo).map((entrada) => (
                <tr key={entrada.codigo}>
                  <td className="py-1.5"><MuestraNumero color={colorDeCodigo(leyenda, entrada.codigo)} tamano="sm" /><span className="sr-only">{entrada.codigo}</span></td>
                  <td className="py-1.5">{colorDeCodigo(leyenda, entrada.codigo).etiqueta}</td>
                  <td className="py-1.5 text-right tabular-nums">{numero.format(entrada.unidades_por_grupo)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{numero.format(entrada.unidades_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="hoja-armado-bloque space-y-2">
        <h3 className="text-sm font-semibold">Niveles, de abajo hacia arriba</h3>
        <ol className="divide-y divide-borde-suave rounded-2xl border border-borde-suave" data-testid="niveles-armado">
          {resuelto.niveles.map((nivel, indice) => (
            <li key={indice} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="w-24 shrink-0 text-[13px] font-semibold tabular-nums">Nivel {indice + 1}</span>
              <span className="min-w-0 flex-1 text-[13px] text-texto-suave">{NOMBRE_ROL[nivel.rol]} · {unidadesTexto(nivel.cantidad, nivel.unidad)}</span>
              <Codigos codigos={nivel.codigos} leyenda={leyenda} />
            </li>
          ))}
          {resuelto.remate.length > 0 && (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="w-24 shrink-0 text-[13px] font-semibold">Remate</span>
              <span className="min-w-0 flex-1 text-[13px] text-texto-suave">arriba del último nivel</span>
              <Codigos codigos={resuelto.remate} leyenda={leyenda} />
            </li>
          )}
          {resuelto.numero && (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="w-24 shrink-0 text-[13px] font-semibold">Números</span>
              <span className="min-w-0 flex-1 text-[13px] text-texto-suave">{ETIQUETA_DISPOSICION[resuelto.numero.disposicion].toLowerCase()}</span>
              <Codigos codigos={resuelto.numero.codigos} leyenda={leyenda} />
            </li>
          )}
        </ol>
      </section>

      <div className="grid gap-5 @2xl:grid-cols-2">
        <section className="hoja-armado-bloque space-y-2">
          <h3 className="text-sm font-semibold">Insumos (no se cotizan)</h3>
          {resuelto.insumos.length > 0 ? (
            <table className="w-full text-[13px]" data-testid="insumos-armado-tabla">
              <thead className="text-left text-xs text-texto-suave">
                <tr><th className="py-1 font-medium">Insumo</th><th className="py-1 text-right font-medium">Cantidad</th><th className="py-1 pl-2 font-medium">Detalle</th></tr>
              </thead>
              <tbody className="divide-y divide-borde-suave">
                {resuelto.insumos.map((insumo) => (
                  <tr key={insumo.insumo}>
                    <td className="py-1.5 capitalize">{insumo.insumo}</td>
                    <td className="py-1.5 text-right tabular-nums">{insumo.estimado ? "≈ " : ""}{numero.format(insumo.cantidad)} {insumo.unidad}</td>
                    <td className="py-1.5 pl-2 text-texto-suave">{insumo.detalle}{insumo.estimado ? <span className="ml-1 rounded-full bg-aviso-suave px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-aviso">estimado</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-[13px] text-texto-suave">Este armado no necesita insumos aparte.</p>}
          {resuelto.duracion_estimada && (
            <p className="text-[13px]" data-testid="duracion-armado"><span className="font-semibold">Duración estimada:</span> flota {resuelto.duracion_estimada.horas_min}–{resuelto.duracion_estimada.horas_max} h <span className="text-texto-suave">(≈ estimado)</span></p>
          )}
        </section>
        {resuelto.pasos.length > 0 && (
          <section className="hoja-armado-bloque space-y-2">
            <h3 className="text-sm font-semibold">Paso a paso</h3>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-texto-suave marker:font-semibold marker:text-acento" data-testid="pasos-armado">
              {resuelto.pasos.map((paso) => <li key={paso}>{paso}</li>)}
            </ol>
          </section>
        )}
      </div>
    </article>
  );
}

/**
 * La hoja en un diálogo (pantalla completa en móvil) con "Imprimir": las
 * mismas clases de impresión que la hoja del patrón, así las reglas
 * `@media print` de `globals.css` dejan en el papel solo la hoja.
 */
export function DialogoHojaArmadoBouquet({ abierto, onAbiertoChange, ...hoja }: PropsHojaArmadoBouquet & { abierto: boolean; onAbiertoChange: (abierto: boolean) => void }) {
  const focoRetorno = useFocoDeRetorno();
  return (
    <Dialog.Root open={abierto} onOpenChange={onAbiertoChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="hoja-armado-fondo fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          {...focoRetorno}
          aria-describedby={undefined}
          data-testid="dialogo-hoja-armado-bouquet"
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
            <HojaArmadoBouquet {...hoja} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
