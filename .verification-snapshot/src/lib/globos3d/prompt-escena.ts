import { GLOSARIO, vocabularioParaPrompt, type Glosario } from "./glosario-taller";

/**
 * Lo que el sistema de la IA de escena (`/api/escena-ia`) dice del vocabulario del taller y de cómo encontrar lo que
 * el usuario nombra antes de editarlo. El vocabulario sale del glosario (`glosario-taller.ts`): una sola fuente para
 * lo que entiende `buscar_en_escena` y lo que lee el modelo.
 */

/** La regla de oro de la edición precisa: primero encontrar, después editar solo eso. */
export const REGLA_BUSCAR_ANTES_DE_EDITAR = [
  "BUSCAR ANTES DE EDITAR (lo que más falla): si el usuario nombra un formato («los link-o-loon», «los tubitos», «los R-24»), un tamaño («los de 24», «los grandes», «las perlitas») o una parte («las ramas», «los pétalos», «las hojas de la palmera»), PRIMERO llama buscar_en_escena con su frase tal cual (o ver_pieza si ya sabes el id): te dice en qué pieza y parte están, cuántos son y el selector.",
  "Después edita SOLO esa selección: con editar_globos pasándole el id y el selector que te dio buscar_en_escena (formatos/partes/colores), o ajustar_tamanos (colores_por_tamano) si es un orgánico. NUNCA recolorees ni cambies la pieza entera (ni recolorear_escena, ni cambiar_pieza con colores) cuando se nombró un formato, un tamaño o una parte; si ninguna herramienta puede limitarse a esa selección, dilo en vez de cambiar todo.",
  "Una decoración aparte puede llamarse como una parte («Ramas»): buscar_en_escena te lo dice; sus globos son los de esa pieza, no los de la estructura de al lado. Lo que va encima o colgado de una pieza es otra pieza, con su propio id (ver_pieza lo lista).",
].join("\n");

/** La sección del sistema: vocabulario del taller + la regla de buscar antes de editar. */
export function seccionVocabularioEscena(glosario: Glosario = GLOSARIO): string {
  return `${vocabularioParaPrompt(glosario)}\n${REGLA_BUSCAR_ANTES_DE_EDITAR}`;
}
