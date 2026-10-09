import { promptFotoDeLayout, type AmbienteRender } from "@/lib/globos3d/render-ia";

/**
 * El texto de «Ver cómo quedaría» para un plan del motor 3D (REQ-007, fase 4): el del «Igual al visor» del Taller
 * (`promptFotoDeLayout`, FLUX.1 Kontext max con la captura como imagen base), consumido tal cual y ajustado en lo único que
 * un plan guiado no tiene.
 *
 * Un plan guiado son globos: no trae mesas ni sillas. La frase de materiales del Taller nombra «linen tablecloths» y «wooden
 * chairs» (la boda de prueba) y contradice el cierre «no furniture, tables» del inventario: FLUX podía ponerlos. Aquí esa frase
 * habla solo de globos, piso y paredes, y se le suma la regla de las formas parciales (una pared vacía sigue vacía), que el
 * inventario de la escena cuenta pero el texto del Taller no repite.
 *
 * Sin dependencias de servidor. `render-ia.ts` no se toca: si su frase cambia, `PASO_DE_MATERIALES` ya no la encuentra, el
 * texto queda como el del Taller y la prueba lo avisa.
 */
export const PASO_DE_MATERIALES = "Replace the flat CG materials with real ones: real linen tablecloths, real latex balloons with natural highlights and subtle texture, real wooden chairs, a real floor and real painted walls, soft natural lighting with soft shadows.";

const SOLO_GLOBOS = "Replace the flat CG materials with real ones: real latex balloons with natural highlights and subtle texture, tightly packed and slightly squashed where they touch, knots hidden, chrome balloons with mirror reflections, a real floor and real painted walls, soft natural lighting with soft shadows. Keep partial and asymmetric shapes as they are: never complete, mirror or close them (an open end stays open, empty wall stays empty).";

export function promptImagenGuiada(descripcion: string, ambiente: AmbienteRender): string {
  return promptFotoDeLayout(descripcion, ambiente).replace(PASO_DE_MATERIALES, SOLO_GLOBOS);
}
