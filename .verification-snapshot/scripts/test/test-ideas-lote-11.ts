/**
 * Lote 11 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-11.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 10 del lote (`clasif/lote-11.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus etiquetas
 *   (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`);
 * - cada idea arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se fabrica en
 *   su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad (lo contado en la
 *   foto); los impresos de la tienda van con el látex de su globo; los publicados, tal cual (nombre, url y código);
 * - en las escenas, cada estructura raíz se extrae con `extraerConjunto`: entran todos sus miembros y sola arma lo mismo
 *   (materiales y cada globo en su sitio) que su rama; en las 7 escenas del lote (#458, #471, #473, #476, #478, #515,
 *   #573) toda estructura de globos es raíz (solo los metalizados cuelgan de otra pieza) y la escenografía va aparte;
 *   se comprueba qué lleva cada una; `indexarEscena` da al menos un conjunto por estructura raíz;
 * - lo contado en las fotos (nudos de la malla, módulos de las columnas, estrellas, cuartetos y collares, balones,
 *   impresos) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente; al indexar, lo de sus escenas sale con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_11 } from "../../src/lib/globos3d/ideas-sempertex/lote-11";
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [458, 471, 473, 476, 478, 479, 498, 515, 539, 573];
const ESCENAS_DEL_LOTE = [458, 471, 473, 476, 478, 515, 573];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 10 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_11.map((i) => i.numero), NUMEROS, "los 10 números del lote 11, en orden");
assert.equal(new Set(LOTE_11.map((i) => i.id)).size, 10, "ids sin repetir");
for (const i of LOTE_11) {
  const que = `${i.numero} ${i.slug}`;
  assert.equal(i.id, `idea:${i.slug}`, `${que}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 120, `${que}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${que}: la nota dice qué quedó igual y qué no`);
  const fuente = fuenteIdea(i.slug);
  assert.ok(fuente, `${que}: está en las fuentes`);
  assert.equal(fuente!.numero, i.numero, `${que}: número del índice`);
  assert.equal(i.fotoUrl, fuente!.fotoUrl, `${que}: la foto de su fuente`);
  assert.deepEqual(i.ocasiones, ocasionesDeEtiquetas(fuente!.etiquetas), `${que}: ocasiones de sus etiquetas`);
  assert.ok(i.ocasiones.every((o) => OCASIONES.includes(o)), `${que}: ocasiones de la lista`);
  const foto = new URL(i.fotoUrl);
  assert.ok(foto.protocol === "https:" && foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${que}: foto https del CDN de Sempertex`);
  assert.equal(i.contenido.tipo, "escena", `${que}: va como escena (con su sala)`);
}
console.log("OK lote: 10 ideas con id, nota, ocasiones de sus etiquetas y foto de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
const escenaDe = (i: (typeof LOTE_11)[number]): Escena => (i.contenido.tipo === "escena" ? i.contenido.escena : { sala: { anchoCm: 600, fondoCm: 500, altoCm: 320, tonos: { piso: "#ccc", paredes: "#eee", techo: "#fff" }, mostrar: { piso: true, fondo: true, laterales: true, techo: true } }, nodos: [{ id: "pieza", nombre: "pieza", pieza: i.contenido.pieza, colocacion: i.contenido.sugerida ?? { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] });
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0;
for (const i of LOTE_11) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenaDe(i);
  const a = armarEscena(escena);
  armadas.set(i.numero, a);
  assert.deepEqual(a.avisos, [], `${que}: arma sin avisos`);
  assert.ok(a.porNodo.every((n) => n.copias > 0), `${que}: cada pieza quedó puesta`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  for (const n of a.porNodo) {
    assert.ok(n.caja.min.y >= -1, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= a.sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo`);
    assert.ok(Math.abs(n.caja.min.x) <= a.sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= a.sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -a.sala.fondoCm / 2 - 1 && n.caja.max.z <= a.sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo`);
  }
  assert.ok(a.globos.length > 0, `${que}: tiene globos`);
  globosTotales += a.globos.length;
  for (const g of a.globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f, `${que}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${que}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(g.infladoCm >= f!.diametroMaxCm * 0.4 - 0.01 && g.infladoCm <= f!.diametroMaxCm + 0.01, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm`);
  }
  for (const t of a.tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    assert.ok(f && f.tipo === "tubito", `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
  }
}
console.log(`OK armado: 10 ideas sin avisos y dentro de su sala, ${globosTotales} globos en colores que se fabrican en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

let lineas = 0, impresos = 0;
for (const i of LOTE_11) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  const pedidos = new Map<string, number>();
  for (const p of i.productos) {
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    assert.ok(p.formato && p.codigo && coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
    if (impresoPorUrl(p.url)) impresos += p.cantidad;
  }
  // Sin cantidad, solo un publicado que la foto no muestra (y que entonces no está en el 3D).
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(!del3D.has(clave(p.formato, p.codigo)) || p.codigo === null, `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  // Los impresos que lleva el 3D salen con su producto de la tienda y su cantidad.
  const globosImpresos = a.globos.filter((g) => g.estampado?.impreso).length;
  const deImpresos = i.productos.filter((p) => p.cantidad !== null && impresoPorUrl(p.url)).reduce((s, p) => s + p.cantidad!, 0);
  assert.equal(deImpresos, globosImpresos, `${que}: ${globosImpresos} globos impresos con su producto`);
  lineas += pedidos.size;
}
// Los impresos de cada idea, por producto y látex.
const impresosDe = (n: number) => Object.fromEntries(LOTE_11.find((i) => i.numero === n)!.productos.filter((p) => p.cantidad !== null && impresoPorUrl(p.url)).map((p) => [`${impresoPorUrl(p.url)!.id}|${p.formato}|${p.codigo}`, p.cantidad ?? 0]));
assert.deepEqual(impresosDe(476), {
  "infinity-feliz-ano-estrellas-fashion-negro|R-24|080": 1, "2-caras-feliz-ano-estrellas-reflex-surtido|R-12|970": 1, "2-caras-feliz-ano-estrellas-reflex-surtido|R-12|981": 1, "infinity-feliz-ano-estrellas-satin-y-metal-surtido-deluxe|R-12|080": 1,
}, "#476: el R-24 Feliz Año y los 3 impresos del ramo (dos productos en la misma pieza, cada uno con lo suyo)");
assert.deepEqual(impresosDe(479), { "globo-redondo-infinity-futbolmania-blanco|R-12|005": 7, "infinity-balon-de-futbol-fashion-blanco|R-24|005": 3 }, "#479: 7 Futbolmanía y 3 balones R-24");
assert.deepEqual(impresosDe(573), { "infinity-arana-metalink-fashion-negro|R-12|080": 6 }, "#573: 3 Araña Metalink en cada pie");
{
  const cb = impresosDe(471);
  const total = Object.values(cb).reduce((s, n) => s + n, 0);
  assert.ok(total >= 30 && total <= 46 && Object.keys(cb).every((k) => k.startsWith("infinity-corazones-brillantes-fashion-metal-surtido|R-12|")), `#471: Corazones Brillantes en la proporción contada (${total})`);
}
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (${impresos} globos impresos de la tienda)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Las estructuras raíz de cada escena se extraen con lo suyo
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
type Rama = { nodo: string; ids: string[]; materiales: string[] };
const colgada = (c: Escena["nodos"][number]["colocacion"]) => c.en === "ancla" || c.en === "sobre";
/** Las raíces: estructuras de globos que no cuelgan de otra pieza. */
const raices = (escena: Escena) => escena.nodos.filter((n) => !colgada(n.colocacion) && clasePieza(n.pieza) === "estructura").map((n) => n.id);
const ramas = new Map<number, Rama[]>();
let extraidas = 0, enSuSitio = 0;
for (const i of LOTE_11) {
  if (i.contenido.tipo !== "escena") continue;
  const escena = i.contenido.escena, armada = armadas.get(i.numero)!;
  const lista: Rama[] = [];
  for (const id of raices(escena)) {
    const que = `${i.numero} / ${id}`;
    const conjunto = extraerConjunto(escena, id, { armada });
    assert.ok(conjunto, `${que}: sale el conjunto`);
    const ids = miembrosDeConjunto(escena, id, armada);
    assert.equal(conjunto!.hijos.length, ids.length - 1, `${que}: entran todos sus miembros`);
    const deLaRama = armada.porNodo.filter((n) => ids.includes(n.id));
    const materiales = ordenar(sumarMateriales(...deLaRama.map((n) => n.materiales)));
    const sola = armarEscena(escenaDeConjunto(conjunto!, { sala: escena.sala, donde: conjunto!.sugerida }));
    assert.deepEqual(sola.avisos, [], `${que}: sola arma sin avisos`);
    assert.deepEqual(ordenar(sola.materiales), materiales, `${que}: sola gasta exactamente lo de su rama`);
    const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(1)}|${g.nudo.y.toFixed(1)}|${g.nudo.z.toFixed(1)}`.replace(/-0\.0(?!\d)/g, "0.0");
    assert.deepEqual(sola.globos.map(firma).sort(), deLaRama.flatMap((n) => n.globos).map(firma).sort(), `${que}: cada globo en su sitio`);
    assert.deepEqual(ordenar(armarEscena(escenaDeConjunto(conjunto!)).materiales), materiales, `${que}: en el origen, lo mismo`);
    enSuSitio += sola.globos.length;
    extraidas++;
    lista.push({ nodo: id, ids, materiales });
  }
  ramas.set(i.numero, lista);
}
const rama = (n: number, nodo: string) => ramas.get(n)!.find((r) => r.nodo === nodo)!;
const hijos = (n: number, nodo: string, prefijo: string) => rama(n, nodo).ids.filter((x) => x.startsWith(prefijo)).length;
// En las 7 escenas del lote: toda estructura de globos es raíz (solo un metalizado puede colgar de otra pieza) y nada de
// escenografía cuelga de ella.
for (const n of ESCENAS_DEL_LOTE) {
  const i = LOTE_11.find((x) => x.numero === n)!;
  if (i.contenido.tipo !== "escena") throw new Error(`${n} es una escena`);
  const escena = i.contenido.escena;
  const estructuras = escena.nodos.filter((x) => clasePieza(x.pieza) === "estructura" && x.pieza.tipo !== "metalizado").map((x) => x.id);
  assert.deepEqual(raices(escena).filter((id) => estructuras.includes(id)), estructuras, `#${n}: cada estructura de globos es un nodo raíz`);
  for (const r of ramas.get(n)!) for (const id of r.ids.slice(1)) assert.notEqual(clasePieza(escena.nodos.find((x) => x.id === id)!.pieza), "escenografia", `#${n} ${r.nodo}: la escenografía no va con la estructura`);
}
// Qué lleva cada estructura (lo de la foto).
assert.deepEqual(rama(458, "malla").materiales, ["R-5|014|152", "R-5|020|196"], "#458: la malla sola (152 eslabones frambuesa y 98 parejas amarillas)");
assert.equal(hijos(471, "arco", "grande-"), 3, "#471: el arco lleva sus 3 R-24 rosados");
assert.deepEqual(rama(473, "aro").ids, ["aro", "cromado-grande"], "#473: el aro con su R-18 cromado (el ramo va aparte)");
assert.equal(hijos(476, "guirnalda", "impreso-gigante"), 1, "#476: la guirnalda lleva el R-24 Feliz Año");
assert.deepEqual(rama(476, "peso").ids, ["peso", "ramo", "metalizado"], "#476: el peso con su ramo y su metalizado");
for (const [id, modulos] of [["colgante-izquierda", 7], ["colgante-dentro", 5], ["colgante-centro", 3], ["colgante-derecha", 12]] as const) {
  assert.equal(rama(478, id).ids.filter((x) => /-(arriba|abajo)-/.test(x)).length, modulos, `#478 ${id}: ${modulos} módulos colgados`);
  assert.equal(hijos(478, id, `${id}-arana`), 1, `#478 ${id}: su araña al pie`);
}
assert.equal(hijos(478, "colgante-centro", "arana-chica"), 3, "#478: 3 arañitas bajo la columna del centro");
for (const id of ["columna-mesa-izquierda", "columna-mesa-derecha"]) assert.equal(hijos(478, id, `${id}-aro`), 3, `#478 ${id}: 3 aros violeta`);
assert.equal(hijos(478, "columna-mesa-izquierda", "columna-mesa-izquierda-arana") + hijos(478, "columna-mesa-derecha", "columna-mesa-derecha-arana"), 5, "#478: 5 arañitas en las columnas de la mesa");
assert.equal(hijos(515, "pared", "estrella-"), 11, "#515: la pared lleva sus 11 estrellas");
assert.equal(hijos(573, "arco", "collar-"), 12, "#573: 12 collares violeta entre los cuartetos");
assert.equal(hijos(573, "arco", "metalink-"), 6, "#573: 3 Araña Metalink en cada pie");
// Las estructuras sueltas: el arco mundialista (3 tramos), el árbol y la columna, con lo suyo.
assert.deepEqual(ramas.get(479)!.map((r) => r.nodo), ["arco", "negro", "blanco"], "#479: tres estructuras (verde, negro y blanco)");
assert.equal(hijos(479, "arco", "balon-"), 3, "#479: los 3 balones van con lo verde");
assert.equal(hijos(479, "arco", "trebol-"), 3, "#479: los 3 tréboles");
assert.deepEqual(["arco", "negro", "blanco"].map((id) => hijos(479, id, "futbolmania-")), [2, 2, 3], "#479: 2 + 2 + 3 Futbolmanía");
assert.deepEqual(rama(498, "tronco").ids, ["tronco", "copa", "tubito-1", "tubito-2", "tubito-3", "tubito-4"], "#498: el tronco con su copa y 4 tubitos");
assert.equal(rama(539, "columna").ids.length, 11, "#539: la columna con su tallo, el R-24, 3 tirabuzones, 3 capullos y 2 moños");
console.log(`OK escenas: ${extraidas} estructuras raíz se extraen con lo suyo (${enSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodo = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!;
const porCodigo = (n: number, filtro: (g: { formatoId: string; codigo: string }) => boolean = () => true) => {
  const cuenta: Record<string, number> = {};
  for (const g of armadas.get(n)!.globos.filter(filtro)) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
// #458: la malla de 4,4 m × 46 cm: 5 filas de nudos (las 3 de la foto y los bordes).
{
  const nudos = new Set(nodo(458, "malla").globos.filter((g) => g.codigo === "020").map((g) => g.nudo.y.toFixed(0)));
  assert.equal(nudos.size, 5, "#458: 5 filas de nudos amarillos");
}
// #478: módulos de las columnas colgadas: R-12 negros (4, 2 y 4 pares) y R-9 negros (3).
assert.equal(["colgante-izquierda", "colgante-centro", "colgante-derecha"].flatMap((id) => armadas.get(478)!.porNodo.filter((x) => x.id.startsWith(`${id}-`) && /-(arriba|abajo)-/.test(x.id))).flatMap((x) => x.globos).filter((g) => g.formatoId === "R-12").length, 4 + 2 + 8, "#478: R-12 negros de las columnas colgadas (4, 2 y 4 pares)");
assert.equal(armadas.get(478)!.porNodo.filter((x) => /^colgante-dentro-(arriba|abajo)/.test(x.id)).flatMap((x) => x.globos).filter((g) => g.formatoId === "R-9").length, 3, "#478: 3 R-9 negros en la de dentro");
assert.equal(armadas.get(478)!.porNodo.filter((x) => x.id.startsWith("calabaza-")).length, 8, "#478: 8 calabacitas");
assert.equal(nodo(478, "columna-mesa-izquierda").globos.length, 20, "#478: columna de la mesa de 5 cuartetos");
// #573: 13 cuartetos verde lima y 12 collares de 4 R-5 violeta.
assert.equal(porCodigo(573)["R-12|031"], 52 + 3, "#573: 13 cuartetos verde lima (y 3 globos-ojo)");
assert.equal(porCodigo(573)["R-5|051"], 48, "#573: 12 collares de 4 R-5");
// #479: 3 balones R-24, 7 Futbolmanía; #515: 11 estrellas; #498: la copa en 4 verdes.
assert.equal(porCodigo(479)["R-24|005"], 3, "#479: 3 balones");
assert.equal(armadas.get(515)!.porNodo.filter((x) => x.id.startsWith("estrella-")).length, 11, "#515: 11 estrellas");
assert.deepEqual(Object.keys(porCodigo(498, (g) => g.formatoId === "R-12" && g.codigo !== "076")).sort(), ["R-12|027", "R-12|030", "R-12|031", "R-12|032"], "#498: la copa en los 4 verdes publicados");
// Alturas y anchos (cm).
const alto = (n: number, ids?: string[]) => Math.max(...armadas.get(n)!.porNodo.filter((x) => !ids || ids.includes(x.id)).map((x) => x.caja.max.y));
const ancho = (n: number, id: string) => nodo(n, id).caja.max.x - nodo(n, id).caja.min.x;
for (const [n, ids, min, max] of [
  [471, ["arco"], 245, 285], [473, ["aro"], 270, 305], [476, ["guirnalda"], 205, 235], [479, ["arco"], 215, 245], [498, ["copa"], 255, 290], [539, ["remate"], 190, 215], [573, ["arco"], 225, 250], [515, ["pared"], 220, 245],
] as const) assert.ok(alto(n, [...ids]) >= min && alto(n, [...ids]) <= max, `#${n}: alto ${alto(n, [...ids]).toFixed(0)} cm`);
for (const [n, id, min, max] of [[458, "malla", 420, 460], [471, "arco", 300, 360], [473, "aro", 270, 310], [515, "pared", 350, 375], [573, "arco", 190, 215]] as const) assert.ok(ancho(n, id) >= min && ancho(n, id) <= max, `#${n}: ${id} de ${ancho(n, id).toFixed(0)} cm de ancho`);
console.log("OK conteos: nudos, módulos, cuartetos, collares, balones, estrellas, colores y medidas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_11) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  if (item!.contenido.tipo === "escena") {
    const derivadosDe = indexarEscena(item!, armadas.get(i.numero));
    assert.ok(derivadosDe.length > 0 && derivadosDe.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
    const nombres = derivadosDe.map((h) => `${h.tipo}|${h.nombre}`);
    assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir`);
    // Al menos un conjunto (o una estructura sola) por estructura raíz: cada raíz aparece en lo derivado.
    for (const r of ramas.get(i.numero) ?? []) assert.ok(derivadosDe.some((h) => h.apareceEn?.[0]?.nodoIds.includes(r.nodo)), `${i.id}: «${r.nodo}» sale como conjunto al indexar`);
    derivados += derivadosDe.length;
  }
}
console.log(`OK biblioteca: las 10 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas`);

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

/** Publicados cuyo formato se corrigió con la foto (el mapeo lo deduce del nombre: R-12). */
const FORMATO_CORREGIDO = new Set(["476|970"]);
const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-11.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; tipo: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-11.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-11.json");
  for (const i of LOTE_11) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    // Los globos publicados (platos, vasos y servilletas van como utilería de la escena, no en la lista de globos).
    for (const m of (datos.productos_mapeados ?? []).filter((x) => x.tipo.startsWith("globo"))) {
      const mio = i.productos.find((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mio, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) {
        assert.equal(mio!.codigo, m.codigo, `${i.slug}: código de «${m.nombre}»`);
        if (!FORMATO_CORREGIDO.has(`${i.numero}|${m.codigo}`)) assert.equal(mio!.formato, m.formato, `${i.slug}: formato de «${m.nombre}»`);
      }
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-11");
