/**
 * Lote 13 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-13.ts`): nueve
 * escenas completas. Sin coste: no llama a ninguna IA ni a la red.
 * - son las 9 del lote (`clasif/lote-13.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus etiquetas
 *   (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); la nota dice qué quedó igual y qué no;
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se fabrica
 *   en su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos de la
 *   tienda van con el látex de su globo; lo publicado va tal cual (nombre y url);
 * - cada estructura es su propio árbol: su raíz es ella misma o su armazón (que no tiene globos y lleva sus tramos de
 *   color); `extraerConjunto` de cada raíz trae todos sus miembros y solo arma exactamente lo de su rama (materiales y
 *   cada globo en su sitio); se comprueba qué lleva cada una;
 * - lo contado en las fotos (niveles, flores, ojos, hojas, globos de los ramos, impresos);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, da al menos un conjunto o estructura por
 *   raíz, con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_13 } from "../../src/lib/globos3d/ideas-sempertex/lote-13";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [933, 524, 553, 554, 639, 650, 794, 948, 961];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 9 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_13.map((i) => i.numero), NUMEROS, "los 9 números del lote 13, en orden");
assert.equal(new Set(LOTE_13.map((i) => i.id)).size, NUMEROS.length, "ids sin repetir");
for (const i of LOTE_13) {
  const que = `${i.numero} ${i.slug}`;
  assert.equal(i.id, `idea:${i.slug}`, `${que}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 200, `${que}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${que}: la nota dice qué quedó igual y qué no`);
  assert.equal(i.contenido.tipo, "escena", `${que}: es una escena completa`);
  const fuente = fuenteIdea(i.slug);
  assert.ok(fuente, `${que}: está en las fuentes`);
  assert.equal(fuente!.numero, i.numero, `${que}: número del índice`);
  assert.equal(i.fotoUrl, fuente!.fotoUrl, `${que}: la foto de su fuente`);
  assert.deepEqual(i.ocasiones, ocasionesDeEtiquetas(fuente!.etiquetas), `${que}: ocasiones de sus etiquetas`);
  assert.ok(i.ocasiones.every((o) => OCASIONES.includes(o)), `${que}: ocasiones de la lista`);
  const foto = new URL(i.fotoUrl);
  assert.ok(foto.protocol === "https:" && foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${que}: foto https del CDN de Sempertex`);
}
console.log("OK lote: 9 escenas con id, nota, ocasiones de sus etiquetas y foto de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada escena arma, dentro de su sala, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
const escenaDe = (n: number): Escena => {
  const i = LOTE_13.find((x) => x.numero === n)!;
  if (i.contenido.tipo !== "escena") throw new Error(`${n} es una escena`);
  return i.contenido.escena;
};
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0;
for (const i of LOTE_13) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenaDe(i.numero);
  const a = armarEscena(escena);
  armadas.set(i.numero, a);
  assert.deepEqual(a.avisos, [], `${que}: arma sin avisos`);
  assert.ok(a.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), `${que}: cada pieza quedó puesta`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  for (const n of a.porNodo) {
    assert.ok(n.caja.min.y >= -1, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= a.sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo (${n.caja.max.y.toFixed(1)})`);
    assert.ok(Math.abs(n.caja.min.x) <= a.sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= a.sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -a.sala.fondoCm / 2 - 1 && n.caja.max.z <= a.sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo (${n.caja.min.z.toFixed(1)})`);
  }
  assert.ok(a.globos.length > 150, `${que}: tiene sus globos`);
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
console.log(`OK armado: 9 escenas sin avisos y dentro de su sala, ${globosTotales} globos en colores que se fabrican en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

let lineas = 0, impresos = 0;
for (const i of LOTE_13) {
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
  const globosImpresos = a.globos.filter((g) => g.estampado?.impreso).length;
  const deImpresos = i.productos.filter((p) => p.cantidad !== null && impresoPorUrl(p.url)).reduce((s, p) => s + p.cantidad!, 0);
  assert.equal(deImpresos, globosImpresos, `${que}: ${globosImpresos} globos impresos con su producto`);
  lineas += pedidos.size;
}
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (${impresos} globos impresos de la tienda)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Cada estructura es su propio árbol y se extrae con lo suyo
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
type Rama = { nodo: string; ids: string[]; materiales: string[]; globos: number };
const cuelga = (c: Escena["nodos"][number]["colocacion"]) => c.en === "ancla" || c.en === "sobre";
/** Las raíces: estructuras de globos que no cuelgan de otra pieza, y los armazones (escenografía de la que cuelgan tramos). */
function raices(escena: Escena): string[] {
  const conEstructura = new Set(escena.nodos.filter((n) => cuelga(n.colocacion) && clasePieza(n.pieza) === "estructura").map((n) => (n.colocacion as { padreId: string }).padreId));
  return escena.nodos.filter((n) => !cuelga(n.colocacion) && (clasePieza(n.pieza) === "estructura" || (clasePieza(n.pieza) === "escenografia" && conEstructura.has(n.id)))).map((n) => n.id);
}
const ramas = new Map<number, Rama[]>();
let extraidas = 0, enSuSitio = 0;
for (const i of LOTE_13) {
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const lista: Rama[] = [];
  const raicesDe = raices(escena);
  // Toda estructura de globos es raíz o está en la rama de una raíz; ninguna en dos ramas.
  const vistos = new Map<string, string>();
  for (const id of raicesDe) {
    const que = `${i.numero} / ${id}`;
    const conjunto = extraerConjunto(escena, id, { armada });
    assert.ok(conjunto, `${que}: sale el conjunto`);
    const ids = miembrosDeConjunto(escena, id, armada);
    assert.equal(conjunto!.hijos.length, ids.length - 1, `${que}: entran todos sus miembros`);
    for (const x of ids) { assert.ok(!vistos.has(x), `${que}: «${x}» ya estaba en la rama de ${vistos.get(x)}`); vistos.set(x, id); }
    const deLaRama = armada.porNodo.filter((n) => ids.includes(n.id));
    const materiales = ordenar(sumarMateriales(...deLaRama.map((n) => n.materiales)));
    assert.ok(materiales.length > 0, `${que}: la rama tiene globos`);
    const sola = armarEscena(escenaDeConjunto(conjunto!, { sala: escena.sala, donde: conjunto!.sugerida }));
    assert.deepEqual(sola.avisos, [], `${que}: sola arma sin avisos`);
    assert.deepEqual(ordenar(sola.materiales), materiales, `${que}: sola gasta exactamente lo de su rama`);
    const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(1)}|${g.nudo.y.toFixed(1)}|${g.nudo.z.toFixed(1)}`.replace(/-0\.0(?!\d)/g, "0.0");
    assert.deepEqual(sola.globos.map(firma).sort(), deLaRama.flatMap((n) => n.globos).map(firma).sort(), `${que}: cada globo en su sitio`);
    enSuSitio += sola.globos.length;
    extraidas++;
    lista.push({ nodo: id, ids, materiales, globos: deLaRama.reduce((s, n) => s + n.globos.length, 0) });
  }
  for (const n of escena.nodos.filter((x) => clasePieza(x.pieza) === "estructura")) assert.ok(vistos.has(n.id), `${i.numero}: la estructura «${n.id}» está en un árbol`);
  // Ninguna escenografía (mesas, fondos, utilería) va dentro de la rama de una estructura, salvo el armazón raíz.
  for (const r of lista) for (const id of r.ids.slice(1)) assert.ok(!["escenografia", "utileria"].includes(clasePieza(escena.nodos.find((x) => x.id === id)!.pieza)), `${i.numero} ${r.nodo}: «${id}» no es escenografía`);
  ramas.set(i.numero, lista);
}
const rama = (n: number, nodo: string) => {
  const r = ramas.get(n)!.find((x) => x.nodo === nodo);
  assert.ok(r, `#${n}: «${nodo}» es una raíz`);
  return r!;
};
const conPrefijo = (r: Rama, prefijo: string) => r.ids.filter((x) => x.startsWith(prefijo)).length;
assert.deepEqual(ramas.get(933)!.map((r) => r.nodo), ["columna-1", "columna-2", "columna-3", "columna-4", "columna-perla"], "#933: 5 columnas, cada una raíz");
for (const k of [1, 2, 3, 4]) assert.deepEqual(rama(933, `columna-${k}`).materiales, ["R-12|015|22", "R-12|406|22"], `#933 columna ${k}: 11 niveles en espiral doble`);
assert.deepEqual(rama(933, "columna-perla").materiales, ["R-12|406|20"], "#933: la perla, 5 niveles");
assert.deepEqual(ramas.get(524)!.map((r) => r.nodo).sort(), ["base-ramo", "guirnalda", "malla", "torre"], "#524: malla, guirnalda, torre y base del ramo");
assert.equal(conPrefijo(rama(524, "guirnalda"), "negro-"), 5, "#524: la guirnalda lleva sus 5 negros");
assert.equal(rama(524, "torre").ids.length, 8, "#524: la torre lleva R-24, R-18, 2 calderos violeta y 3 collares");
assert.ok(rama(524, "base-ramo").ids.includes("ramo"), "#524: el ramo va pegado a su base");
assert.ok(rama(524, "malla").materiales.some((m) => m.startsWith("LOL-12|061|")) && rama(524, "malla").materiales.some((m) => m.startsWith("LOL-12|080|")), "#524: malla negra y naranja");
assert.deepEqual(rama(553, "armazon-arco").ids, ["armazon-arco", "tramo-terracota", "tramo-durazno", "r24-nude"], "#553: el arco con sus 2 tramos y el R-24");
assert.deepEqual(rama(553, "armazon-cascada").ids, ["armazon-cascada", "tramo-cafe", "tramo-mostaza", "r24-mostaza"], "#553: la cascada con sus 2 tramos y el R-24");
assert.ok(rama(553, "racimo-canasto").ids.includes("ramo-izquierda"), "#553: el ramo Terra va pegado a su racimo");
assert.equal(conPrefijo(rama(554, "aro"), "tramo-"), 4, "#554: el aro con sus 4 tramos de color");
assert.deepEqual(rama(554, "monticulo").ids.filter((x) => x !== "monticulo").sort(), ["bigotes-azul", "bigotes-mostaza", "ramo-izquierda", "sombrero"], "#554: el montículo con sus 2 globos, el sombrero y el ramo");
assert.equal(conPrefijo(rama(639, "armazon"), "tramo-"), 4, "#639: el arco con sus 4 tramos");
assert.ok(rama(639, "racimo-ramo").ids.includes("ramo"), "#639: el ramo va pegado a su racimo");
assert.ok(rama(650, "racimo-abajo-izquierda").ids.includes("ramo"), "#650: el ramo, con el peso junto al montículo de la izquierda, va pegado a él");
for (const [r, k] of [["racimo-arriba-izquierda", 1], ["racimo-arriba-derecha", 2], ["racimo-abajo-izquierda", 1], ["racimo-abajo-derecha", 2]] as const) assert.equal(conPrefijo(rama(650, r), "ojos-"), k, `#650: ${r} con ${k} par(es) de ojos`);
assert.deepEqual(rama(794, "armazon").ids.filter((x) => x !== "armazon").sort(), ["flor-cafe", "tramo-arena", "tramo-cafe", "tramo-champana", "tramo-pata-derecha", "tramo-pie-izquierdo"], "#794: el marco con sus 5 tramos y la flor");
for (const lado of ["izquierda", "derecha"]) assert.ok(rama(794, `racimito-${lado}`).ids.includes(`ramo-${lado}`), `#794: el ramo de la ${lado} va pegado a su racimito`);
const aro948 = rama(948, "aro");
assert.deepEqual([conPrefijo(aro948, "bejuco-"), conPrefijo(aro948, "hoja-"), conPrefijo(aro948, "bayas-"), conPrefijo(aro948, "flor-")], [6, 12, 8, 9], "#948: el aro con 6 bejucos, 12 hojas, 8 racimitos de bayas y 9 flores (6 en los bejucos y 3 en el racimo)");
for (const lado of ["izquierda", "derecha"]) assert.equal(conPrefijo(rama(948, `base-${lado}`), "flor-"), 3, `#948: la base ${lado} con 3 flores`);
assert.equal(conPrefijo(rama(961, "armazon"), "tramo-"), 8, "#961: el arco con sus 8 bloques de color");
assert.equal(ramas.get(961)!.filter((r) => r.nodo.startsWith("globitos-jaula")).length, 3, "#961: los globitos de las 3 jaulas");
console.log(`OK escenas: ${extraidas} estructuras raíz se extraen con lo suyo (${enSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodo = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!;
const impresosDe = (n: number, id: string) => nodo(n, id).globos.filter((g) => g.estampado?.impreso).length;
// Los ramos: cuántos globos y cuántos impresos de la tienda.
for (const [n, id, globos, conImpreso] of [[524, "ramo", 6, 6], [553, "ramo-izquierda", 5, 3], [553, "ramo-derecha", 3, 1], [554, "ramo-izquierda", 7, 6], [554, "ramo-derecha", 7, 3], [639, "ramo", 7, 7], [650, "ramo", 11, 11], [794, "ramo-izquierda", 7, 1], [794, "ramo-derecha", 6, 0]] as const) {
  assert.equal(nodo(n, id).globos.length, globos, `#${n} ${id}: ${globos} globos`);
  assert.equal(impresosDe(n, id), conImpreso, `#${n} ${id}: ${conImpreso} impresos`);
}
assert.equal(nodo(639, "ramo").globos.filter((g) => g.formatoId === "R-24").length, 1, "#639: el R-24 «Feliz Año»");
assert.ok(impresosDe(639, "racimo-ramo") >= 2 && nodo(639, "racimo-ramo").globos.filter((g) => g.estampado?.impreso).every((g) => g.formatoId === "R-5" && g.codigo === "981"), "#639: las Estrellas Reflex Plata en R-5 plata");
// #948: 15 flores grandes de 5 pétalos (6 globos) y 5 florecitas de 3 (4), 12 hojas y 6 bejucos de T-260 verde lima.
const escena948 = escenaDe(948);
assert.equal(escena948.nodos.filter((x) => x.id.startsWith("flor-")).length, 15, "#948: 15 flores grandes");
assert.ok(escena948.nodos.filter((x) => x.id.startsWith("flor-")).every((x) => nodo(948, x.id).globos.length === 6), "#948: flores de 5 pétalos y su centro");
assert.equal(escena948.nodos.filter((x) => x.id.startsWith("flor-amarilla")).length, 7, "#948: 7 amarillas");
assert.equal(escena948.nodos.filter((x) => x.id.startsWith("florecita-")).length, 5, "#948: 5 florecitas en el pasto");
assert.ok(armadas.get(948)!.tubos.filter((t) => !t.papel).every((t) => t.codigo === "931"), "#948: los tubitos en Reflex Verde Lima");
// #650: 6 pares de ojos (12 globos blancos) y 2 manos de tubito.
assert.equal(escenaDe(650).nodos.filter((x) => x.id.startsWith("ojos-")).reduce((s, x) => s + nodo(650, x.id).globos.length, 0), 12, "#650: 12 ojos");
assert.equal(escenaDe(650).nodos.filter((x) => x.id.startsWith("mano-")).length, 2, "#650: 2 manos");
// #961: cada bloque de color con su color publicado como el de más globos.
for (const [bloque, codigo] of [["lila", "650"], ["azul", "640"], ["verde", "630"], ["amarillo", "620"], ["rosado", "609"]] as const) {
  const cuenta = new Map<string, number>();
  for (const g of nodo(961, `tramo-${bloque}`).globos) cuenta.set(g.codigo, (cuenta.get(g.codigo) ?? 0) + 1);
  assert.equal([...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]![0], codigo, `#961: el bloque ${bloque} es ${codigo}`);
}
// Alturas: las columnas del Grinch ~2,25 m; los arcos de 2,3 a 3,1 m.
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length).map((x) => x.caja.max.y));
assert.ok(nodo(933, "columna-1").caja.max.y >= 215 && nodo(933, "columna-1").caja.max.y <= 235, "#933: columnas de ~2,25 m");
for (const [n, min, max] of [[524, 260, 300], [553, 290, 330], [554, 220, 260], [639, 280, 310], [650, 270, 300], [794, 290, 330], [948, 280, 310], [961, 225, 255]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: columnas, ramos e impresos, flores, ojos, manos, bloques de color y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_13) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  const hijos = indexarEscena(item!, armadas.get(i.numero));
  assert.ok(hijos.length > 0 && hijos.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
  const nombres = hijos.map((h) => `${h.tipo}|${h.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir`);
  for (const r of ramas.get(i.numero)!) assert.ok(hijos.some((h) => (h.tipo === "conjunto" || h.tipo === "estructura") && h.apareceEn![0]!.nodoIds.includes(r.nodo)), `${i.id}: «${r.nodo}» sale como conjunto o estructura`);
  // Todas llevan decoraciones (globos sueltos, ramos, flores, ojos) menos #933 y #961, que solo tienen estructuras.
  if (i.numero !== 933 && i.numero !== 961) assert.ok(hijos.some((h) => h.tipo === "decoracion"), `${i.id}: salen sus decoraciones sueltas`);
  derivados += hijos.length;
}
console.log(`OK biblioteca: las 9 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas (al menos uno por raíz)`);

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

/**
 * Publicados cuya talla del mapeo (R-12, deducida del nombre) no es la de la foto: el surtido Naranja-Negro presta su
 * nombre a las uniones R-5 de la malla (#524) y el Blanco de #650 son los ojos (R-9 y R-5).
 */
const FORMATO_CORREGIDO = new Set(["524|061", "650|005"]);
const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-13.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string; tipo: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-13.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-13.json");
  for (const i of LOTE_13) {
    const c = clasif.find((x) => x.numero === i.numero);
    assert.equal(c?.slug, i.slug, `${i.numero}: slug del índice`);
    assert.equal(c?.tipo, "escena", `${i.numero}: clasificada como escena`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) {
        assert.ok(mios.every((p) => p.codigo === m.codigo), `${i.slug}: código de «${m.nombre}»`);
        if (!FORMATO_CORREGIDO.has(`${i.numero}|${m.codigo}`)) assert.ok(mios.some((p) => p.formato === m.formato), `${i.slug}: formato de «${m.nombre}»`);
      }
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-13");
