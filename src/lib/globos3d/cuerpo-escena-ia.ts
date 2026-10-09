import type { Escena } from "./escena";

/**
 * Lo que el navegador manda a `/api/escena-ia` (la barra «Pídele a la IA»), armado aparte del componente para probarlo:
 * la escena, el pedido, el historial corto, la pieza elegida y, si hay, la foto adjunta ya reducida (`foto-cliente.ts`).
 */

export type FotoAdjuntaIA = { mime: string; base64: string };
export type TurnoIA = { rol: "usuario" | "asistente"; texto: string };
export type SeleccionIA = { id: string; nombre: string; raizSolitario?: { id: string; nombre: string } | null };

/** Pedido que se manda cuando se adjunta una foto sin escribir nada. */
export const PEDIDO_FOTO_POR_DEFECTO = "Arma esta decoración como la de la foto.";

/** El texto del pedido: lo escrito, o el pedido de siempre si solo se adjuntó la foto. Vacío si no hay ninguno de los dos. */
export function mensajeDelPedido(texto: string, foto: FotoAdjuntaIA | null): string {
  const limpio = texto.trim();
  return limpio || (foto ? PEDIDO_FOTO_POR_DEFECTO : "");
}

export function construirCuerpoEscenaIA(entrada: { escena: Escena; mensaje: string; historial: readonly TurnoIA[]; seleccion: SeleccionIA | null; foto?: FotoAdjuntaIA | null }): Record<string, unknown> {
  const { escena, mensaje, historial, seleccion, foto } = entrada;
  return {
    escena,
    mensaje,
    historial: historial.slice(-6),
    seleccion: seleccion ? { id: seleccion.id, nombre: seleccion.nombre.slice(0, 120), raizSolitario: seleccion.raizSolitario ?? null } : null,
    ...(foto ? { foto: { mime: foto.mime, base64: foto.base64 } } : {}),
  };
}
