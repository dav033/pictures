"use client";

import { AlertCircle, X } from "lucide-react";
import type { AccionUiV1, UiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";

/** Texto de cada botón de acción. Las acciones nunca se ejecutan solas. */
const ETIQUETA_ACCION: Readonly<Record<AccionUiV1, string>> = {
  reintentar: "Reintentar",
  generar_estilo_estandar: "Generar con estilo estándar",
  revisar_propuesta: "Ver propuesta",
  pedir_nueva_propuesta: "Pedir la propuesta de nuevo",
  ajustar_propuesta: "Ajustar propuesta",
  activar_validacion_visual: "Activar revisión de calidad",
  revisar_adjuntos: "Revisar imágenes",
};

type Props = {
  error: UiErrorV1;
  /** Acciones que el contexto actual sabe ejecutar; el resto no se ofrece. */
  accionesDisponibles: ReadonlySet<AccionUiV1>;
  onAccion: (accion: AccionUiV1) => void;
  onCerrar: () => void;
  /** Modo dev: muestra código, request_id y el detalle técnico. */
  mostrarDetallesDev: boolean;
};

export function AvisoError({ error, accionesDisponibles, onAccion, onCerrar, mostrarDetallesDev }: Props) {
  const acciones = [error.accion_sugerida, ...error.acciones_alternativas]
    .filter((accion): accion is AccionUiV1 => accion !== null && accionesDisponibles.has(accion));

  return (
    <div role="alert" className="ui-alert flex flex-col gap-2" data-testid="aviso-error" data-error-code={error.code}>
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">{error.mensaje_usuario}</p>
        <button type="button" onClick={onCerrar} className="shrink-0 rounded p-0.5 hover:opacity-70 focus-visible:outline focus-visible:outline-2" aria-label="Cerrar aviso">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {acciones.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-6">
          {acciones.map((accion, indice) => (
            <button
              key={accion}
              type="button"
              onClick={() => onAccion(accion)}
              className={`${indice === 0 ? "ui-button-primary" : "ui-button-secondary"} px-3 py-1.5 text-xs font-semibold`}
            >
              {ETIQUETA_ACCION[accion]}
            </button>
          ))}
        </div>
      )}
      {mostrarDetallesDev && (
        <details className="pl-6 text-xs opacity-80">
          <summary className="cursor-pointer select-none">Detalles técnicos</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 break-all">
            <dt>code</dt>
            <dd>{error.code}</dd>
            {error.detalles_dev.codigo_origen && (<><dt>origen</dt><dd>{error.detalles_dev.codigo_origen}</dd></>)}
            {error.detalles_dev.causa && (<><dt>causa</dt><dd>{error.detalles_dev.causa}</dd></>)}
            {error.request_id && (<><dt>request_id</dt><dd>{error.request_id}</dd></>)}
            <dt>detalle</dt>
            <dd className="whitespace-pre-wrap">{error.detalles_dev.mensaje}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}
