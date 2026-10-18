import { promptFotoDeLayout, type AmbienteRender } from "@/lib/globos3d/render-ia";
export { fraseMetalicos } from "@/lib/globos3d/render-ia";

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
 * La regla de reflejos metálicos pertenece al prompt compartido para que Taller y guiada coincidan.
 */
export const PASO_DE_MATERIALES = "Replace the flat CG materials with real ones: real linen tablecloths, real latex balloons with natural highlights and subtle texture, real wooden chairs, a real floor and real painted walls, soft natural lighting with soft shadows.";

/**
 * The older paid experiment found that explicit reflection-colour wording kept chrome gold gold and pale lilac closer to target.
 * Its shared builder means both the Taller and guided path now use the measured rule.
 */
function soloGlobos(): string {
  return "Replace the flat CG materials with real ones: real latex balloons with natural highlights and subtle texture, tightly packed and slightly squashed where they touch, knots hidden, a real floor and real painted walls, soft natural lighting with soft shadows. Keep partial and asymmetric shapes as they are: never complete, mirror or close them (an open end stays open, empty wall stays empty).";
}

export function promptImagenGuiada(descripcion: string, ambiente: AmbienteRender): string {
  const delTaller = promptFotoDeLayout(descripcion, ambiente);
  // Keep the shared metal rule and replace only the Taller-specific furniture wording.
  return delTaller.replace(PASO_DE_MATERIALES, () => soloGlobos());
}
