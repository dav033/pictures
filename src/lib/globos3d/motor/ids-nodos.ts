/** Los nodos de la escena que son de una pieza del cliente (sus flores de globo) llevan su id y este separador. */
export const SEPARADOR_FLORES = "__flor";

export const piezaDeNodo = (nodoId: string): string => nodoId.split(SEPARADOR_FLORES)[0]!;
