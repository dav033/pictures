"use client";

import { useEffect, useId, useRef } from "react";
import { Check, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import type { ColorLeyenda } from "../patron/leyenda";
import { ControlesGuirnaldaOrganica } from "./ControlesGuirnaldaOrganica";
import type { PuedeGuardarGuirnaldaOrganica } from "./guardar-guirnalda-organica";
import { RecetaArco } from "../arco/RecetaArco";
import type { EstadoVistaBorradorGuirnaldaOrganica } from "./vista-borrador-guirnalda-organica";

/**
 * Lo que va debajo del dibujo cuando se edita la guirnalda (ADR-0035, paso 3): los ajustes, lo que el motor dice del
 * borrador y el pie con "Guardar". Presentación pura, como `PanelGuirnaldaOrganica`: recibe el estado ya resuelto, así que
 * se pinta con cada estado sin red.
 *
 * Los estados son explícitos: ajustes cargando (todavía sin las herramientas del motor), dibujo pendiente, borrador
 * rechazado con la frase del motor, motor sin respuesta (con "Reintentar"), colores de la pieza cambiados bajo el
 * borrador y listo. Guardar solo se ofrece con un borrador que el motor ya dibujó y dice, junto al botón, por qué no
 * cuando no se puede. «Listo» no promete la compra: la cobertura del catálogo se comprueba al guardar.
 *
 * Al abrirse, el foco pasa al encabezado: el botón que lo abrió desaparece y el foco no puede caer al documento.
 */

type Props = {
  borrador: ArmadoGuirnaldaOrganicaV1;
  vista: Pick<EstadoVistaBorradorGuirnaldaOrganica, "vista" | "borrador" | "error">;
  leyenda: readonly ColorLeyenda[];
  guardar: PuedeGuardarGuirnaldaOrganica;
  guardando: boolean;
  /** Por qué el guardado no quedó en el plan (el plan sigue como estaba). */
  errorGuardado: string | null;
  /** La propuesta cambió mientras se editaba: guardar la reemplaza por este borrador. */
  planCambio: boolean;
  /** Los colores de la pieza cambiaron y la paleta está sin revisar. */
  coloresCambiaron: boolean;
  hayCambios: boolean;
  onCambiar: (siguiente: ArmadoGuirnaldaOrganicaV1) => void;
  onGuardar: () => void;
  onDescartar: () => void;
  onRestablecer: () => void;
  onReintentar: () => void;
  onSeguirConMiBorrador: () => void;
  onUsarGuirnaldaDeLaPropuesta: () => void;
  /** Pide la receta del motor y la pone de borrador; resuelve el motivo si no llegó. */
  onReceta: () => Promise<string | null>;
};

const BOTON = "min-h-11 px-4 text-[13px]";

export function EditorGuirnaldaOrganica({
  borrador, vista, leyenda, guardar, guardando, errorGuardado, planCambio, coloresCambiaron, hayCambios,
  onCambiar, onGuardar, onDescartar, onRestablecer, onReintentar, onSeguirConMiBorrador, onUsarGuirnaldaDeLaPropuesta, onReceta,
}: Props) {
  const id = useId();
  const encabezado = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    encabezado.current?.focus();
  }, []);
  const dibujo = vista.vista;
  // El rechazo del motor y su silencio son errores del borrador; el resto, un estado que se anuncia con cortesía.
  const errorBorrador = guardar.puede ? null : guardar.tipo === "error" ? guardar.motivo : null;
  const estado = guardar.puede
    ? "Listo para guardar. Al guardar se recalcula la compra con el catálogo; si falta algún globo, te lo digo y no se guarda."
    : guardar.tipo === "error" || guardar.tipo === "colores" ? null : guardar.motivo;
  const pendiente = !guardar.puede && guardar.tipo === "espera";
  return (
    <div data-testid="editor-guirnalda-organica" className="space-y-3 border-t border-borde-suave pt-3">
      <h3 ref={encabezado} tabIndex={-1} className="text-[13px] font-semibold text-texto outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">Editar guirnalda</h3>
      {dibujo ? (
        <ControlesGuirnaldaOrganica borrador={borrador} opciones={dibujo.opciones} limites={dibujo.limites} leyenda={leyenda} onCambiar={onCambiar} />
      ) : (
        <p role="status" className="brillo-carga rounded-xl bg-superficie px-3 py-6 text-center text-xs text-texto-suave">Cargando los ajustes del motor…</p>
      )}

      {coloresCambiaron && (
        <div data-testid="colores-cambiaron-guirnalda-organica" role="alert" className="space-y-2 rounded-xl bg-aviso-suave px-3 py-2.5 text-xs text-aviso">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">Los colores de la pieza cambiaron: revisa la paleta. Tu borrador no se perdió; el dibujo ya usa los colores de ahora.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onSeguirConMiBorrador} data-testid="seguir-con-mi-borrador" className={`ui-button-secondary ui-pressable ${BOTON}`}>Seguir con mi borrador</button>
            <button type="button" onClick={onUsarGuirnaldaDeLaPropuesta} data-testid="usar-guirnalda-de-la-propuesta" className={`ui-button-secondary ui-pressable ${BOTON}`}>Usar la guirnalda de la propuesta</button>
          </div>
        </div>
      )}
      {planCambio && (
        <p data-testid="plan-cambio-guirnalda-organica" role="status" className="flex items-start gap-2 rounded-xl bg-aviso-suave px-3 py-2 text-xs font-medium text-aviso">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">La propuesta cambió mientras editabas la guirnalda. Si guardas, la guirnalda queda como la tienes aquí.</span>
        </p>
      )}

      {errorBorrador && (
        <div role="alert" data-testid="error-editor-guirnalda-organica" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{errorBorrador}</span>
          {vista.borrador === "fallido" && (
            <button type="button" onClick={onReintentar} data-testid="reintentar-editor-guirnalda-organica" className="ui-button-secondary ui-pressable min-h-11 px-3 py-1.5 text-xs">
              <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
            </button>
          )}
        </div>
      )}
      {errorGuardado && (
        <p role="alert" data-testid="error-guardado-guirnalda-organica" className="flex items-start gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">No se guardó: {errorGuardado} La propuesta sigue como estaba.</span>
        </p>
      )}

      <p id={`${id}-estado`} role="status" aria-live="polite" data-testid="estado-editor-guirnalda-organica" className="flex min-h-5 items-center gap-1.5 text-xs text-texto-suave empty:hidden">
        {estado && (
          <>
            {pendiente ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" /> : guardar.puede ? <Check className="size-3.5 shrink-0 text-exito" aria-hidden="true" /> : null}
            {estado}
          </>
        )}
      </p>
      <p className="text-xs leading-relaxed text-texto-suave">Al guardar, la propuesta cambia de firma: es otra decoración y se recalcula su total. Si ya estaba aprobada, hay que regenerar la imagen.</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onGuardar}
          disabled={!guardar.puede}
          aria-describedby={`${id}-estado`}
          data-testid="guardar-guirnalda-organica"
          className={`ui-button-primary ui-pressable ${BOTON}`}
        >
          {guardando ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {guardando ? "Guardando…" : "Guardar guirnalda"}
        </button>
        <button type="button" onClick={onDescartar} disabled={guardando} data-testid="descartar-guirnalda-organica" className={`ui-button-secondary ui-pressable ${BOTON}`}>
          {hayCambios ? "Descartar cambios" : "Cerrar"}
        </button>
        {hayCambios && (
          <button type="button" onClick={onRestablecer} disabled={guardando} data-testid="restablecer-guirnalda-organica" className={`ui-button-secondary ui-pressable ${BOTON}`}>
            <RotateCcw className="size-3.5" aria-hidden="true" />Restablecer
          </button>
        )}
      </div>
      <RecetaArco onReceta={onReceta} deshabilitado={guardando} perdida="Se reemplaza tu borrador por la guirnalda que el motor propone para esta pieza; no se guarda hasta que toques «Guardar guirnalda»." />
    </div>
  );
}
