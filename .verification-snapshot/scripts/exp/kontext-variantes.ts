/**
 * Las variantes del texto del experimento de color de Kontext y las escenas con las que se probaron. Idea 07 («Dos columnas rosa, lila y
 * dorado») es la del experimento; la idea 10 (azules con plata cromada) comprueba la frase de los metálicos en una escena de plata.
 *   base) el prompt de producción ANTES de la variante d (`promptImagenGuiada` con su frase de metálicos anterior);
 *   a)   hex exacto y nombre de acabado Sempertex por color, dentro de cada frase de color de la escena;
 *   b)   leyenda de colores por pieza («la columna 1 es…», «la columna 2 es…») antes de la fidelidad de color;
 *   c)   b + restricciones explícitas («mantén lila pastel, no gris; mantén oro, no plata»);
 *   d)   el prompt de producción de hoy (`promptImagenGuiada`): la frase de los metálicos conserva su tinte (`fraseMetalicos`). Ganó.
 * a, b y c arman su texto con la forma de la idea 07 (dos columnas): solo valen para esa escena.
 */
import { fraseMetalicos, promptImagenGuiada } from "../../src/lib/guiada-motor/render-ia-guiada";
import type { ColorDeEscena } from "../lib/paleta-guiada";

export const VARIANTES = ["base", "a", "b", "c", "d"] as const;
export type Variante = (typeof VARIANTES)[number];

export const ESCENAS = { "07": "idea-deco-real-07-", "10": "idea-deco-real-10-" } as const;
export type Escena = keyof typeof ESCENAS;

export const esEscena = (valor: string | undefined): valor is Escena => valor !== undefined && valor in ESCENAS;
export const esVariante = (valor: string | undefined): valor is Variante => (VARIANTES as readonly string[]).includes(valor ?? "");

/** Las variantes que tienen sentido en cada escena. */
export const variantesDe = (escena: Escena): readonly Variante[] => (escena === "07" ? VARIANTES : ["base", "d"]);

/** Los archivos de la escena 07 conservan los nombres con que nacieron; las demás llevan el prefijo `e<escena>-`. */
export const prefijoDe = (escena: Escena): string => (escena === "07" ? "" : `e${escena}-`);

/** La frase de los metálicos que tenía producción antes de la variante d: la que la imagen «base» del experimento usó. */
const FRASE_METALICOS_ANTERIOR = "chrome balloons with mirror reflections";

const FINISH_EN = (acabado: string) => (/chrome|cromad|metal|espejo/i.test(acabado) ? "metallic mirror" : /pastel/i.test(acabado) ? "matte pastel" : /mate/i.test(acabado) ? "matte" : acabado.toLowerCase());

/** Las piezas de la descripción con los colores (nombre inglés y hex) de cada una, en orden. */
function piezasDe(descripcion: string): Array<{ numero: number; colores: Array<{ nombre: string; hex: string }> }> {
  return descripcion.split(/(?=\(\d\) )/).flatMap((tramo) => {
    const numero = /^\((\d)\) /.exec(tramo);
    const lista = /standing on the floor, in ([^.;]+)/.exec(tramo);
    if (!numero || !lista) return [];
    const colores = [...lista[1]!.matchAll(/([a-z ]+?) \((#[0-9A-Fa-f]{6})\)/g)].map((c) => ({ nombre: c[1]!.trim().replace(/^(in|and) /, ""), hex: c[2]!.toUpperCase() }));
    return [{ numero: Number(numero[1]), colores }];
  });
}

/** El texto de cada variante para una escena; a, b y c salen de la forma de la idea 07 y en otra escena no se arman. */
export function variantesDelPrompt(descripcion: string, paleta: ColorDeEscena[], escena: Escena): Partial<Record<Variante, string>> {
  const actual = promptImagenGuiada(descripcion, "igual_visor");
  const clausulaActual = fraseMetalicos(actual);
  if (!clausulaActual) throw new Error("La escena no trae metales: no hay frase de metálicos que comparar.");
  const base = actual.replace(clausulaActual, FRASE_METALICOS_ANTERIOR);
  if (escena !== "07") return { base, d: actual };

  const piezas = piezasDe(descripcion);
  // a) cada «color (#HEX)» de la escena se vuelve «color #HEX, acabado (Sempertex Nombre)»
  let a = base;
  for (const color of paleta) {
    const frase = new RegExp(`((?:in |and )?)([a-z][a-z ]*?) \\(${color.hex}\\)`, "gi");
    a = a.replace(frase, (_, prefijo: string, nombre: string) => `${prefijo}${nombre.trim()} ${color.hex}, ${FINISH_EN(color.acabado)} finish (Sempertex ${color.sempertex})`);
  }
  const leyenda = piezas
    .map((p) => `piece ${p.numero} (${p.numero === 1 ? "left" : "right"} column): ${p.colores.map((c) => `${c.nombre} ${c.hex}`).join(", ")}`)
    .join("; ");
  const porNombre = (patron: RegExp) => paleta.filter((c) => patron.test(c.nombre)).map((c) => `${c.nombre} ${c.hex}`);
  const restricciones = [
    porNombre(/gold/i).length ? `keep the gold balloons gold (${porNombre(/gold/i).join(", ")}), not silver` : "",
    porNombre(/lilac/i).length ? `keep the lilac balloons pastel lilac (${porNombre(/lilac/i).join(", ")}), not grey` : "",
    porNombre(/pink/i).length ? `keep the pink balloons pink (${porNombre(/pink/i).join(", ")}), not white or beige` : "",
  ].filter(Boolean).join("; ");
  const textoLeyenda = `Colour legend by column, use exactly these colours: ${leyenda}.`;
  const textoRestricciones = `Do not change any colour: ${restricciones}.`;
  const b = base.replace(" Color fidelity:", ` ${textoLeyenda} Color fidelity:`);
  const c = base.replace(" Color fidelity:", ` ${textoLeyenda} ${textoRestricciones} Color fidelity:`);
  return { base, a, b, c, d: actual };
}
