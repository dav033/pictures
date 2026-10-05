"use client";

import { useRef, useState, type ReactNode } from "react";
import { Info, LoaderCircle, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import type { ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import { mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoColumna, type VistaArmadoColumna } from "@/lib/plan/peticion-armado-columna";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { MarcoEdicion } from "../motor/MarcoEdicion";
import { VistaMotor } from "../motor/VistaMotor";
import { colorDe, type ColorLeyenda } from "../patron/leyenda";
import { MuestraNumero } from "../patron/LeyendaPatron";
import { EditorColumna } from "./EditorColumna";
import { RecetaColumna } from "./RecetaColumna";
import { useEditorColumna } from "./usarEditorColumna";
import { useVistaColumna } from "./usarVistaColumna";
import { peticionVistaColumna, type PanelVistaColumna, type PiezaVistaColumna } from "./vista-columna";

/**
 * "Armado de la columna" dentro del detalle de una pieza (ADR-0034, ADR-0035 paso 3): el dibujo que emite el motor
 * del diseñador y, al lado, lo que el motor resolvió y antes no se veía — cuántos globos lleva de cada color y de cada
 * tamaño, el remate, las medidas reales de la columna armada y **los avisos** (el motor dice en español lo que
 * corrigió: «El alto se ajustó a 1,6 m…»).
 *
 * Gemelo de `BloqueArco`, con la misma diferencia respecto de `BloquePatron`: **aquí no se calcula nada**. Este
 * bloque recibe el SVG del mismo motor que colocó los globos y los contó, y lo muestra (`VistaMotor`). Ni geometría,
 * ni conteos, ni totales: lo único que esta pantalla hace con un número es darle formato. A diferencia del arco,
 * tampoco muestra «lo que hay que comprar»: la compra de la pieza la cuenta `plan.py` (ADR-0034 §3) y la columna
 * resuelta no la publica.
 *
 * Solo se monta cuando la pieza trae `armado_columna` (ADR-0034, decisión 3). Sin él la tarjeta se queda con la
 * gráfica de siempre, y eso es lo que hace el cambio reversible: quitar el armado devuelve la pieza al camino viejo
 * sin tocar código.
 *
 * **Editar la columna** (ADR-0035, paso 3). Con `onGuardar`, el encabezado ofrece «Editar columna»: el editor va
 * plegado por defecto para no agrandar la tarjeta y, abierto, el dibujo que se ve es el que el motor hace del
 * borrador (con su pausa, su cancelación y su "gana la última"), no el del plan. Nada se guarda hasta «Guardar
 * columna», que escribe el armado por la edición del plan y deja la propuesta firmada de nuevo.
 */

const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

type Props = {
  /** El armado que trae la pieza en el plan; es lo que se manda al motor. */
  armado: ArmadoColumnaV1;
  /** Sobre qué se pide el dibujo: el plan a la vista, la estructura y sus tonos. */
  pieza: PiezaVistaColumna;
  leyenda: readonly ColorLeyenda[];
  nombrePieza: string;
  /** Cuántas piezas iguales lleva el plan: el motor arma una, y así se dice. */
  repeticiones: number;
  /**
   * Escribe el armado en la propuesta (acción `armado_columna` de la edición del plan); resuelve `null` si quedó
   * guardado o el motivo si no. Sin él, la columna es de solo lectura.
   */
  onGuardar?: (armado: ArmadoColumnaV1) => Promise<string | null>;
  /** Otro ajuste de la propuesta se está guardando: guardar la columna espera. */
  ocupado?: boolean;
};

/**
 * Lo que el panel necesita: un estado ya resuelto y cómo volver a pedir el dibujo. `accion` es el botón del
 * encabezado y `pie` lo que va debajo del dibujo (el editor): el panel no sabe de edición, solo les da sitio.
 */
type PropsPanel = Omit<Props, "armado" | "pieza" | "onGuardar" | "ocupado"> & {
  estado: PanelVistaColumna;
  onReintentar: () => void;
  accion?: ReactNode;
  pie?: ReactNode;
};

const botonReintentar = "ui-button-secondary ui-pressable min-h-11 px-3 py-1.5 text-xs";

/** Marco del dibujo: el lienzo de la columna es más alto que ancho (600 × 720), así que el hueco también. */
const MARCO = "relative h-72 overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset @md:h-auto @md:w-56 @md:min-h-72 @md:shrink-0";

type Vista = Extract<PanelVistaColumna, { fase: "listo" }>["vista"];

/** El nombre del patrón lo escribe el motor (`opciones.patrones`); aquí no hay tabla de nombres. */
function patronDelMotor(vista: Vista): string | null {
  if (vista.armado.modo === "capas") return "Capa por capa";
  return vista.opciones.patrones.find((patron) => patron.id === vista.armado.patron)?.nombre ?? null;
}

/**
 * Lo que lleva de cada color y de cada tamaño, en una tabla: son los globos que el motor colocó, uno por uno. El
 * remate va aparte porque no entra en el conteo del cuerpo.
 */
function MaterialesColumna({ columna, leyenda }: { columna: Vista["columna"]; leyenda: readonly ColorLeyenda[] }) {
  if (!columna.conteo.length) return null;
  return (
    <table data-testid="materiales-armado-columna" className="w-full text-[13px]">
      <caption className="sr-only">Globos por color y tamaño, según el motor</caption>
      <thead>
        <tr className="text-xs text-texto-suave">
          <th scope="col" className="pb-1 text-left font-medium">Color</th>
          <th scope="col" className="pb-1 text-right font-medium">Tamaño</th>
          <th scope="col" className="pb-1 text-right font-medium">Lleva</th>
        </tr>
      </thead>
      <tbody>
        {columna.conteo.map((fila) => {
          const color = colorDe(leyenda, fila.material);
          return (
            <tr key={`${fila.material}-${fila.tamano}`} className="border-t border-borde-suave">
              <th scope="row" className="py-1 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2">
                  <MuestraNumero color={color} tamano="sm" />
                  <span className="min-w-0 truncate text-texto">{color.etiqueta}</span>
                </span>
              </th>
              <td className="py-1 text-right tabular-nums text-texto-suave">R{fila.tamano}</td>
              <td className="py-1 text-right font-semibold tabular-nums text-texto">{entero.format(fila.cantidad)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Coordinación: pide el dibujo del armado de la pieza y lo entrega al panel. Nada más, y por eso el panel
 * (`PanelColumna`) se puede pintar con cada estado sin red, como hacen las pruebas de UI del arco y de la
 * guirnalda con sus bloques.
 */
export function BloqueColumna({ armado, pieza, leyenda, nombrePieza, repeticiones, onGuardar, ocupado = false }: Props) {
  const { estado, reintentar } = useVistaColumna({ pieza, armado });
  // El editor se abre con el dibujo del plan en la mano (trae las herramientas del motor y sus rangos) y sigue
  // abierto aunque el dibujo del plan se vuelva a pedir mientras tanto: el borrador no se pierde por eso.
  const [sesion, setSesion] = useState<{ inicial: VistaArmadoColumna } | null>(null);
  const botonEditar = useRef<HTMLButtonElement | null>(null);
  if (sesion && onGuardar) {
    return (
      <ColumnaEnEdicion
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
      data-testid="editar-columna"
      className="ui-button-secondary ui-pressable shrink-0 min-h-11 px-3.5 py-1.5 text-[13px]"
    >
      <Pencil className="size-3.5" aria-hidden="true" />Editar columna
    </button>
  ) : undefined;
  // Si el armado que trae el plan no se dibuja (el motor lo rechaza o no responde), no hay nada que editar: la salida
  // es volver a la receta, que el motor propone para la pieza, y guardarla.
  const sinDibujo = onGuardar && (estado.fase === "vacio" || estado.fase === "error") ? (
    <RecetaColumna
      deshabilitado={ocupado}
      perdida="La columna vuelve al diseño que el motor propone para esta pieza y se guarda en la propuesta; se pierde el armado actual."
      onReceta={async () => {
        try {
          const receta = await pedirVistaArmadoColumna(peticionVistaColumna(pieza, null));
          return await onGuardar(receta.armado);
        } catch (error) {
          return mensajeFalloPlanArmado(error);
        }
      }}
    />
  ) : undefined;
  return <PanelColumna estado={estado} leyenda={leyenda} nombrePieza={nombrePieza} repeticiones={repeticiones} onReintentar={reintentar} accion={accion} pie={sinDibujo} />;
}

/** La columna abierta para editar: el dibujo es el del borrador y debajo van los ajustes y «Guardar columna». */
function ColumnaEnEdicion({ armado, pieza, inicial, leyenda, nombrePieza, repeticiones, onGuardar, ocupado, onCerrar }: Omit<Props, "onGuardar" | "ocupado"> & {
  inicial: VistaArmadoColumna;
  onGuardar: (armado: ArmadoColumnaV1) => Promise<string | null>;
  ocupado: boolean;
  onCerrar: () => void;
}) {
  const editor = useEditorColumna({ armadoEnPlan: armado, pieza, inicial, onGuardar, ocupado, onCerrar });
  return (
    <PanelColumna
      estado={editor.panel}
      leyenda={leyenda}
      nombrePieza={nombrePieza}
      repeticiones={repeticiones}
      onReintentar={editor.vista.reintentar}
      pie={(
        <EditorColumna
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
          onUsarColumnaDeLaPropuesta={editor.usarColumnaDeLaPropuesta}
          onReceta={editor.pedirReceta}
        />
      )}
    />
  );
}

/** Presentación: lo que se ve en cada estado (cargando, vacío, error y la columna dibujada). */
export function PanelColumna({ estado, leyenda, nombrePieza, repeticiones, onReintentar, accion, pie }: PropsPanel) {
  return (
    <section aria-label="Armado de la columna" data-testid="bloque-armado-columna" data-fase={estado.fase} className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      {estado.fase === "listo" ? (
        <ColumnaDibujada estado={estado} leyenda={leyenda} nombrePieza={nombrePieza} repeticiones={repeticiones} onReintentar={onReintentar} accion={accion} pie={pie} />
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-texto">Armado de la columna</p>
          {estado.fase === "cargando" ? (
            <p role="status" className="brillo-carga flex items-center gap-1.5 rounded-xl bg-superficie px-3 py-6 text-center text-xs text-texto-suave">
              <LoaderCircle className="size-3.5 animate-spin text-acento" aria-hidden="true" />
              Armando la columna globo por globo…
            </p>
          ) : estado.fase === "vacio" ? (
            // El motor no puede armar el armado que trae el plan: reintentar daría lo mismo y su frase dice qué pasa.
            <p role="status" data-testid="columna-sin-dibujo" className="flex items-start gap-2 rounded-xl bg-aviso-suave px-3 py-2 text-xs font-medium text-aviso">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{estado.mensaje}</span>
            </p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{estado.mensaje}</span>
              <button type="button" onClick={onReintentar} data-testid="reintentar-armado-columna" className={botonReintentar}>
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

/** La columna con su dibujo al lado de lo que el motor resolvió. */
function ColumnaDibujada({ estado, leyenda, nombrePieza, repeticiones, onReintentar, accion, pie }: {
  estado: Extract<PanelVistaColumna, { fase: "listo" }>;
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
  const { columna, grafica } = vista;
  const patron = patronDelMotor(vista);
  // Las medidas reales de la columna armada, no las declaradas: el motor ajusta lo que no cabe y lo cuenta en `avisos`.
  const medidas: Array<{ termino: string; valor: string }> = [
    { termino: "Alto total", valor: metrosCliente(columna.alto_total_m) },
    { termino: "Alto del cuerpo", valor: metrosCliente(columna.alto_cuerpo_m) },
    { termino: "Ancho", valor: metrosCliente(columna.diametro_m) },
    { termino: "Capas", valor: entero.format(columna.capas) },
  ];
  return (
    <MarcoEdicion editor={pie}>
    <div aria-busy={actualizando} className="flex flex-col gap-3 @md:flex-row">
      <div className={`${MARCO} ${tenue}`}>
        <VistaMotor
          svg={grafica.svg}
          lienzo={grafica.lienzo.ancho}
          alto={grafica.lienzo.alto}
          etiqueta={`${nombrePieza}: columna de ${metrosCliente(columna.alto_total_m)} de alto${patron ? `, patrón ${patron.toLowerCase()}` : ""}, dibujada por el motor`}
          className="absolute inset-0 size-full p-1.5"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 self-center">
            <p className="text-[13px] font-semibold text-texto">Armado de la columna</p>
            {patron && <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">{patron}</span>}
            <span aria-live="polite" className="inline-flex items-center gap-1 text-[11px] font-medium text-texto-suave">
              {actualizando && <><LoaderCircle className="size-3 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />Actualizando…</>}
              {vencido && "Es el último dibujo que llegó."}
            </span>
          </div>
          {accion}
        </div>
        <div className={`space-y-2.5 ${tenue}`}>
          <dl data-testid="medidas-armado-columna" className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs @sm:grid-cols-2">
            {medidas.map((medida) => (
              <div key={medida.termino} className="flex min-w-0 gap-1.5">
                <dt className="shrink-0 font-semibold text-texto">{medida.termino}:</dt>
                <dd className="min-w-0 text-texto-suave">{medida.valor}</dd>
              </div>
            ))}
          </dl>
          <MaterialesColumna columna={columna} leyenda={leyenda} />
          <p data-testid="remate-armado-columna" className="text-xs text-texto-suave">
            <span className="font-semibold text-texto">Remate:</span> {columna.remate.descripcion}
            {columna.remate.globos.length > 0 && (
              <>
                {" · "}
                {columna.remate.globos.map((globo) => `${entero.format(globo.cantidad)} de R${globo.tamano} (${colorDe(leyenda, globo.material).etiqueta})`).join(", ")}
              </>
            )}
            {columna.remate.foil && <> · {columna.remate.foil}</>}
          </p>
          {repeticiones > 1 && (
            <p className="text-[11px] text-texto-suave">Las cifras son de una sola columna; el plan lleva {repeticiones} iguales.</p>
          )}
          {/* Siempre montada: un lector de pantalla solo anuncia lo que cambia dentro de una región que ya existía. */}
          <div aria-live="polite" aria-relevant="additions text" data-testid="avisos-vivos-armado-columna">
            {columna.avisos.length > 0 && (
              <ul aria-label="Avisos del armado" data-testid="avisos-armado-columna" className="space-y-0.5 text-xs text-texto-suave">
                {columna.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
              </ul>
            )}
          </div>
        </div>
        {fallo && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{fallo} El dibujo es el último que llegó.</span>
            <button type="button" onClick={onReintentar} data-testid="reintentar-armado-columna" className={botonReintentar}>
              <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
    </MarcoEdicion>
  );
}
