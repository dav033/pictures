"use client";

import { admiteRotulo, conTextoPieza, portadorDeRotulo, type PiezaEscenografia } from "@/lib/globos3d/mobiliario-pieza";
import type { Pieza } from "@/lib/globos3d/piezas";
import { ACABADOS_ROTULO, avisoDeTexto, caraDe, esAcabadoRotulo, limpiarTexto, MAX_LINEAS_ROTULO, NOMBRE_ACABADO_ROTULO } from "@/lib/globos3d/rotulos";
import { CampoTexto } from "./CampoTexto";
import { useFuenteRotulos } from "./fuente-rotulos";
import { Deslizador } from "./PanelFlor";

const centimetros = (cm: number) => `${Math.round(cm)} cm`;
/** El texto con que arranca un rótulo nuevo: se cambia de inmediato. */
const TEXTO_NUEVO = "Nombre";
/** Lo que deja escribir el campo: más que lo que se dibuja (24), para poder decir qué se quita o se corta en vez de cortarlo sin avisar. */
const MAX_ENTRADA_ROTULO = 120;

/** ¿Es una pieza que admite un nombre en cursiva (panel redondo, arcos, lentejuelas, letrero, marco con tela)? */
export const esRotulable = (p: Pieza): p is PiezaEscenografia => p.tipo === "escenografia" && admiteRotulo(p);

/**
 * El nombre en letra cursiva de un fondo (vinilo o acrílico recortado): se añade, se escribe (hasta 3 líneas), se cambia de
 * color y de material, de tamaño y de altura, o se quita. Cada cambio rearma la pieza (`conTextoPieza`) y el visor la redibuja.
 */
export function EditorRotulo({ pieza, onPieza }: { pieza: PiezaEscenografia; onPieza: (p: Pieza) => void }) {
  const rotulo = pieza.mueble?.rotulo;
  const fuente = useFuenteRotulos();
  const portador = portadorDeRotulo(pieza);
  const cara = portador ? caraDe(portador) : null;
  if (!cara) return null;
  const pon = (cambio: Parameters<typeof conTextoPieza>[1]) => onPieza(conTextoPieza(pieza, cambio));
  if (!rotulo) {
    return (
      <div className="flex flex-col gap-1.5" aria-label="Nombre en cursiva">
        <button type="button" onClick={() => pon({ texto: TEXTO_NUEVO })} className="min-h-8 rounded-md bg-superficie-suave px-2 text-left text-xs text-texto-suave hover:text-texto">+ Nombre en cursiva (vinilo)</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5" aria-label="Nombre en cursiva">
      {fuente === "fallo" && <p role="alert" className="text-xs text-red-600">No se pudo cargar la letra cursiva: el nombre se ve como una marca roja (se vuelve a intentar al editar; si sigue, revisa la conexión).</p>}
      {/* Vaciar el campo no quita el texto (para eso está el botón): se queda el último. */}
      <CampoTexto etiqueta="Nombre o frase en cursiva" valor={rotulo.texto} lineas={MAX_LINEAS_ROTULO} maxLength={MAX_ENTRADA_ROTULO} aviso={(t) => avisoDeTexto(t)} onTexto={(t) => { if (limpiarTexto(t)) pon({ texto: t }); }} />
      <div className="grid grid-cols-2 gap-2">
        <span className="flex items-center gap-2 text-xs text-texto">
          <input type="color" value={rotulo.color} aria-label="Color del texto" onChange={(e) => pon({ color: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />
          <span className="min-w-0 truncate">letras</span>
        </span>
        <select value={rotulo.acabado} aria-label="Material del texto" onChange={(e) => { if (esAcabadoRotulo(e.target.value)) pon({ acabado: e.target.value }); }} className="rounded-md bg-superficie-suave px-2 py-1 text-xs">
          {ACABADOS_ROTULO.map((a) => <option key={a} value={a}>{NOMBRE_ACABADO_ROTULO[a]}</option>)}
        </select>
      </div>
      <Deslizador id="rotulo-alto" etiqueta="Tamaño del texto" valor={rotulo.altoCm} min={Math.max(2, Math.round(cara.altoCm * 0.04))} max={Math.round(cara.altoCm)} paso={1} texto={centimetros(rotulo.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
      <Deslizador id="rotulo-altura" etiqueta="Altura del texto" valor={rotulo.yCm} min={0} max={Math.round(cara.altoCm)} paso={1} texto={centimetros(rotulo.yCm)} onCambio={(v) => pon({ yCm: v })} />
      <button type="button" onClick={() => pon({ texto: "" })} className="min-h-8 self-start rounded-md bg-superficie-suave px-2 text-xs text-texto-suave hover:text-texto">Quitar el texto</button>
    </div>
  );
}
