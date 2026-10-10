/**
 * **Lo que tendría que nombrar una frase del cliente** en una espec de prueba, escrito aparte del resolver del motor
 * (`color-en-pieza.ts`) para poder contradecirlo: las reglas acordadas en la revisión, con una tabla a mano de lo que cada
 * frase puede ser entre los colores que usa el generador (`ACABADOS` de `lib-espec-aleatoria.ts`).
 * 1. El nombre de una tarjeta (o el código), en todo el plan, es ese color y solo ese, y gana siempre: «Rosa» es la tarjeta
 *    del 011 aunque haya un «Rosado» (009), que es lo que la tienda vende con «rosa». Cambia sin preguntar.
 * 2. Una palabra de la paleta es la tarjeta que dice esa misma palabra («rosa» es la tarjeta «Rosado»). Cambia sin preguntar,
 *    salvo que parezca la repetición de una orden: la espec ya se editó y el color que entra ya está. Entonces se pregunta,
 *    aunque sea el color de la tienda («rosa» cambió la tarjeta «Rosa» y repetirla pasaría al «Rosado»). Sin edición previa
 *    no hay orden que repetir, y que el color que entra ya esté no es motivo para preguntar.
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
  { dice: "rosa", puedeSer: ["009", "011"], tienda: "009" },
  { dice: "rosado", puedeSer: ["009", "011"], tienda: "009" },
  { dice: "fashion rosa", puedeSer: ["011"] },
  { dice: "011", puedeSer: ["011"] },
  { dice: "verde", puedeSer: [], tienda: "030" },
  { dice: "dorado rosa", puedeSer: [], tienda: "968" },
];

/** Las tarjetas del generador que son una palabra de la paleta, con el color que la tienda vende con ella. */
const PALABRA_DE_TARJETA: Readonly<Record<string, string>> = { azul: "040", blanco: "005", rosa: "009", rosado: "009" };

/** `repeticion`: pregunta porque puede ser la repetición de una orden (regla 2); `sinOrden`: sería la misma situación sin edición previa, y no pregunta. */
export type NombradoEsperado = { codigos: string[]; pregunta: boolean; repeticion: boolean; sinOrden: boolean };

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
  const paso = pasos.findIndex(llevaAlguno);
  const propios = pasos[paso];
  const porPalabra = paso === 1;
  const editada = espec.origen.tipo === "edicion";
  const yaEntro = seleccion.some((pieza) => pieza.colores.some((color) => entran.includes(color.codigo)));
  const puedeSer = (color: { codigo: string; nombre: string }): boolean => Boolean(frase?.puedeSer.includes(color.codigo)) && !entran.includes(color.codigo) && !(frase?.tienda && PALABRA_DE_TARJETA[plegarTexto(color.nombre)]);
  return new Map(seleccion.map((pieza): [string, NombradoEsperado] => {
    const nombrados = pieza.colores.filter((color) => (propios ? propios.has(color.codigo) : puedeSer(color)));
    const codigos = [...new Set(nombrados.map((color) => color.codigo))];
    const unoQueYaEntro = codigos.length === 1 && yaEntro;
    const repeticion = unoQueYaEntro && Boolean(propios) && porPalabra && editada;
    const sinOrden = unoQueYaEntro && Boolean(propios) && porPalabra && !editada;
    const quizaRepetida = unoQueYaEntro && (propios ? repeticion : codigos[0] !== frase?.tienda);
    return [pieza.id, { codigos, pregunta: codigos.length > 1 || quizaRepetida, repeticion, sinOrden }];
  }));
}
