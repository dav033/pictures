"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { ArrowUp, Home, Image as ImageIcon, Paperclip, Square, X } from "lucide-react";
import { MenuApp } from "./MenuApp";

export type AdjuntoVisible = { src: string; etiqueta: string };

type Props = {
  variante: "grande" | "normal";
  entrada: string;
  onEntrada: (valor: string) => void;
  onEnviar: () => void;
  cargando: boolean;
  onCancelar: () => void;
  placeholder: string;
  inputRef: RefObject<HTMLInputElement | null>;
  fotoEspacio: AdjuntoVisible | null;
  onQuitarFotoEspacio: () => void;
  referencias: readonly AdjuntoVisible[];
  onQuitarReferencia: (indice: number) => void;
  onArchivoEspacio: (archivo: File) => void;
  onArchivosReferencia: (archivos: FileList) => void;
  puedeAgregarReferencia: boolean;
  /** Estado del análisis de la foto (ReferenceAnalysisController), junto a los adjuntos (hallazgo #23). */
  analisis?: ReactNode;
  /** Aviso de adjuntos (formato, peso) debajo de los chips. */
  errorAdjuntos?: string | null;
};

/**
 * Compositor limpio (maquetas EstadoInicial y Main): adjuntar referencia o
 * espacio, texto y enviar. Los adjuntos van como chips encima del campo,
 * con el estado del análisis al lado para que se vea también a 400 px.
 */
export function Compositor({
  variante,
  entrada,
  onEntrada,
  onEnviar,
  cargando,
  onCancelar,
  placeholder,
  inputRef,
  fotoEspacio,
  onQuitarFotoEspacio,
  referencias,
  onQuitarReferencia,
  onArchivoEspacio,
  onArchivosReferencia,
  puedeAgregarReferencia,
  analisis,
  errorAdjuntos,
}: Props) {
  const espacioInputRef = useRef<HTMLInputElement>(null);
  const referenciasInputRef = useRef<HTMLInputElement>(null);
  const hayAdjuntos = Boolean(fotoEspacio) || referencias.length > 0;
  const enviarDeshabilitado = cargando || (!entrada.trim() && !hayAdjuntos);

  return (
    <div className="w-full" id="adjuntos-cliente">
      <input
        ref={espacioInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          if (archivo) onArchivoEspacio(archivo);
          evento.target.value = "";
        }}
      />
      <input
        ref={referenciasInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(evento) => {
          if (evento.target.files?.length) onArchivosReferencia(evento.target.files);
          evento.target.value = "";
        }}
      />

      {(hayAdjuntos || analisis || errorAdjuntos) && (
        <div className="mb-2 flex flex-col gap-2" data-testid="adjuntos-compositor">
          {hayAdjuntos && (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Imágenes adjuntas">
              {fotoEspacio && (
                <li className="adjunto-chip" data-adjunto="espacio">
                  {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local en base64 */}
                  <img src={fotoEspacio.src} alt="" />
                  <span className="truncate pr-1">{fotoEspacio.etiqueta}</span>
                  <button type="button" onClick={onQuitarFotoEspacio} aria-label="Quitar foto del espacio" className="ui-icon-button size-7 rounded-lg">
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              )}
              {referencias.map((referencia, indice) => (
                <li key={`${indice}:${referencia.src.slice(-24)}`} className="adjunto-chip" data-adjunto="referencia">
                  {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local en base64 */}
                  <img src={referencia.src} alt="" />
                  <span className="max-w-[12rem] truncate pr-1">{referencia.etiqueta}</span>
                  <button type="button" onClick={() => onQuitarReferencia(indice)} aria-label={`Quitar ${referencia.etiqueta}`} className="ui-icon-button size-7 rounded-lg">
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {analisis}
          {errorAdjuntos && <p className="ui-alert" role="alert">{errorAdjuntos}</p>}
        </div>
      )}

      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          onEnviar();
        }}
        className={`compositor ${variante === "grande" ? "grande" : ""}`}
      >
        <MenuApp
          etiqueta="Adjuntar imagen"
          testId="adjuntar-imagen"
          lado={variante === "grande" ? "abajo" : "arriba"}
          alineacion="izquierda"
          claseBoton="compositor-adjuntar"
          icono={<Paperclip className="size-[1.125rem]" aria-hidden="true" />}
          items={[
            { tipo: "accion", id: "referencia", etiqueta: "Foto de una decoración que te guste", onSeleccionar: () => referenciasInputRef.current?.click(), deshabilitado: !puedeAgregarReferencia, icono: <ImageIcon className="size-4" /> },
            { tipo: "accion", id: "espacio", etiqueta: "Foto de tu espacio", onSeleccionar: () => espacioInputRef.current?.click(), icono: <Home className="size-4" /> },
          ]}
        />
        <input
          ref={inputRef}
          name="mensaje"
          autoComplete="off"
          value={entrada}
          onChange={(evento) => onEntrada(evento.target.value)}
          placeholder={placeholder}
          aria-label="Escribe tu mensaje"
          className="compositor-input"
        />
        {cargando ? (
          <button type="button" onClick={onCancelar} aria-label="Cancelar respuesta" title="Cancelar respuesta" className="compositor-enviar" data-testid="cancelar-respuesta">
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" disabled={enviarDeshabilitado} aria-label="Enviar" title="Enviar" className="compositor-enviar">
            <ArrowUp className="size-[1.125rem]" aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
}
