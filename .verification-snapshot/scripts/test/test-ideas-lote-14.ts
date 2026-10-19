/**
 * Lote 14 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-14.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-14.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); todas son escenas;
 * - cada idea arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se fabrica en
 *   su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad (lo contado en la
 *   foto), impresos incluidos; los impresos y metalizados de la tienda que usa el 3D existen en su catálogo con su url
 *   y salen en los productos con la cantidad que lleva la escena; los publicados, tal cual;
 * - cada estructura de globos (arco, letras, metalizado) es un nodo raíz, y cada raíz con piezas colgadas se extrae con
 *   `extraerConjunto`: entran todos sus miembros (decoraciones) y sola arma lo mismo (materiales y cada globo en su
 *   sitio) que su rama; `indexarEscena` da al menos un item por cada raíz con globos;
 * - lo contado en las fotos (globos por color e impreso, pisos, nudos, niveles del arco, patas, tubitos) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_14 } from "../../src/lib/globos3d/ideas-sempertex/lote-14";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import { impresoPorId, impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [29, 68, 131, 203, 206, 211, 231, 307, 821, 859, 863, 884, 953, 5, 31];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_14.map((i) => i.numero), NUMEROS, "los 15 números del lote 14, en orden");
assert.equal(new Set(LOTE_14.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_14) {
  const que = `${i.numero} ${i.slug}`;
  assert.equal(i.id, `idea:${i.slug}`, `${que}: id «idea:<slug>»`);
  assert.equal(i.contenido.tipo, "escena", `${que}: es una escena`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 200, `${que}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${que}: la nota dice qué quedó igual y qué no`);
  const fuente = fuenteIdea(i.slug);
  assert.ok(fuente, `${que}: está en las fuentes`);
  assert.equal(fuente!.numero, i.numero, `${que}: número del índice`);
  assert.equal(i.fotoUrl, fuente!.fotoUrl, `${que}: la foto de su fuente`);
  assert.deepEqual(i.ocasiones, ocasionesDeEtiquetas(fuente!.etiquetas), `${que}: ocasiones de sus etiquetas`);
  assert.ok(i.ocasiones.every((o) => OCASIONES.includes(o)), `${que}: ocasiones de la lista`);
  const foto = new URL(i.fotoUrl);
  assert.ok(foto.protocol === "https:" && foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${que}: foto https del CDN de Sempertex`);
}
console.log("OK lote: 15 escenas con id, nota, ocasiones de sus etiquetas y foto de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada escena arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const escenaDe = (i: (typeof LOTE_14)[number]): Escena => {
  if (i.contenido.tipo !== "escena") throw new Error(`${i.numero} es una escena`);
  return i.contenido.escena;
};
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_14) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenaDe(i);
  const a = armarEscena(escena);
  armadas.set(i.numero, a);
  assert.deepEqual(a.avisos, [], `${que}: arma sin avisos`);
  assert.ok(a.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), `${que}: cada pieza quedó puesta`);
  assert.equal(new Set(escena.nodos.map((n) => n.id)).size, escena.nodos.length, `${que}: ids de nodo sin repetir`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  for (const n of a.porNodo) {
    assert.ok(n.caja.min.y >= -1, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= a.sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo`);
    assert.ok(Math.abs(n.caja.min.x) <= a.sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= a.sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -a.sala.fondoCm / 2 - 1 && n.caja.max.z <= a.sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo`);
  }
  assert.ok(a.globos.length + a.tubos.filter((t) => !t.papel).length > 0, `${que}: tiene globos o tubitos`);
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
    tubitosTotales++;
  }
}
console.log(`OK armado: 15 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubitosTotales} tramos de tubito en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea; impresos y metalizados, los de la tienda
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0, impresos = 0, metalizados = 0;
for (const i of LOTE_14) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i);
  // Los impresos y metalizados que usa el 3D existen en su catálogo, con url de la tienda.
  for (const nodo of escena.nodos) {
    for (const pedido of nodo.pieza.impresos ?? []) {
      const imp = impresoPorId(pedido.impresoId);
      assert.ok(imp && imp.url.startsWith("/products/"), `${que}: el impreso «${pedido.impresoId}» de «${nodo.nombre}» está en el catálogo con su url`);
    }
    if (nodo.pieza.tipo === "metalizado") {
      const producto = nodo.pieza.metalizado.producto;
      assert.ok(producto && metalizadoPorUrl(producto.url) && producto.url.startsWith("/products/"), `${que}: el metalizado de «${nodo.nombre}» es uno de la tienda con su url`);
    }
  }
  // Látex: por formato y código, lo de los productos (lisos, impresos y los de la tienda que van en su fondo) es lo del 3D.
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const especiales = new Map<string, number>();
  for (const p of i.productos) {
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    const impreso = impresoPorUrl(p.url);
    if (impreso) {
      impresos += p.cantidad;
      assert.ok(impreso.surtido ? impreso.surtido.includes(p.codigo ?? "") : p.codigo === impreso.codigoBase, `${que}: «${p.nombre}» en un color del impreso (${p.codigo})`);
      especiales.set(p.url, (especiales.get(p.url) ?? 0) + p.cantidad);
    }
    if (p.formato === null) {
      assert.ok(metalizadoPorUrl(p.url), `${que}: «${p.nombre}» sin formato es un metalizado de la tienda`);
      metalizados += p.cantidad;
      especiales.set(p.url, (especiales.get(p.url) ?? 0) + p.cantidad);
      continue;
    }
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.codigo && coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    assert.equal(formatoPorId(p.formato)?.tipo, formatoPorId(p.nombre.includes("TUBITO") ? "T-260" : "R-12")?.tipo, `${que}: «${p.nombre}» del tipo de su nombre (${p.formato})`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  // Impresos del catálogo y metalizados: los de la escena armada (cada pieza con sus productos, por sus copias).
  const deLaEscena = new Map<string, number>();
  for (const nodo of escena.nodos) {
    const copias = a.porNodo.find((n) => n.id === nodo.id)!.copias;
    for (const p of armarPieza(nodo.pieza).productos ?? []) deLaEscena.set(p.url, (deLaEscena.get(p.url) ?? 0) + p.cantidad * copias);
  }
  assert.deepEqual([...especiales.entries()].sort(), [...deLaEscena.entries()].sort(), `${que}: impresos y metalizados = los de la escena armada`);
  // Sin cantidad, solo un publicado que la foto no muestra (y que entonces no está en el 3D).
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(!del3D.has(clave(p.formato, p.codigo)), `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  lineas += pedidos.size;
}
console.log(`OK productos: ${lineas} líneas de látex cuadran con el 3D; ${impresos} globos impresos y ${metalizados} metalizados de la tienda con su producto`);

// ----------------------------------------------------------------------------------------------------------
// 4. Cada estructura es una raíz y cada raíz se extrae con lo suyo
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
type Rama = { nodo: string; ids: string[] };
const ramas = new Map<number, Rama[]>();
let extraidas = 0, enSuSitio = 0, items = 0;
for (const i of LOTE_14) {
  const escena = escenaDe(i), armada = armadas.get(i.numero)!;
  for (const n of escena.nodos.filter((x) => clasePieza(x.pieza) === "estructura")) assert.ok(n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre", `#${i.numero}: «${n.nombre}» (estructura) es raíz`);
  const raices = escena.nodos.filter((n) => n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre");
  const lista: Rama[] = [];
  for (const raiz of raices) {
    const que = `#${i.numero} / ${raiz.id}`;
    const ids = miembrosDeConjunto(escena, raiz.id, armada);
    if (ids.length < 2) continue;
    const conjunto = extraerConjunto(escena, raiz.id, { armada });
    assert.ok(conjunto, `${que}: sale el conjunto`);
    assert.equal(conjunto!.hijos.length, ids.length - 1, `${que}: entran todos sus miembros`);
    for (const id of ids.slice(1)) assert.equal(clasePieza(escena.nodos.find((x) => x.id === id)!.pieza), "decoracion", `${que}: «${id}» es una decoración suya`);
    const deLaRama = armada.porNodo.filter((n) => ids.includes(n.id));
    const materiales = ordenar(sumarMateriales(...deLaRama.map((n) => n.materiales)));
    const sola = armarEscena(escenaDeConjunto(conjunto!, { sala: escena.sala, donde: conjunto!.sugerida }));
    assert.deepEqual(sola.avisos, [], `${que}: sola arma sin avisos`);
    assert.deepEqual(ordenar(sola.materiales), materiales, `${que}: sola gasta exactamente lo de su rama`);
    const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(1)}|${g.nudo.y.toFixed(1)}|${g.nudo.z.toFixed(1)}`.replace(/-0\.0(?!\d)/g, "0.0");
    assert.deepEqual(sola.globos.map(firma).sort(), deLaRama.flatMap((n) => n.globos).map(firma).sort(), `${que}: cada globo en su sitio`);
    enSuSitio += sola.globos.length;
    extraidas++;
    lista.push({ nodo: raiz.id, ids });
  }
  ramas.set(i.numero, lista);
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  const hijos = indexarEscena(item!, armada);
  for (const raiz of raices.filter((r) => clasePieza(r.pieza) === "estructura")) {
    const suyo = hijos.find((h) => (h.tipo === "estructura" || h.tipo === "conjunto") && h.apareceEn?.[0]?.nodoIds.includes(raiz.id));
    assert.ok(suyo, `#${i.numero}: «${raiz.nombre}» sale como item de la biblioteca`);
  }
  const nombres = hijos.map((h) => `${h.tipo}|${h.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir`);
  items += hijos.length;
}
const rama = (n: number, nodo: string) => ramas.get(n)!.find((r) => r.nodo === nodo);
assert.equal(rama(68, "cordon")!.ids.length - 1, 44, "#68: el cordón lleva los 8 eslabones y los 36 R-5");
assert.equal(rama(131, "arco")!.ids.length - 1, 1, "#131: el arco lleva su relleno de R-5 (un nodo repartido en sus huecos)");
assert.equal(rama(31, "hilo")!.ids.length - 1, 12, "#31: el hilo lleva cuerpo, 2 ojos, boca y 8 patas");
for (const n of [29, 231, 821, 859, 863, 953]) assert.equal(rama(n, "peso")!.ids.length - 1, n === 231 ? 7 : n === 29 ? 9 : 11, `#${n}: el peso lleva cada globo del ramo`);
console.log(`OK escenas: ${extraidas} raíces se extraen con lo suyo (${enSuSitio} globos en su sitio); ${items} items al indexarlas`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const porCodigo = (n: number, filtro: (id: string) => boolean = () => true) => {
  const cuenta: Record<string, number> = {};
  for (const x of armadas.get(n)!.porNodo.filter((y) => filtro(y.id))) for (const g of x.globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
const impresosDe = (n: number) => armadas.get(n)!.globos.filter((g) => g.estampado?.impreso).length;
const nodo = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!;
const metalizadosDe = (n: number) => escenaDe(LOTE_14.find((i) => i.numero === n)!).nodos.filter((x) => x.pieza.tipo === "metalizado").map((x) => (x.pieza.tipo === "metalizado" ? x.pieza.metalizado.producto?.url ?? "" : "")).sort();
// Ramos por pisos.
assert.deepEqual(porCodigo(29), { "R-12|051": 3, "R-12|481": 3, "R-12|061": 3, "R-12|390": 3, "R-12|981": 3 }, "#29: 3 dobles violeta, 3 naranja, 3 dobles araña");
assert.equal(impresosDe(29), 3, "#29: las 3 arañas impresas");
assert.deepEqual(porCodigo(231), { "R-12|080": 3, "R-12|931": 3, "R-18|061": 1 }, "#231: 3 negro, 3 verde lima y la calabaza");
assert.ok(nodo(231, "globo-3-1").tubos.length >= 4, "#231: la calabaza con su tallo de lazos");
assert.deepEqual(porCodigo(821), { "R-12|940": 4, "R-12|406": 3, "R-12|970": 4 }, "#821: 4 azul, 3 perla, 4 palomas");
assert.deepEqual(porCodigo(859), { "R-12|440": 5, "R-12|076": 3, "R-12|005": 3 }, "#859: 2 + 3 satín azul, 3 chocolate, 3 blancos");
assert.deepEqual(porCodigo(863), { "R-12|074": 3, "R-12|071": 3, "R-12|530": 2, "R-12|406": 3 }, "#863: 3 café, 3 arena, 2 verde, 3 perla");
assert.deepEqual(porCodigo(953), { "R-12|931": 3, "R-12|044": 2, "R-12|038": 3, "R-12|390": 3 }, "#953: 3 verde lima, 2 naval, 3 caribe, 3 graffiti");
assert.equal(impresosDe(953), 3, "#953: los 3 Graffiti Cielo impresos");
// Arcos.
assert.deepEqual(porCodigo(68), { "R-12|640": 8, "R-5|041": 36 }, "#68: 8 eslabones y 9 cuartetos de R-5");
assert.equal(impresosDe(68), 8, "#68: los 8 eslabones impresos");
assert.deepEqual(porCodigo(131, (id) => id === "arco"), { "R-12|005": 108, "R-12|044": 36 }, "#131: 36 niveles, uno azul en cada uno");
assert.equal(nodo(131, "relleno").copias, 144, "#131: un R-5 en cada hueco");
// Ramos con base y centros de mesa.
assert.equal(Object.values(porCodigo(203, (id) => id.startsWith("anillo"))).reduce((s, x) => s + x, 0), 38, "#203: 38 R-5 en el anillo de la base");
assert.deepEqual(porCodigo(203, (id) => ["rosado", "dorado", "plata"].includes(id)), { "R-12|568": 1, "R-12|570": 1, "R-12|981": 1 }, "#203: los 3 de helio");
assert.equal(nodo(203, "botella").globos.length, 9, "#203: la burbuja con sus 8 R-5 dentro");
assert.deepEqual(metalizadosDe(206), ["/products/globo-metalizado-festivo", "/products/globo-metalizado-festivo"], "#206: dos metalizados de cumpleaños");
assert.equal(Object.values(porCodigo(206, (id) => id.startsWith("cuarteto"))).reduce((s, x) => s + x, 0), 16, "#206: 4 cuartetos de R-5 en las cadenas");
assert.deepEqual(metalizadosDe(211), ["/products/globo-metalizado-estrella-rosada-vibrante", "/products/globo-metalizado-estrella-verde-vibrante"], "#211: la estrella verde y la estrellita");
assert.equal(impresosDe(211), 2, "#211: los 2 «Feliz Día»");
assert.deepEqual(porCodigo(211, (id) => id.startsWith("base")), { "R-5|020": 6 }, "#211: 6 R-5 amarillos en la base");
assert.ok(nodo(211, "numeros").tubos.length > 0, "#211: los números de tubito");
assert.equal(metalizadosDe(307).length, 2, "#307: dos estrellas");
assert.deepEqual(porCodigo(307), { "R-12|412": 1, "R-12|126": 1, "R-12|951": 1 }, "#307: 3 R-12 de helio");
assert.deepEqual(metalizadosDe(884), ["/products/globo-metalizado-corazones-plata", "/products/globo-metalizado-corazones-plata"], "#884: dos corazones plata");
assert.deepEqual(porCodigo(884), { "R-12|015": 2, "R-12|970": 1 }, "#884: 2 Te Amo y 1 dorado");
// Figuras.
assert.deepEqual(porCodigo(5), { "R-12|931": 3, "R-5|931": 10 }, "#5: base, 2 de helio y 5 pares de R-5");
assert.equal(armadas.get(5)!.porNodo.filter((x) => x.id.startsWith("tubito")).length, 5, "#5: 5 tubitos");
assert.deepEqual(porCodigo(31), { "R-12|080": 1, "R-5|005": 2, "R-5|080": 1 }, "#31: cuerpo, 2 ojos y boca");
const patas = armadas.get(31)!.porNodo.filter((x) => x.id.startsWith("pata-"));
assert.equal(patas.length, 8, "#31: 8 patas");
assert.ok(patas.every((p) => p.tubos.length === 1 && sumarMateriales(p.materiales).every((m) => m.codigo === "080" && m.cantidad <= 1)), "#31: un T-260 por pata");
// Alturas (lo más alto de lo que es globo o tubito).
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.some((t) => !t.papel)).map((x) => x.caja.max.y));
for (const [n, min, max] of [[29, 190, 215], [231, 200, 225], [821, 185, 205], [859, 220, 245], [863, 220, 245], [953, 220, 245], [68, 115, 135], [131, 290, 320], [203, 175, 190], [5, 125, 145]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: pisos de cada ramo, impresos, metalizados, eslabones, niveles, bases, tubitos, patas y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_14) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id)!;
  assert.equal(item.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
}
console.log("OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente");

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-14.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-14.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-14.json");
  for (const i of LOTE_14) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      // Con código publicado, ese; sin él (un impreso o un color fuera de la tabla), el látex en que va (un metalizado no tiene).
      for (const mio of mios) assert.ok(m.codigo === null ? mio.formato === null || mio.codigo !== null || mio.cantidad === null : mio.codigo === m.codigo, `${i.slug}: código de «${m.nombre}»`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-14");
