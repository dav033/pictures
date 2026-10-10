import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { interpretarColor, type ColorInterpretado } from "./color-dicho";
import { nombreClienteDeReferencia } from "./colores-espec";
import { conArticulo, plegar } from "./ediciones-comunes";
import type { EspecClienteV1, PiezaEspec } from "./espec-cliente-v1";

/**
 * **Cuál de los colores del plan es el que dijo el cliente.** El cliente y el modelo del chat nombran los colores como los
 * muestra la tarjeta (`planActualDesdeEspec`): «azul», «celeste», «Metal Dorado». Se busca en este orden, y el primer paso
 * que encuentra algo en las piezas elegidas es el que manda:
 * 1. el nombre de la tarjeta o el código, en todo el plan: «azul» es el color que la tarjeta llama «azul», aunque al lado
 *    haya un Pastel Mate Azul;
 * 2. la misma palabra de la paleta dicha de otro modo: «rosa» es el que la tarjeta llama «rosado»; «oro», el «dorado»;
 * 3. lo que solo puede ser un color de la lámina: «dorado metal» es el 570 aunque la tarjeta diga «Metal Dorado»;
 * 4. lo que la frase puede ser en la lámina («dorado» con un Metal Dorado y un Reflex Dorado). Una palabra de la paleta no
 *    nombra aquí un color que la tarjeta llama con otra palabra de la paleta: «celeste» no es el que dice «azul».
 * Los pasos 1 y 3 cambian sin preguntar, y el nombre de una tarjeta (paso 1) gana siempre: «rosa» es la tarjeta «Rosa» aunque
 * al lado haya un «Rosado». El paso 2 también, salvo que parezca la repetición de una orden. En el 4 se pregunta si la pieza
 * tiene más de uno. Con uno solo también se pregunta si el color que entra ya está en esas piezas y ese no es el que la tienda
 * vende con esa palabra: puede ser lo que quedó de dar la misma orden otra vez («azul» cambió el que la tarjeta llama «azul» y
 * al lado sigue un Pastel Mate Azul), y cambiarlo haría que repetirla cambiara otro color (D-023). En el paso 2 se pregunta
 * con uno solo si el color que entra ya está y la espec ya pasó por una edición (`origen.tipo`), sea o no el color de la
 * tienda: «rosa» cambió la tarjeta «Rosa» y repetirla pasaría al «Rosado», así que dos «rosa» seguidos no cambian los dos
 * rosas (P-052). Sin edición previa no hay orden que repetir y se cambia sin preguntar. Las opciones de la pregunta son
 * frases que, repetidas, dan ese color y solo ese.
 */
export type OpcionDeColor = { frase: string; codigo: string };
export type DudaDeColor = { texto: string; opciones: OpcionDeColor[] };
/** `parecidos`: los colores que la frase podía ser y la tarjeta llama con otra palabra de la paleta (para decir qué lleva). */
export type ColorNombrado = { indices: number[]; duda?: DudaDeColor; parecidos: string[] };

type PlanConPiezas = Pick<EspecClienteV1, "piezas" | "origen">;
type Hallado = { indices: number[]; preguntar: boolean; parecidos: string[] };

const conO = (opciones: readonly string[]): string => `${opciones.slice(0, -1).join(", ")} o ${opciones.at(-1)}`;

/** La palabra de la paleta que es una frase, como el color que compra la tienda con ella («rosa» y «rosado»: el 009). */
function palabraDeLaPaleta(interpretado: ColorInterpretado): string | null {
  return interpretado.amplio && interpretado.compra.length ? interpretado.compra.map((color) => color.codigo).join("+") : null;
}

const palabraDeTarjeta = (nombre: string): string | null => palabraDeLaPaleta(interpretarColor(nombre));

/** `porPalabra`: salió del paso 2, de una tarjeta que dice la misma palabra de la paleta y no el mismo nombre. */
type Propios = { codigos: ReadonlySet<string>; porPalabra: boolean };

/** Los códigos que la frase nombra por sí misma (pasos 1 a 3), si alguna pieza elegida lleva alguno; null si no. */
function codigosPropios(plan: PlanConPiezas, seleccion: readonly PiezaEspec[], dicho: string, interpretado: ColorInterpretado): Propios | null {
  const limpio = dicho.trim();
  const plegado = plegar(limpio);
  const todos = plan.piezas.flatMap((pieza) => pieza.colores);
  const palabra = palabraDeLaPaleta(interpretado);
  const pasos: ReadonlyArray<() => ReadonlySet<string>> = [
    () => new Set(todos.filter((color) => color.codigo === limpio || plegar(color.nombre) === plegado).map((color) => color.codigo)),
    () => new Set(palabra ? todos.filter((color) => palabraDeTarjeta(color.nombre) === palabra).map((color) => color.codigo) : []),
    () => new Set(interpretado.nombra.length === 1 ? interpretado.nombra : []),
  ];
  for (const [indice, paso] of pasos.entries()) {
    const codigos = paso();
    if (seleccion.some((pieza) => pieza.colores.some((color) => codigos.has(color.codigo)))) return { codigos, porPalabra: indice === 1 };
  }
  return null;
}

function buscar(plan: PlanConPiezas, seleccion: readonly PiezaEspec[], dicho: string, entran: readonly string[]): Map<string, Hallado> {
  const interpretado = interpretarColor(dicho);
  const propios = codigosPropios(plan, seleccion, dicho, interpretado);
  type Color = PiezaEspec["colores"][number];
  const puedeSer = (color: Color): boolean => !propios && interpretado.nombra.includes(color.codigo) && !entran.includes(color.codigo);
  const deOtraPalabra = (color: Color): boolean => interpretado.amplio && palabraDeTarjeta(color.nombre) !== null;
  const esLaFrase = (color: Color): boolean => (propios ? propios.codigos.has(color.codigo) : puedeSer(color) && !deOtraPalabra(color));
  const yaEntro = entran.length > 0 && seleccion.some((pieza) => pieza.colores.some((color) => entran.includes(color.codigo)));
  const deLaTienda = interpretado.amplio ? interpretado.compra.map((color) => color.codigo) : [];
  const editada = plan.origen.tipo === "edicion";
  return new Map(seleccion.map((pieza): [string, Hallado] => {
    const indices = pieza.colores.flatMap((color, indice) => (esLaFrase(color) ? [indice] : []));
    const codigos = [...new Set(indices.map((indice) => pieza.colores[indice]!.codigo))];
    const parecidos = pieza.colores.filter((color) => puedeSer(color) && deOtraPalabra(color)).map((color) => color.nombre);
    const puedeSerRepetida = (codigo: string): boolean => (propios ? editada && propios.porPalabra : !deLaTienda.includes(codigo));
    const quizaRepetida = codigos.length === 1 && yaEntro && puedeSerRepetida(codigos[0]!);
    return [pieza.id, { indices, preguntar: codigos.length > 1 || quizaRepetida, parecidos }];
  }));
}

/** Lo que el cliente puede repetir para elegir ese color: su nombre en la lámina; si así no sale solo él, el nombre completo. */
function opcionPara(plan: PlanConPiezas, seleccion: readonly PiezaEspec[], pieza: PiezaEspec, indice: number, entran: readonly string[]): OpcionDeColor {
  const color = pieza.colores[indice]!;
  const referencia = referenciaPorCodigo(color.codigo);
  const frases = [...new Set([...(referencia ? [nombreClienteDeReferencia(referencia), referencia.nombreCompleto] : []), color.nombre])];
  const unica = frases.find((frase) => {
    const hallado = buscar(plan, seleccion, frase, entran).get(pieza.id)!;
    return !hallado.preguntar && hallado.indices.length === 1 && hallado.indices[0] === indice;
  });
  return { frase: unica ?? frases.at(-1)!, codigo: color.codigo };
}

/**
 * Lo que `dicho` nombra en cada pieza de `seleccion` (por id), con los nombres de tarjeta de todo `plan`. `entran`: los
 * códigos del color que se pone en su lugar, al cambiar uno por otro.
 */
export function coloresNombrados(plan: PlanConPiezas, seleccion: readonly PiezaEspec[], dicho: string, entran: readonly string[] = []): Map<string, ColorNombrado> {
  const hallados = buscar(plan, seleccion, dicho, entran);
  return new Map(seleccion.map((pieza): [string, ColorNombrado] => {
    const { indices, preguntar, parecidos } = hallados.get(pieza.id)!;
    if (!preguntar) return [pieza.id, { indices, parecidos }];
    const opciones = indices.map((indice) => opcionPara(plan, seleccion, pieza, indice, entran));
    const frases = opciones.map((opcion) => opcion.frase);
    const pregunta = frases.length > 1 ? `${conO(frases)} en ${conArticulo(pieza)}; dime cuál` : `${frases[0]} en ${conArticulo(pieza)}; si es ese, dímelo con su nombre`;
    return [pieza.id, { indices: [], duda: { texto: `«${dicho.trim()}» puede ser ${pregunta}`, opciones }, parecidos }];
  }));
}
