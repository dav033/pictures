"use client";

import { useEffect, useId, useRef } from "react";
import { Check, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import type { Densidad } from "@/lib/plan/tipos";
import { textoEditar, textoGuardar, type NombrePieza } from "@/lib/plan/nombre-pieza";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { DeslizadorArco, GrupoOpcionesArco, SeleccionArco } from "../arco/controles-arco";
import {
  ETIQUETA_DENSIDAD,
  conMedida,
  valorMedida,
  type BorradorPieza,
  type CampoMedida,
} from "./borrador-pieza";
import type { FormaPiezaFicha } from "@/lib/plan/formas-pieza";

/**
 * Los mandos de una pieza **que ningún motor arma** (la pared, el aro circular, el techo de globos y el centro de
 * mesa), al lado de su dibujo: la forma, la densidad y las medidas que la fórmula de la propuesta lee para
 * contarla. Presentación pura: recibe el borrador y lo que se puede elegir, y avisa de cada cambio.
 *
 * Mismo molde que los editores de los motores (`EditorArcoOrganico`): el encabezado recibe el foco al abrirse,
 * nada se guarda hasta «Guardar pared» (una sola edición, `accion: "propiedades"`, una sola firma nueva y un
 * «Deshacer»), y si no queda guardado se dice por qué y el editor sigue abierto.
 *
 * El dibujo de al lado es el del borrador **en su forma**; la densidad y las medidas no lo mueven porque el
 * dibujo es esquemático (su medida es la típica de la estructura). Lo que esos dos cambian —cuántos globos y lo
 * que cuesta— lo recalcula la propuesta al guardar, y es lo que la tarjeta y la cotización muestran después.
 */

type Props = {
  nombre: NombrePieza;
  borrador: BorradorPieza;
  formas: readonly FormaPiezaFicha[];
  densidades: readonly Densidad[];
  campos: readonly CampoMedida[];
  hayCambios: boolean;
  guardando: boolean;
  errorGuardado: string | null;
  /** Otro ajuste de la propuesta se está guardando: guardar espera. */
  ocupado: boolean;
  onCambiar: (siguiente: BorradorPieza) => void;
  onGuardar: () => void;
  onDescartar: () => void;
  onRestablecer: () => void;
};

const BOTON = "min-h-11 px-4 text-[13px]";
const SIN_FORMA = "";

export function EditorPiezaSinMotor({
  nombre, borrador, formas, densidades, campos, hayCambios, guardando, errorGuardado, ocupado,
  onCambiar, onGuardar, onDescartar, onRestablecer,
}: Props) {
  const id = useId();
  const encabezado = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    encabezado.current?.focus();
  }, []);
  const elegida = formas.find((ficha) => ficha.id === borrador.forma) ?? null;
  const puede = hayCambios && !guardando && !ocupado;
  const estado = guardando
    ? null
    : ocupado
      ? "Espera a que termine de guardarse el último cambio."
      : hayCambios
        ? "Listo para guardar. Al guardar, la propuesta recalcula los globos y el precio de la pieza."
        : "Cambia algo para poder guardar.";
  return (
    <div data-testid="editor-pieza-sin-motor" className="space-y-3 border-t border-borde-suave pt-3">
      <h3 ref={encabezado} tabIndex={-1} className="text-[13px] font-semibold text-texto outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">{textoEditar(nombre)}</h3>

      {formas.length > 0 && (
        <SeleccionArco
          etiqueta="¿Cómo se arma?"
          ayuda={elegida ? elegida.ayuda : "Sin elegir, se dibuja como su estructura oficial da por hecho. La forma cambia el dibujo, no los globos."}
          opciones={[{ valor: SIN_FORMA, etiqueta: "Como la propone el plan" }, ...formas.map((ficha) => ({ valor: ficha.id, etiqueta: ficha.nombre }))]}
          valor={borrador.forma ?? SIN_FORMA}
          onCambiar={(valor) => onCambiar({ ...borrador, forma: valor === SIN_FORMA ? null : valor })}
          testid="editor-forma-pieza"
        />
      )}

      {densidades.length > 1 && (
        <GrupoOpcionesArco
          etiqueta="Densidad"
          ayuda={ETIQUETA_DENSIDAD[borrador.densidad].ayuda}
          opciones={densidades.map((densidad) => ({ valor: densidad, etiqueta: ETIQUETA_DENSIDAD[densidad].nombre, descripcion: ETIQUETA_DENSIDAD[densidad].ayuda }))}
          valor={borrador.densidad}
          onCambiar={(densidad) => onCambiar({ ...borrador, densidad })}
          testid="editor-densidad-pieza"
        />
      )}

      {campos.map((campo) => {
        const valor = valorMedida(borrador.medidas, campo);
        return (
          <DeslizadorArco
            key={campo.testid}
            etiqueta={campo.etiqueta}
            ayuda={campo.ayuda}
            valor={Math.min(campo.max, Math.max(campo.min, valor ?? campo.min))}
            valorReal={valor ?? Number.NaN}
            min={campo.min}
            max={campo.max}
            paso={campo.paso}
            formato={metrosCliente}
            onConfirmar={(siguiente) => onCambiar(conMedida(borrador, campo, Math.round(siguiente * 100) / 100))}
            testid={campo.testid}
          />
        );
      })}

      {errorGuardado && (
        <p role="alert" data-testid="error-guardado-pieza" className="flex items-start gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">No se guardó: {errorGuardado} La propuesta sigue como estaba.</span>
        </p>
      )}
      <p id={`${id}-estado`} role="status" aria-live="polite" data-testid="estado-editor-pieza" className="flex min-h-5 items-center gap-1.5 text-xs text-texto-suave empty:hidden">
        {estado && (
          <>
            {puede ? <Check className="size-3.5 shrink-0 text-exito" aria-hidden="true" /> : null}
            {estado}
          </>
        )}
      </p>
      <p className="text-xs leading-relaxed text-texto-suave">Al guardar, la propuesta cambia de firma: es otra decoración y se recalcula su total. Si ya estaba aprobada, hay que regenerar la imagen.</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onGuardar}
          disabled={!puede}
          aria-describedby={`${id}-estado`}
          data-testid="guardar-pieza"
          className={`ui-button-primary ui-pressable ${BOTON}`}
        >
          {guardando ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {guardando ? "Guardando…" : textoGuardar(nombre)}
        </button>
        <button type="button" onClick={onDescartar} disabled={guardando} data-testid="descartar-pieza" className={`ui-button-secondary ui-pressable ${BOTON}`}>
          {hayCambios ? "Descartar cambios" : "Cerrar"}
        </button>
        {hayCambios && (
          <button type="button" onClick={onRestablecer} disabled={guardando} data-testid="restablecer-pieza" className={`ui-button-secondary ui-pressable ${BOTON}`}>
            <RotateCcw className="size-3.5" aria-hidden="true" />Restablecer
          </button>
        )}
      </div>
    </div>
  );
}
