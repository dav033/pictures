import type { SeleccionIA } from "./cuerpo-escena-ia";
import type { Escena } from "./escena";

/**
 * El **alcance** de un pedido a la IA (D-021): sobre qué trabaja. Las fichas del compositor lo dejan ver y cambiar: la
 * pieza elegida en el visor (que se puede soltar), más piezas añadidas a mano, o la escena entera. Aquí se resuelve a lo que
 * viaja al servidor: la pieza principal por el campo `seleccion` de siempre y las demás como una línea al final del mensaje
 * (el servidor no cambia). Puro.
 */

export type AlcanceIA = {
  /** Pedir sobre toda la escena aunque haya una pieza elegida. */
  escenaEntera: boolean;
  /** La pieza elegida que la persona soltó con la «×» (vale mientras siga siendo la elegida). */
  descartada: string | null;
  /** Piezas añadidas a mano. */
  extras: readonly string[];
};

export const ALCANCE_INICIAL: AlcanceIA = { escenaEntera: false, descartada: null, extras: [] };

export type AlcanceResuelto = {
  seleccion: SeleccionIA | null;
  extras: { id: string; nombre: string }[];
  /** Cómo se lee en la tarjeta del turno: «sobre «Columna izquierda»», «escena entera». */
  contexto: string;
};

/** Máximo del mensaje que acepta la ruta. */
const MAX_MENSAJE = 1000;
/** Piezas que se pueden añadir a mano, y lo que se deja del pedido escrito para que quepa su línea (≈ 3 × 70 caracteres). */
export const MAX_EXTRAS = 3;
export const MAX_TEXTO_PEDIDO = 700;
const corto = (t: string, n = 30) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function resolverAlcance(escena: Escena, elegida: SeleccionIA | null, alcance: AlcanceIA): AlcanceResuelto {
  if (alcance.escenaEntera) return { seleccion: null, extras: [], contexto: "escena entera" };
  const principal = elegida && elegida.id !== alcance.descartada ? elegida : null;
  const extras = alcance.extras
    .filter((id) => id !== principal?.id)
    .flatMap((id) => { const n = escena.nodos.find((x) => x.id === id); return n ? [{ id: n.id, nombre: n.nombre }] : []; })
    .slice(0, MAX_EXTRAS);
  const nombres = [...(principal ? [principal.nombre] : []), ...extras.map((e) => e.nombre)];
  const contexto = nombres.length ? `sobre ${nombres.slice(0, 3).map((n) => `«${n}»`).join(", ")}${nombres.length > 3 ? ` y ${nombres.length - 3} más` : ""}` : "escena entera";
  return { seleccion: principal, extras, contexto };
}

/** El mensaje con las piezas añadidas (y, si se pidió la escena entera teniendo una elegida, el aviso). Nunca pasa del tope. */
export function mensajeConAlcance(mensaje: string, alcance: AlcanceResuelto, escenaEnteraConElegida: boolean): string {
  const linea = alcance.extras.length
    ? `[También sobre: ${alcance.extras.map((e) => `«${corto(e.nombre)}» (id ${corto(e.id)})`).join(", ")}.]`
    : escenaEnteraConElegida ? "[Alcance: la escena entera, no solo la pieza elegida en el editor.]" : "";
  if (!linea) return mensaje;
  const completo = `${mensaje}\n${linea}`;
  return completo.length <= MAX_MENSAJE ? completo : mensaje;
}
