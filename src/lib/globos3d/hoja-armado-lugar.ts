import type { NodoEscena } from "./escena";

/** El sitio que el autor de la escena le puso a una pieza entre paréntesis al final del nombre: «(arriba a la izquierda)», «(abajo)». Otros paréntesis («(insecto)») no son un sitio. */
const SITIO_DE_AUTOR = /\(((?:al |a la |en el |en la )?(?:arriba|abajo|izquierda|derecha|centro|medio|frente|fondo|atrás|detrás|delante|adelante|lado)[^)]*)\)\s*$/i;

/**
 * Dónde va una pieza de la escena, con lo que la escena ya dice: de qué pieza está colgada o sobre cuál se apoya (con el
 * nombre que le dio su autor entre paréntesis: «arriba a la izquierda») o si va en el piso, la pared o el techo. `undefined` si
 * no hay nada que decir (una pieza libre en el aire, sin nombre de sitio).
 */
export function dondeVaNodo(nodo: NodoEscena, nodos: ReadonlyMap<string, NodoEscena>): string | undefined {
  const c = nodo.colocacion;
  const padre = (id: string) => nodos.get(id)?.nombre ?? id;
  // Un amarre es una pieza que no se ve (el punto donde se atan los globos): no es un sitio que decirle a quien arma.
  const sobre = (id: string) => (/^Amarre\b/i.test(padre(id)) ? undefined : `sobre «${padre(id)}»`);
  const base = c.en === "sobre" ? sobre(c.padreId)
    : c.en === "ancla" ? `en las anclas de «${padre(c.padreId)}»`
      : c.en === "pared" ? "en la pared"
        : c.en === "piso" ? "en el piso"
          : c.en === "techo" ? "en el techo"
            : undefined;
  const sitio = SITIO_DE_AUTOR.exec(nodo.nombre)?.[1];
  if (base && sitio) return `${base} (${sitio})`;
  return base ?? sitio;
}
