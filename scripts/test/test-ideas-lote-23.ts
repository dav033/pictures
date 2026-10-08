/**
 * Lote 23 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-23.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-23.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); la nota dice qué quedó igual y qué no;
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se
 *   fabrica en su formato, inflado dentro de lo que da ese formato;
 * - montaje: cada estructura es su propio árbol: la raíz suelta, su amarre escondido (`oculto`) colgado de ella donde se
 *   pidió, y todo lo suyo colgado del amarre (o de las anclas de la raíz); `extraerConjunto` de cada raíz trae todos
 *   sus miembros y arma solo exactamente lo de su rama (materiales y cada globo en su sitio); lo suelto es escenografía,
 *   utilería o el ramo de helio de #985;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos y
 *   metalizados de la tienda, con su cantidad; lo publicado, con su nombre, url y código;
 * - lo contado en las fotos (esferas, niveles, pisos, peces, patas, globos de la «P», bufanda…) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, da un conjunto o estructura por raíz.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_23 } from "../../src/lib/globos3d/ideas-sempertex/lote-23";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada, type NodoEscena } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [931, 938, 985, 12, 32, 38, 40, 44, 56, 59, 107, 111, 118, 123, 139];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_23.map((i) => i.numero), NUMEROS, "los 15 números del lote 23, en orden");
assert.equal(new Set(LOTE_23.map((i) => i.id)).size, NUMEROS.length, "ids sin repetir");
for (const i of LOTE_23) {
  const que = `${i.numero} ${i.slug}`;
  assert.equal(i.id, `idea:${i.slug}`, `${que}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 10 && i.nota.trim().length > 300, `${que}: nombre y nota`);
  assert.ok(/^Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${que}: la nota dice qué quedó igual y qué no`);
  assert.equal(i.contenido.tipo, "escena", `${que}: es una escena`);
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
// 2. Cada escena arma, dentro de su sala, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const escenaDe = (n: number): Escena => {
  const c = LOTE_23.find((x) => x.numero === n)!.contenido;
  if (c.tipo !== "escena") throw new Error(`#${n} es una escena`);
  return c.escena;
};
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_23) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenaDe(i.numero);
  const a = armarEscena(escena);
  armadas.set(i.numero, a);
  assert.deepEqual(a.avisos, [], `${que}: arma sin avisos`);
  assert.ok(a.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), `${que}: cada pieza quedó puesta`);
  assert.equal(new Set(escena.nodos.map((n) => n.id)).size, escena.nodos.length, `${que}: ids de nodo sin repetir`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  for (const n of a.porNodo) {
    assert.ok(n.caja.min.y >= -1.5, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= a.sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo (${n.caja.max.y.toFixed(1)})`);
    assert.ok(Math.abs(n.caja.min.x) <= a.sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= a.sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -a.sala.fondoCm / 2 - 1 && n.caja.max.z <= a.sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo (${n.caja.min.z.toFixed(1)})`);
  }
  for (const g of a.globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f, `${que}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${que}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(g.infladoCm >= f!.diametroMaxCm * 0.4 - 0.01 && g.infladoCm <= f!.diametroMaxCm + 0.01, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm`);
  }
  for (const t of a.tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    // Tubitos y el Link-O-Loon 660 (los lazos del arbolito #56).
    assert.ok(f && (f.tipo === "tubito" || f.id === "LOL-660"), `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
    tubitosTotales++;
  }
  globosTotales += a.globos.length;
}
console.log(`OK armado: 15 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubitosTotales} tramos de tubito en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: cada estructura su árbol (raíz, amarre escondido, lo suyo colgado) y se extrae con lo suyo
// ----------------------------------------------------------------------------------------------------------

const cuelga = (c: NodoEscena["colocacion"]) => c.en === "ancla" || c.en === "sobre";
const padreDe = (n: NodoEscena) => (cuelga(n.colocacion) ? (n.colocacion as { padreId: string }).padreId : null);
const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(1)}|${g.nudo.y.toFixed(1)}|${g.nudo.z.toFixed(1)}`.replace(/-0\.0(?!\d)/g, "0.0");
type Rama = { raiz: string; ids: string[] };
const ramas = new Map<number, Rama[]>();
let extraidas = 0, enSuSitio = 0;
for (const i of LOTE_23) {
  const que = `#${i.numero}`;
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const porId = new Map(escena.nodos.map((n) => [n.id, n]));
  const amarres = escena.nodos.filter((n) => n.id.endsWith("-amarre"));
  const raices = amarres.map((a) => porId.get(padreDe(a)!)!);
  assert.ok(raices.length >= 1, `${que}: al menos una raíz`);
  const lista: Rama[] = [];
  for (const [k, raiz] of raices.entries()) {
    const amarre = amarres[k]!;
    assert.equal(amarre.id, `${raiz.id}-amarre`, `${que}: el amarre de «${raiz.id}»`);
    assert.ok(raiz.colocacion.en === "libre", `${que}: la raíz «${raiz.id}» va suelta`);
    assert.ok(clasePieza(raiz.pieza) === "estructura" || (i.numero === 123 && raiz.id === "letra-p" && raiz.pieza.tipo === "escenografia"), `${que}: «${raiz.id}» es una estructura de globos (o el marco de la «P»)`);
    assert.ok(amarre.pieza.tipo === "escenografia" && amarre.pieza.elementos.length > 0 && amarre.pieza.elementos.every((e) => e.oculto === true), `${que}: el amarre de «${raiz.id}» va escondido`);
    // El amarre quedó donde se pidió (no lo corrió ningún globo de la raíz).
    if (raiz.colocacion.en === "libre" && amarre.colocacion.en === "sobre") {
      const g = (raiz.colocacion.giroGrados * Math.PI) / 180, p = amarre.colocacion.puntoCm;
      const esperado = { x: raiz.colocacion.xCm + p.x * Math.cos(g) + p.z * Math.sin(g), y: raiz.colocacion.yCm + p.y - 1.5, z: raiz.colocacion.zCm - p.x * Math.sin(g) + p.z * Math.cos(g) };
      const t = armada.porNodo.find((n) => n.id === amarre.id)!.puestas[0]!.marco.t;
      assert.ok(Math.hypot(t.x - esperado.x, t.y - esperado.y, t.z - esperado.z) < 0.05, `${que}: el amarre de «${raiz.id}» quedó donde se pidió`);
    }
    const conjunto = extraerConjunto(escena, raiz.id, { armada });
    assert.ok(conjunto, `${que} ${raiz.id}: sale el conjunto`);
    const ids = miembrosDeConjunto(escena, raiz.id, armada);
    assert.equal(conjunto!.hijos.length, ids.length - 1, `${que} ${raiz.id}: entran todos sus miembros`);
    // Lo de la rama: lo que cuelga del amarre o de la raíz (en sus anclas), y nada más.
    const esperados = new Set([raiz.id, amarre.id, ...escena.nodos.filter((n) => padreDe(n) === amarre.id || (padreDe(n) === raiz.id && n.colocacion.en === "ancla")).map((n) => n.id)]);
    assert.deepEqual([...ids].sort(), [...esperados].sort(), `${que} ${raiz.id}: la rama es la raíz, su amarre y lo que cuelga de ellos`);
    const deLaRama = armada.porNodo.filter((n) => ids.includes(n.id));
    const materiales = ordenar(sumarMateriales(...deLaRama.map((n) => n.materiales)));
    assert.ok(materiales.length > 0, `${que} ${raiz.id}: la rama tiene globos`);
    const sola = armarEscena(escenaDeConjunto(conjunto!, { sala: escena.sala, donde: conjunto!.sugerida }));
    assert.deepEqual(sola.avisos, [], `${que} ${raiz.id}: sola arma sin avisos`);
    assert.deepEqual(ordenar(sola.materiales), materiales, `${que} ${raiz.id}: sola gasta exactamente lo de su rama`);
    assert.deepEqual(sola.globos.map(firma).sort(), deLaRama.flatMap((n) => n.globos).map(firma).sort(), `${que} ${raiz.id}: cada globo en su sitio`);
    enSuSitio += sola.globos.length;
    extraidas++;
    lista.push({ raiz: raiz.id, ids });
  }
  // Toda pieza está en una rama o es escenografía, utilería o el ramo suelto de #985; ninguna en dos ramas.
  const vistos = lista.flatMap((r) => r.ids);
  assert.equal(new Set(vistos).size, vistos.length, `${que}: ninguna pieza en dos ramas`);
  for (const n of escena.nodos.filter((x) => !vistos.includes(x.id))) {
    assert.ok(n.colocacion.en === "libre" && (["escenografia", "utileria"].includes(clasePieza(n.pieza)) || (i.numero === 985 && n.id === "ramo")), `${que}: «${n.id}» suelto es escenografía, utilería o el ramo`);
  }
  for (const r of lista) for (const id of r.ids.filter((x) => x !== r.raiz && x !== `${r.raiz}-amarre`)) assert.ok(!["escenografia", "utileria"].includes(clasePieza(porId.get(id)!.pieza)) || porId.get(id)!.pieza.tipo === "escenografia" && (porId.get(id)!.pieza as { elementos: Array<{ acabado: string }> }).elementos.every((e) => e.acabado === "foil"), `${que} ${r.raiz}: «${id}» no es mesa ni utilería (solo foil)`);
  ramas.set(i.numero, lista);
}
assert.deepEqual(ramas.get(12)!.map((r) => r.raiz), ["organico", "malteada"], "#12: el orgánico y la malteada, cada uno su árbol");
assert.deepEqual(ramas.get(107)!.map((r) => r.raiz), ["guirnalda", "marimonda"], "#107: la guirnalda y la marimonda");
assert.deepEqual(ramas.get(123)!.map((r) => r.raiz), ["organico", "letra-p"], "#123: el orgánico y la «P»");
for (const n of NUMEROS.filter((x) => ![12, 107, 123].includes(x))) assert.equal(ramas.get(n)!.length, 1, `#${n}: una estructura`);
console.log(`OK montaje: ${extraidas} estructuras raíz con su amarre escondido se extraen con lo suyo (${enSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_23) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i.numero);
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const metalizados = new Map<string, number>();
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.formato === null) { assert.ok(metalizadoPorUrl(p.url), `${que}: «${p.nombre}» es un metalizado de la tienda`); metalizados.set(p.url, (metalizados.get(p.url) ?? 0) + p.cantidad); continue; }
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.codigo && coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  const impresos3D = a.globos.filter((g) => g.estampado?.impreso).length;
  const impresosProd = i.productos.filter((p) => p.cantidad !== null && impresoPorUrl(p.url)).reduce((s, p) => s + p.cantidad!, 0);
  assert.equal(impresosProd, impresos3D, `${que}: ${impresos3D} globos impresos con su producto`);
  const esperados = new Map<string, number>();
  for (const nodo of escena.nodos) if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) esperados.set(nodo.pieza.metalizado.producto.url, (esperados.get(nodo.pieza.metalizado.producto.url) ?? 0) + 1);
  assert.deepEqual([...metalizados.entries()].sort(), [...esperados.entries()].sort(), `${que}: metalizados de la tienda con su cantidad`);
  lineas += pedidos.size + metalizados.size;
}
const porNumero = (n: number) => LOTE_23.find((i) => i.numero === n)!;
const cantidadDe = (n: number, url: string) => porNumero(n).productos.filter((p) => p.url === url && p.cantidad !== null).reduce((s, p) => s + p.cantidad!, 0);
assert.equal(cantidadDe(123, "/products/globo-latex-redondo-infinity-r-feliz-dia-papa-oeste-fashion-surtido"), 3, "#123: los 3 impresos de papá de la «P»");
assert.equal(cantidadDe(985, "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente"), 1, "#985: el globo cristal impreso");
assert.equal(cantidadDe(56, "/products/globo-metalizado-estrella-dorado-mate"), 1, "#56: la estrella metalizada de la tienda");
assert.ok(porNumero(107).productos.some((p) => p.nombre === "GLOBO REDONDO FASHION SURTIDO TROPICAL" && p.cantidad === null), "#107: el surtido tropical publicado, sin cantidad");
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (impresos y metalizados de la tienda con su cantidad)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodo = (n: number, id: string) => {
  const x = armadas.get(n)!.porNodo.find((k) => k.id === id);
  assert.ok(x, `#${n}: «${id}» está`);
  return x!;
};
const conPrefijo = (n: number, prefijo: string) => escenaDe(n).nodos.filter((x) => x.id.startsWith(prefijo));
const mat = (n: number, id: string) => ordenar(nodo(n, id).materiales);
assert.deepEqual(mat(931, "columna"), ["R-12|009|16"], "#931: 4 cuartetos rosados");
assert.deepEqual(mat(938, "bola"), ["R-12|968|12", "R-5|981|10"], "#938: 12 R-12 dorado rosa y 10 R-5 plata");
assert.deepEqual(mat(938, "rizos"), ["T-260|981|10"], "#938: 10 rizos de T-260 plata");
assert.equal(nodo(985, "pared").globos.length, 110, "#985: pared de 10 × 11");
assert.equal(nodo(985, "ramo").globos.length, 3, "#985: ramo de 3");
assert.equal(conPrefijo(12, "vaso-").length, 6, "#12: el vaso de 6 cuartetos");
assert.equal(conPrefijo(12, "pitillo-").length, 2, "#12: el pitillo de dos tubitos");
assert.equal(conPrefijo(32, "pata-").length, 8, "#32: 8 patas");
assert.deepEqual(mat(32, "burbuja"), ["R-18|390|1", "R-9|061|8"], "#32: la burbuja con 8 naranjas");
assert.equal(conPrefijo(38, "esfera-").length, 44, "#38: 44 esferas");
const colores38 = new Map<string, number>();
for (const e of conPrefijo(38, "esfera-")) { const g = nodo(38, e.id).globos[0]!; colores38.set(g.codigo, (colores38.get(g.codigo) ?? 0) + 1); }
assert.deepEqual([...colores38.entries()].sort(), [["015", 7], ["020", 5], ["031", 2], ["040", 3], ["041", 5], ["051", 8], ["390", 7], ["530", 7]], "#38: las esferas por color");
assert.equal(conPrefijo(44, "esfera-").length, 9, "#44: 9 esferas");
assert.equal(conPrefijo(44, "gancho-").length, 9, "#44: 9 ganchos");
assert.equal(conPrefijo(56, "piso-").length, 5, "#56: 5 pisos de lazos");
assert.ok(conPrefijo(56, "piso-").every((x) => nodo(56, x.id).tubos.length === 4), "#56: 4 lazos por piso");
assert.equal(conPrefijo(56, "rojo-").length, 9, "#56: 9 R-5 rojos");
assert.deepEqual(mat(56, "tronco"), ["R-9|032|36"], "#56: tronco de 9 cuartetos");
assert.equal(conPrefijo(59, "pez-").filter((x) => x.id.endsWith("-cuerpo")).length, 3, "#59: 3 peces");
assert.equal(conPrefijo(59, "alga-").length, 6, "#59: 3 algas por caracola");
assert.equal(nodo(107, "marimonda").globos.length, 24, "#107: 6 cuartetos en la columna");
assert.equal(new Set(nodo(107, "marimonda").globos.map((g) => g.codigo)).size, 4, "#107: espiral de 4 colores");
assert.equal(conPrefijo(111, "bufanda-").length, 16, "#111: bufanda de 12 y 4 en las puntas");
assert.equal(conPrefijo(118, "rizo-").length, 6, "#118: 6 rizos");
assert.equal(conPrefijo(118, "burbuja-").length, 2, "#118: 2 burbujas");
assert.equal(conPrefijo(123, "p-globo-").length, 12, "#123: 12 globos en la «P»");
assert.equal(conPrefijo(123, "p-globo-").filter((x) => x.pieza.impresos?.length).length, 3, "#123: 3 impresos en la «P»");
assert.equal(conPrefijo(139, "tira-").length, 2, "#139: las tiras de dentro y de fuera colgadas de la del medio");
// Alturas (lo más alto de lo que tiene globos o foil), medidas en la foto.
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.length || x.solidos.some((s) => s.acabado === "foil" || s.acabado === "foil_mate")).map((x) => x.caja.max.y));
for (const [n, min, max] of [[931, 175, 195], [938, 105, 125], [12, 255, 285], [32, 100, 115], [38, 350, 375], [40, 225, 245], [44, 220, 240], [56, 195, 215], [59, 175, 205], [107, 205, 230], [111, 280, 300], [118, 240, 265], [123, 280, 305], [139, 195, 215], [985, 240, 255]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: esferas, niveles, pisos, peces, patas, globos de la «P», bufanda, rizos y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_23) {
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
  for (const r of ramas.get(i.numero)!) assert.ok(hijos.some((h) => (h.tipo === "conjunto" || h.tipo === "estructura") && h.apareceEn![0]!.nodoIds.includes(r.raiz)), `${i.id}: «${r.raiz}» sale como conjunto o estructura`);
  derivados += hijos.length;
}
console.log(`OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas (al menos uno por raíz)`);

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-23.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-23.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-23.json");
  for (const i of LOTE_23) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) assert.ok(mios.every((p) => p.codigo === m.codigo), `${i.slug}: código de «${m.nombre}»`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-23");
