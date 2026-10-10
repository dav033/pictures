/**
 * Propiedades de los colores que nombra el cliente (las corre `test-propiedades-motor.ts`), contra el oráculo escrito aparte
 * del resolver (`lib-oraculo-color.ts`):
 * - cada nombre que lee el chat (`planActualDesdeEspec`) cambia exactamente su color en ese plan, sin preguntar, también
 *   cuando la pieza lleva a la vez la tarjeta «Rosa» (011) y la «Rosado» (009);
 * - lo que dice el cliente cambia lo que el oráculo nombra, pregunta donde el oráculo pregunta y dice «no lleva» solo si
 *   no nombra nada; la espec puede venir ya editada o no, y el color que entra puede estar ya en la pieza: solo con una
 *   edición previa una palabra de la paleta puede ser la repetición de la orden y preguntar;
 * - cada opción de una pregunta, repetida, da ese color y no vuelve a preguntar (sin bucle), y nunca es un código;
 * - cambiar un color por otro dos veces deja la espec igual la segunda vez.
 */
import assert from "node:assert/strict";
import { coloresNombrados } from "../../src/lib/globos3d/motor/color-en-pieza";
import { conArticulo } from "../../src/lib/globos3d/motor/ediciones-comunes";
import { aplicarEdicion, especDesdePropuesta, planActualDesdeEspec, type EdicionEspecV1, type EspecClienteV1, type PiezaEspec } from "../../src/lib/globos3d/motor/v1";
import { plegarTexto } from "../../src/lib/rag/taxonomy/v2";
import { semillaDeCaso } from "./lib-config-propiedades";
import { ACABADOS, comoEditada, edicionAleatoria, especAleatoria } from "./lib-espec-aleatoria";
import { codigosQueEntran, loQueNombra } from "./lib-oraculo-color";
import { Azar } from "./lib-semilla";

/** Un color que el generador nunca pone y que se fabrica en todos los formatos: el que entra al cambiar. */
const DESTINO = "012";
const codigosDe = (pieza: PiezaEspec | undefined): string[] => pieza?.colores.map((color) => color.codigo) ?? [];
const piezaDe = (espec: EspecClienteV1, id: string): PiezaEspec | undefined => espec.piezas.find((pieza) => pieza.id === id);

/** «Cambia «nombre» por fucsia» en `elegidas`: salen los colores con ese nombre de tarjeta, y nada más, sin preguntar. */
function cambiaSoloSuColor(espec: EspecClienteV1, nombre: string, elegidas: readonly PiezaEspec[], donde: string): void {
  const suyos = new Set(espec.piezas.flatMap((pieza) => pieza.colores).filter((color) => plegarTexto(color.nombre.slice(0, 40)) === plegarTexto(nombre)).map((color) => color.codigo));
  const enUna = elegidas.length < espec.piezas.length;
  const r = aplicarEdicion(espec, { op: "reemplazar_color", de: nombre, a: DESTINO, ...(enUna ? { piezas: elegidas.map((pieza) => pieza.id) } : {}) });
  assert.equal(r.noAplicado, undefined, `${donde}: «${nombre}»: ${r.noAplicado}`);
  assert.equal(r.sinHacer, undefined, `${donde}: «${nombre}» preguntó: ${r.sinHacer?.join(" | ")}`);
  for (const pieza of espec.piezas) {
    const despues = codigosDe(piezaDe(r.espec, pieza.id));
    const elegida = elegidas.some((otra) => otra.id === pieza.id);
    for (const color of pieza.colores) {
      assert.equal(despues.includes(color.codigo), !(elegida && suyos.has(color.codigo)), `${donde}: «${nombre}» y el ${color.codigo} («${color.nombre}») de ${pieza.id}`);
    }
  }
}

export type CuentasDeNombres = { delPlan: number; dePieza: number; dosRosas: number };

const llevaLosDosRosas = (espec: EspecClienteV1): boolean => espec.piezas.some((pieza) => codigosDe(pieza).includes("011") && codigosDe(pieza).includes("009"));

/** Todo nombre de color que produce `planActualDesdeEspec` resuelve exactamente a su color en ese plan (A3). */
export function propiedadesDeNombresDeTarjeta(semilla: number, casos: number): CuentasDeNombres {
  const cuentas: CuentasDeNombres = { delPlan: 0, dePieza: 0, dosRosas: 0 };
  for (let caso = 0; caso < casos || (caso < casos * 4 && cuentas.dosRosas === 0); caso += 1) {
    const espec = especAleatoria(new Azar(semillaDeCaso(semilla, "nombres", caso)));
    if (llevaLosDosRosas(espec)) cuentas.dosRosas += 1;
    const plan = planActualDesdeEspec(espec);
    for (const nombre of plan.colores) {
      cambiaSoloSuColor(espec, nombre, espec.piezas, `nombres ${caso}`);
      cuentas.delPlan += 1;
    }
    plan.piezas.forEach((leida, indice) => {
      for (const { color } of leida.participacion ?? []) {
        cambiaSoloSuColor(espec, color, [espec.piezas[indice]!], `nombres ${caso}, pieza ${indice}`);
        cuentas.dePieza += 1;
      }
    });
  }
  assert.ok(cuentas.delPlan > 0 && cuentas.dePieza > 0 && cuentas.dosRosas > 0, `la propiedad de los nombres quedó vacía (${JSON.stringify(cuentas)})`);
  return cuentas;
}

/** `repeticiones`: preguntas por parecer la repetición de una orden; `sinOrden`: la misma situación sin edición previa, que no pregunta. */
export type CuentasDeColor = { aplicadas: number; noLleva: number; preguntas: number; opciones: number; repeticiones: number; sinOrden: number };
type EdicionDeColor = Extract<EdicionEspecV1, { op: "reemplazar_color" | "quitar_color" | "mas_menos_color" }>;

const OPERACIONES_DE_COLOR = [0, 2, 4] as const;
const dichoDe = (edicion: EdicionDeColor): string => (edicion.op === "reemplazar_color" ? edicion.de : edicion.color);
const conDicho = (edicion: EdicionDeColor, dicho: string): EdicionDeColor => (edicion.op === "reemplazar_color" ? { ...edicion, de: dicho } : { ...edicion, color: dicho });
const preguntaPor = (textos: readonly string[], pieza: PiezaEspec): boolean => textos.some((texto) => /puede ser/.test(texto) && texto.includes(` en ${conArticulo(pieza)};`));

const sinEjercer = (cuentas: CuentasDeColor): boolean => Object.values(cuentas).some((cuenta) => cuenta === 0);

/** Una orden de color contra lo que el oráculo dice que nombra: qué cambia, dónde pregunta, cuándo dice «no lleva», y las preguntas sin bucle. */
function verificarFrase(espec: EspecClienteV1, edicion: EdicionDeColor, donde: string, cuentas: CuentasDeColor): void {
  const dicho = dichoDe(edicion);
  const seleccion = espec.piezas.filter((pieza) => !edicion.piezas?.length || edicion.piezas.includes(pieza.id));
  const entran = edicion.op === "reemplazar_color" ? codigosQueEntran(seleccion, ACABADOS.find((acabado) => acabado.nombre === edicion.a)!.codigo) : [];
  const esperado = loQueNombra(espec, seleccion, dicho, entran);
  const r = aplicarEdicion(espec, edicion);
  const textos = [r.noAplicado ?? "", ...(r.sinHacer ?? [])];

  for (const pieza of seleccion) {
    const { codigos, pregunta } = esperado.get(pieza.id)!;
    const despues = piezaDe(r.espec, pieza.id);
    assert.equal(preguntaPor(textos, pieza), pregunta, `${donde}: ${pregunta ? "no pregunta" : "pregunta sin que haga falta"} por ${pieza.id} (${textos.join(" | ")})`);
    if (pregunta || !codigos.length) {
      assert.deepEqual(despues, pieza, `${donde}: tocó ${pieza.id}, donde la frase ${pregunta ? "es dudosa" : "no nombra nada"}`);
      continue;
    }
    const quedan = codigosDe(despues);
    for (const color of pieza.colores.filter((otro) => !codigos.includes(otro.codigo))) assert.ok(quedan.includes(color.codigo), `${donde}: quitó el ${color.codigo} de ${pieza.id}, que la frase no nombra`);
    if (edicion.op === "mas_menos_color") assert.deepEqual([...quedan].sort(), codigosDe(pieza).sort(), `${donde}: más o menos cambió los colores`);
  }
  const nombraAlgo = [...esperado.values()].some((nombrado) => nombrado.codigos.length > 0);
  assert.equal(/tu plan no lleva|no encontré «/.test(r.noAplicado ?? ""), !nombraAlgo, `${donde}: ${nombraAlgo ? "dice que no lleva y la frase nombra un color" : "no dice que no lleva"} (${r.noAplicado})`);
  if (!nombraAlgo) cuentas.noLleva += 1;
  if ([...esperado.values()].some((nombrado) => nombrado.pregunta)) cuentas.preguntas += 1;
  if ([...esperado.values()].some((nombrado) => nombrado.repeticion)) cuentas.repeticiones += 1;
  if ([...esperado.values()].some((nombrado) => nombrado.sinOrden)) cuentas.sinOrden += 1;
  if (!r.noAplicado) cuentas.aplicadas += 1;
  if (edicion.op === "reemplazar_color") assert.deepEqual(aplicarEdicion(r.espec, edicion).espec, r.espec, `${donde}: repetirla cambia otra cosa`);

  for (const [id, nombrado] of coloresNombrados(espec, seleccion, dicho, entran)) {
    const pieza = seleccion.find((otra) => otra.id === id)!;
    for (const opcion of nombrado.duda?.opciones ?? []) {
      assert.doesNotMatch(opcion.frase, /^\d{3}$/, `${donde}: la opción es un código`);
      const otra = coloresNombrados(espec, seleccion, opcion.frase, entran).get(id)!;
      assert.ok(!otra.duda && otra.indices.length === 1 && pieza.colores[otra.indices[0]!]!.codigo === opcion.codigo, `${donde}: «${opcion.frase}» no da el ${opcion.codigo} de ${id}: ${JSON.stringify(otra)}`);
      const repetida = aplicarEdicion(espec, conDicho(edicion, opcion.frase));
      assert.ok(!preguntaPor([repetida.noAplicado ?? "", ...(repetida.sinHacer ?? [])], pieza), `${donde}: responder «${opcion.frase}» vuelve a preguntar por ${id}`);
      cuentas.opciones += 1;
    }
  }
}

const conPesosIguales = (colores: ReadonlyArray<readonly [string, string]>): PiezaEspec["colores"] => {
  const peso = Math.floor(1000 / colores.length) / 1000;
  return colores.map(([codigo, nombre], i) => ({ codigo, nombre, peso: i === colores.length - 1 ? Math.round((1 - peso * (colores.length - 1)) * 1000) / 1000 : peso }));
};

/** Cómo puede llamar el plan a los dos rosas en el arco: las tarjetas de catálogo («Rosa», «Rosado»), las palabras de la paleta y mezcladas. */
const ROSAS_DEL_ARCO: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
  [["011", "Rosa"]],
  [["009", "Rosado"]],
  [["011", "Rosa"], ["009", "Rosado"]],
  [["011", "fashion rosa"], ["009", "rosado"]],
];
/** Lo que más lleva el arco, y el color que entra puede estar ya o no: es lo que decide si una palabra de la paleta parece una orden repetida. */
const RESTO_DEL_ARCO: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [[], [["005", "blanco"]]];
const COLUMNAS: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [[["005", "blanco"]], [["040", "azul"]]];

/**
 * «rosa» y «rosado» sin azar, en todas las combinaciones de lo que lleva el arco y la columna, con la espec editada o no,
 * cambiando por un color que ya está, que está en otra pieza o que no está, quitando y moviendo la proporción: el caso en que el
 * motor decide entre las tarjetas «Rosa» (011) y «Rosado» (009), que el azar casi nunca arma.
 */
function propiedadesDeLasDosRosas(cuentas: CuentasDeColor): void {
  const base = especDesdePropuesta({ frase: "Propuesta de prueba.", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] }).espec;
  for (const rosas of ROSAS_DEL_ARCO) for (const resto of RESTO_DEL_ARCO) for (const columna of COLUMNAS) for (const editar of [false, true]) {
    const partida = {
      ...base,
      piezas: base.piezas.map((pieza, indice) => ({ ...pieza, colores: conPesosIguales(indice === 0 ? [...rosas, ...resto] : columna) })),
    };
    const espec = editar ? comoEditada(partida) : partida;
    for (const dicho of ["rosa", "rosado"]) {
      const ordenes: EdicionDeColor[] = [
        ...["blanco", "azul", "dorado reflex"].map((a): EdicionDeColor => ({ op: "reemplazar_color", de: dicho, a })),
        { op: "quitar_color", color: dicho },
        { op: "mas_menos_color", color: dicho, direccion: 1 },
      ];
      for (const edicion of ordenes) verificarFrase(espec, edicion, `rosas (${JSON.stringify({ rosas, resto, columna, editar })}) ${JSON.stringify(edicion)}`, cuentas);
    }
  }
}

/**
 * Lo que dice el cliente de un color contra lo que el oráculo dice que nombra; y las preguntas, sin bucle. Las preguntas
 * son raras (una pieza con los dos dorados): si tras `casos` alguna respuesta no salió, se sigue hasta el cuádruple.
 */
export function propiedadesDeColoresDelCliente(semilla: number, casos: number): CuentasDeColor {
  const cuentas: CuentasDeColor = { aplicadas: 0, noLleva: 0, preguntas: 0, opciones: 0, repeticiones: 0, sinOrden: 0 };
  propiedadesDeLasDosRosas(cuentas);
  for (let caso = 0; caso < casos || (caso < casos * 4 && sinEjercer(cuentas)); caso += 1) {
    const azar = new Azar(semillaDeCaso(semilla, "colores", caso));
    const inicial = especAleatoria(azar);
    const espec = azar.booleano() ? comoEditada(inicial) : inicial;
    const edicion = edicionAleatoria(azar, espec, OPERACIONES_DE_COLOR[caso % OPERACIONES_DE_COLOR.length]!) as EdicionDeColor;
    verificarFrase(espec, edicion, `colores ${caso} (${JSON.stringify(edicion)})`, cuentas);
  }
  assert.ok(!sinEjercer(cuentas), `las frases del cliente no ejercieron todas las respuestas (${JSON.stringify(cuentas)}): la propiedad quedaría vacía`);
  return cuentas;
}
