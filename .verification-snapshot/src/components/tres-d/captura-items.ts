import { BIBLIOTECA_FABRICA, escenaDeItem, indexarEscena, type ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { armarEscena, type EscenaArmada } from "@/lib/globos3d/escena";
import type { PiezaArmada } from "@/lib/globos3d/piezas";

/**
 * Cómo la página de captura (`/3d/captura`) llega de un id de la biblioteca a lo que dibuja el visor: los items de
 * fábrica salen de `BIBLIOTECA_FABRICA`; los derivados (`<escena>~<nodo>`) de indexar la escena de donde vienen, con
 * el mismo código del taller. Sin React ni three.js.
 */

const FABRICA = new Map<string, ItemBiblioteca>(BIBLIOTECA_FABRICA.map((i) => [i.id, i]));
/** Piezas armadas en memoria como mucho (sin tope, una corrida larga las acumula). */
const TOPE_CACHE = 800;

export type ResolverItems = { item: (id: string) => ItemBiblioteca | null; armar: (item: ItemBiblioteca) => EscenaArmada };

export function crearResolverItems(): ResolverItems {
  const cache = new Map<string, PiezaArmada>();
  const indices = new Map<string, ItemBiblioteca[]>();
  const indiceDe = (escenaId: string): ItemBiblioteca[] => {
    const hecho = indices.get(escenaId);
    if (hecho) return hecho;
    const escena = FABRICA.get(escenaId);
    const derivados = escena ? indexarEscena(escena, undefined, cache) : [];
    if (indices.size > 40) indices.clear();
    indices.set(escenaId, derivados);
    return derivados;
  };
  return {
    item(id) {
      const base = FABRICA.get(id);
      if (base) return base;
      const corte = id.indexOf("~");
      return corte < 0 ? null : indiceDe(id.slice(0, corte)).find((i) => i.id === id) ?? null;
    },
    armar(item) {
      if (cache.size > TOPE_CACHE) cache.clear();
      return armarEscena(escenaDeItem(item), cache);
    },
  };
}


/** La sala neutra de las capturas vive aparte (`sala-neutra.ts`): quien solo la necesita no arrastra la biblioteca. */
export { salaNeutra } from "./sala-neutra";
