/**
 * **Lo que tendría que nombrar una frase del cliente** en una espec de prueba, escrito aparte del resolver del motor
 * (`color-en-pieza.ts`) para poder contradecirlo: las reglas acordadas en la revisión, con una tabla a mano de lo que cada
 * frase puede ser entre los colores que usa el generador (`ACABADOS` de `lib-espec-aleatoria.ts`).
 * 1. El nombre de una tarjeta (o el código), en todo el plan, es ese color y solo ese.
 * 2. Una palabra de la paleta es la tarjeta que dice esa misma palabra.
 * 3. Una frase que solo puede ser un color de la lámina es ese color.
 * 4. Si no, lo que la frase puede ser, sin las tarjetas que dicen otra palabra de la paleta; se pregunta si en la pieza hay
 *    dos, o uno que no es el de la tienda cuando el color que entra ya está (repetir la orden no puede cambiar otro).
 */
import { colorFabricable } from "../../src/lib/globos3d/motor/ediciones-comunes";
import type { EspecClienteV1, PiezaEspec } from "../../src/lib/globos3d/motor/v1";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { plegarTexto } from "../../src/lib/rag/taxonomy/v2";

/**
 * Lo que dice el cliente, los colores del generador que puede ser y, si es una palabra de la paleta, el que vende la tienda
 * con ella. «azul» y «celeste» pueden ser los dos azules, pero cada uno es la tarjeta que lo dice (pasos 1 y 2).
 */
export const FRASES_DEL_CLIENTE: ReadonlyArray<{ dice: string; puedeSer: readonly string[]; tienda?: string }> = [
  { dice: "rojo", puedeSer: ["915"], tienda: "015" },
  { dice: "rojo reflex", puedeSer: ["915"] },
  { dice: "Reflex Cristal Rojo", puedeSer: ["915"] },
  { dice: "915", puedeSer: ["915"] },
  { dice: "azul", puedeSer: ["040", "640"], tienda: "040" },
  { dice: "azul mate", puedeSer: ["640"] },
  { dice: "Pastel Mate Azul", puedeSer: ["640"] },
  { dice: "celeste", puedeSer: ["640", "040"], tienda: "640" },
  { dice: "dorado", puedeSer: ["570", "970"], tienda: "970" },
  { dice: "dorado metal", puedeSer: ["570"] },
  { dice: "Metal Dorado", puedeSer: ["570"] },
  { dice: "dorado reflex", puedeSer: ["970"] },
  { dice: "Reflex Dorado", puedeSer: ["970"] },
  { dice: "blanco", puedeSer: ["005"], tienda: "005" },
  { dice: "verde", puedeSer: [], tienda: "030" },
  { dice: "dorado rosa", puedeSer: [], tienda: "968" },
];

/** Las tarjetas del generador que son una palabra de la paleta, con el color que la tienda vende con ella. */
const PALABRA_DE_TARJETA: Readonly<Record<string, string>> = { azul: "040", blanco: "005" };

export type NombradoEsperado = { codigos: string[]; pregunta: boolean };

const fraseDe = (dice: string) => FRASES_DEL_CLIENTE.find((frase) => plegarTexto(frase.dice) === plegarTexto(dice));

/** Lo que entra en cada pieza al cambiar un color por `a` (el más parecido que se fabrica en esa pieza). */
export function codigosQueEntran(seleccion: readonly PiezaEspec[], a: string): string[] {
  const referencia = referenciaPorCodigo(a);
  const destino = referencia ? { codigo: a, nombre: referencia.nombre } : null;
  return destino ? seleccion.map((pieza) => colorFabricable(destino, pieza, []).codigo) : [];
}

export function loQueNombra(espec: EspecClienteV1, seleccion: readonly PiezaEspec[], dice: string, entran: readonly string[] = []): Map<string, NombradoEsperado> {
  const frase = fraseDe(dice);
  const todos = espec.piezas.flatMap((pieza) => pieza.colores);
  const llevaAlguno = (codigos: ReadonlySet<string>) => seleccion.some((pieza) => pieza.colores.some((color) => codigos.has(color.codigo)));
  const pasos: ReadonlyArray<ReadonlySet<string>> = [
    new Set(todos.filter((color) => color.codigo === dice.trim() || plegarTexto(color.nombre) === plegarTexto(dice)).map((color) => color.codigo)),
    new Set(frase?.tienda ? todos.filter((color) => PALABRA_DE_TARJETA[plegarTexto(color.nombre)] === frase.tienda).map((color) => color.codigo) : []),
    new Set(frase && !frase.tienda && frase.puedeSer.length === 1 ? frase.puedeSer : []),
  ];
  const propios = pasos.find(llevaAlguno);
  const yaEntro = seleccion.some((pieza) => pieza.colores.some((color) => entran.includes(color.codigo)));
  return new Map(seleccion.map((pieza): [string, NombradoEsperado] => {
    const nombrados = pieza.colores.filter((color) => (propios
      ? propios.has(color.codigo)
      : Boolean(frase?.puedeSer.includes(color.codigo)) && !entran.includes(color.codigo) && !(frase?.tienda && PALABRA_DE_TARJETA[plegarTexto(color.nombre)])));
    const codigos = [...new Set(nombrados.map((color) => color.codigo))];
    const quizaRepetida = !propios && codigos.length === 1 && yaEntro && codigos[0] !== frase?.tienda;
    return [pieza.id, { codigos, pregunta: codigos.length > 1 || quizaRepetida }];
  }));
}
