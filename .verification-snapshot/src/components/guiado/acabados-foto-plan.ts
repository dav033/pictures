import { acabadoVisual, familiaSempertex, sinTildes, type AcabadoGlobo, type AcabadoVisual } from "./color-globo";
import type { LecturaFoto } from "./lectura-foto";

/**
 * Un acabado que la foto muestra y el plan no compra, dicho con discreción en «Ajustes que hice». Puro.
 *
 * Probador 141 (menor 7): la lectura de la foto decía «Rosado satinado 24 %» y el plan compraba Pastel Mate Rosado sin
 * avisarlo; el aviso de colores de la foto (`avisoColoresFoto`) solo mira la familia del color (rosado), que sí está.
 * Aquí se compara el ACABADO que se ve (cromado, metalizado, perlado, satinado, neón) con el de los globos que compra
 * el plan de ese mismo color (el nombre del producto de sus líneas). No decide nada del plan: solo lo dice.
 */

/** Los acabados que se distinguen a simple vista; pastel, mate y liso son el globo de siempre. */
const DISTINTIVOS: ReadonlySet<AcabadoGlobo> = new Set<AcabadoGlobo>(["reflex", "cromado", "metalizado", "perlado", "satin", "neon"]);

function visualDe(acabado: AcabadoGlobo): AcabadoVisual {
  if (acabado === "reflex" || acabado === "cromado" || acabado === "metalizado") return "espejo";
  if (acabado === "perlado" || acabado === "satin") return "perlado";
  if (acabado === "neon") return "neon";
  if (acabado === "cristal") return "cristal";
  return "mate";
}

type PlanConLineas = { estructuras?: ReadonlyArray<{ lineas?: ReadonlyArray<{ color?: unknown; titulo?: unknown; unidades?: unknown }> }> };

/**
 * «La foto muestra rosa satinado; tu plan lo lleva en acabado pastel.» por cada color de la foto con un acabado
 * distintivo que el plan compra solo con otro acabado. Nada si el plan no lleva ese color (eso lo dice
 * `avisoColoresFoto`) o si alguno de sus globos de ese color tiene el mismo acabado a la vista.
 */
export function acabadosFotoSinComprar(lectura: Pick<LecturaFoto, "colores"> | null | undefined, plan: unknown): string[] {
  if (!lectura || !plan || typeof plan !== "object") return [];
  const lineas = ((plan as PlanConLineas).estructuras ?? []).flatMap((estructura) => estructura.lineas ?? [])
    .filter((linea) => typeof linea.color === "string" && typeof linea.titulo === "string" && (typeof linea.unidades !== "number" || linea.unidades > 0));
  const avisos: string[] = [];
  for (const color of lectura.colores) {
    if (!color.clave || !color.adjetivo || !DISTINTIVOS.has(color.acabado)) continue;
    const clave = sinTildes(color.clave);
    const delColor = lineas.filter((linea) => sinTildes(linea.color as string) === clave);
    if (!delColor.length) continue;
    const visto = visualDe(color.acabado);
    if (delColor.some((linea) => acabadoVisual(linea.titulo as string) === visto)) continue;
    const familia = familiaSempertex(delColor[0]!.titulo as string);
    const texto = `La foto muestra ${color.nombre}; tu plan lo lleva ${familia ? `en acabado ${familia.cliente}` : "con otro acabado"}.`;
    if (!avisos.includes(texto)) avisos.push(texto);
  }
  return avisos;
}
