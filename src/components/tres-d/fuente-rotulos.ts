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
export const FUENTE_ROTULOS = { familia: "Great Vibes", url: "/fonts/great-vibes-5.3.0-latin-400.woff2", version: "great-vibes-5.3.0-latin" } as const;
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

/** Cuánto se espera después de un fallo antes de volver a intentarlo por sí solo (ms); pedir la carga a propósito (una captura) reintenta ya. */
const ESPERA_REINTENTO_MS = 5000;
let falloEn = 0;

/**
 * Carga la letra y dice si quedó lista. Nunca lanza: si falla, avisa en la consola y el estado queda en «fallo», pero NO se recuerda el
 * fallo (la red vuelve, la sesión se renueva): la siguiente petición lo intenta de nuevo. Una carga en curso se comparte.
 */
export function cargarFuenteRotulos(): Promise<boolean> {
  if (estado === "lista") return Promise.resolve(true);
  if (carga) return carga;
  if (typeof document === "undefined" || !("fonts" in document) || typeof FontFace === "undefined") {
    fijar("fallo");
    return Promise.resolve(false);
  }
  fijar("cargando");
  carga = (async () => {
    try {
      const cara = new FontFace(FUENTE_ROTULOS.familia, `url(${FUENTE_ROTULOS.url})`, { style: "normal", weight: "400" });
      await cara.load();
      document.fonts.add(cara);
      await document.fonts.load(fuenteDeRotulos(40), "Aa");
      if (!document.fonts.check(fuenteDeRotulos(40), "Aa")) throw new Error("el navegador no la registró");
      carga = null;
      fijar("lista");
      return true;
    } catch (error) {
      console.warn(`[rótulos] No se pudo cargar la letra cursiva (${FUENTE_ROTULOS.url}): ${error instanceof Error ? error.message : String(error)}. Los nombres se ven como una marca roja hasta que cargue; se vuelve a intentar.`);
      carga = null;
      falloEn = Date.now();
      fijar("fallo");
      return false;
    }
  })();
  return carga;
}

/** Vuelve a intentar la carga si falló hace más de unos segundos (lo llama el visor al querer dibujar un texto: no se queda mal hasta recargar la página). */
export function reintentarFuenteRotulos(): void {
  if (estado === "fallo" && Date.now() - falloEn >= ESPERA_REINTENTO_MS) void cargarFuenteRotulos();
}

/**
 * Espera la letra solo si hay algo que la use (un rótulo o un letrero de neón) y dice si está lista. Una captura que va a la IA no
 * puede salir con la marca roja en su lugar: quien la pide debe parar si da `false` (`exigirLetraDeRotulos`).
 */
export async function prepararRotulos(solidos: readonly { rotulo?: unknown; motivo?: { estilo?: string } }[]): Promise<boolean> {
  return solidos.some((s) => s.rotulo || s.motivo?.estilo === "neon") ? cargarFuenteRotulos() : true;
}

/** Lo mismo, pero lanza si la letra no cargó: para las capturas (FLUX, refinado), que no deben mandar una marca roja como si fuera el rótulo. */
export async function exigirLetraDeRotulos(solidos: readonly { rotulo?: unknown; motivo?: { estilo?: string } }[]): Promise<void> {
  if (!(await prepararRotulos(solidos))) throw new Error(`No se pudo cargar la letra de los rótulos (${FUENTE_ROTULOS.url}): la captura saldría con una marca roja en lugar del texto. Revisa la conexión e inténtalo de nuevo.`);
}

const suscribir = (oyente: () => void) => { oyentes.add(oyente); return () => { oyentes.delete(oyente); }; };

/** El estado de la letra para un componente (la miniatura, el editor); pide la carga al montarse. */
export function useFuenteRotulos(): EstadoFuente {
  useEffect(() => { void cargarFuenteRotulos(); }, []);
  return useSyncExternalStore(suscribir, estadoFuenteRotulos, () => "pendiente");
}
