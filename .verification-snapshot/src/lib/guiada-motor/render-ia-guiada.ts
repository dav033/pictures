import { promptFotoDeLayout, type AmbienteRender } from "@/lib/globos3d/render-ia";
import { TABLA_SEMPERTEX } from "@/lib/plan/referencia-sempertex";

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

/** Los acabados de la tabla Sempertex que son espejo o brillo metálico (el resto —satín, perlado, mate— no refleja). */
const ACABADOS_METALICOS: ReadonlySet<string> = new Set(["glossy chrome", "metallic sheen"]);

type Metalico = { nombre: string; frase: string; tono: string };

/** Cada color metálico oficial con la frase exacta con la que `colorDeGloboEnIngles` lo escribe en la descripción («chrome gold (#A08344)»). */
const METALICOS: readonly Metalico[] = TABLA_SEMPERTEX.referencias
  .filter((r) => ACABADOS_METALICOS.has(r.acabado))
  .map((r) => ({ nombre: r.nombreEn, frase: `${r.nombreEn} (${r.hexGlobo.toUpperCase()})`, tono: r.nombreEn.replace(/^(?:chrome|metallic) /, "") }));

/** Qué dice el texto de cada metal para que su reflejo conserve su color: el plateado sigue plateado y el resto no se vuelve plata. */
const reflejoDe = (m: Metalico): string => (m.tono === "silver" ? `${m.nombre} reflects silver` : `${m.nombre} reflects ${m.tono}, never silver`);

/**
 * La frase de los globos metálicos DE LA ESCENA, o `""` si no hay ninguno: solo nombra los metales que el texto cuenta, así un plan de
 * plata, oro rosa o azul cromado no recibe la regla de otro metal.
 *
 * Por qué: «chrome balloons with mirror reflections» hacía que FLUX.1 Kontext max pintara de plata el dorado cromado (idea 07,
 * 2026-10-09: en 5 de 6 tomas la columna con oro salió plateada). Con «metallic balloons whose reflections keep their own colour (chrome
 * gold reflects gold, never silver)», en 3 tomas de 3 el oro siguió siendo oro (la peor, 8 globos dorados contra 4 plateados; las otras
 * dos, ninguno plateado), el lila pasó de ΔE 12,9 a 6,3 de media y el rosa quedó dentro del ruido (10,8 contra 10,1), sin costuras ni
 * objetos inventados (`scripts/exp/kontext-color.ts`, variante d; datos en la bitácora: research/kontext-color/). La evidencia es n = 3 en
 * UNA escena (la idea 07, con oro); la redacción para los demás metales (plata y el resto) sale de la misma plantilla y se comprobó con
 * una toma de la idea 10 (plata cromada). Las leyendas por columna y las restricciones «no plata» (variantes b y c) no ayudaron más y
 * trajeron costuras y objetos inventados. El Taller («Igual al visor») no lleva esta frase: su texto no habla de cromados y no se midió.
 */
export function fraseMetalicos(descripcion: string): string {
  const presentes = METALICOS.filter((m) => descripcion.includes(m.frase));
  return presentes.length ? `metallic balloons whose reflections keep their own colour (${presentes.map(reflejoDe).join("; ")})` : "";
}

function soloGlobos(metalicos: string): string {
  return `Replace the flat CG materials with real ones: real latex balloons with natural highlights and subtle texture, tightly packed and slightly squashed where they touch, knots hidden, ${metalicos ? `${metalicos}, ` : ""}a real floor and real painted walls, soft natural lighting with soft shadows. Keep partial and asymmetric shapes as they are: never complete, mirror or close them (an open end stays open, empty wall stays empty).`;
}

export function promptImagenGuiada(descripcion: string, ambiente: AmbienteRender): string {
  const delTaller = promptFotoDeLayout(descripcion, ambiente);
  // Los metales se buscan en lo que de verdad quedó en el texto (la descripción se recorta a su tope) y se reemplaza con función: el texto no es un patrón.
  return delTaller.replace(PASO_DE_MATERIALES, () => soloGlobos(fraseMetalicos(delTaller)));
}
