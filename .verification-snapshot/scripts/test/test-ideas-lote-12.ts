/**
 * Lote 12 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-12.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 10 del lote (`clasif/lote-12.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); todas son escenas;
 * - cada idea arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se fabrica en
 *   su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad (lo contado en la
 *   foto); el metalizado y el mural publicado, con las piezas que los llevan; los publicados, tal cual;
 * - cada estructura de globos es un nodo raíz y se extrae con `extraerConjunto`: entran todos sus miembros y sola arma lo
 *   mismo (materiales y cada globo en su sitio) que su rama, sin escenografía; se comprueba qué lleva cada una;
 * - `indexarEscena` da al menos un item (la estructura o «con sus decoraciones») por cada estructura raíz;
 * - lo contado en las fotos (celdas de las paredes, flores, ramas, manos, globos grandes);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_12 } from "../../src/lib/globos3d/ideas-sempertex/lote-12";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [640, 654, 705, 795, 847, 862, 876, 896, 899, 929];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 10 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_12.map((i) => i.numero), NUMEROS, "los 10 números del lote 12, en orden");
assert.equal(new Set(LOTE_12.map((i) => i.id)).size, 10, "ids sin repetir");
for (const i of LOTE_12) {
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
console.log("OK lote: 10 escenas con id, nota, ocasiones de sus etiquetas y foto de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada escena arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const escenaDe = (i: (typeof LOTE_12)[number]): Escena => {
  if (i.contenido.tipo !== "escena") throw new Error(`${i.numero} es una escena`);
  return i.contenido.escena;
};
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_12) {
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
console.log(`OK armado: 10 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubitosTotales} tramos de tubito en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_12) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i);
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const otros = new Map<string, number>();
  for (const p of i.productos) {
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.formato === null) { otros.set(p.url, (otros.get(p.url) ?? 0) + p.cantidad); continue; }
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.codigo && coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    assert.equal(formatoPorId(p.formato)?.tipo, formatoPorId(p.nombre.includes("TUBITO") ? "T-260" : "R-12")?.tipo, `${que}: «${p.nombre}» del tipo de su nombre (${p.formato})`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  // Lo que no es látex liso: los metalizados de la tienda y la utilería que la idea publica (el mural de cuadros).
  const esperados = new Map<string, number>();
  for (const nodo of escena.nodos) {
    if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) esperados.set(nodo.pieza.metalizado.producto.url, (esperados.get(nodo.pieza.metalizado.producto.url) ?? 0) + 1);
    if (nodo.pieza.tipo === "escenografia") for (const p of nodo.pieza.productos ?? []) if (!p.generico && i.productos.some((x) => x.url === p.url)) esperados.set(p.url, (esperados.get(p.url) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...otros.entries()].sort(), [...esperados.entries()].sort(), `${que}: metalizados y utilería publicada con su cantidad`);
  // Sin cantidad, solo un publicado que la foto no muestra (y que entonces no está en el 3D).
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(!del3D.has(clave(p.formato, p.codigo)), `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  lineas += pedidos.size + otros.size;
}
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (metalizado y mural publicado incluidos)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Cada estructura de globos es una raíz y se extrae con lo suyo
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
type Rama = { nodo: string; ids: string[]; materiales: string[] };
const ramas = new Map<number, Rama[]>();
let extraidas = 0, enSuSitio = 0, items = 0;
for (const i of LOTE_12) {
  const escena = escenaDe(i), armada = armadas.get(i.numero)!;
  const estructuras = escena.nodos.filter((n) => clasePieza(n.pieza) === "estructura");
  // Toda estructura es raíz: ninguna cuelga de otra pieza (cada una, su propio árbol).
  for (const n of estructuras) assert.ok(n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre", `#${i.numero}: «${n.nombre}» es raíz`);
  const lista: Rama[] = [];
  for (const raiz of estructuras) {
    const que = `#${i.numero} / ${raiz.id}`;
    const conjunto = extraerConjunto(escena, raiz.id, { armada });
    assert.ok(conjunto, `${que}: sale el conjunto`);
    const ids = miembrosDeConjunto(escena, raiz.id, armada);
    assert.equal(conjunto!.hijos.length, ids.length - 1, `${que}: entran todos sus miembros`);
    for (const id of ids.slice(1)) {
      const clase = clasePieza(escena.nodos.find((x) => x.id === id)!.pieza);
      assert.ok(clase === "decoracion", `${que}: «${id}» es una decoración suya (no escenografía ni otra estructura)`);
    }
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
    lista.push({ nodo: raiz.id, ids, materiales });
  }
  ramas.set(i.numero, lista);
  // La biblioteca: al menos un item (la estructura sola o «con sus decoraciones») por cada estructura raíz.
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  const hijos = indexarEscena(item!, armada);
  for (const raiz of estructuras) {
    const suyo = hijos.find((h) => (h.tipo === "estructura" || h.tipo === "conjunto") && h.apareceEn?.[0]?.nodoIds.includes(raiz.id));
    assert.ok(suyo, `#${i.numero}: «${raiz.nombre}» sale como item de la biblioteca`);
    if ((ramas.get(i.numero)!.find((r) => r.nodo === raiz.id)!.ids.length) > 1) assert.equal(suyo!.tipo, "conjunto", `#${i.numero}: «${raiz.nombre}» sale con sus decoraciones`);
  }
  const nombres = hijos.map((h) => `${h.tipo}|${h.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir`);
  items += hijos.length;
}
const rama = (n: number, nodo: string) => ramas.get(n)!.find((r) => r.nodo === nodo)!;
const hijosDe = (n: number, nodo: string) => rama(n, nodo).ids.slice(1).sort();
assert.deepEqual(hijosDe(640, "torre"), ["grado-derecha-abajo", "grado-derecha-arriba", "grado-izquierda"], "#640: la torre lleva sus 3 R-12 dorados");
assert.deepEqual(hijosDe(640, "racimo-ramo"), ["ramo"], "#640: el racimo lleva el ramo de helio amarrado");
assert.deepEqual(hijosDe(640, "guirnalda-pedestal"), ["grado-pedestal"], "#640: la media luna lleva su R-12 grande");
assert.deepEqual(hijosDe(654, "arco"), ["cristal-derecha", "cristal-izquierda", "gris-arriba", "gris-piso", "telarana-derecha", "telarana-izquierda"], "#654: el arco lleva 2 R-24 grises, 2 cristal y 2 telarañas");
assert.deepEqual(hijosDe(705, "rosado-arriba"), ["rosado-grande"], "#705: el racimo rosado lleva el R-24 rosado");
assert.deepEqual(hijosDe(705, "coral-medio-izquierda"), ["coral-grande-izquierda"], "#705: el racimo coral lleva su coral grande");
assert.deepEqual(hijosDe(705, "rojo-abajo-derecha"), ["fucsia-grande-derecha"], "#705: el racimo rojo lleva el R-24 fucsia");
assert.deepEqual(hijosDe(705, "racimo-entre-pedestales"), ["coral-grande-centro"], "#705: el racimo de entre los pedestales lleva el coral grande");
assert.equal(ramas.get(705)!.length, 20, "#705: pared, 16 racimos de pared, 2 rellenos de pedestal y el racimo de entre ellos");
assert.deepEqual(hijosDe(795, "aro"), ["flor-hojas"], "#795: la guirnalda del aro lleva la flor de hojas doradas");
assert.deepEqual(hijosDe(929, "pared"), ["corbatin", "mano-derecha", "mano-izquierda"], "#929: la pared lleva las 2 manos y el corbatín");
assert.equal(rama(899, "tallo").ids.length, 17, "#899: el tallo lleva la base, la flor grande, sus lazos, 5 ramitas y 8 florecitas");
assert.equal(ramas.get(876)!.length, 0, "#876: el ramo no tiene estructura de globos (el moño es la raíz)");
for (const n of [847, 862, 896]) assert.ok(ramas.get(n)!.some((r) => r.nodo === "pared"), `#${n}: la pared es una estructura raíz`);
console.log(`OK escenas: ${extraidas} estructuras raíz se extraen con lo suyo (${enSuSitio} globos en su sitio); ${items} items al indexarlas`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodo = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!;
const porCodigo = (n: number, id: string) => {
  const cuenta: Record<string, number> = {};
  for (const g of nodo(n, id).globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
// Paredes celda a celda.
assert.deepEqual(porCodigo(705, "pared"), { "R-12|005": 136, "R-5|005": 136 }, "#705: tablero de 17 × 16 blanco");
assert.deepEqual(porCodigo(847, "pared"), { "R-12|041": 66, "R-12|015": 44, "R-12|061": 66, "R-12|020": 88, "R-12|030": 44, "R-12|932": 110, "R-12|038": 66, "R-12|040": 88, "R-12|012": 66 }, "#847: 29 columnas en 9 franjas, 22 filas");
assert.deepEqual(porCodigo(862, "pared"), { "R-12|040": 312, "R-5|040": 138 }, "#862: 26 × 12 R-12 y un R-5 en la mitad de los 275 huecos");
assert.deepEqual(porCodigo(896, "pared"), { "R-12|015": 77, "R-5|059": 40 }, "#896: 7 × 11 R-12 rojos y 40 R-5 coral en damero (con los de los lados)");
assert.deepEqual(porCodigo(929, "pared"), { "R-9|005": 50, "R-9|080": 50 }, "#929: 10 columnas de 10, blancas y negras");
// Globos grandes y sueltos.
for (const id of ["grado-izquierda", "grado-derecha-arriba", "grado-derecha-abajo", "grado-pedestal"]) assert.deepEqual(porCodigo(640, id), { "R-12|970": 1 }, `#640: ${id}`);
assert.equal(nodo(640, "ramo").globos.length, 5, "#640: ramo de 5 R-12 de helio");
assert.deepEqual({ ...porCodigo(654, "gris-arriba"), ...porCodigo(654, "cristal-izquierda") }, { "R-24|081": 1, "R-12|390": 1 }, "#654: R-24 gris y cristal");
assert.equal(nodo(654, "gris-piso").globos[0]!.infladoCm, 55, "#654: el R-24 gris del piso a 55 cm");
// Flores, ramas, manos.
const decos = (n: number, prefijo: string) => armadas.get(n)!.porNodo.filter((x) => x.id.startsWith(prefijo));
assert.equal(decos(876, "flor-").length, 16, "#876: 16 flores");
assert.equal(decos(876, "tallo-").length, 16, "#876: un tallo por flor");
assert.ok(decos(876, "flor-").every((f) => f.tubos.filter((t) => t.codigo === "968").length === 5), "#876: flores de 5 pétalos dorado rosa");
assert.equal(decos(899, "flor-").filter((f) => f.id !== "flor-grande").length, 8, "#899: 8 florecitas");
assert.equal(decos(899, "flor-").filter((f) => f.tubos.some((t) => t.codigo === "015")).length, 3, "#899: 3 florecitas rojas");
assert.equal(decos(899, "flor-").filter((f) => f.tubos.some((t) => t.codigo === "012")).length, 5, "#899: 5 florecitas fucsia");
assert.equal(decos(899, "rama-").length, 5, "#899: 5 ramitas doradas");
assert.deepEqual(porCodigo(899, "flor-grande"), { "R-12|014": 5, "R-5|912": 5, "R-5|970": 1 }, "#899: flor de 5 pétalos frambuesa, corona de 5 y centro dorado");
assert.deepEqual(porCodigo(899, "base"), { "R-12|912": 4 }, "#899: base de 4 R-12 Reflex Fucsia");
assert.equal(decos(929, "mano-").length, 2, "#929: 2 manos");
// Alturas.
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.some((t) => !t.papel)).map((x) => x.caja.max.y));
for (const [n, min, max] of [[640, 250, 275], [654, 270, 315], [899, 210, 235], [929, 170, 195]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: paredes celda a celda, globos grandes, flores, ramas, manos y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_12) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id)!;
  assert.equal(item.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
}
assert.ok(LOTE_12.find((i) => i.numero === 896)!.productos.some((p) => p.cantidad === 1 && metalizadoPorUrl(p.url)), "#896: el corazón metalizado de la tienda");
console.log("OK biblioteca: las 10 en BIBLIOTECA_FABRICA con su fuente");

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-12.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-12.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-12.json");
  for (const i of LOTE_12) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      for (const mio of mios) assert.equal(mio.codigo, m.codigo, `${i.slug}: código de «${m.nombre}»`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-12");
