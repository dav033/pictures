/**
 * Cobertura del helio en toda la biblioteca de fábrica y en las escenas de partida (PRO-02, D-027). Sin coste: ninguna IA ni red.
 *
 * Un globo solo entra en los litros y la cinta de la lista de compra si su fuente lo marca como de helio (`helio: true`,
 * en la pieza o en el globo de una decoración) o es de una parte de helio (techo, ramo de helio). Esta prueba recorre TODAS
 * las ideas, decoraciones, escenas y presets y exige:
 * - todo globo, decoración o pieza de techo que se llama «de helio» (en su id o su nombre) flota de verdad cuando se arma;
 * - toda idea cuyo texto dice que lleva helio tiene al menos una pieza que flota (salvo las que solo llevan foil);
 * - los ramos «por pisos» (globo-N-M sobre un peso con sus cintas) flotan todos;
 * - cada idea con su cuenta de helio escrita en su texto da esa cuenta en la escena armada;
 * - lo que va de aire no se marca: el peso, la base, el huevo de pie, el ramo de varillas, la malla de pared…;
 * - lo derivado de la biblioteca (`clavePieza`, `nombreConHelio`) distingue el que flota del de aire, en globos y en decoraciones;
 * (Las lecturas de foto no marcan helio por «en el aire»: no distingue flotar de colgar; ver `test-compilar-lectura.ts`.)
 * Las cantidades de la tabla salen del texto de cada idea («9 R-12 de helio contados en 3 pisos», «un ramo de 3 R-12 de helio»…).
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-helio-cobertura.ts
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, bibliotecaCompleta, clavePieza, escenaDeItem, type ItemBiblioteca } from "../../src/lib/globos3d/biblioteca";
import { ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { esGloboDeHelio, gruposDeHelio, llevaHelio, nombreConHelio, resumenHelio } from "../../src/lib/globos3d/helio-cinta";

type Nodo = { id: string; nombre: string; pieza: Pieza };
type Fuente = { id: string; descripcion: string; nodos: Nodo[] };

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

function nodosDeItem(item: ItemBiblioteca): Nodo[] {
  const c = item.contenido;
  if (c.tipo === "escena") return c.escena.nodos;
  if (c.tipo === "conjunto") return [{ id: "raiz", nombre: c.conjunto.raiz.nombre, pieza: c.conjunto.raiz.pieza }, ...c.conjunto.hijos];
  return [{ id: "pieza", nombre: c.nombre, pieza: c.pieza }];
}

const fuentes: Fuente[] = [
  ...BIBLIOTECA_FABRICA.map((item) => ({ id: item.id, descripcion: `${item.nombre}. ${item.descripcion}`, nodos: nodosDeItem(item) })),
  ...ESCENAS_PREDEFINIDAS.map((p) => ({ id: `preset:${p.id}`, descripcion: `${p.nombre}. ${p.descripcion}`, nodos: p.escena.nodos })),
];
const fuente = (id: string): Fuente => fuentes.find((f) => f.id === id) ?? assert.fail(`no existe ${id}`);
const nodo = (idFuente: string, idNodo: string): Nodo => fuente(idFuente).nodos.find((n) => n.id === idNodo) ?? assert.fail(`no existe ${idFuente} › ${idNodo}`);

/** ¿Flota algún globo de la pieza armada? (la marca tiene que llegar hasta el globo, no quedarse en los datos) */
const flotaArmada = (p: Pieza): boolean => armarPieza(p).globos.some(esGloboDeHelio);
/** ¿Dicen los datos que algo de la pieza flota? (sin armarla) */
const marcadaEnDatos = (p: Pieza): boolean =>
  p.tipo === "techo" ? p.techo.elementos.some((e) => e.tipo === "helio")
    : p.tipo === "decoracion" && p.decoracion.tipo === "ramo_helio" ? true
      : JSON.stringify(p).includes('"helio":true');

/** Las piezas que pueden llevar un globo de látex (los foil —metalizados— no entran en los litros). */
const LLEVAN_LATEX = new Set<Pieza["tipo"]>(["globo", "decoracion", "techo", "columna"]);
/** Ideas cuyo helio es solo de foil: no hay litros de látex que contar. */
const SOLO_FOIL = new Set(["idea:bouquet-regalo-de-cumpleano"]);
/** Textos que hablan de un helio que la pieza NO modela («el ramo de helio de la foto no va»): no hay globo que marcar. */
const HELIO_NO_MODELADO = new Set(["celebra:columna_bloques_pirata", "celebra:columna_espiral_roja_azul", "base-organica:arco-l-cromado-negro-oro-plata"]);

console.log(`${fuentes.length} fuentes (ideas, decoraciones, escenas y presets), ${fuentes.reduce((n, f) => n + f.nodos.length, 0)} piezas.`);

console.log("Lo que se llama «de helio» flota");
prueba("todo globo, decoración o techo con «helio» en su id o su nombre flota al armarlo", () => {
  const sinMarca: string[] = [];
  let revisados = 0;
  for (const f of fuentes) {
    for (const n of f.nodos) {
      // «Ramo de helio: pesa de 3 cuartetos»: la pesa que lo sostiene es de aire, aunque lleve «helio» en el nombre.
      if (!LLEVAN_LATEX.has(n.pieza.tipo) || !/helio/i.test(`${n.id} ${n.nombre}`) || /\b(peso|pesa)\b/i.test(n.nombre)) continue;
      revisados += 1;
      if (!flotaArmada(n.pieza)) sinMarca.push(`${f.id} › ${n.id} «${n.nombre}»`);
    }
  }
  assert.ok(revisados > 150, `se revisaron ${revisados} piezas con «helio» en el nombre`);
  assert.deepEqual(sinMarca, []);
});
prueba("los ramos por pisos (globo-N-M sobre un peso) flotan todos", () => {
  const sinMarca: string[] = [];
  let revisados = 0;
  for (const f of fuentes) {
    for (const n of f.nodos) {
      if (n.pieza.tipo !== "globo" || !/^globo-\d+(-\d+)?$/.test(n.id)) continue;
      revisados += 1;
      if (!flotaArmada(n.pieza)) sinMarca.push(`${f.id} › ${n.id}`);
    }
  }
  assert.ok(revisados > 250, `se revisaron ${revisados} globos de ramos por pisos`);
  assert.deepEqual(sinMarca, []);
});
prueba("toda idea que dice «de helio» o «con helio» en su texto tiene al menos una pieza que flota (salvo las de solo foil)", () => {
  const sinHelio: string[] = [];
  let conTexto = 0;
  for (const f of fuentes) {
    if (!/\b(de|con) helio\b|ramo de helio|helio por pisos/i.test(f.descripcion)) continue;
    conTexto += 1;
    if (!f.nodos.some((n) => marcadaEnDatos(n.pieza)) && !SOLO_FOIL.has(f.id) && !HELIO_NO_MODELADO.has(f.id)) sinHelio.push(f.id);
  }
  assert.ok(conTexto > 60, `${conTexto} ideas hablan de helio`);
  assert.deepEqual(sinHelio, []);
});
prueba("toda marca llega al globo armado: cada pieza marcada en los datos tiene un globo que flota", () => {
  const perdidas: string[] = [];
  let marcadas = 0;
  for (const f of fuentes) {
    for (const n of f.nodos) {
      if (!marcadaEnDatos(n.pieza)) continue;
      marcadas += 1;
      if (!flotaArmada(n.pieza)) perdidas.push(`${f.id} › ${n.id} «${n.nombre}»`);
    }
  }
  assert.ok(marcadas > 500, `${marcadas} piezas marcadas`);
  assert.deepEqual(perdidas, []);
});

console.log("La cuenta de cada idea");
// Idea → globos de látex que flotan, como lo dice su texto. El doble globo cuenta solo el de fuera; los foil no entran.
const CUENTAS: ReadonlyArray<readonly [string, number, string]> = [
  ["idea:arana-graffiti-invierno-violeta", 9, "9 R-12 de helio contados en 3 pisos (3 lisos y 6 dobles)"],
  ["idea:calabaza-verde-lima-negro", 7, "7 globos de helio contados en 3 pisos (una calabaza)"],
  ["idea:arreglo-organico-con-decoraciones", 7, "el ramo de 7 R-12 de helio por pisos (dos calabazas)"],
  ["idea:bautizo-unisex", 15, "dos ramos de helio: 7 y 8"],
  ["idea:huevos-de-pascua-polka", 6, "de cada huevo un ramo de 3 R-12 de helio (el huevo de pie es de aire)"],
  ["idea:dorado-eucalipto-arena", 10, "4 arena, 2 eucalipto, 3 dorados y la burbuja R-24 de arriba"],
  ["idea:buho", 3, "los tres globos de helio uno por piso (dos con lunares)"],
  ["idea:centro-de-mesa-feliz-cumpleanos", 3, "tres R-12 con lunares de helio (el foil no entra)"],
  ["idea:bouquet-tenebroso", 7, "el ramo de 7 R-12 de helio (uno con cara de calavera)"],
  ["idea:columna-lady-bug", 4, "el ramo de 4 R-12 de helio (uno con lunares dibujados)"],
  ["idea:columna-mariquita", 4, "el ramo de 4 R-12 de helio (uno con lunares dibujados)"],
  ["idea:destello-de-corazones", 4, "la medusa de helio: el cuarteto de R-12 (los corazones de las puntas, de aire)"],
  ["idea:celebra-con-mama", 10, "dos ramos de helio de 6 y 5 globos (uno es un corazón foil)"],
  ["idea:centro-de-mesa-del-oeste", 2, "dos con helio (café y mostaza)"],
  ["idea:centro-de-mesa-futbol", 3, "tres balones de colores con helio"],
  ["idea:columna-organica-encanto-dorado", 5, "el ramo de 5 R-12 de cristal con helio"],
  ["idea:desayuno-sorpresa", 1, "un R-12 rosado con helio"],
  ["idea:flor-de-corazones-dorados", 3, "tres R-12 de helio"],
  ["idea:ocasiones-especiales-trufa-y-champana", 3, "el ramo de 3 R-12 champaña de helio"],
  ["idea:centro-de-mesa-feliz-dia-mami", 1, "el corazón rojo de helio"],
  ["idea:farol-encantado", 3, "tres R-12 de helio con su cinta"],
  ["idea:feliz-navidad", 1, "un R-24 rojo arriba (helio, contra el techo)"],
  ["idea:flor-de-corazones", 2, "dos R-12 de helio"],
  ["idea:flor-destellos", 3, "tres R-12 de helio"],
  ["idea:bouquet-filigree-con-base", 3, "3 R-12 de helio uno sobre otro"],
  ["idea:bouquet", 2, "dos R-12 de helio (la estrella foil no entra)"],
  ["idea:centro-de-mesa-primera-comunion", 3, "tres R-12 de helio (las estrellas foil no entran)"],
  ["idea:regalo-con-corazones", 3, "tres R-12 de helio (los corazones foil no entran)"],
  ["idea:dorado-cristal-rojo-verde-lima-chocolate-arena", 13, "ramo por pisos de R-12 (13 con su cinta)"],
  ["idea:ocean-hues-1", 14, "ramo por pisos de R-12 (14 con su cinta)"],
];
prueba(`${CUENTAS.length} ideas dan en la escena armada los globos de helio que dice su texto`, () => {
  const mal: string[] = [];
  for (const [id, esperados, porQue] of CUENTAS) {
    const item = BIBLIOTECA_FABRICA.find((x) => x.id === id) ?? assert.fail(`no existe ${id}`);
    const escena = escenaDeItem(item);
    const armada = armarEscena(escena);
    const resumen = resumenHelio(gruposDeHelio(escena.nodos, armada.porNodo));
    const globos = resumen?.globos ?? 0;
    if (globos !== esperados) mal.push(`${id}: ${globos} en vez de ${esperados} (${porQue})`);
  }
  assert.deepEqual(mal, []);
});

console.log("Lo que va de aire no se marca");
// [idea, pieza, por qué es de aire]
const DE_AIRE: ReadonlyArray<readonly [string, string, string]> = [
  ["idea:malla-marina", "ramo-izquierdo-globo-1", "el ramo va en varillas, no en cintas de helio"],
  ["idea:malla-marina", "ramo-derecho-globo-1", "el ramo va en varillas, no en cintas de helio"],
  ["idea:huevos-de-pascua-polka", "ramo-rosado-huevo", "el huevo está de pie en el piso"],
  ["idea:huevos-de-pascua-polka", "ramo-verde-huevo", "el huevo está de pie en el piso"],
  ["idea:huevos-de-pascua-polka", "piso-1", "van en el piso"],
  ["idea:decoracion-corazones-surtidos", "peso", "es el peso del ramo"],
  ["idea:bouquet", "base-1", "es la base de números, de aire"],
  ["idea:bouquet-filigree-con-base", "anillo-1-1", "el anillo de la base es de aire"],
  ["idea:centro-de-mesa-futbol", "balon", "el balón blanco va encima de la columna"],
  ["idea:centro-de-mesa-del-oeste", "remate", "el remate va encima de la columna"],
  ["idea:celebra-con-mama", "eslabon-1", "es un eslabón de la malla de pared"],
  ["idea:feliz-navidad", "centro", "es el R-5 del cuarteto que cuelga del R-24"],
  ["idea:destello-de-corazones", "corazon-1", "el corazón de la punta del tentáculo, medio inflado"],
  ["idea:algas-marinas", "base", "es la base de la que salen las algas"],
];
prueba(`${DE_AIRE.length} globos que son de aire no llevan la marca ni cuentan en los litros`, () => {
  for (const [idea, id, porQue] of DE_AIRE) {
    const n = nodo(idea, id);
    assert.equal(marcadaEnDatos(n.pieza), false, `${idea} › ${id}: ${porQue}`);
    assert.equal(flotaArmada(n.pieza), false, `${idea} › ${id}: ${porQue}`);
  }
});
prueba("ninguna pieza marcada se llama peso, base, de pie, varilla o del piso", () => {
  const raras: string[] = [];
  for (const f of fuentes) for (const n of f.nodos) if (marcadaEnDatos(n.pieza) && /\b(peso|pesa|base|de pie|varillas?|en el piso|del piso)\b/i.test(n.nombre)) raras.push(`${f.id} › ${n.id} «${n.nombre}»`);
  assert.deepEqual(raras, []);
});
prueba("un tubito o un Link-O-Loon marcado no cuenta: solo flotan los redondos y los corazones", () => {
  assert.equal(flotaArmada({ tipo: "globo", formatoId: "LOL-12", infladoCm: 25, codigo: "015", helio: true }), false);
  assert.equal(flotaArmada({ tipo: "globo", formatoId: "C-12", infladoCm: 28, codigo: "015", helio: true }), true);
});

console.log("Lo derivado de la biblioteca distingue el helio");
prueba("la clave de una pieza cuenta si flota, en el globo suelto y en la decoración (aunque la decoración no cuente su orientación)", () => {
  const globo: Pieza = { tipo: "globo", formatoId: "R-12", infladoCm: 28, codigo: "021" };
  const calabaza: Pieza = { tipo: "decoracion", decoracion: { tipo: "calabaza", propiedades: { globo: { formatoId: "R-12", infladoCm: 28, codigo: "061" }, cara: { hex: "#141414" }, tallo: null } } };
  for (const p of [globo, calabaza]) {
    assert.notEqual(clavePieza(p), clavePieza({ ...p, helio: true }), p.tipo);
    assert.equal(clavePieza({ ...p, helio: true }), clavePieza({ ...p, helio: true }));
  }
  const girada: Pieza = { ...calabaza, deFrente: true };
  assert.equal(clavePieza(girada), clavePieza(calabaza), "la orientación sigue sin contar");
  assert.equal(nombreConHelio({ ...globo, helio: true }, "R-12 Fashion Arena"), "R-12 Fashion Arena con helio");
  assert.equal(nombreConHelio({ ...globo, helio: true }, "R-12 café con helio"), "R-12 café con helio");
  assert.equal(nombreConHelio(globo, "R-12 Fashion Arena"), "R-12 Fashion Arena");
});
prueba("todo item derivado cuya pieza flota lleva «helio» en el nombre", () => {
  const sinNombre: string[] = [];
  let flotan = 0;
  for (const i of bibliotecaCompleta()) {
    if (!i.derivado || i.contenido.tipo !== "pieza" || (i.tipo !== "decoracion" && i.tipo !== "utileria")) continue;
    const flota = llevaHelio(i.contenido.pieza);
    if (flota) flotan += 1;
    if (flota && !/helio/i.test(i.nombre)) sinNombre.push(`${i.id} «${i.nombre}»`);
  }
  assert.ok(flotan > 120, `${flotan} items derivados flotan`);
  assert.deepEqual(sinNombre, []);
});

console.log(`${pruebas} pruebas en verde`);
