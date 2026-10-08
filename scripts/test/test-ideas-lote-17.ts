/**
 * Lote 17 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-17.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-17.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); #264 y #303 (misma foto) comparten escena;
 * - cada escena arma sin avisos, nada bajo la mesa ni fuera de la sala, y cada globo y tubito usa un color que se fabrica
 *   en su formato, inflado dentro de lo que da ese formato;
 * - montaje: la estructura principal es la raíz (suelta), su varilla cuelga de ella justo donde se pidió y lo demás de la
 *   varilla (o de la raíz, en #293); el conjunto de la raíz se lleva la escena entera;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos y
 *   metalizados de la tienda, con las piezas que los llevan; lo publicado que la foto no tiene, sin cantidad;
 * - lo contado en las fotos (globos de helio por piso, impresos, flores, bandas, cuartetos);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_17 } from "../../src/lib/globos3d/ideas-sempertex/lote-17";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, extraerConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [219, 232, 233, 237, 264, 274, 277, 285, 292, 293, 295, 298, 299, 303, 306];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_17.map((i) => i.numero), NUMEROS, "los 15 números del lote 17, en orden");
assert.equal(new Set(LOTE_17.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_17) {
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
const porNumero = (n: number) => LOTE_17.find((i) => i.numero === n)!;
const escenaDe = (n: number): Escena => {
  const c = porNumero(n).contenido;
  if (c.tipo !== "escena") throw new Error(`#${n} es una escena`);
  return c.escena;
};
// #264 y #303: la misma foto con dos títulos; se digitaliza una vez y #303 la reusa con su id, slug y foto.
assert.equal(escenaDe(303).nodos, escenaDe(264).nodos, "#303 reusa los nodos de #264");
assert.notDeepEqual(escenaDe(303).sala.tonos, escenaDe(264).sala.tonos, "#303 con los tonos de su foto (la biblioteca no la funde con #264)");
assert.notEqual(porNumero(303).fotoUrl, "", "#303 con su propia foto");
assert.ok(porNumero(303).nota.startsWith("Misma foto que #264"), "#303 dice «misma foto que #264»");
assert.deepEqual(porNumero(303).productos.map((p) => `${p.url}|${p.cantidad}`), porNumero(264).productos.map((p) => `${p.url}|${p.cantidad}`), "#303 con los productos de #264");
console.log("OK lote: 15 escenas con id, nota, ocasiones de sus etiquetas y foto de su fuente (#303 reusa los nodos de #264)");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada escena arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_17) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenaDe(i.numero);
  const a = armarEscena(escena);
  armadas.set(i.numero, a);
  assert.deepEqual(a.avisos, [], `${que}: arma sin avisos`);
  assert.ok(a.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), `${que}: cada pieza quedó puesta`);
  assert.equal(new Set(escena.nodos.map((n) => n.id)).size, escena.nodos.length, `${que}: ids de nodo sin repetir`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  for (const n of a.porNodo) {
    assert.ok(n.caja.min.y >= -1.5, `${que}: «${n.nombre}» no se hunde en la mesa (${n.caja.min.y.toFixed(1)})`);
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
    assert.ok(f && f.tipo === "tubito", `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
    tubitosTotales++;
  }
  globosTotales += a.globos.length;
}
console.log(`OK armado: 15 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubitosTotales} tramos de tubito en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: raíz, varilla y lo que cuelga; el conjunto de la raíz es la escena entera
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_17) {
  const que = `#${i.numero}`;
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const [raiz, segundo, ...resto] = escena.nodos;
  assert.ok(raiz && raiz.colocacion.en === "libre", `${que}: la raíz va suelta`);
  // La raíz es la estructura principal; la calabaza (#232) es una decoración entera (su racimo es la raíz).
  assert.equal(clasePieza(raiz.pieza), i.numero === 232 ? "decoracion" : "estructura", `${que}: la raíz es la estructura principal (${raiz.pieza.tipo})`);
  if (i.numero === 293) {
    assert.ok([segundo!, ...resto].every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === raiz.id), `${que}: todo cuelga de la base`);
  } else {
    assert.ok(segundo && segundo.id === "varilla" && segundo.pieza.tipo === "escenografia" && segundo.colocacion.en === "sobre" && segundo.colocacion.padreId === raiz.id, `${que}: la varilla cuelga de la raíz`);
    assert.ok(resto.every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "varilla"), `${que}: todo lo demás cuelga de la varilla`);
    // La varilla quedó donde se pidió (su base 1,5 cm bajo el punto): no se apoyó en ningún globo de la raíz.
    if (raiz.colocacion.en === "libre" && segundo.colocacion.en === "sobre") {
      const g = (raiz.colocacion.giroGrados * Math.PI) / 180, p = segundo.colocacion.puntoCm;
      const esperado = { x: raiz.colocacion.xCm + p.x * Math.cos(g) + p.z * Math.sin(g), y: raiz.colocacion.yCm + p.y - 1.5, z: raiz.colocacion.zCm - p.x * Math.sin(g) + p.z * Math.cos(g) };
      const t = armada.porNodo.find((n) => n.id === "varilla")!.puestas[0]!.marco.t;
      assert.ok(Math.hypot(t.x - esperado.x, t.y - esperado.y, t.z - esperado.z) < 0.05, `${que}: la varilla quedó donde se pidió`);
    }
  }
  const conjunto = extraerConjunto(escena, raiz.id, { armada });
  assert.ok(conjunto, `${que}: se extrae el conjunto de la raíz`);
  assert.equal(conjunto!.hijos.length, escena.nodos.length - 1, `${que}: el conjunto de la raíz se lleva toda la escena`);
}
console.log("OK montaje: la estructura principal es la raíz, la varilla en su sitio y su conjunto se lleva todo");

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_17) {
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
  // Los impresos de la tienda: cada uno con los globos que lo llevan en el 3D.
  const impresos3D = new Map<string, number>();
  for (const nodo of a.porNodo) for (const g of nodo.globos) if (g.estampado?.impreso) impresos3D.set(clave(g.formatoId, g.codigo), (impresos3D.get(clave(g.formatoId, g.codigo)) ?? 0) + 1);
  const impresosProd = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && impresoPorUrl(p.url)) impresosProd.set(clave(p.formato, p.codigo), (impresosProd.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  for (const [k, n] of impresosProd) assert.ok((impresos3D.get(k) ?? 0) >= n, `${que}: ${n} impresos ${k} en el 3D`);
  // Los metalizados de la tienda, con las piezas que los llevan.
  const esperados = new Map<string, number>();
  for (const nodo of escena.nodos) if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) esperados.set(nodo.pieza.metalizado.producto.url, (esperados.get(nodo.pieza.metalizado.producto.url) ?? 0) + 1);
  assert.deepEqual([...metalizados.entries()].sort(), [...esperados.entries()].sort(), `${que}: metalizados de la tienda con su cantidad`);
  // Sin cantidad, solo un publicado que la foto no muestra: su liso no queda en el 3D (fuera de los impresos).
  const lisos3D = new Map([...del3D].map(([k, n]) => [k, n - (impresosProd.get(k) ?? 0)]));
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(p.codigo === null || !((lisos3D.get(clave(p.formato, p.codigo)) ?? 0) > 0), `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  lineas += pedidos.size + metalizados.size;
}
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (impresos y metalizados de la tienda incluidos)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodo = (n: number, id: string) => {
  const x = armadas.get(n)!.porNodo.find((y) => y.id === id);
  assert.ok(x, `#${n}: nodo ${id}`);
  return x!;
};
const ids = (n: number, prefijo: string) => escenaDe(n).nodos.filter((x) => x.id.startsWith(prefijo)).map((x) => x.id);
const porCodigo = (n: number, id: string) => {
  const cuenta: Record<string, number> = {};
  for (const g of nodo(n, id).globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
const impresos = (n: number) => armadas.get(n)!.globos.filter((g) => g.estampado?.impreso).length;
const alturaCentro = (n: number, id: string) => { const c = nodo(n, id).caja; return (c.min.y + c.max.y) / 2; };
// Ramos de helio por pisos: cuántos globos y en qué orden de altura.
const pisos: ReadonlyArray<readonly [number, number]> = [[219, 3], [233, 4], [237, 3], [264, 3], [274, 3], [277, 3], [285, 3], [295, 2], [298, 3]];
for (const [n, cuantos] of pisos) assert.equal(ids(n, "helio-").length, cuantos, `#${n}: ${cuantos} globos de helio`);
assert.ok(alturaCentro(219, "helio-verde") < alturaCentro(219, "helio-fucsia") && alturaCentro(219, "helio-fucsia") < alturaCentro(219, "helio-amarillo"), "#219: verde, fucsia y amarillo de abajo arriba");
assert.ok(alturaCentro(298, "helio-nino-1") < alturaCentro(298, "helio-blanco") && alturaCentro(298, "helio-blanco") < alturaCentro(298, "helio-nino-2"), "#298: niño, blanco y niño de abajo arriba");
// Impresos de la tienda.
assert.equal(impresos(233), 4, "#233: 4 «Happy Halloween»");
assert.equal(impresos(264), 4, "#264: 3 «Feliz Día» de bigote y el «Feliz Día Papá» de dentro de la burbuja");
assert.equal(impresos(274), 3, "#274: 2 «Feliz Día Mamá» y el rojo de amor");
assert.equal(impresos(292), 6, "#292: 6 cristal con estrellas");
assert.equal(impresos(295), 2, "#295: 2 cristal Graffiti Invierno");
assert.equal(impresos(298), 6, "#298: 4 «Es un niño» de la base y 2 de helio");
assert.equal(impresos(299), 2, "#299: los 2 «Feliz cumpleaños» terra");
// Piezas contadas.
assert.deepEqual(porCodigo(232, "racimo"), { "R-12|061": 6, "R-18|061": 1 }, "#232: racimo de 6 R-12 y un R-18 al centro");
assert.equal(ids(232, "ojo-").length, 2, "#232: 2 ojos de triángulo");
assert.equal(ids(233, "calabaza-").length, 3, "#233: 3 calabacitas apiladas");
assert.equal(ids(237, "flor-").length, 3, "#237: 3 flores");
assert.equal(nodo(237, "florero").globos.length, 60, "#237: florero de 6 anillos de 10 R-5");
assert.deepEqual({ ...porCodigo(264, "corazon") }, { "R-5|940": 4 }, "#264: corazón de cuarteto Reflex Azul");
assert.equal(ids(264, "mostaza-").length, 12, "#264: 12 R-5 mostaza");
assert.equal(nodo(274, "corazon").globos.length, 49, "#274: corazón de 49 R-5 rojo");
assert.deepEqual(porCodigo(277, "burbuja"), { "R-12|390": 1, "C-12|015": 1 }, "#277: cristal con un corazón rojo dentro");
assert.equal(ids(285, "flor-").length, 2, "#285: 2 flores de lazos");
assert.equal(ids(293, "flor-").length, 3, "#293: 3 flores");
assert.equal(ids(293, "rizo-").length, 3, "#293: 3 rizos");
assert.equal(nodo(295, "columna").globos.length, 12, "#295: columna de 3 cuartetos");
assert.equal(ids(298, "biberon-").length, 3, "#298: 3 biberones");
assert.equal(ids(299, "tallo-").length, 9, "#299: 9 R-5 dorados en el tallo");
assert.equal(ids(306, "banda-").length, 6, "#306: 6 bandas de tubito");
assert.equal(nodo(306, "tambor").globos.length, 20, "#306: tambor de 2 anillos de 10");
// Alturas (lo más alto con globos o tubitos, cm).
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.some((t) => !t.papel) || escenaDe(n).nodos.find((y) => y.id === x.id)?.pieza.tipo === "metalizado").map((x) => x.caja.max.y));
for (const [n, min, max] of [[219, 175, 195], [233, 155, 175], [264, 145, 165], [285, 160, 175], [292, 105, 120], [295, 165, 185], [298, 150, 165], [299, 125, 140]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: helio por pisos, impresos, flores, bandas, cuartetos y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_17) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
}
assert.ok(porNumero(285).productos.some((p) => p.cantidad === 1 && metalizadoPorUrl(p.url)), "#285: el metalizado «Feliz cumpleaños» de la tienda");
assert.ok(porNumero(292).productos.some((p) => p.cantidad === 1 && metalizadoPorUrl(p.url)), "#292: la estrella metalizada de la tienda");
console.log("OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente");

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-17.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-17.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-17.json");
  for (const i of LOTE_17) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      // Los lisos con el código publicado; los impresos, con el color de fondo del globo que lo lleva.
      if (!impresoPorUrl(m.url) && m.codigo) for (const mio of mios) assert.equal(mio.codigo, m.codigo, `${i.slug}: código de «${m.nombre}»`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-17");
