"use client";

import { EstadoError } from "@/components/propuesta/EstadoError";
import type { AccionUiV1, UiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { ETIQUETA_ACCION_ERROR, presentarError, type OrigenError } from "@/lib/estado/estado-error";

type Props = {
  error: UiErrorV1;
  /** Dónde ocurrió: decide el título por defecto. */
  origen: OrigenError;
  /** Acciones que el contexto actual sabe ejecutar; el resto no se ofrece. */
  accionesDisponibles: ReadonlySet<AccionUiV1>;
  onAccion: (accion: AccionUiV1) => void;
  onCerrar: () => void;
  /** Modo dev: muestra código, request_id y el detalle técnico. */
  mostrarDetallesDev: boolean;
};

/**
 * Aviso de un ui-error.v1 con el estado limpio de la maqueta Estados: título
 * corto, el mensaje redactado del contrato y como mucho dos acciones que el
 * cliente elige. Un error no reintentable (p. ej. la vista previa sin saldo
 * del proveedor de imágenes) nunca ofrece "Reintentar". Las acciones nunca se
 * ejecutan solas; el detalle técnico queda solo en modo dev.
 */
export function AvisoError({ error, origen, accionesDisponibles, onAccion, onCerrar, mostrarDetallesDev }: Props) {
  const presentacion = presentarError(error, origen, accionesDisponibles);
  const [principal, secundaria] = presentacion.acciones;
  const accion = (valor: AccionUiV1 | undefined) => (valor ? { texto: ETIQUETA_ACCION_ERROR[valor], onClick: () => onAccion(valor) } : undefined);

  return (
    <div data-testid="aviso-error" data-error-code={error.code} className="relative">
      <EstadoError
        titulo={presentacion.titulo}
        mensaje={presentacion.mensaje}
        tono={presentacion.variante}
        accion={accion(principal)}
        accionSecundaria={accion(secundaria)}
        className="pr-12"
      >
        {mostrarDetallesDev && (
          <details className="text-xs text-texto-suave">
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
      </EstadoError>
      <button type="button" onClick={onCerrar} className="ui-icon-button absolute right-2 top-2 size-8" aria-label="Cerrar aviso">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
