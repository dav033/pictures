import { useEffect, useSyncExternalStore } from "react";

/**
 * **La letra de los rótulos**: Great Vibes (SIL Open Font License 1.1, sin nombre reservado; la licencia va en
 * `public/fonts/OFL-GreatVibes.txt`), el subconjunto latino de @fontsource/great-vibes 5.3.0 sin modificar (U+0000–00FF y puntuación:
 * 42,8 KB, que el navegador baja la primera vez que se dibuja un rótulo). Es la misma en el visor, en la captura que va a la IA y
 * en las miniaturas, en cualquier equipo: nunca se cae en una letra del sistema (el nombre se vería distinto en cada máquina).
 *
 * Una letra es un recurso del documento, no de la GPU: se carga una vez por página (regla D-017 habla de recursos de un contexto WebGL).
 * Si falla, el rótulo se muestra como una marca roja y el campo del inspector lo avisa; no se reemplaza por otra letra.
 */
export const FUENTE_ROTULOS = { familia: "Great Vibes", url: "/fonts/great-vibes-latin-400-normal.woff2", version: "great-vibes-5.3.0-latin" } as const;
/** La fuente de lienzo y de CSS para un tamaño en px. */
export const fuenteDeRotulos = (px: number) => `${px}px "${FUENTE_ROTULOS.familia}"`;

export type EstadoFuente = "pendiente" | "cargando" | "lista" | "fallo";

let estado: EstadoFuente = "pendiente";
let carga: Promise<boolean> | null = null;
const oyentes = new Set<() => void>();

function fijar(nuevo: EstadoFuente) {
  estado = nuevo;
  for (const oyente of oyentes) oyente();
}

export const estadoFuenteRotulos = (): EstadoFuente => estado;

/** Carga la letra (una sola vez por página) y dice si quedó lista. Nunca lanza: si falla, avisa en la consola y el estado queda en «fallo». */
export function cargarFuenteRotulos(): Promise<boolean> {
  if (carga) return carga;
  if (typeof document === "undefined" || !("fonts" in document) || typeof FontFace === "undefined") {
    fijar("fallo");
    return (carga = Promise.resolve(false));
  }
  fijar("cargando");
  carga = (async () => {
    try {
      const cara = new FontFace(FUENTE_ROTULOS.familia, `url(${FUENTE_ROTULOS.url})`, { style: "normal", weight: "400" });
      await cara.load();
      document.fonts.add(cara);
      await document.fonts.load(fuenteDeRotulos(40), "Aa");
      if (!document.fonts.check(fuenteDeRotulos(40), "Aa")) throw new Error("el navegador no la registró");
      fijar("lista");
      return true;
    } catch (error) {
      console.warn(`[rótulos] No se pudo cargar la letra cursiva (${FUENTE_ROTULOS.url}): ${error instanceof Error ? error.message : String(error)}. Los nombres se ven como una marca roja hasta que cargue.`);
      fijar("fallo");
      return false;
    }
  })();
  return carga;
}

/** Espera la letra solo si hay rótulos que dibujar (una captura sin cabeza no debe dibujar la marca roja). */
export async function prepararRotulos(solidos: readonly { rotulo?: unknown }[]): Promise<void> {
  if (solidos.some((s) => s.rotulo)) await cargarFuenteRotulos();
}

const suscribir = (oyente: () => void) => { oyentes.add(oyente); return () => { oyentes.delete(oyente); }; };

/** El estado de la letra para un componente (la miniatura, el editor); pide la carga al montarse. */
export function useFuenteRotulos(): EstadoFuente {
  useEffect(() => { void cargarFuenteRotulos(); }, []);
  return useSyncExternalStore(suscribir, estadoFuenteRotulos, () => "pendiente");
}
