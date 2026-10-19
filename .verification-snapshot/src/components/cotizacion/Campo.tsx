"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ecoDePesos, escrituraPesos, posicionTrasDigitos } from "@/lib/cotizacion/lectura-numeros";

/**
 * Campo de texto con su etiqueta SIEMPRE visible: vacío, la etiqueta ocupa el
 * lugar del texto; con algo escrito (o con el foco) sube a la esquina. Así una
 * columna no pierde su nombre al rellenarse, y cada campo mide 44 px de alto
 * (lo mínimo cómodo para el dedo). El nombre accesible lleva además el contexto
 * («Valor por unidad (Transporte y equipos)»).
 *
 * `tipo="pesos"` muestra los miles separados mientras se escribe ("1000" se ve
 * "1.000"; el punto es SOLO estético) y conserva el cursor; ver
 * `escrituraPesos` para el caso de la coma decimal.
 */

type Props = {
  id: string;
  /** Lo que se lee en el campo («Valor por unidad»). */
  etiqueta: string;
  /** El nombre accesible completo, que debe contener la etiqueta. */
  nombre: string;
  valor: string;
  onValor: (texto: string) => void;
  tipo?: "texto" | "pesos" | "decimal";
  /** Mensaje de lo que está mal; el campo se marca y lo apunta (el mensaje lo pinta quien lo usa, con id `${id}-error`). */
  error?: string;
  derecha?: boolean;
  /** Borde de acento: el valor es uno que el usuario puso en lugar del de siempre. */
  destacado?: boolean;
  maxLength?: number;
  className?: string;
};

/** Cuánto se espera tras la última tecla para decir qué se entendió: así no parpadea mientras se escribe «12.500». */
const ESPERA_ECO_MS = 700;

function tipoDeEntrada(evento: Event): string {
  return "inputType" in evento && typeof evento.inputType === "string" ? evento.inputType : "";
}

/**
 * Escribir pesos: los miles se separan mientras se teclea, el cursor no salta
 * y, al dejar de teclear, se dice qué se entendió si sorprende («12.5» → «= $ 125»).
 * Lo usan `Campo` y los campos de pesos de las filas de gastos.
 */
export function useEscrituraPesos(valor: string, onValor: (texto: string) => void, activo = true) {
  const ref = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  useEffect(() => {
    const nodo = ref.current;
    if (cursor.current === null || !nodo) return;
    nodo.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
  });
  // Lo que la persona tecleó (antes de limpiarlo) y lo que quedó en el campo: de ahí sale «= $ 125».
  const [tecleado, setTecleado] = useState<{ crudo: string; formateado: string } | null>(null);
  // El eco se guarda junto al tecleo que lo produjo: con la tecla siguiente deja de valer y desaparece al instante.
  const [ecoGuardado, setEcoGuardado] = useState<{ de: object; texto: string | null } | null>(null);
  useEffect(() => {
    if (!activo || !tecleado) return;
    const temporizador = window.setTimeout(() => setEcoGuardado({ de: tecleado, texto: ecoDePesos(tecleado.crudo, tecleado.formateado) }), ESPERA_ECO_MS);
    return () => window.clearTimeout(temporizador);
  }, [activo, tecleado]);
  const eco = activo && tecleado && tecleado.formateado === valor && ecoGuardado?.de === tecleado ? ecoGuardado.texto : null;
  const alCambiar = (evento: ChangeEvent<HTMLInputElement>) => {
    const escrito = evento.target.value;
    if (!activo) {
      onValor(escrito);
      return;
    }
    const hasta = evento.target.selectionStart ?? escrito.length;
    const digitos = escrito.slice(0, hasta).replace(/\D/g, "").length;
    const tipoEntrada = tipoDeEntrada(evento.nativeEvent);
    const resultado = escrituraPesos(escrito, tipoEntrada.startsWith("delete"));
    // Si el texto no cambió (p. ej. una coma decimal que se deja a la vista) el cursor se queda donde estaba.
    cursor.current = resultado === escrito ? hasta : posicionTrasDigitos(resultado, digitos);
    // Lo tecleado, con sus puntos y comas aunque el campo ya los haya limpiado: se acumula tecla a tecla
    // (si se borra, se pega o se edita en medio, vale lo que hay en el campo).
    const base = tecleado && tecleado.formateado === valor ? tecleado.crudo : valor;
    const dato = "data" in evento.nativeEvent && typeof evento.nativeEvent.data === "string" ? evento.nativeEvent.data : null;
    const alFinal = hasta === escrito.length;
    setTecleado({ crudo: tipoEntrada === "insertText" && dato !== null && alFinal ? base + dato : escrito, formateado: resultado });
    onValor(resultado);
  };
  return { ref, eco, alCambiar };
}

export function Campo({ id, etiqueta, nombre, valor, onValor, tipo = "texto", error, derecha = false, destacado = false, maxLength, className = "" }: Props) {
  const { ref, eco, alCambiar } = useEscrituraPesos(valor, onValor, tipo === "pesos");
  const idEco = `${id}-eco`;
  const descritoPor = [error ? `${id}-error` : null, eco ? idEco : null].filter(Boolean).join(" ") || undefined;
  const borde = error ? "border-error" : destacado ? "border-acento" : "border-borde";
  return (
    <div className={`relative min-w-0 ${className}`}>
      <input
        id={id}
        ref={ref}
        aria-label={nombre}
        aria-invalid={Boolean(error)}
        aria-errormessage={error ? `${id}-error` : undefined}
        aria-describedby={descritoPor}
        inputMode={tipo === "pesos" ? "numeric" : tipo === "decimal" ? "decimal" : undefined}
        value={valor}
        maxLength={maxLength}
        placeholder=" "
        onChange={alCambiar}
        className={`peer h-11 w-full rounded-lg border bg-fondo px-2.5 pb-1 pt-5 text-[13px] text-texto outline-none placeholder-transparent focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento ${borde} ${derecha ? "text-right tabular-nums" : ""}`}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-2.5 right-2.5 top-1 truncate text-[11px] leading-3 text-texto-suave transition-[top,font-size] peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-[13px] peer-placeholder-shown:leading-4 peer-focus:top-1 peer-focus:text-[11px] peer-focus:leading-3"
      >
        {etiqueta}
      </label>
      {tipo === "pesos" && (
        <p id={idEco} aria-live="polite" className={eco ? "mt-0.5 text-right text-[11px] tabular-nums text-texto-suave" : "sr-only"}>
          {eco}
        </p>
      )}
    </div>
  );
}

/** Mensajes de error de las celdas de una fila, pegados a los campos que los apuntan con `aria-errormessage`. */
export function MensajesDeError({ mensajes }: { mensajes: Array<{ id: string; texto: string }> }) {
  if (mensajes.length === 0) return null;
  return (
    <ul className="col-span-full space-y-0.5 text-xs text-error">
      {mensajes.map(({ id, texto }) => (
        <li key={id} id={`${id}-error`}>{texto}</li>
      ))}
    </ul>
  );
}
