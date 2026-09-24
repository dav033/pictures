"use client";

import { Eraser, Eye, Grid3x3, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import type { PatronColor, PatronColorResuelto, PintadoPatronColor } from "@/lib/plan/patron-color";
import { colorDe, type ColorLeyenda } from "./leyenda";
import { LeyendaPatron, MuestraNumero } from "./LeyendaPatron";
import { GraficaPatron, type Pincel } from "./GraficaPatron";
import { VistaPatron } from "./VistaPatron";
import { ResumenPatron } from "./ResumenPatron";
import { Segmentado } from "./controles-comunes";
import type { ErrorVista } from "./usarVistaPrevia";

export type ModoVistaPatron = "vista" | "grafica";

/** De dónde viene el borrador: la sugerencia de Python o la foto se dicen; lo del decorador no. */
function etiquetaOrigen(origen: PatronColor["origen"] | undefined): string {
  if (origen === "sugerido") return " · sugerido";
  if (origen === "referencia") return " · de tu foto";
  return "";
}

type PropsLienzo = {
  vista: PatronColorResuelto | null;
  /** Origen del borrador en edición (no el de la vista, que puede venir de una petición anterior). */
  origen?: PatronColor["origen"];
  /** Celdas a dibujar: las de la vista con la pintura optimista encima. */
  celdas: readonly (readonly number[])[] | null;
  leyenda: readonly ColorLeyenda[];
  tipo: string;
  oficialId?: string;
  espejo: boolean;
  proporcion?: number;
  nombrePieza: string;
  modo: ModoVistaPatron;
  onModo: (modo: ModoVistaPatron) => void;
  pincel: Pincel;
  onPincel: (pincel: Pincel) => void;
  pintados: readonly PintadoPatronColor[];
  onPintar: (pintado: PintadoPatronColor) => void;
  onBorrarPintados: () => void;
  cargando: boolean;
  error: ErrorVista | null;
  onReintentar: () => void;
  deshabilitado?: boolean;
};

/**
 * La vista grande del editor: pseudo-3D o gráfica numerada con pincel. Mientras
 * llega otra vista previa se conserva el último dibujo de Python.
 */
export function LienzoPatron(props: PropsLienzo) {
  const { vista, origen, celdas, leyenda, tipo, oficialId, espejo, proporcion, nombrePieza, modo, onModo, pincel, onPincel, pintados, onPintar, onBorrarPintados, cargando, error, onReintentar, deshabilitado = false } = props;
  const unidad = vista?.geometria === "rejilla" ? "fila" : "racimo";
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmentado
          etiqueta="Cómo ver el patrón"
          valor={modo}
          onCambiar={onModo}
          opciones={[
            { valor: "vista", etiqueta: "Vista", icono: <Eye className="size-3.5" aria-hidden="true" /> },
            { valor: "grafica", etiqueta: "Gráfica", icono: <Grid3x3 className="size-3.5" aria-hidden="true" /> },
          ]}
        />
        <p aria-live="polite" className="inline-flex min-h-6 items-center gap-1.5 text-xs text-texto-suave">
          {cargando ? (
            <><LoaderCircle className="size-3.5 animate-spin text-acento" aria-hidden="true" />Actualizando…</>
          ) : error?.patronInvalido ? (
            // El dibujo es el último válido; el nombre de ese patrón confundiría con el borrador rechazado.
            <span className="inline-flex items-center gap-1 rounded-full bg-aviso-suave px-2.5 py-0.5 font-semibold text-aviso"><TriangleAlert className="size-3.5" aria-hidden="true" />Revisa el patrón</span>
          ) : vista ? (
            <span className="rounded-full bg-acento-suave px-2.5 py-0.5 font-semibold text-acento">{vista.nombre}{etiquetaOrigen(origen)}</span>
          ) : null}
        </p>
      </div>

      {modo === "grafica" && vista && (
        <div className="sticky top-0 z-10 space-y-2 rounded-2xl bg-superficie p-2 shadow-[0_6px_16px_-10px_var(--sombra)] ring-1 ring-borde-suave ring-inset md:static md:shadow-none">
          <div className="flex flex-wrap items-center gap-1.5">
            <Segmentado
              etiqueta="Qué pinta cada toque"
              valor={pincel.alcance}
              deshabilitado={deshabilitado}
              onCambiar={(alcance) => onPincel({ ...pincel, alcance })}
              opciones={[{ valor: "globo", etiqueta: "Un globo" }, { valor: "racimo", etiqueta: unidad === "fila" ? "Fila completa" : "Racimo completo" }]}
            />
            {pintados.length > 0 && (
              <button type="button" onClick={onBorrarPintados} disabled={deshabilitado} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-texto-suave hover:bg-superficie-2 hover:text-texto focus-visible:outline-2 focus-visible:outline-acento">
                <Eraser className="size-3.5" aria-hidden="true" />Borrar lo pintado
              </button>
            )}
          </div>
          <LeyendaPatron leyenda={leyenda} pincel={pincel.material} onPincel={(material) => onPincel({ ...pincel, material })} etiqueta="Color del pincel" />
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-superficie ring-1 ring-borde-suave ring-inset">
        {vista && celdas ? (
          modo === "vista" ? (
            <VistaPatron
              resuelto={vista}
              celdas={celdas}
              leyenda={leyenda}
              tipo={tipo}
              oficialId={oficialId}
              espejo={espejo}
              proporcion={proporcion}
              etiqueta={`${nombrePieza}: patrón ${vista.nombre.toLowerCase()}`}
              className="size-full p-3"
            />
          ) : (
            <div className="scroll-suave overflow-x-auto p-2 md:size-full md:overflow-auto">
              <p className="px-1 pb-1 text-[11px] text-texto-suave">Toca un globo para pintarlo; el número de {unidad === "fila" ? "una fila" : "un racimo"} lo pinta entero.</p>
              <GraficaPatron resuelto={vista} celdas={celdas} leyenda={leyenda} tipo={tipo} oficialId={oficialId} pincel={pincel} onPintar={deshabilitado ? undefined : onPintar} pintados={pintados} className="mx-auto w-fit max-w-full" />
            </div>
          )
        ) : error && !cargando ? (
          <div role="alert" className="grid size-full place-items-center p-6 text-center">
            <div className="space-y-2">
              <p className="text-sm text-texto">{error.mensaje}</p>
              {/* Sin dibujo todavía: los estilos quedan en los ajustes para empezar por otro camino. */}
              <p className="text-xs text-texto-suave">Elige un estilo en los ajustes para armarlo a tu manera.</p>
              {!error.patronInvalido && (
                <button type="button" onClick={onReintentar} className="ui-button-secondary ui-pressable min-h-9 px-3 py-1.5 text-xs">
                  <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="brillo-carga grid size-full place-items-center px-4 text-center text-xs text-texto-suave" role="status">Preparando una propuesta de patrón…</div>
        )}
      </div>

      {/* En móvil el conteo completo queda debajo de los ajustes: aquí va la cifra por color, siempre a la vista. */}
      {vista && (
        <div aria-hidden="true" className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texto md:hidden ${cargando ? "opacity-60" : ""}`}>
          {vista.conteo.map((fila) => (
            <span key={fila.material} className="inline-flex items-center gap-1 tabular-nums">
              <MuestraNumero color={colorDe(leyenda, fila.material)} tamano="xs" />
              <strong className="font-semibold">{fila.unidades_total}</strong>
            </span>
          ))}
          {error && <span className={`basis-full font-medium ${error.patronInvalido ? "text-aviso" : "text-error"}`}>{error.mensaje}</span>}
        </div>
      )}
    </div>
  );
}

type PropsResumen = {
  vista: PatronColorResuelto | null;
  /** El conteo a la vista es el del patrón que ya tiene el plan (no una sugerencia ni un borrador). */
  enPropuesta: boolean;
  leyenda: readonly ColorLeyenda[];
  repeticiones: number;
  modo: ModoVistaPatron;
  cargando: boolean;
  error: ErrorVista | null;
  onReintentar: () => void;
};

/** Lo que acompaña al dibujo: leyenda, la frase de Python, el conteo en vivo y sus avisos. */
export function ResumenVistaPatron({ vista, enPropuesta, leyenda, repeticiones, modo, cargando, error, onReintentar }: PropsResumen) {
  if (!vista) return null;
  return (
    <div className="@container space-y-2.5">
      {modo === "vista" && <LeyendaPatron leyenda={leyenda} />}
      {vista.descripcion && <p className="text-[13px] leading-relaxed text-texto-suave">{vista.descripcion}</p>}
      <div className={`transition-opacity ${cargando ? "opacity-60" : ""}`}>
        <ResumenPatron conteo={vista.conteo} repeticiones={repeticiones} leyenda={leyenda} fueraDePropuesta={!enPropuesta} compacto />
      </div>
      {error && (
        <p role="alert" className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-medium ${error.patronInvalido ? "bg-aviso-suave text-aviso" : "bg-error-suave text-error"}`}>
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error.mensaje}</span>
          {!error.patronInvalido && <button type="button" onClick={onReintentar} className="shrink-0 font-semibold underline underline-offset-2">Reintentar</button>}
        </p>
      )}
      {vista.avisos.length > 0 && !error && (
        <ul aria-label="Avisos del patrón" className="space-y-1 rounded-xl bg-superficie px-3 py-2 text-xs text-texto-suave ring-1 ring-borde-suave ring-inset">
          {vista.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><TriangleAlert className="mt-px size-3.5 shrink-0 text-aviso" aria-hidden="true" />{aviso}</li>)}
        </ul>
      )}
    </div>
  );
}
