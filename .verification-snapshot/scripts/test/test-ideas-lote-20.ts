/**
 * Lote 20 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-20.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-20.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); #449 (misma foto que #277 del lote 17)
 *   reusa sus nodos con otros tonos de sala y sus productos;
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se
 *   fabrica en su formato, inflado dentro de lo que da ese formato;
 * - montaje: la estructura principal es la raíz (suelta; el peso en el ramo #504), su varilla cuelga de ella justo donde
 *   se pidió y lo demás de la varilla; el conjunto de la raíz se lleva la escena entera; la varilla y los amarres van
 *   escondidos (delgados, por dentro de los globos o detrás) y no hay más escenografía que cintas, peso y foil;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos de
 *   la tienda, con los globos que los llevan; lo publicado, con su nombre, url y código;
 * - lo contado en las fotos (niveles, cuartetos, tentáculos, globos de helio, rizos, impresos) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que los lotes: cada lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa los lotes.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_20 } from "../../src/lib/globos3d/ideas-sempertex/lote-20";
import { LOTE_17 } from "../../src/lib/globos3d/ideas-sempertex/lote-17";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, extraerConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [429, 449, 450, 451, 452, 454, 461, 464, 496, 504, 512, 543, 545, 546, 551];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_20.map((i) => i.numero), NUMEROS, "los 15 números del lote 20, en orden");
assert.equal(new Set(LOTE_20.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_20) {
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
const porNumero = (n: number) => LOTE_20.find((i) => i.numero === n)!;
const escenaDe = (n: number): Escena => {
  const c = porNumero(n).contenido;
  if (c.tipo !== "escena") throw new Error(`#${n} es una escena`);
  return c.escena;
};
// #449 y #277: la misma foto con dos títulos; #449 reusa la escena de #277 (lote 17) con su id, slug y foto.
const de277 = LOTE_17.find((i) => i.numero === 277)!;
assert.ok(de277.contenido.tipo === "escena", "#277 es una escena");
if (de277.contenido.tipo === "escena") {
  assert.equal(escenaDe(449).nodos, de277.contenido.escena.nodos, "#449 reusa los nodos de #277");
  assert.notDeepEqual(escenaDe(449).sala.tonos, de277.contenido.escena.sala.tonos, "#449 con otros tonos (la biblioteca no la funde con #277)");
}
assert.notEqual(porNumero(449).fotoUrl, de277.fotoUrl, "#449 con su propia foto");
assert.ok(porNumero(449).nota.startsWith("Misma foto que #277"), "#449 dice «misma foto que #277»");
assert.deepEqual(porNumero(449).productos.map((p) => `${p.url}|${p.cantidad}`), de277.productos.map((p) => `${p.url}|${p.cantidad}`), "#449 con los productos de #277");
console.log("OK lote: 15 escenas con id, nota, ocasiones de sus etiquetas y foto de su fuente (#449 reusa los nodos de #277)");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada escena arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_20) {
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
    assert.ok(n.caja.max.y <= a.sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo`);
    assert.ok(Math.abs(n.caja.min.x) <= a.sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= a.sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -a.sala.fondoCm / 2 - 1 && n.caja.max.z <= a.sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo`);
  }
  for (const g of a.globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f, `${que}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${que}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(g.infladoCm >= f!.diametroMaxCm * 0.4 - 0.01 && g.infladoCm <= f!.diametroMaxCm + 0.01, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm`);
  }
  for (const t of a.tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    // Tubitos y el Link-O-Loon 660 (el ala del sombrero del duende, un aro de 660).
    assert.ok(f && (f.tipo === "tubito" || f.id === "LOL-660"), `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
    tubitosTotales++;
  }
  globosTotales += a.globos.length;
}
console.log(`OK armado: 15 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubitosTotales} tramos de tubito en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: raíz, varilla escondida y lo que cuelga; el conjunto de la raíz es la escena entera
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_20) {
  const que = `#${i.numero}`;
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const [raiz, segundo, ...resto] = escena.nodos;
  assert.ok(raiz && raiz.colocacion.en === "libre", `${que}: la raíz va suelta`);
  // La raíz es la estructura principal; el ramo (#504), que no tiene estructura, lleva de raíz su peso (lote 16).
  assert.equal(clasePieza(raiz.pieza), i.numero === 504 ? "escenografia" : "estructura", `${que}: la raíz es la estructura principal (${raiz.pieza.tipo})`);
  assert.ok(segundo && segundo.id === "varilla" && segundo.pieza.tipo === "escenografia" && segundo.colocacion.en === "sobre" && segundo.colocacion.padreId === raiz.id, `${que}: la varilla cuelga de la raíz`);
  assert.ok(resto.every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "varilla"), `${que}: todo lo demás cuelga de la varilla`);
  if (raiz.colocacion.en === "libre" && segundo.colocacion.en === "sobre") {
    const g = (raiz.colocacion.giroGrados * Math.PI) / 180, p = segundo.colocacion.puntoCm;
    const esperado = { x: raiz.colocacion.xCm + p.x * Math.cos(g) + p.z * Math.sin(g), y: raiz.colocacion.yCm + p.y - 1.5, z: raiz.colocacion.zCm - p.x * Math.sin(g) + p.z * Math.cos(g) };
    const t = armada.porNodo.find((n) => n.id === "varilla")!.puestas[0]!.marco.t;
    assert.ok(Math.hypot(t.x - esperado.x, t.y - esperado.y, t.z - esperado.z) < 0.05, `${que}: la varilla quedó donde se pidió`);
  }
  // Escondida: delgada, y su punta no asoma sobre lo más alto de los globos.
  if (segundo.pieza.tipo === "escenografia") for (const e of segundo.pieza.elementos) assert.ok(e.forma === "cilindro" && e.radioCm <= 0.6, `${que}: la varilla es delgada`);
  const varilla = armada.porNodo.find((n) => n.id === "varilla")!;
  const masAlto = Math.max(...armada.porNodo.filter((n) => n.globos.length).map((n) => n.caja.max.y));
  assert.ok(varilla.caja.max.y < masAlto, `${que}: la varilla no asoma por arriba`);
  // No hay más escenografía que la varilla, las cintas, el peso del ramo y los metalizados de foil.
  for (const n of escena.nodos.filter((x) => x.pieza.tipo === "escenografia")) {
    if (n.pieza.tipo !== "escenografia") continue;
    const ok = n.id === "varilla" || n.id === "cintas" || n.id === "peso" || n.pieza.elementos.every((e) => e.acabado === "foil" || e.acabado === "foil_mate");
    assert.ok(ok, `${que}: «${n.nombre}» es varilla, cintas, peso o foil`);
  }
  const conjunto = extraerConjunto(escena, raiz.id, { armada });
  assert.ok(conjunto, `${que}: se extrae el conjunto de la raíz`);
  assert.equal(conjunto!.hijos.length, escena.nodos.length - 1, `${que}: el conjunto de la raíz se lleva toda la escena`);
}
// Las varillas por dentro: en las columnas, por el eje (dentro de los cuartetos); en el corazón, detrás de él.
const caja = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!.caja;
for (const n of [450, 451, 452, 454, 461, 464, 512, 543, 545, 546, 551]) {
  const c = caja(n, "varilla");
  assert.ok(Math.abs((c.min.x + c.max.x) / 2) < 0.05 && Math.abs((c.min.z + c.max.z) / 2) < 0.05, `#${n}: la varilla va por el eje`);
}
assert.ok(caja(429, "varilla").max.z < caja(429, "corazon").min.z, "#429: el amarre va detrás del corazón");
assert.ok(caja(429, "varilla").min.y > caja(429, "corazon").min.y + 60 && caja(429, "varilla").max.y < caja(429, "corazon").max.y - 40, "#429: el amarre queda tapado por el corazón");
assert.ok(caja(504, "varilla").max.y <= caja(504, "peso").max.y && caja(504, "varilla").min.y >= caja(504, "peso").min.y, "#504: el amarre va dentro del peso");
assert.ok(caja(496, "varilla").max.y < caja(496, "cuarteto").max.y && caja(496, "varilla").min.y > caja(496, "cuarteto").min.y, "#496: el amarre va entre los nudos del cuarteto");
// El «love» pegado al frente del corazón (hundido un poco entre sus globos).
assert.ok(caja(429, "love").min.z < caja(429, "corazon").max.z && caja(429, "love").max.z > caja(429, "corazon").max.z - 2, "#429: el «love» va pegado al frente del corazón");
console.log("OK montaje: la estructura principal es la raíz, la varilla escondida en su sitio y su conjunto se lleva todo");

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_20) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i.numero);
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const metalizados = new Map<string, number>();
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
  const impresos3D = new Map<string, number>();
  for (const nodo of a.porNodo) for (const g of nodo.globos) if (g.estampado?.impreso) impresos3D.set(clave(g.formatoId, g.codigo), (impresos3D.get(clave(g.formatoId, g.codigo)) ?? 0) + 1);
  const impresosProd = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && impresoPorUrl(p.url)) impresosProd.set(clave(p.formato, p.codigo), (impresosProd.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  for (const [k, n] of impresosProd) assert.ok((impresos3D.get(k) ?? 0) >= n, `${que}: ${n} impresos ${k} en el 3D`);
  const esperados = new Map<string, number>();
  for (const nodo of escena.nodos) if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) esperados.set(nodo.pieza.metalizado.producto.url, (esperados.get(nodo.pieza.metalizado.producto.url) ?? 0) + 1);
  assert.deepEqual([...metalizados.entries()].sort(), [...esperados.entries()].sort(), `${que}: metalizados de la tienda con su cantidad`);
  const lisos3D = new Map([...del3D].map(([k, n]) => [k, n - (impresosProd.get(k) ?? 0)]));
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(p.codigo === null || !((lisos3D.get(clave(p.formato, p.codigo)) ?? 0) > 0), `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  lineas += pedidos.size + metalizados.size;
}
// Lo publicado, con cantidad (la foto lo tiene).
const conCantidad = (n: number, url: string) => porNumero(n).productos.filter((p) => p.url === url && p.cantidad !== null).reduce((s, p) => s + p.cantidad!, 0);
assert.ok(conCantidad(429, "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo") > 100, "#429: el corazón es del Reflex Cristal Rojo publicado");
assert.equal(conCantidad(504, "/products/globo-para-fiesta-latex-redondo-infinity-diamantes-dorados-fashion-transparente"), 1, "#504: la burbuja lleva el Diamantes Dorados publicado");
assert.equal(conCantidad(504, "/products/globo-para-fiesta-latex-redondo-fashion-arena"), 4, "#504: 4 arena");
for (const n of [545, 546]) {
  assert.equal(conCantidad(n, "/products/globo-para-fiesta-latex-redondo-fashion-surtido-navidad-rojo-y-verde-selva"), 17, `#${n}: 17 globos del Surtido Navidad (R-12 y R-9)`);
  assert.ok(conCantidad(n, "/products/globo-para-fiesta-latex-tubito-fashion-blanco") >= 5, `#${n}: el tubito blanco publicado (bastón, cuadrados y postes)`);
}
assert.ok(conCantidad(546, "/products/globo-para-fiesta-latex-tubito-fashion-rojo") >= 1, "#546: el tubito rojo publicado (bastón)");
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (impresos de la tienda incluidos; lo publicado, tal cual)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodo = (n: number, id: string) => {
  const x = armadas.get(n)!.porNodo.find((y) => y.id === id);
  assert.ok(x, `#${n}: nodo ${id}`);
  return x!;
};
const ids = (n: number, prefijo: string) => escenaDe(n).nodos.filter((x) => x.id.startsWith(prefijo)).map((x) => x.id);
const impresos = (n: number) => armadas.get(n)!.globos.filter((g) => g.estampado?.impreso).length;
const porCodigo = (n: number, id: string) => {
  const cuenta: Record<string, number> = {};
  for (const g of nodo(n, id).globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
// Cruces de columna: 18 cuartetos de dos colores, brazos de 5, base, puntas y remate.
for (const [n, a, b] of [[451, "570", "981"], [452, "059", "009"], [454, "038", "037"]] as const) {
  assert.deepEqual(porCodigo(n, "columna"), { [`R-5|${a}`]: 36, [`R-5|${b}`]: 36 }, `#${n}: columna de 18 cuartetos, una pareja de cada color`);
  assert.equal(nodo(n, "brazo-izquierdo").globos.length + nodo(n, "brazo-derecho").globos.length, 40, `#${n}: dos brazos de 5 cuartetos`);
  assert.equal(nodo(n, "base-abajo").globos.length + nodo(n, "base-arriba").globos.length, 8, `#${n}: base de dos cuartetos`);
  assert.ok(Math.abs(nodo(n, "brazo-izquierdo").caja.max.x + nodo(n, "brazo-derecho").caja.min.x) < 0.5, `#${n}: brazos simétricos`);
}
// La celestial: 9 óvalos de LOL-12, 10 racimos de 4 R-5 y 35 R-5 azules en espiral.
assert.equal(ids(450, "ovalo-").length, 9, "#450: 9 óvalos de LOL-12");
assert.equal(escenaDe(450).nodos.filter((x) => x.id.startsWith("racimo-")).length, 10, "#450: 10 racimos (contando la raíz)");
assert.equal(ids(450, "azul-").length, 35, "#450: 35 R-5 azules en espiral");
// Cupcakes: 5 niveles de un color, 16 R-9 y 8 R-5 rosados, un impreso y 3 metalizados.
assert.equal(ids(461, "nivel-").length + 1, 5, "#461: 5 cuartetos de colores");
assert.equal(ids(461, "rosado-").length, 16, "#461: 16 R-9 rosados en los huecos");
assert.equal(ids(461, "rosadito-").length, 8, "#461: 8 R-5 rosados en el lila");
assert.equal(impresos(461), 1, "#461: un R-12 impreso");
// Rock star: base de 2, columna de 13, negro, rojo y dorado; estrella y guitarra; 3 rizos.
assert.equal(nodo(464, "columna").globos.length, 52, "#464: columna de 13 cuartetos R-5 violeta");
assert.equal(ids(464, "rizo-").length, 3, "#464: 3 rizos de T-260 negro");
// Medusa: cuarteto impreso, 7 tentáculos y 7 corazones.
assert.equal(impresos(496), 4, "#496: el cuarteto de corazones impresos");
assert.equal(ids(496, "tentaculo-").length, 7, "#496: 7 tentáculos");
assert.equal(ids(496, "corazon-").length, 7, "#496: 7 corazones");
assert.ok(armadas.get(496)!.porNodo.filter((x) => x.id.startsWith("corazon-")).every((x) => x.globos[0]!.formatoId === "C-12"), "#496: corazones C-12");
// Ramo: 9 R-12 de helio y la burbuja con 6 dentro, cada uno con su cinta.
assert.equal(escenaDe(504).nodos.filter((x) => /^(arena|eucalipto|dorado)-/.test(x.id)).length, 9, "#504: 9 R-12 de helio (4 arena, 2 eucalipto, 3 dorados)");
assert.deepEqual(porCodigo(504, "burbuja"), { "R-24|390": 1, "R-9|027": 3, "R-9|970": 3 }, "#504: burbuja R-24 cristal con 3 eucalipto y 3 dorados");
const cintas504 = escenaDe(504).nodos.find((x) => x.id === "cintas")!;
assert.ok(cintas504.pieza.tipo === "escenografia" && cintas504.pieza.elementos.length === 10, "#504: 10 cintas (9 globos y la burbuja)");
// Duende, fantasma y faroles.
assert.ok(armadas.get(512)!.tubos.some((t) => t.formatoId === "LOL-660"), "#512: ala del sombrero de Link-O-Loon 660");
assert.equal(impresos(543), 1, "#543: el naranja «Happy Halloween»");
for (const n of [545, 546]) {
  assert.equal(impresos(n), 17, `#${n}: 17 globos del Surtido Navidad`);
  assert.equal(ids(n, "poste-").length, 4, `#${n}: 4 postes del farol`);
  assert.equal(ids(n, "baston-").length, 2, `#${n}: el bastón de dos tubitos`);
}
assert.equal(impresos(551), 3, "#551: 3 R-12 «Feliz cumpleaños» de splash neón");
assert.equal(ids(551, "rizo-").length, 6, "#551: 3 coronas de 2 rizos");
// Alturas (lo más alto con globos, tubitos o foil, cm; la caja de un globo es su esfera desde el nudo).
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.id !== "varilla" && x.id !== "cintas").map((x) => x.caja.max.y));
for (const [n, min, max] of [[429, 210, 225], [450, 120, 135], [451, 150, 162], [452, 148, 160], [461, 205, 225], [464, 195, 210], [496, 185, 195], [504, 195, 215], [512, 155, 172], [543, 85, 100], [545, 210, 222], [551, 155, 170]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: cuartetos y niveles, óvalos y espiral, tentáculos, helio, impresos, rizos y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_20) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
}
console.log("OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente");

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-20.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-20.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-20.json");
  for (const i of LOTE_20) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (!impresoPorUrl(m.url) && m.codigo) for (const mio of mios) assert.equal(mio.codigo, m.codigo, `${i.slug}: código de «${m.nombre}»`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-20");
