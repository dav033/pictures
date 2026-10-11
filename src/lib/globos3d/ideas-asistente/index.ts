import { canonicalizarOcasiones } from "../../taller/taxonomia-celebraciones";
import type { Escena } from "../escena";
import type { ContenidoItem, ItemBiblioteca } from "../biblioteca";
import { perezoso } from "../perezoso";
import archivo from "./escenas.json";

/**
 * **Las ideas del asistente en el Taller 3D** (D-038, D-039): las ideas del carrusel de la vista guiada que el motor 3D arma, con
 * la MISMA geometría que arma para el cliente, para insertarlas en /3d desde «Añadir → Ideas → Ideas del asistente». Son de
 * Sempertex (prefijo `asistente:`). Su lista de compra sale de la escena, y es exactamente la del motor (`test-ideas-asistente-taller`):
 * con el 3D como motor de la vista guiada, el «Precio en la tienda» del Taller da el mismo total que el «¿Cuánto cuesta?» de la tarjeta.
 * La interfaz no lo promete (con el corte del 3D encendido la tarjeta cotiza el plan de Python): solo dice que es la idea del asistente.
 *
 * Las escenas están en `escenas.json`, que escribe `scripts/biblioteca/precomputar-escenas-ideas-asistente.ts` con el motor (solo
 * servidor: su receta no viaja al navegador, D-019); la prueba falla si el archivo no es lo que el motor arma hoy. Importarlo no arma
 * nada (`test-carga-3d`). Una idea sin plan guardado no está aquí: su lista curada da cantidades, no geometría.
 */
export const PREFIJO_IDEA_ASISTENTE = "asistente:";
export const GRUPO_IDEAS_ASISTENTE = "Ideas del asistente";

type DatosDeIdea = { titulo: string; tematica: string; eventos: string[]; escena: Escena };
type ArchivoDeEscenas = { version: 1; motor: string; ideas: Record<string, DatosDeIdea> };

export type IdeaAsistente = {
  /** `asistente:<id de la idea>`: el id de su item en la biblioteca. */
  id: string;
  /** El id de la idea en la vista guiada (`decoraciones.json`). */
  ideaId: string;
  nombre: string;
  descripcion: string;
  /** Ocasiones canónicas de sus eventos; perezoso, como las de las ideas de sempertex.com. */
  ocasiones: () => string[];
  escena: Escena;
};

const datos = archivo as unknown as ArchivoDeEscenas;

export const IDEAS_ASISTENTE: readonly IdeaAsistente[] = Object.entries(datos.ideas).map(([ideaId, idea]) => {
  const ocasiones = perezoso(() => canonicalizarOcasiones(idea.eventos));
  return {
    id: `${PREFIJO_IDEA_ASISTENTE}${ideaId}`,
    ideaId,
    nombre: idea.titulo,
    descripcion: `${idea.titulo}: temática ${idea.tematica}, para ${idea.eventos.join(", ")}. La misma idea que ofrece el asistente, armada con su motor 3D.`,
    ocasiones,
    escena: idea.escena,
  };
});

/** `itemPerezoso` de la biblioteca: se recibe en vez de importarlo para que `biblioteca.ts` (que importa este módulo) y este no se importen en círculo. */
type CrearItem = (fijo: Omit<ItemBiblioteca, "contenido" | "descripcion">, descripcion: string, contenido: () => ContenidoItem) => ItemBiblioteca;

/** Los items de la biblioteca de fábrica: una escena de Sempertex por idea, que se copia al pedirla (nada se arma al importar). */
export function itemsDeIdeasAsistente(crearItem: CrearItem): ItemBiblioteca[] {
  return IDEAS_ASISTENTE.map((idea) => crearItem(
    { id: idea.id, tipo: "escena", nombre: idea.nombre, get ocasiones() { return idea.ocasiones(); }, fuente: { tipo: "propio", titulo: `${GRUPO_IDEAS_ASISTENTE} · ${idea.nombre}` } },
    idea.descripcion,
    () => ({ tipo: "escena", escena: structuredClone(idea.escena) }),
  ));
}

export const esIdeaDelAsistente = (id: string): boolean => id.startsWith(PREFIJO_IDEA_ASISTENTE);

/** Separa las ideas del asistente del resto de una lista de la biblioteca, cada grupo en su orden. */
export function separarIdeasDelAsistente(items: readonly ItemBiblioteca[]): { delAsistente: ItemBiblioteca[]; resto: ItemBiblioteca[] } {
  const delAsistente: ItemBiblioteca[] = [];
  const resto: ItemBiblioteca[] = [];
  for (const item of items) (esIdeaDelAsistente(item.id) ? delAsistente : resto).push(item);
  return { delAsistente, resto };
}
