"use client";

import { useRef, useState, type ReactNode } from "react";
import { Info, LoaderCircle, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoGuirnaldaOrganica, type VistaArmadoGuirnaldaOrganica } from "@/lib/plan/peticion-armado-guirnalda-organica";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { RecetaArco } from "../arco/RecetaArco";
import { MarcoEdicion } from "../motor/MarcoEdicion";
import { VistaMotor } from "../motor/VistaMotor";
import { colorDe, type ColorLeyenda } from "../patron/leyenda";
import { MuestraNumero } from "../patron/LeyendaPatron";
import { EditorGuirnaldaOrganica } from "./EditorGuirnaldaOrganica";
import { useEditorGuirnaldaOrganica } from "./usarEditorGuirnaldaOrganica";
import { useVistaGuirnaldaOrganica } from "./usarVistaGuirnaldaOrganica";
import { peticionVistaGuirnaldaOrganica, type PanelVistaGuirnaldaOrganica, type PiezaVistaGuirnaldaOrganica } from "./vista-guirnalda-organica";
import { RESERVA_CLIENTE, useVozCliente } from "../motor/voz-editor";

/**
 * "Armado de la guirnalda" dentro del detalle de una pieza (ADR-0034): el dibujo que emite el motor del
 * diseñador y, debajo, lo que el motor resolvió y antes no se veía — cuántos globos lleva de cada color y de
 * cada tamaño, cuántos hay que comprar, las medidas reales de la tira armada, los adornos que no son globos y
 * **los avisos** (el motor dice en español lo que corrigió).
 *
 * Gemelo de `BloqueArco`, con la misma regla que es el motivo de todo: **aquí no se calcula nada**. El bloque
 * recibe el SVG del mismo motor que colocó y contó los globos, y lo muestra (`VistaMotor`). Ni geometría, ni
 * conteos, ni totales: lo único que esta pantalla hace con un número es darle formato.
 *
 * Con una diferencia de forma: el lienzo de la guirnalda es apaisado (760 × 440), así que el dibujo va arriba a
 * todo el ancho y el detalle debajo, y no uno al lado del otro como en el arco.
 *
 * **No es el bloque de `BloqueGuirnalda`** (ADR-0032: racimos, relleno y remates). Cuando una pieza trae los dos
 * armados, manda este: es el que coloca los globos de verdad. Solo se monta cuando la pieza trae
 * `armado_guirnalda_organica` (ADR-0034, decisión 3): sin él la tarjeta se queda como antes, y eso es lo que
 * hace el cambio reversible.
 *
 * **Editar la guirnalda** (ADR-0035, paso 3). Con `onGuardar`, el encabezado ofrece «Editar guirnalda»: el editor va
 * plegado por defecto para no agrandar la tarjeta y, abierto, el dibujo que se ve es el que el motor hace del
 * borrador (con su pausa, su cancelación y su "gana la última"), no el del plan. Nada se guarda hasta «Guardar
 * guirnalda», que escribe el armado por la edición del plan y deja la propuesta firmada de nuevo.
 */

const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const conDecimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

type Props = {
  /** El armado que trae la pieza en el plan; es lo que se manda al motor. */
  armado: ArmadoGuirnaldaOrganicaV1;
  /** Sobre qué se pide el dibujo: el plan a la vista, la estructura y sus tonos. */
  pieza: PiezaVistaGuirnaldaOrganica;
  leyenda: readonly ColorLeyenda[];
  nombrePieza: string;
  /** Cuántas piezas iguales lleva el plan: el motor arma una, y así se dice. */
  repeticiones: number;
  /**
   * Escribe el armado en la propuesta (acción `armado_guirnalda_organica` de la edición del plan); resuelve `null`
   * si quedó guardado o el motivo si no. Sin él, la guirnalda es de solo lectura.
   */
  onGuardar?: (armado: ArmadoGuirnaldaOrganicaV1) => Promise<string | null>;
  /** Otro ajuste de la propuesta se está guardando: guardar la guirnalda espera. */
  ocupado?: boolean;
};

/**
 * Lo que el panel necesita: un estado ya resuelto y cómo volver a pedir el dibujo. `accion` es el botón del
 * encabezado y `pie` lo que va debajo del dibujo (el editor): el panel no sabe de edición, solo les da sitio.
 */
type PropsPanel = Omit<Props, "armado" | "pieza" | "onGuardar" | "ocupado"> & {
  estado: PanelVistaGuirnaldaOrganica;
  onReintentar: () => void;
  accion?: ReactNode;
  pie?: ReactNode;
};

const botonReintentar = "ui-button-secondary ui-pressable min-h-11 px-3 py-1.5 text-xs";

type Listo = Extract<PanelVistaGuirnaldaOrganica, { fase: "listo" }>;

/** «5″: 14 · 12″: 19»: lo que lleva de cada tamaño, tal como lo contó el motor (la clave es la pulgada). */
function porTamano(cantidades: Readonly<Record<string, number | undefined>>): string {
  return Object.entries(cantidades)
    .filter((par): par is [string, number] => typeof par[1] === "number")
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([pulgadas, cantidad]) => `${pulgadas}″: ${entero.format(cantidad)}`)
    .join(" · ");
}

/**
 * Lo que lleva de cada color y lo que hay que comprar, en una tabla: son dos cifras por material y el
 * decorador las compara. `compra` ya trae las dos (`cantidad` y `comprar`, con el desperdicio que aplicó
 * Python) y cuántos lleva de cada tamaño; sin ella se muestra solo el conteo, sin inventar la compra.
 */
function MaterialesGuirnalda({ guirnalda, leyenda }: { guirnalda: Listo["vista"]["guirnalda"]; leyenda: readonly ColorLeyenda[] }) {
  // En la guiada, UNA cifra: la que lleva la pieza (la de Python); la reserva de compra se explica en una línea.
  const cliente = useVozCliente();
  const filas: Array<{ material: number; cantidad: number; comprar: number | null; tamanos: string }> = guirnalda.compra.length
    ? guirnalda.compra.map((linea) => ({ material: linea.material, cantidad: linea.cantidad, comprar: linea.comprar, tamanos: porTamano(linea.por_tamano) }))
    : [...guirnalda.conteo.reduce((por, linea) => por.set(linea.material, (por.get(linea.material) ?? 0) + linea.cantidad), new Map<number, number>())].map(
      ([material, cantidad]) => ({ material, cantidad, comprar: null, tamanos: "" }),
    );
  if (!filas.length) return null;
  return (
    <table data-testid="materiales-armado-guirnalda-organica" className="w-full text-[13px]">
      <caption className="sr-only">{cliente ? "Globos por color" : "Globos por color y lo que hay que comprar, según el motor"}</caption>
      <thead>
        <tr className="text-xs text-texto-suave">
          <th scope="col" className="pb-1 text-left font-medium">Color</th>
          <th scope="col" className="pb-1 pl-3 text-right font-medium">{cliente ? "Globos" : "Lleva"}</th>
          {!cliente && <th scope="col" className="pb-1 pl-3 text-right font-medium">Comprar</th>}
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
                  <span className="min-w-0">
                    <span className="block truncate text-texto">{color.etiqueta}</span>
                    {fila.tamanos && <span className="block text-[11px] tabular-nums text-texto-suave">{fila.tamanos}</span>}
                  </span>
                </span>
              </th>
              <td className="py-1 pl-3 text-right tabular-nums text-texto">{entero.format(fila.cantidad)}</td>
              {!cliente && <td className="py-1 pl-3 text-right font-semibold tabular-nums text-texto">{fila.comprar === null ? "—" : entero.format(fila.comprar)}</td>}
            </tr>
          );
        })}
      </tbody>
      {guirnalda.total_comprar > 0 && (
        <tfoot>
          <tr className="border-t border-borde">
            {cliente ? (
              <><th scope="row" className="py-1 text-left text-xs font-semibold text-texto">Total</th><td className="py-1 pl-3 text-right font-semibold tabular-nums text-texto">{entero.format(filas.reduce((suma, fila) => suma + fila.cantidad, 0))}</td></>
            ) : (
              <><th scope="row" colSpan={2} className="py-1 text-left text-xs font-semibold text-texto">Total a comprar</th>
            <td className="py-1 pl-3 text-right font-semibold tabular-nums text-texto">{entero.format(guirnalda.total_comprar)}</td></>
            )}
          </tr>
          {cliente && <tr><td colSpan={2} className="pt-1 text-[11px] leading-snug text-texto-suave">{RESERVA_CLIENTE}</td></tr>}
        </tfoot>
      )}
    </table>
  );
}

/**
 * Coordinación: pide el dibujo del armado de la pieza y lo entrega al panel. Nada más, y por eso el panel
 * (`PanelGuirnaldaOrganica`) se puede pintar con cada estado sin red, como hacen las pruebas de UI del arco, del
 * patrón y de la guirnalda con sus bloques.
 */
export function BloqueGuirnaldaOrganica({ armado, pieza, leyenda, nombrePieza, repeticiones, onGuardar, ocupado = false }: Props) {
  const { estado, reintentar } = useVistaGuirnaldaOrganica({ pieza, armado });
  // El editor se abre con el dibujo del plan en la mano (trae las herramientas del motor y sus rangos) y sigue
  // abierto aunque el dibujo del plan se vuelva a pedir mientras tanto: el borrador no se pierde por eso.
  const [sesion, setSesion] = useState<{ inicial: VistaArmadoGuirnaldaOrganica } | null>(null);
  const botonEditar = useRef<HTMLButtonElement | null>(null);
  if (sesion && onGuardar) {
    return (
      <GuirnaldaEnEdicion
        armado={armado}
        pieza={pieza}
        inicial={sesion.inicial}
        leyenda={leyenda}
        nombrePieza={nombrePieza}
        repeticiones={repeticiones}
        onGuardar={onGuardar}
        ocupado={ocupado}
        onCerrar={() => {
          setSesion(null);
          // El botón vuelve a existir en el render siguiente: el foco regresa a donde estaba el decorador.
          window.requestAnimationFrame(() => botonEditar.current?.focus());
        }}
      />
    );
  }
  const accion = onGuardar && estado.fase === "listo" ? (
    <button
      ref={botonEditar}
      type="button"
      onClick={() => setSesion({ inicial: estado.vista })}
      data-testid="editar-guirnalda-organica"
      className="ui-button-secondary ui-pressable min-h-11 shrink-0 px-3.5 py-1.5 text-[13px]"
    >
      <Pencil className="size-3.5" aria-hidden="true" />Editar guirnalda
    </button>
  ) : undefined;
  // Si el armado que trae el plan no se dibuja (el motor lo rechaza o no responde), no hay nada que editar: la salida
  // es volver a la receta, que el motor propone para la pieza, y guardarla.
  const sinDibujo = onGuardar && (estado.fase === "vacio" || estado.fase === "error") ? (
    <RecetaArco
      deshabilitado={ocupado}
      perdida="La guirnalda vuelve al diseño que el motor propone para esta pieza y se guarda en la propuesta; se pierde el armado actual."
      onReceta={async () => {
        try {
          const receta = await pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(pieza, null));
          return await onGuardar(receta.armado);
        } catch (error) {
          return mensajeFalloPlanArmado(error);
        }
      }}
    />
  ) : undefined;
  return <PanelGuirnaldaOrganica estado={estado} leyenda={leyenda} nombrePieza={nombrePieza} repeticiones={repeticiones} onReintentar={reintentar} accion={accion} pie={sinDibujo} />;
}

/** La guirnalda abierta para editar: el dibujo es el del borrador y debajo van los ajustes y «Guardar guirnalda». */
function GuirnaldaEnEdicion({ armado, pieza, inicial, leyenda, nombrePieza, repeticiones, onGuardar, ocupado, onCerrar }: Omit<Props, "onGuardar" | "ocupado"> & {
  inicial: VistaArmadoGuirnaldaOrganica;
  onGuardar: (armado: ArmadoGuirnaldaOrganicaV1) => Promise<string | null>;
  ocupado: boolean;
  onCerrar: () => void;
}) {
  const editor = useEditorGuirnaldaOrganica({ armadoEnPlan: armado, pieza, inicial, onGuardar, ocupado, onCerrar });
  return (
    <PanelGuirnaldaOrganica
      estado={editor.panel}
      leyenda={leyenda}
      nombrePieza={nombrePieza}
      repeticiones={repeticiones}
      onReintentar={editor.vista.reintentar}
      pie={(
        <EditorGuirnaldaOrganica
          borrador={editor.borrador}
          vista={editor.vista}
          leyenda={leyenda}
          guardar={editor.guardar}
          guardando={editor.guardando}
          errorGuardado={editor.errorGuardado}
          planCambio={editor.planCambio}
          coloresCambiaron={editor.coloresCambiaron}
          hayCambios={editor.hayCambios}
          onCambiar={editor.cambiar}
          onGuardar={editor.pedirGuardar}
          onDescartar={editor.descartar}
          onRestablecer={editor.restablecer}
          onReintentar={editor.vista.reintentar}
          onSeguirConMiBorrador={editor.seguirConMiBorrador}
          onUsarGuirnaldaDeLaPropuesta={editor.usarGuirnaldaDeLaPropuesta}
          onReceta={editor.pedirReceta}
        />
      )}
    />
  );
}

/** Presentación: lo que se ve en cada estado (cargando, vacío, error y la guirnalda dibujada). */
export function PanelGuirnaldaOrganica({ estado, leyenda, nombrePieza, repeticiones, onReintentar, accion, pie }: PropsPanel) {
  return (
    <section aria-label="Armado de la guirnalda" data-testid="bloque-armado-guirnalda-organica" data-fase={estado.fase} className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      {estado.fase === "listo" ? (
        <GuirnaldaDibujada estado={estado} leyenda={leyenda} nombrePieza={nombrePieza} repeticiones={repeticiones} onReintentar={onReintentar} accion={accion} pie={pie} />
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-texto">Armado de la guirnalda</p>
          {estado.fase === "cargando" ? (
            <p role="status" className="brillo-carga flex items-center gap-1.5 rounded-xl bg-superficie px-3 py-6 text-center text-xs text-texto-suave">
              <LoaderCircle className="size-3.5 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />
              Armando la guirnalda globo por globo…
            </p>
          ) : estado.fase === "vacio" ? (
            // El motor no puede armar el armado que trae el plan: reintentar daría lo mismo y su frase dice qué pasa.
            <p role="status" data-testid="guirnalda-organica-sin-dibujo" className="flex items-start gap-2 rounded-xl bg-aviso-suave px-3 py-2 text-xs font-medium text-aviso">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{estado.mensaje}</span>
            </p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{estado.mensaje}</span>
              <button type="button" onClick={onReintentar} data-testid="reintentar-armado-guirnalda-organica" className={botonReintentar}>
                <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
              </button>
            </div>
          )}
          {pie}
        </div>
      )}
    </section>
  );
}

/** La guirnalda con su dibujo y, debajo, lo que el motor resolvió. */
function GuirnaldaDibujada({ estado, leyenda, nombrePieza, repeticiones, onReintentar, accion, pie }: {
  estado: Listo;
  leyenda: readonly ColorLeyenda[];
  nombrePieza: string;
  repeticiones: number;
  onReintentar: () => void;
  accion?: ReactNode;
  pie?: ReactNode;
}) {
  const { vista, actualizando, fallo, vencido = false } = estado;
  // Un dibujo que no es el del armado a la vista (el nuevo está en camino o no se pudo dibujar) se ve apagado:
  // sus cifras tampoco son las de ese armado, y no tienen que pasar por vigentes.
  const tenue = actualizando || vencido ? "opacity-60 transition-opacity motion-reduce:transition-none" : "";
  const { guirnalda, grafica } = vista;
  // Las medidas reales de la guirnalda armada, no las declaradas: el motor ajusta lo que no cabe y lo cuenta en `avisos`.
  const cliente = useVozCliente();
  const medidas: Array<{ termino: string; valor: string }> = [
    { termino: "Largo", valor: metrosCliente(guirnalda.largo_m) },
    { termino: "Alto", valor: metrosCliente(guirnalda.alto_m) },
    { termino: "Grosor en los extremos", valor: metrosCliente(guirnalda.grosor_extremos_m) },
    { termino: "Grosor en el centro", valor: metrosCliente(guirnalda.grosor_centro_m) },
    ...(cliente ? [] : [{ termino: "Globos por metro", valor: conDecimal.format(guirnalda.globos_por_metro) }]),
  ];
  const { ramas, flores } = guirnalda.adornos;
  return (
    <MarcoEdicion editor={pie}>
      <div aria-busy={actualizando} className="space-y-3">
        <div
          className={`relative w-full overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset ${tenue}`}
          // El lienzo del motor no es cuadrado: el marco toma su proporción para que el dibujo no quede con bandas.
          style={{ aspectRatio: `${grafica.ancho} / ${grafica.alto}` }}
        >
          <VistaMotor
            svg={grafica.svg}
            lienzo={grafica.ancho}
            alto={grafica.alto}
            etiqueta={`${nombrePieza}: guirnalda de ${metrosCliente(guirnalda.largo_m)} de largo, dibujada por el motor`}
            className="absolute inset-0 size-full p-1.5"
          />
        </div>
        <div className="min-w-0 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 self-center">
              <p className="text-[13px] font-semibold text-texto">{cliente ? "Así queda" : `Armado de la guirnalda`}</p>
              <span aria-live="polite" className="inline-flex items-center gap-1 text-[11px] font-medium text-texto-suave">
                {actualizando && <><LoaderCircle className="size-3 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />Actualizando…</>}
                {vencido && "Es el último dibujo que llegó."}
              </span>
            </div>
            {accion}
          </div>
          <div className={`space-y-2.5 ${tenue}`}>
            <dl data-testid="medidas-armado-guirnalda-organica" className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs @sm:grid-cols-2">
              {medidas.map((medida) => (
                <div key={medida.termino} className="flex min-w-0 gap-1.5">
                  <dt className="shrink-0 font-semibold text-texto">{medida.termino}:</dt>
                  <dd className="min-w-0 text-texto-suave">{medida.valor}</dd>
                </div>
              ))}
            </dl>
            <MaterialesGuirnalda guirnalda={guirnalda} leyenda={leyenda} />
            {(ramas > 0 || flores > 0) && (
              <p data-testid="adornos-armado-guirnalda-organica" className="text-xs text-texto-suave">
                Además lleva {[ramas > 0 ? `${entero.format(ramas)} ${ramas === 1 ? "rama de follaje" : "ramas de follaje"}` : null, flores > 0 ? `${entero.format(flores)} ${flores === 1 ? "flor" : "flores"}` : null].filter(Boolean).join(" y ")}: no son globos y no están en esta compra.
              </p>
            )}
            {guirnalda.sueltos > 0 && (
              <p role="status" className="flex items-start gap-1.5 text-xs font-medium text-aviso">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {guirnalda.sueltos === 1 ? "Un globo queda sin tocar a otro." : `${entero.format(guirnalda.sueltos)} globos quedan sin tocar a otro.`}
              </p>
            )}
            {repeticiones > 1 && (
              <p className="text-[11px] text-texto-suave">Las cifras son de una sola guirnalda; el plan lleva {repeticiones} iguales.</p>
            )}
            {/* Siempre montada: un lector de pantalla solo anuncia lo que cambia dentro de una región que ya existía. */}
            <div aria-live="polite" aria-relevant="additions text" data-testid="avisos-vivos-armado-guirnalda-organica">
              {guirnalda.avisos.length > 0 && (
                <ul aria-label="Avisos del armado" data-testid="avisos-armado-guirnalda-organica" className="space-y-0.5 text-xs text-texto-suave">
                  {guirnalda.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
                </ul>
              )}
            </div>
          </div>
          {fallo && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{fallo} El dibujo es el último que llegó.</span>
              <button type="button" onClick={onReintentar} data-testid="reintentar-armado-guirnalda-organica" className={botonReintentar}>
                <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
              </button>
            </div>
          )}
        </div>
      </div>
    </MarcoEdicion>
  );
}
