/**
 * Los colores que dice el cliente contra la lámina Sempertex (REQ-007). Sin coste y sin red.
 * - auditoría dirigida por la tabla: para CADA color de la lámina, su nombre completo, su nombre propio (si es único) y su
 *   nombre con la palabra de su acabado («dorado metal», «rojo reflex») resuelven a su código;
 * - el nombre de la tarjeta es el asa del color: cada nombre que lee el chat cambia ese color y solo ese, sin preguntar;
 * - si ninguna tarjeta se llama así, se busca lo que la frase es en la lámina entre los colores de la pieza, con los nombres
 *   de catálogo que de verdad tiene («Reflex Dorado Rosa», «Eucalipto», «Pastel Mate Rosado»); una palabra de la paleta no
 *   toma el color que la tarjeta llama con otra («celeste» no es el «azul»);
 * - si lo que dijo podría ser dos colores de la pieza, no se elige uno: se pregunta con opciones que, repetidas, dan ese color
 *   (y repetir la orden no cambia nada).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  aplicarEdicion, aplicarEdiciones, especDesdePropuesta, planActualDesdeEspec, PREFIJO_NO_PUDE, type EdicionEspecV1, type EspecClienteV1, type PiezaEspec,
} from "../../src/lib/globos3d/motor/v1";
import { coloresNombrados } from "../../src/lib/globos3d/motor/color-en-pieza";
import { nombreClienteDeReferencia } from "../../src/lib/globos3d/motor/colores-espec";
import { resolverColorDicho } from "../../src/lib/globos3d/motor/ediciones-comunes";
import { referenciaPorCodigo, TABLA_SEMPERTEX, type ReferenciaSempertex } from "../../src/lib/plan/referencia-sempertex";
import { clasificarColores, plegarTexto, type ColorPropuestaV2 } from "../../src/lib/rag/taxonomy/v2";

const codigosDe = (texto: string): string[] => resolverColorDicho(texto).map((color) => color.codigo);

/** La palabra con que el cliente nombra el acabado de cada familia de la lámina (cristal no tiene: es un color). */
const PALABRA_DE_ACABADO: Readonly<Record<string, string>> = {
  fashion: "fashion", pastelMate: "mate", pastelDusk: "dusk", satin: "satin", silk: "silk", neon: "neon", metal: "metal", reflex: "reflex",
};

const nombresUnicos = (): Set<string> => {
  const cuenta = new Map<string, number>();
  for (const r of TABLA_SEMPERTEX.referencias) cuenta.set(plegarTexto(r.nombre), (cuenta.get(plegarTexto(r.nombre)) ?? 0) + 1);
  return new Set([...cuenta].filter(([, n]) => n === 1).map(([nombre]) => nombre));
};

test("auditoría: el nombre completo de cada color de la lámina resuelve a su código", () => {
  for (const r of TABLA_SEMPERTEX.referencias) assert.deepEqual(codigosDe(r.nombreCompleto), [r.codigo], `«${r.nombreCompleto}»`);
});

test("auditoría: el nombre propio de un color que no se repite resuelve a su código", () => {
  const unicos = nombresUnicos();
  const probados = TABLA_SEMPERTEX.referencias.filter((r) => unicos.has(plegarTexto(r.nombre)));
  assert.ok(probados.length > 40, `solo ${probados.length} nombres únicos: la auditoría quedaría casi vacía`);
  for (const r of probados) assert.deepEqual(codigosDe(r.nombre), [r.codigo], `«${r.nombre}»`);
});

test("auditoría: el nombre con la palabra de su acabado resuelve a su código, en los dos órdenes", () => {
  let probados = 0;
  for (const r of TABLA_SEMPERTEX.referencias) {
    const palabra = PALABRA_DE_ACABADO[r.familia];
    if (!palabra) continue;
    for (const frase of [`${r.nombre} ${palabra}`, `${palabra} ${r.nombre}`]) {
      assert.deepEqual(codigosDe(frase), [r.codigo], `«${frase}» (${r.nombreCompleto})`);
      probados += 1;
    }
  }
  assert.ok(probados > 150, `solo ${probados} frases probadas`);
});

/** La palabra de tono con que el cliente nombra a una referencia: la que la taxonomía lee en su nombre. */
const tonoDe = (r: ReferenciaSempertex): string | null => clasificarColores(r.nombre).values[0] ?? null;

test("auditoría: tono + acabado resuelve a la referencia de ese acabado («dorado metal» es la 570, «rojo reflex» la 915)", () => {
  assert.deepEqual(codigosDe("dorado metal"), ["570"]);
  assert.deepEqual(codigosDe("dorado reflex"), ["970"]);
  assert.deepEqual(codigosDe("rojo reflex"), ["915"]);
  assert.deepEqual(codigosDe("rojo metal"), ["515"]);
  assert.deepEqual(codigosDe("azul mate"), ["640"]);
  assert.deepEqual(codigosDe("dorado rosa metal"), ["568"]);
  assert.deepEqual(codigosDe("dorado rosa reflex"), ["968"]);
  let probados = 0;
  for (const r of TABLA_SEMPERTEX.referencias) {
    const palabra = PALABRA_DE_ACABADO[r.familia];
    const tono = tonoDe(r);
    if (!palabra || !tono) continue;
    // El grupo incluye el color que la tienda compra para esa palabra («morado» es el Violeta): de varios, vale cualquiera.
    const compradoPorLaTienda = codigosDe(tono);
    const mismoGrupo = TABLA_SEMPERTEX.referencias.filter((otra) => otra.familia === r.familia && (tonoDe(otra) === tono || compradoPorLaTienda.includes(otra.codigo)));
    for (const frase of [`${tono} ${palabra}`, `${palabra} ${tono}`]) {
      const codigos = codigosDe(frase);
      if (mismoGrupo.length === 1) assert.deepEqual(codigos, [r.codigo], `«${frase}» (${r.nombreCompleto})`);
      else assert.ok(codigos.length === 1 && mismoGrupo.some((otra) => otra.codigo === codigos[0]), `«${frase}» tiene que dar un color de ${r.familia} y dio ${codigos}`);
      probados += 1;
    }
  }
  assert.ok(probados > 100, `solo ${probados} frases de tono y acabado`);
});

test("auditoría: lo que no es de la lámina no se inventa", () => {
  assert.deepEqual(codigosDe("tornasol imposible"), []);
  assert.deepEqual(codigosDe("999"), []);
  assert.deepEqual(codigosDe("   "), []);
});

// --- Los colores de una pieza, con los nombres de catálogo que de verdad lleva ---------------------------------------

const ARCO = "EST_01_ARCO";
const COLUMNA = "EST_02_COLUMNA";
const BASE = especDesdePropuesta({ frase: "x", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] }).espec;

/** La pieza lleva estos códigos con su nombre de catálogo («Reflex Dorado Rosa»), a partes iguales. */
function piezaCon(codigos: readonly string[]): (pieza: PiezaEspec) => PiezaEspec {
  const peso = Math.floor(1000 / codigos.length) / 1000;
  const colores = codigos.map((codigo, i) => ({
    codigo,
    nombre: nombreClienteDeReferencia(referenciaPorCodigo(codigo)!),
    peso: i === codigos.length - 1 ? Math.round((1 - peso * (codigos.length - 1)) * 1000) / 1000 : peso,
  }));
  return (pieza) => ({ ...pieza, colores });
}

function conColores(porPieza: Readonly<Record<string, readonly string[]>>): EspecClienteV1 {
  return { ...BASE, piezas: BASE.piezas.map((pieza) => (porPieza[pieza.id] ? piezaCon(porPieza[pieza.id]!)(pieza) : pieza)) };
}

const codigosDePieza = (espec: EspecClienteV1, id: string): string[] => espec.piezas.find((p) => p.id === id)!.colores.map((c) => c.codigo);
const reemplazo = (de: string, a = "rojo"): EdicionEspecV1 => ({ op: "reemplazar_color", de, a });

test("el cliente dice la familia o el tono, la pieza lleva el nombre de catálogo y ninguna tarjeta se llama así: se encuentra (regresión: «dorado rosa», «verde salvia», «rosa pastel»)", () => {
  const casos: Array<{ lleva: string; dice: string }> = [
    { lleva: "968", dice: "dorado rosa" },
    { lleva: "968", dice: "Reflex Dorado Rosa" },
    { lleva: "027", dice: "verde salvia" },
    { lleva: "027", dice: "Eucalipto" },
    { lleva: "609", dice: "rosa pastel" },
    { lleva: "609", dice: "Pastel Mate Rosado" },
    { lleva: "041", dice: "azul" },
    { lleva: "041", dice: "azul rey" },
    { lleva: "570", dice: "dorado" },
    { lleva: "570", dice: "dorado metal" },
    { lleva: "915", dice: "rojo reflex" },
    { lleva: "915", dice: "rojo" },
    { lleva: "081", dice: "gris" },
    { lleva: "640", dice: "celeste" },
  ];
  for (const { lleva, dice } of casos) {
    // La columna, solo en blanco: si una tarjeta del plan se llamara «azul», «azul» sería ese color (paso 1).
    const espec = conColores({ [ARCO]: [lleva, "005"], [COLUMNA]: ["005"] });
    const r = aplicarEdicion(espec, reemplazo(dice, lleva === "915" ? "azul" : "rojo"));
    assert.equal(r.noAplicado, undefined, `«${dice}» sobre ${lleva}: ${r.noAplicado}`);
    assert.ok(!codigosDePieza(r.espec, ARCO).includes(lleva), `«${dice}» no cambió el ${lleva}`);
    assert.ok(codigosDePieza(r.espec, ARCO).includes("005"), `«${dice}» tocó el blanco`);
  }
});

test("lo que la pieza no lleva se dice sin inventar: «dorado reflex» no cambia el Metal Dorado ni «azul» un rojo", () => {
  const metal = conColores({ [ARCO]: ["570", "005"] });
  for (const dice of ["dorado reflex", "dorado rosa", "970", "Reflex Dorado"]) {
    const r = aplicarEdicion(metal, reemplazo(dice));
    assert.ok(r.noAplicado?.startsWith(PREFIJO_NO_PUDE) && /tu plan no lleva/.test(r.noAplicado), `«${dice}»: ${r.noAplicado}`);
    assert.deepEqual(r.espec, metal);
  }
  const rosa = conColores({ [ARCO]: ["968", "005"] });
  assert.ok(aplicarEdicion(rosa, reemplazo("dorado")).noAplicado, "el dorado rosa no es dorado");
});

test("si lo que dijo puede ser dos colores de la pieza se pregunta cuál, y repetir la orden no cambia nada", () => {
  const dos = conColores({ [ARCO]: ["570", "970", "005"] });
  for (const edicion of [reemplazo("dorado", "azul"), { op: "quitar_color", color: "dorado" } as const, { op: "mas_menos_color", color: "dorado", direccion: 1 } as const]) {
    const una = aplicarEdicion(dos, edicion);
    assert.ok(una.noAplicado?.startsWith(PREFIJO_NO_PUDE), `${edicion.op}: ${una.noAplicado}`);
    assert.match(una.noAplicado!, /«dorado» puede ser Metal Dorado o Reflex Dorado en el arco/, `${edicion.op}: tiene que nombrar las opciones`);
    assert.deepEqual(una.espec, dos);
    assert.deepEqual(aplicarEdicion(una.espec, edicion).espec, una.espec, `${edicion.op}: repetirla no puede cambiar nada`);
  }
});

test("con el acabado dicho se cambia el que es, y repetir la orden no pasa al otro", () => {
  const dos = conColores({ [ARCO]: ["570", "970", "005"] });
  const edicion = reemplazo("dorado reflex", "azul");
  const una = aplicarEdicion(dos, edicion);
  assert.equal(una.noAplicado, undefined);
  assert.deepEqual(codigosDePieza(una.espec, ARCO).sort(), ["005", "040", "570"]);
  const otra = aplicarEdicion(una.espec, edicion);
  assert.ok(otra.noAplicado, "la segunda vez el dorado reflex ya no está");
  assert.deepEqual(otra.espec, una.espec);
  assert.ok(codigosDePieza(otra.espec, ARCO).includes("570"), "el Metal Dorado sigue");
});

test("«dorado» a «azul» dos veces, con un solo dorado, se queda igual la segunda vez", () => {
  const uno = conColores({ [ARCO]: ["970", "005"] });
  const una = aplicarEdicion(uno, reemplazo("dorado", "azul"));
  assert.equal(una.noAplicado, undefined);
  const dos = aplicarEdicion(una.espec, reemplazo("dorado", "azul"));
  assert.ok(dos.noAplicado);
  assert.deepEqual(dos.espec, una.espec);
});

test("una pieza con duda no frena a las demás: se cambian las claras y la otra llega entera como «No pude: …» (A4)", () => {
  const plan = conColores({ [ARCO]: ["970", "005"], [COLUMNA]: ["570", "970", "005"] });
  const r = aplicarEdicion(plan, reemplazo("dorado", "azul"));
  assert.equal(r.noAplicado, undefined);
  assert.ok(!codigosDePieza(r.espec, ARCO).includes("970"), "la pieza clara se cambió");
  assert.deepEqual(r.espec.piezas.find((p) => p.id === COLUMNA), plan.piezas.find((p) => p.id === COLUMNA), "la pieza con duda no se tocó");
  const pregunta = /^No pude: «dorado» puede ser Metal Dorado o Reflex Dorado en la columna; dime cuál\.$/;
  assert.ok(r.sinHacer?.some((texto) => pregunta.test(texto)), `sinHacer: ${r.sinHacer}`);
  assert.ok(!r.avisos.some((aviso) => /puede ser/.test(aviso)), "la pregunta no va en los avisos, que se recortan");
  const tanda = aplicarEdiciones(plan, [reemplazo("dorado", "azul")]);
  assert.equal(tanda.aplicadas, 1);
  assert.ok(tanda.noAplicadas.some((texto) => pregunta.test(texto)), `noAplicadas: ${tanda.noAplicadas}`);
});

// --- Los nombres de la tarjeta son el asa del color (A1) --------------------------------------------------------

/** Un plan de arco y columna en las palabras de la paleta, como sale de una propuesta: la tarjeta dice esas palabras. */
const enPalabras = (...colores: ColorPropuestaV2[]): EspecClienteV1 => especDesdePropuesta({ frase: "x", colores, piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] }).espec;
const conNombres = (porPieza: Readonly<Record<string, ReadonlyArray<[string, string]>>>): EspecClienteV1 => ({
  ...BASE,
  piezas: BASE.piezas.map((pieza) => {
    const lista = porPieza[pieza.id];
    if (!lista) return pieza;
    const peso = Math.floor(1000 / lista.length) / 1000;
    return { ...pieza, colores: lista.map(([codigo, nombre], i) => ({ codigo, nombre, peso: i === lista.length - 1 ? Math.round((1 - peso * (lista.length - 1)) * 1000) / 1000 : peso })) };
  }),
});

test("cada nombre de la tarjeta cambia su color y solo ese, sin preguntar, en las paletas de tonos vecinos", () => {
  const paletas: ColorPropuestaV2[][] = [["azul", "celeste", "blanco"], ["rosa pastel", "rosado", "blanco"], ["verde", "menta", "blanco"], ["dorado", "dorado rosa", "champagne"], ["morado", "lila", "plateado"]];
  // «verde reflex» por sí solo puede ser los dos verdes reflex: el nombre de la tarjeta lo decide.
  const conAcabados = conNombres({ [ARCO]: [["931", "verde reflex"], ["932", "Reflex Verde Aurora"], ["005", "blanco"]], [COLUMNA]: [["570", "dorado metal"], ["970", "Reflex Dorado"]] });
  for (const espec of [...paletas.map((paleta) => enPalabras(...paleta)), conAcabados]) {
    const paleta = planActualDesdeEspec(espec).colores;
    for (const nombre of paleta) {
      const sale = new Set(espec.piezas.flatMap((p) => p.colores).filter((c) => c.nombre === nombre).map((c) => c.codigo));
      const r = aplicarEdicion(espec, reemplazo(nombre, "081"));
      assert.equal(r.noAplicado, undefined, `${paleta}: «${nombre}»: ${r.noAplicado}`);
      assert.equal(r.sinHacer, undefined, `${paleta}: «${nombre}» preguntó: ${r.sinHacer}`);
      for (const pieza of espec.piezas) {
        const despues = codigosDePieza(r.espec, pieza.id);
        for (const color of pieza.colores) assert.equal(despues.includes(color.codigo), !sale.has(color.codigo), `${paleta}: «${nombre}» y el ${color.codigo} («${color.nombre}») de ${pieza.id}`);
      }
    }
  }
});

test("una palabra de la paleta no nombra el color que la tarjeta llama con otra: se dice lo que lleva", () => {
  const casos: Array<[ColorPropuestaV2[], string, RegExp]> = [
    [["azul", "blanco"], "celeste", /tu plan no lleva celeste; lleva azul\./],
    [["rosado", "blanco"], "rosa pastel", /tu plan no lleva rosa pastel; lleva rosado\./],
    [["menta", "blanco"], "verde", /tu plan no lleva verde; lleva menta\./],
    [["celeste", "blanco"], "azul", /tu plan no lleva azul; lleva celeste\./],
  ];
  for (const [paleta, dice, motivo] of casos) {
    const espec = enPalabras(...paleta);
    const r = aplicarEdicion(espec, reemplazo(dice, "081"));
    assert.match(r.noAplicado ?? "", motivo, `${paleta} «${dice}»`);
    assert.deepEqual(r.espec, espec);
  }
  // La misma palabra dicha de otro modo sí es ese color: «rosa» es el «rosado» de la tarjeta; «oro», el «dorado».
  for (const [paleta, dice, sale] of [[["rosado", "rosa pastel"], "rosa", "009"], [["dorado", "blanco"], "oro", "970"], [["celeste", "azul"], "azul pastel", "640"]] as const) {
    const r = aplicarEdicion(enPalabras(...paleta), reemplazo(dice, "081"));
    assert.equal(r.noAplicado, undefined, `«${dice}»: ${r.noAplicado}`);
    assert.ok(r.espec.piezas.every((p) => !p.colores.some((c) => c.codigo === sale)), `«${dice}» tenía que cambiar el ${sale}`);
    assert.equal(r.espec.piezas.flatMap((p) => p.colores).length, enPalabras(...paleta).piezas.flatMap((p) => p.colores).length);
  }
});

test("el nombre de una tarjeta manda en todo el plan: «azul» es el azul de la columna, no el azul rey del arco", () => {
  const plan = conNombres({ [ARCO]: [["041", "azul rey"], ["005", "blanco"]], [COLUMNA]: [["040", "azul"], ["005", "blanco"]] });
  const r = aplicarEdicion(plan, reemplazo("azul", "081"));
  assert.deepEqual(codigosDePieza(r.espec, ARCO), ["041", "005"]);
  assert.deepEqual(codigosDePieza(r.espec, COLUMNA), ["081", "005"]);
  // Solo en el arco, donde no hay una tarjeta «azul», es lo que la palabra puede ser: el azul rey.
  assert.deepEqual(codigosDePieza(aplicarEdicion(plan, { ...reemplazo("azul", "081"), piezas: [ARCO] } as EdicionEspecV1).espec, ARCO), ["081", "005"]);
});

test("las opciones de la pregunta, repetidas, dan ese color y solo ese, y nunca son un código (A1, A6)", () => {
  const planes: Array<[EspecClienteV1, string]> = [
    [conColores({ [ARCO]: ["570", "970", "005"] }), "dorado"],
    // Dos colores con el mismo nombre de tarjeta: el nombre no basta y se ofrece el de la lámina.
    [conNombres({ [ARCO]: [["009", "rosado"], ["011", "rosado"], ["005", "blanco"]] }), "rosado"],
    [conNombres({ [ARCO]: [["931", "verde reflex"], ["932", "Reflex Verde Aurora"]], [COLUMNA]: [["005", "blanco"]] }), "verde"],
  ];
  for (const [plan, dice] of planes) {
    const duda = coloresNombrados(plan, plan.piezas, dice).get(ARCO)!.duda;
    assert.ok(duda && duda.opciones.length >= 2, `«${dice}» tenía que preguntar: ${JSON.stringify(duda)}`);
    assert.doesNotMatch(duda.texto, /\b\d{3}\b/, `la pregunta no dice códigos: ${duda.texto}`);
    for (const { frase, codigo } of duda.opciones) {
      assert.doesNotMatch(frase, /^\d{3}$/);
      const r = aplicarEdicion(plan, reemplazo(frase, "081"));
      assert.equal(r.noAplicado, undefined, `«${frase}» vuelve a preguntar: ${r.noAplicado}`);
      const arco = plan.piezas.find((p) => p.id === ARCO)!;
      assert.deepEqual(arco.colores.filter((c) => !codigosDePieza(r.espec, ARCO).includes(c.codigo)).map((c) => c.codigo), [codigo], `«${frase}»`);
    }
  }
});

test("repetir «azul» cuando al lado queda un Pastel Mate Azul no lo cambia: se pregunta (N2)", () => {
  const plan = conNombres({ [ARCO]: [["040", "azul"], ["640", "Pastel Mate Azul"], ["005", "blanco"]], [COLUMNA]: [["005", "blanco"]] });
  const edicion = reemplazo("azul", "081");
  const una = aplicarEdicion(plan, edicion);
  assert.deepEqual(codigosDePieza(una.espec, ARCO), ["081", "640", "005"], "la primera vez, el que la tarjeta llama «azul»");
  const dos = aplicarEdicion(una.espec, edicion);
  assert.deepEqual(dos.espec, una.espec);
  assert.match(dos.noAplicado ?? "", /«azul» puede ser Pastel Mate Azul en el arco; si es ese, dímelo con su nombre/);
  // Si el color que entra no está, el único azul que queda es el que dice: se cambia sin preguntar.
  assert.deepEqual(codigosDePieza(aplicarEdicion(una.espec, reemplazo("azul", "rojo")).espec, ARCO), ["081", "015", "005"]);
});

test("el color nuevo también entiende el acabado: «dorado metal» es la 570 y «rojo reflex» la 915", () => {
  const uno = conColores({ [ARCO]: ["040", "005"] });
  assert.deepEqual(codigosDePieza(aplicarEdicion(uno, reemplazo("azul", "dorado metal")).espec, ARCO), ["570", "005"]);
  assert.deepEqual(codigosDePieza(aplicarEdicion(uno, reemplazo("azul", "rojo reflex")).espec, ARCO), ["915", "005"]);
  assert.deepEqual(codigosDePieza(aplicarEdicion(uno, { op: "agregar_color", color: "dorado metal" }).espec, ARCO), ["040", "005", "570"]);
});
