"use client";

import { Info, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import type { ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { VistaMotor } from "../motor/VistaMotor";
import { colorDe, type ColorLeyenda } from "../patron/leyenda";
import { MuestraNumero } from "../patron/LeyendaPatron";
import { useVistaArco } from "./usarVistaArco";
import type { PanelVistaArco, PiezaVistaArco } from "./vista-arco";

/**
 * "Armado del arco" dentro del detalle de una pieza (ADR-0034): el dibujo que emite el motor del diseñador y,
 * al lado, lo que el motor resolvió y antes no se veía — cuántos globos lleva de cada color, cuántos hay que
 * comprar, las medidas reales del arco armado y **los avisos** (el motor dice en español lo que corrigió:
 * «El alto se ajustó a 2,4 m…»).
 *
 * Hermano de `BloquePatron` y de `BloqueGuirnalda`, con una diferencia que es el motivo de todo:
 * **aquí no se calcula nada**. `BloquePatron` recibe una matriz de índices y vuelve a decidir en el navegador
 * dónde va cada globo; este bloque recibe el SVG del mismo motor que los colocó y los contó, y lo muestra
 * (`VistaMotor`). Ni geometría, ni conteos, ni totales: lo único que esta pantalla hace con un número es
 * darle formato.
 *
 * Solo se monta cuando la pieza trae `armado_arco` (ADR-0034, decisión 3). Sin él la tarjeta se queda con la
 * gráfica de siempre, y eso es lo que hace el cambio reversible: quitar el armado devuelve la pieza al camino
 * viejo sin tocar código.
 */

const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const conDecimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

type Props = {
  /** El armado que trae la pieza en el plan; es lo que se manda al motor. */
  armado: ArmadoArcoV1;
  /** Sobre qué se pide el dibujo: el plan a la vista, la estructura y sus tonos. */
  pieza: PiezaVistaArco;
  leyenda: readonly ColorLeyenda[];
  nombrePieza: string;
  /** Cuántas piezas iguales lleva el plan: el motor arma una, y así se dice. */
  repeticiones: number;
};

/** Lo que el panel necesita: un estado ya resuelto y cómo volver a pedir el dibujo. */
type PropsPanel = Omit<Props, "armado" | "pieza"> & { estado: PanelVistaArco; onReintentar: () => void };

const botonReintentar = "ui-button-secondary ui-pressable min-h-9 px-3 py-1.5 text-xs";

/** Marco del dibujo: el lienzo del motor es cuadrado, así que el hueco también. */
const MARCO = "relative h-64 overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset @md:h-auto @md:w-64 @md:min-h-64 @md:shrink-0";

/** El nombre y la frase del patrón los escribe el motor (`opciones.patrones`); aquí no hay tabla de nombres. */
function patronDelMotor(vista: Extract<PanelVistaArco, { fase: "listo" }>["vista"]): { nombre: string; descripcion: string } | null {
  const descrito = vista.opciones.patrones.find((patron) => patron.id === vista.armado.patron);
  return descrito ? { nombre: descrito.nombre, descripcion: descrito.descripcion } : null;
}

/**
 * Lo que lleva de cada color y lo que hay que comprar, en una tabla: son dos cifras por material y el
 * decorador las compara. `compra` ya trae las dos (`cantidad` y `comprar`, con el desperdicio que aplicó
 * Python); sin ella se muestra solo el conteo, sin inventar la compra.
 */
function MaterialesArco({ arco, leyenda }: { arco: Extract<PanelVistaArco, { fase: "listo" }>["vista"]["arco"]; leyenda: readonly ColorLeyenda[] }) {
  const filas: Array<{ material: number; cantidad: number; comprar: number | null }> = arco.compra.length
    ? arco.compra.map((linea) => ({ material: linea.material, cantidad: linea.cantidad, comprar: linea.comprar }))
    : arco.conteo.map((linea) => ({ material: linea.material, cantidad: linea.cantidad, comprar: null }));
  if (!filas.length) return null;
  return (
    <table data-testid="materiales-armado-arco" className="w-full text-[13px]">
      <caption className="sr-only">Globos por color y lo que hay que comprar, según el motor</caption>
      <thead>
        <tr className="text-xs text-texto-suave">
          <th scope="col" className="pb-1 text-left font-medium">Color</th>
          <th scope="col" className="pb-1 text-right font-medium">Lleva</th>
          <th scope="col" className="pb-1 text-right font-medium">Comprar</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => {
          const color = colorDe(leyenda, fila.material);
          return (
            <tr key={fila.material} className="border-t border-borde-suave">
              <th scope="row" className="py-1 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2">
                  <MuestraNumero color={color} tamano="sm" />
                  <span className="min-w-0 truncate text-texto">{color.etiqueta}</span>
                </span>
              </th>
              <td className="py-1 text-right tabular-nums text-texto">{entero.format(fila.cantidad)}</td>
              <td className="py-1 text-right font-semibold tabular-nums text-texto">{fila.comprar === null ? "—" : entero.format(fila.comprar)}</td>
            </tr>
          );
        })}
      </tbody>
      {arco.total_comprar > 0 && (
        <tfoot>
          <tr className="border-t border-borde">
            <th scope="row" colSpan={2} className="py-1 text-left text-xs font-semibold text-texto">Total a comprar</th>
            <td className="py-1 text-right font-semibold tabular-nums text-texto">{entero.format(arco.total_comprar)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/**
 * Coordinación: pide el dibujo del armado de la pieza y lo entrega al panel. Nada más, y por eso el panel
 * (`PanelArco`) se puede pintar con cada estado sin red, como hacen las pruebas de UI del patrón y de la
 * guirnalda con sus bloques.
 */
export function BloqueArco({ armado, pieza, leyenda, nombrePieza, repeticiones }: Props) {
  const { estado, reintentar } = useVistaArco({ pieza, armado });
  return <PanelArco estado={estado} leyenda={leyenda} nombrePieza={nombrePieza} repeticiones={repeticiones} onReintentar={reintentar} />;
}

/** Presentación: lo que se ve en cada estado (cargando, vacío, error y el arco dibujado). */
export function PanelArco({ estado, leyenda, nombrePieza, repeticiones, onReintentar }: PropsPanel) {
  return (
    <section aria-label="Armado del arco" data-testid="bloque-armado-arco" data-fase={estado.fase} className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      {estado.fase === "listo" ? (
        <ArcoDibujado estado={estado} leyenda={leyenda} nombrePieza={nombrePieza} repeticiones={repeticiones} onReintentar={onReintentar} />
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-texto">Armado del arco</p>
          {estado.fase === "cargando" ? (
            <p role="status" className="brillo-carga flex items-center gap-1.5 rounded-xl bg-superficie px-3 py-6 text-center text-xs text-texto-suave">
              <LoaderCircle className="size-3.5 animate-spin text-acento" aria-hidden="true" />
              Armando el arco globo por globo…
            </p>
          ) : estado.fase === "vacio" ? (
            // El motor no puede armar el armado que trae el plan: reintentar daría lo mismo y su frase dice qué pasa.
            <p role="status" data-testid="arco-sin-dibujo" className="flex items-start gap-2 rounded-xl bg-aviso-suave px-3 py-2 text-xs font-medium text-aviso">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{estado.mensaje}</span>
            </p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{estado.mensaje}</span>
              <button type="button" onClick={onReintentar} data-testid="reintentar-armado-arco" className={botonReintentar}>
                <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** El arco con su dibujo al lado de lo que el motor resolvió. */
function ArcoDibujado({ estado, leyenda, nombrePieza, repeticiones, onReintentar }: {
  estado: Extract<PanelVistaArco, { fase: "listo" }>;
  leyenda: readonly ColorLeyenda[];
  nombrePieza: string;
  repeticiones: number;
  onReintentar: () => void;
}) {
  const { vista, actualizando, fallo } = estado;
  const { arco, grafica } = vista;
  const patron = patronDelMotor(vista);
  // Las medidas reales del arco armado, no las declaradas: el motor ajusta lo que no cabe y lo cuenta en `avisos`.
  const medidas: Array<{ termino: string; valor: string }> = [
    { termino: "Ancho", valor: metrosCliente(arco.ancho_m) },
    { termino: "Alto", valor: metrosCliente(arco.alto_m) },
    { termino: "Grosor de la banda", valor: metrosCliente(arco.grosor_m) },
    { termino: "Línea guía", valor: metrosCliente(arco.largo_m) },
    { termino: "Globos por metro", valor: conDecimal.format(arco.globos_por_metro) },
  ];
  return (
    <div className="flex flex-col gap-3 @md:flex-row">
      <div className={MARCO}>
        <VistaMotor
          svg={grafica.svg}
          lienzo={grafica.lienzo}
          etiqueta={`${nombrePieza}: arco de ${metrosCliente(arco.ancho_m)} por ${metrosCliente(arco.alto_m)}${patron ? `, patrón ${patron.nombre.toLowerCase()}` : ""}, dibujado por el motor`}
          className="absolute inset-0 size-full p-1.5"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13px] font-semibold text-texto">Armado del arco</p>
          {patron && <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">{patron.nombre}</span>}
          <span aria-live="polite" className="inline-flex items-center gap-1 text-[11px] font-medium text-texto-suave">
            {actualizando && <><LoaderCircle className="size-3 animate-spin text-acento" aria-hidden="true" />Actualizando…</>}
          </span>
        </div>
        {patron && <p className="text-[13px] leading-relaxed text-texto-suave">{patron.descripcion}</p>}
        <dl data-testid="medidas-armado-arco" className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs @sm:grid-cols-2">
          {medidas.map((medida) => (
            <div key={medida.termino} className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 font-semibold text-texto">{medida.termino}:</dt>
              <dd className="min-w-0 text-texto-suave">{medida.valor}</dd>
            </div>
          ))}
        </dl>
        <MaterialesArco arco={arco} leyenda={leyenda} />
        {repeticiones > 1 && (
          <p className="text-[11px] text-texto-suave">Las cifras son de un solo arco; el plan lleva {repeticiones} iguales.</p>
        )}
        {arco.avisos.length > 0 && (
          <ul aria-label="Avisos del armado" data-testid="avisos-armado-arco" className="space-y-0.5 text-xs text-texto-suave">
            {arco.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
          </ul>
        )}
        {fallo && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{fallo} El dibujo es el último que llegó.</span>
            <button type="button" onClick={onReintentar} data-testid="reintentar-armado-arco" className={botonReintentar}>
              <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
