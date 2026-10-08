/**
 * Lote 21 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-21.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-21.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`);
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se fabrica
 *   en su formato, inflado dentro de lo que da ese formato;
 * - montaje: la estructura principal es la raíz (suelta; el peso en el ramo #700), su amarre cuelga de ella en el piso,
 *   donde se pidió, y está oculto (un cilindro de 1 cm con `oculto: true`: no se dibuja ni sale en la lista); lo demás
 *   cuelga del amarre; el conjunto de la raíz se lleva la escena entera (salvo la mesa de #700); los murales van solos;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos de
 *   la tienda, con los globos que los llevan; lo publicado, con su nombre, url y código;
 * - lo contado en las fotos (niveles, cuartetos, impresos, rizos, resortes, chupetes, celdas de los murales) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y su lista de productos no trae los amarres ocultos.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_21 } from "../../src/lib/globos3d/ideas-sempertex/lote-21";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, extraerConjunto, productosDe } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [604, 616, 635, 686, 687, 700, 706, 720, 721, 725, 741, 746, 761, 768, 769];
const SOLOS = [768, 769];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_21.map((i) => i.numero), NUMEROS, "los 15 números del lote 21, en orden");
assert.equal(new Set(LOTE_21.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_21) {
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
const porNumero = (n: number) => LOTE_21.find((i) => i.numero === n)!;
const escenaDe = (n: number): Escena => {
  const c = porNumero(n).contenido;
  if (c.tipo !== "escena") throw new Error(`#${n} es una escena`);
  return c.escena;
};
console.log("OK lote: 15 escenas con id, nota, ocasiones de sus etiquetas y foto de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada escena arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_21) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenaDe(i.numero);
  const a = armarEscena(escena);
  armadas.set(i.numero, a);
  assert.deepEqual(a.avisos, [], `${que}: arma sin avisos`);
  assert.ok(a.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), `${que}: cada pieza quedó puesta (${a.porNodo.filter((n) => n.avisos.length).map((n) => n.avisos.join(" ")).join(" | ")})`);
  assert.equal(new Set(escena.nodos.map((n) => n.id)).size, escena.nodos.length, `${que}: ids de nodo sin repetir`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  for (const n of a.porNodo) {
    assert.ok(n.caja.min.y >= -1.5, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= a.sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo (${n.caja.max.y.toFixed(1)})`);
    assert.ok(Math.abs(n.caja.min.x) <= a.sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= a.sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -a.sala.fondoCm / 2 - 1 && n.caja.max.z <= a.sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo (${n.caja.min.z.toFixed(1)}…${n.caja.max.z.toFixed(1)})`);
  }
  for (const g of a.globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f, `${que}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${que}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(g.infladoCm >= f!.diametroMaxCm * 0.4 - 0.01 && g.infladoCm <= f!.diametroMaxCm + 0.01, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm`);
  }
  for (const t of a.tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    // Tubitos y el Link-O-Loon 660 (los tubos gruesos del centro de la malla #706).
    assert.ok(f && (f.tipo === "tubito" || f.id === "LOL-660"), `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
    tubitosTotales++;
  }
  globosTotales += a.globos.length;
}
console.log(`OK armado: 15 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubitosTotales} tramos de tubito en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: raíz, amarre oculto y lo que cuelga; el conjunto de la raíz es la escena entera
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_21) {
  const que = `#${i.numero}`;
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const [raiz, amarre, ...resto] = escena.nodos;
  assert.ok(raiz && raiz.colocacion.en === "libre", `${que}: la raíz va suelta`);
  // La raíz es la estructura; la flor de pared (#604) es ella misma una decoración y el ramo (#700) lleva de raíz su peso.
  assert.equal(clasePieza(raiz.pieza), i.numero === 604 ? "decoracion" : i.numero === 700 ? "escenografia" : "estructura", `${que}: la raíz es la estructura principal (${raiz.pieza.tipo})`);
  if (SOLOS.includes(i.numero)) { assert.equal(escena.nodos.length, 1, `${que}: el mural va solo`); continue; }
  assert.ok(amarre && amarre.id === "amarre" && amarre.pieza.tipo === "escenografia" && amarre.colocacion.en === "sobre" && amarre.colocacion.padreId === raiz.id, `${que}: el amarre cuelga de la raíz`);
  if (amarre.pieza.tipo === "escenografia") assert.ok(amarre.pieza.elementos.length === 1 && amarre.pieza.elementos.every((e) => e.oculto === true), `${que}: el amarre está oculto`);
  const mesa = i.numero === 700 ? 1 : 0;
  assert.ok(resto.length > 0 && resto.slice(0, resto.length - mesa).every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "amarre"), `${que}: todo lo demás cuelga del amarre`);
  // El amarre quedó en el piso, donde se pidió (no se apoyó en ningún globo de la raíz).
  const t = armada.porNodo.find((n) => n.id === "amarre")!.puestas[0]!.marco.t;
  assert.ok(Math.abs(t.y) < 0.05, `${que}: el amarre quedó en el piso (${t.y.toFixed(2)})`);
  // Ninguna escenografía que se vea, fuera del amarre oculto, el peso y la mesa de #700 y las cintas.
  for (const n of escena.nodos.filter((x) => x.pieza.tipo === "escenografia")) assert.ok(["amarre", "cintas", "peso", "mesa"].includes(n.id), `${que}: «${n.nombre}» es amarre, cintas, peso o mesa`);
  const conjunto = extraerConjunto(escena, raiz.id, { armada });
  assert.ok(conjunto, `${que}: se extrae el conjunto de la raíz`);
  assert.equal(conjunto!.hijos.length, escena.nodos.length - 1 - mesa, `${que}: el conjunto de la raíz se lleva toda la escena`);
}
// Lo colgado queda donde se pidió (en el mundo), también bajo una raíz girada (#687).
const origen = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!.puestas[0]!.marco.t;
const cerca = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, tol = 0.05) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tol;
assert.ok(cerca(origen(687, "cuerpo-2"), { x: 0, y: 111.59, z: 0 }), `#687: el segundo cuarteto amarillo a la altura medida (${JSON.stringify(origen(687, "cuerpo-2"))})`);
const caja = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!.caja;
const centroCaja = (n: number, id: string) => { const c = caja(n, id); return { x: (c.min.x + c.max.x) / 2, y: (c.min.y + c.max.y) / 2, z: (c.min.z + c.max.z) / 2 }; };
assert.ok(cerca(centroCaja(721, "pez-grande"), { x: 6, y: 86, z: 40 }, 0.1), "#721: el pez grande donde se pidió");
console.log("OK montaje: la estructura es la raíz, el amarre en el piso y oculto, lo colgado en su sitio y su conjunto se lleva todo");

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_21) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  for (const p of i.productos) {
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    assert.ok(p.formato !== null, `${que}: «${p.nombre}» es un globo (el lote no usa metalizados de la tienda)`);
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.codigo && coloresDelFormato(p.formato!).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  // Los impresos de la tienda: cada uno con los globos que lo llevan en el 3D.
  const impresos3D = new Map<string, number>();
  for (const g of a.globos) if (g.estampado?.impreso) impresos3D.set(clave(g.formatoId, g.codigo), (impresos3D.get(clave(g.formatoId, g.codigo)) ?? 0) + 1);
  const impresosProd = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && impresoPorUrl(p.url)) impresosProd.set(clave(p.formato, p.codigo), (impresosProd.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  assert.deepEqual([...impresosProd.entries()].sort(), [...impresos3D.entries()].sort(), `${que}: los impresos del 3D son los de sus productos`);
  lineas += pedidos.size;
}
const conCantidad = (n: number, url: string) => porNumero(n).productos.filter((p) => p.url === url && p.cantidad !== null).reduce((s, p) => s + p.cantidad!, 0);
assert.equal(conCantidad(616, "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco"), 8, "#616: 8 balones (4 de la base, 3 dentro de los Link-O-Loon y el R-24)");
assert.equal(conCantidad(616, "/products/globo-para-fiesta-latex-link-o-loon-fashion-transparente"), 3, "#616: 3 Link-O-Loon cristal");
assert.equal(conCantidad(616, "/products/globo-para-fiesta-latex-redondo-fashion-negro"), 16, "#616: 16 R-5 negros (4 uniones)");
assert.equal(conCantidad(725, "/products/globo-para-fiesta-latex-corazon-fashion-rosado"), 1, "#725: el corazón C-12 publicado");
assert.ok(conCantidad(725, "/products/globo-para-fiesta-latex-tubito-fashion-rosado") >= 4, "#725: el tubito rosado publicado (4 espirales)");
for (const url of ["/products/globo-latex-redondo-silk-rocio-de-oro", "/products/globo-latex-redondo-silk-amatista", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-lavanda", "/products/globo-latex-redondo-silk-blanco-nacar"]) {
  assert.ok(conCantidad(746, url) >= 6, `#746: ${url} con su cantidad`);
}
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
const cuartetos = (n: number) => escenaDe(n).nodos.filter((x) => x.pieza.tipo === "columna" && x.pieza.alturaCm < x.pieza.infladoCm).length;
const impresos = (n: number) => armadas.get(n)!.globos.filter((g) => g.estampado?.impreso).length;
const porCodigo = (n: number, id: string) => {
  const cuenta: Record<string, number> = {};
  for (const g of nodo(n, id).globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
// #604: 5 pétalos impresos, corona de 6, centro y 5 resortes.
assert.deepEqual(porCodigo(604, "flor"), { "R-12|015": 5, "R-5|032": 6, "R-5|015": 1 }, "#604: 5 pétalos, corona de 6 y centro");
assert.equal(impresos(604), 5, "#604: los 5 pétalos (y no el centro) llevan el Graffiti Invierno");
assert.equal(ids(604, "resorte-").length, 5, "#604: 5 resortes");
// #616: base de 4 balones, 4 uniones, 3 dobles globos, 3 rizos y 3 estrellas.
assert.equal(cuartetos(616), 5, "#616: la base y 4 uniones");
assert.equal(ids(616, "balon-en-lol-").length, 3, "#616: 3 Link-O-Loon con balón");
assert.equal(ids(616, "estrella-").length, 3, "#616: 3 estrellitas");
assert.equal(impresos(616), 8, "#616: 8 balones impresos");
// #635: 12 R-5 dentro, anillo de 8 y cuarteto.
assert.equal(ids(635, "relleno-").length, 12, "#635: 12 R-5 de relleno");
assert.equal(nodo(635, "anillo").globos.length, 8, "#635: anillo de 8 R-5");
// #686: cadena de 5, cuarteto de lunares (4 impresos) y la punta.
assert.equal(ids(686, "cadena-").length, 5, "#686: cadena de 5 R-5");
assert.equal(impresos(686), 4, "#686: 4 R-12 de lunares");
// #687: 5 amarillos, 3 madera, 3 mina, anillo.
assert.equal(cuartetos(687), 12, "#687: 5 + 3 + 3 + 1 cuartetos");
// #700: 4 globos de helio.
assert.equal(armadas.get(700)!.globos.length, 4, "#700: 4 R-12 de helio");
// #706: 13 × 7 blancos, 8 impresos, 12 fucsia, 24 lila; 3 Link-O-Loon 660; 10 flores y 8 juntas.
assert.deepEqual(porCodigo(706, "malla"), { "R-12|005": 91, "R-12|609": 8, "R-9|012": 12, "R-5|050": 22, "R-9|050": 2 }, "#706: la malla con sus centros");
assert.equal(impresos(706), 8, "#706: 8 «Es una niña»");
assert.equal(ids(706, "flor-").length, 10, "#706: 10 florecitas");
assert.equal(ids(706, "junta-").length, 8, "#706: 8 juntas lila");
// #720: 8 dulces dentro del cristal.
assert.deepEqual(porCodigo(720, "dulces")["R-24|390"], 1, "#720: el cristal");
assert.equal(nodo(720, "dulces").globos.length, 9, "#720: 8 dulces dentro del cristal");
// #721: aro de 12, 14 algas, 2 peces.
assert.equal(nodo(721, "aro").globos.length, 12, "#721: aro de 12 R-12 azul rey");
assert.equal(nodo(721, "algas-oscuras").tubos.length + nodo(721, "algas-claras").tubos.length >= 14, true, "#721: 14 algas");
assert.equal(ids(721, "pez-").length, 2, "#721: 2 peces");
// #725: 4 espirales y el corazón.
assert.equal(ids(725, "espiral-").length, 4, "#725: 4 espirales");
// #741: 12 margaritas y 3 de helio (2 impresos).
assert.equal(ids(741, "margarita-").length, 12, "#741: 12 margaritas");
assert.equal(impresos(741), 2, "#741: 2 cristal Confetti Dorado");
// #746: 4 bloques y 11 rizos.
assert.equal(escenaDe(746).nodos.filter((x) => x.pieza.tipo === "organico").length, 4, "#746: 4 bloques");
assert.equal(ids(746, "rizo-").length, 11, "#746: 11 rizos");
// #761: 3 lila, 4 impresos, la carita y 6 chupetes.
assert.equal(nodo(761, "lila").globos.length, 3, "#761: 3 lila contra el techo");
assert.equal(impresos(761), 4, "#761: 4 «Es una niña»");
assert.equal(ids(761, "chupete-aro-").length, 6, "#761: 6 chupetes");
// Murales: celdas contadas.
assert.deepEqual(porCodigo(768, "mural"), { "R-5|012": 501, "R-5|021": 87 }, "#768: 588 R-5, 87 amarillos");
assert.deepEqual(porCodigo(769, "mural"), { "R-12|080": 108, "R-5|412": 20, "R-9|011": 30 }, "#769: 108 negros, 20 R-5 y 30 del corazón");
// Alturas (lo más alto con globos o tubitos, cm).
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.some((t) => !t.papel)).map((x) => x.caja.max.y));
for (const [n, min, max] of [[616, 195, 210], [635, 100, 112], [687, 205, 220], [720, 125, 135], [741, 230, 245], [768, 205, 220]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: ${alto(n).toFixed(1)} cm de alto`);
console.log("OK conteos: niveles, cuartetos, impresos, rizos, chupetes, celdas de los murales y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_21) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  // El amarre oculto no sale en la lista de lo que lleva.
  assert.ok(!JSON.stringify(productosDe(item!, armadas.get(i.numero)).escenografia).includes("Amarre"), `${i.id}: el amarre no sale en la lista`);
}
console.log("OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente, sin amarres en la lista");

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-21.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-21.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-21.json");
  for (const i of LOTE_21) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      // Los lisos con el código publicado; los impresos, con el color de fondo del globo que lo lleva.
      if (!impresoPorUrl(m.url) && m.codigo) for (const mio of mios) assert.equal(mio.codigo, m.codigo, `${i.slug}: código de «${m.nombre}»`);
      // Todo lo publicado está en la foto: con su cantidad.
      assert.ok(mios.every((p) => p.cantidad !== null), `${i.slug}: «${m.nombre}» contado`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-21");
