/**
 * Lote 15 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-15.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-15.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`), la foto de su fuente (`fuenteIdea`) y una nota que dice qué quedó igual y qué no;
 * - cada idea arma sin avisos, nada bajo el piso ni fuera de la sala, cada globo y tubito en un color que se fabrica en
 *   su formato e inflado dentro de lo que da ese formato; cada amarre quedó exactamente donde se pidió (sin globos de
 *   la raíz que lo corran);
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad (lo contado en la
 *   foto); los impresos de la tienda van con el látex de su globo y los metalizados de la tienda con su cantidad; los
 *   publicados, tal cual (nombre, url y código);
 * - cada estructura raíz se extrae con `extraerConjunto`: entran todos sus miembros y sola arma lo mismo (materiales y
 *   cada globo en su sitio); lo que no es raíz cuelga de ella (solo el pino y el tapete de #41 van aparte, y el «1» de
 *   #91 es su propia estructura);
 * - lo contado en las fotos (niveles, corazones, acentos, eslabones, impresos, ojos, arañas…) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente; al indexar, lo de sus escenas sale con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_15 } from "../../src/lib/globos3d/ideas-sempertex/lote-15";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [35, 41, 45, 57, 76, 78, 91, 92, 98, 114, 127, 134, 135, 149, 152];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_15.map((i) => i.numero), NUMEROS, "los 15 números del lote 15, en orden");
assert.equal(new Set(LOTE_15.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_15) {
  const que = `${i.numero} ${i.slug}`;
  assert.equal(i.id, `idea:${i.slug}`, `${que}: id «idea:<slug>»`);
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
  assert.equal(i.contenido.tipo, "escena", `${que}: va como escena (con su sala)`);
}
console.log("OK lote: 15 ideas con id, nota, ocasiones de sus etiquetas y foto de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const escenaDe = (n: number): Escena => {
  const i = LOTE_15.find((x) => x.numero === n)!;
  if (i.contenido.tipo !== "escena") throw new Error(`${n} es una escena`);
  return i.contenido.escena;
};
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0;
for (const i of LOTE_15) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenaDe(i.numero);
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
  // El amarre (un disco de 2 cm de radio) quedó en el piso donde se pidió: ningún globo de la raíz lo corrió.
  for (const nodo of escena.nodos.filter((x) => x.id.endsWith("-amarre"))) {
    const caja = a.porNodo.find((x) => x.id === nodo.id)!.caja;
    assert.ok(Math.abs(caja.min.y) < 0.01 && Math.abs(caja.max.y - 0.5) < 0.01 && Math.abs(caja.max.x - caja.min.x - 4) < 0.01, `${que}: el amarre en el piso, sin correrse`);
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
console.log(`OK armado: 15 ideas sin avisos y dentro de su sala, amarres en su sitio, ${globosTotales} globos en colores que se fabrican en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0, impresos = 0, metalizados = 0;
for (const i of LOTE_15) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i.numero);
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const otros = new Map<string, number>();
  for (const p of i.productos) {
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.formato === null) { assert.ok(metalizadoPorUrl(p.url), `${que}: «${p.nombre}» es un metalizado de la tienda`); otros.set(p.url, (otros.get(p.url) ?? 0) + p.cantidad); continue; }
    assert.ok(p.codigo && coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
    if (impresoPorUrl(p.url)) impresos += p.cantidad;
  }
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  const globosImpresos = a.globos.filter((g) => g.estampado?.impreso).length;
  const deImpresos = i.productos.filter((p) => p.cantidad !== null && impresoPorUrl(p.url)).reduce((s, p) => s + p.cantidad!, 0);
  assert.equal(deImpresos, globosImpresos, `${que}: ${globosImpresos} globos impresos con su producto`);
  const esperados = new Map<string, number>();
  for (const nodo of escena.nodos) if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) esperados.set(nodo.pieza.metalizado.producto.url, (esperados.get(nodo.pieza.metalizado.producto.url) ?? 0) + 1);
  assert.deepEqual([...otros.entries()].sort(), [...esperados.entries()].sort(), `${que}: los metalizados de la tienda con su cantidad`);
  metalizados += [...otros.values()].reduce((s, n) => s + n, 0);
  // Sin cantidad, solo un publicado que la foto no muestra o un impreso que el taller no trae (el código null).
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(p.codigo === null || !del3D.has(clave(p.formato, p.codigo)), `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  lineas += pedidos.size + otros.size;
}
const impresosDe = (n: number) => Object.fromEntries(LOTE_15.find((i) => i.numero === n)!.productos.filter((p) => p.cantidad !== null && impresoPorUrl(p.url)).map((p) => [`${impresoPorUrl(p.url)!.id}|${p.formato}|${p.codigo}`, p.cantidad ?? 0]));
assert.deepEqual(impresosDe(76), { "infinity-corazones-por-siempre-fashion-surtido-rojo-blanco|R-12|005": 64 }, "#76: 8 niveles impresos por columna (64 Corazones por siempre)");
assert.deepEqual(impresosDe(78), { "infinity-corazones-brillantes-fashion-metal-surtido|R-12|568": 4, "infinity-corazones-brillantes-fashion-metal-surtido|R-12|009": 2 }, "#78: 6 Corazones Brillantes (4 dorado rosa, 2 rosados)");
assert.deepEqual(impresosDe(127), {
  "infinity-feliz-dia-mami-flores-fashion-surtido-rosa-silvestre|R-12|009": 1, "infinity-feliz-dia-mami-flores-fashion-surtido-rosa-silvestre|R-12|011": 2,
  "infinity-feliz-dia-mami-flores-fashion-surtido-rosa-silvestre|R-12|012": 1, "infinity-feliz-dia-mami-flores-fashion-surtido-rojo-blanco|R-12|015": 3,
}, "#127: 7 Feliz Día Mami (4 rosa silvestre, 3 rojo-blanco)");
assert.deepEqual(impresosDe(135), { "infinity-graffiti-rosa-fashion-transparente|R-12|390": 20 }, "#135: 5 niveles de Graffiti Rosa");
assert.deepEqual(impresosDe(152), { "2-caras-happy-halloween-noche-reflex-surtido|R-12|951": 1 }, "#152: el Happy Halloween violeta");
assert.ok((impresosDe(41)["infinity-graffiti-invierno-fashion-transparente|R-12|390"] ?? 0) >= 40, "#41: Graffiti Invierno en la guirnalda y en 9 adornos");
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (${impresos} globos impresos y ${metalizados} metalizados de la tienda)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Las estructuras raíz se extraen con lo suyo
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
const colgada = (c: Escena["nodos"][number]["colocacion"]) => c.en === "ancla" || c.en === "sobre";
const ramas = new Map<number, Map<string, string[]>>();
let extraidas = 0, enSuSitio = 0;
for (const i of LOTE_15) {
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const raices = escena.nodos.filter((n) => !colgada(n.colocacion) && clasePieza(n.pieza) !== "escenografia").map((n) => n.id);
  const porRaiz = new Map<string, string[]>();
  for (const id of raices) {
    const que = `${i.numero} / ${id}`;
    assert.equal(clasePieza(escena.nodos.find((n) => n.id === id)!.pieza), "estructura", `${que}: la raíz es una estructura de globos`);
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
    enSuSitio += sola.globos.length;
    extraidas++;
    porRaiz.set(id, ids);
  }
  // Una sola estructura raíz que se lleva todo lo de globos (en #91 además el «1», que es su propia estructura).
  const esperadas = i.numero === 91 ? 2 : 1;
  assert.equal(raices.length, esperadas, `#${i.numero}: ${esperadas} estructura(s) raíz`);
  const dentro = new Set([...porRaiz.values()].flat());
  for (const n of escena.nodos) if (clasePieza(n.pieza) !== "escenografia" || colgada(n.colocacion)) assert.ok(dentro.has(n.id), `#${i.numero}: «${n.nombre}» va con su estructura`);
  ramas.set(i.numero, porRaiz);
}
const rama = (n: number) => [...ramas.get(n)!.values()][0]!;
const hijos = (n: number, prefijo: string) => rama(n).filter((x) => x.startsWith(prefijo)).length;
assert.equal(hijos(35, "corazon-"), 48, "#35: el tronco con sus 48 corazones");
assert.equal(hijos(45, "nivel-"), 9, "#45: la base y 9 niveles más");
assert.equal(hijos(45, "muesca-"), 28, "#45: 28 R-5 en las muescas");
assert.equal(hijos(57, "flor-"), 3, "#57: 3 flores");
assert.equal(hijos(76, "izquierda-") + hijos(76, "derecha-"), 31, "#76: 16 niveles por columna (la base izquierda es la raíz)");
assert.equal(hijos(76, "corazon-"), 2, "#76: los 2 corazones metalizados");
assert.equal(hijos(91, "eslabon-"), 8, "#91: 4 eslabones de cada lado");
assert.equal(hijos(91, "union-"), 10, "#91: 10 racimos de 4 R-5 en las uniones");
assert.equal(rama(91).filter((x) => x.endsWith("burbuja") || x === "burbuja-arriba").length, 3, "#91: 3 cristales con globitos");
assert.equal(hijos(92, "eslabon-"), 13, "#92: 13 eslabones en la cima");
assert.equal(hijos(98, "ojo-"), 3, "#98: 3 ojos");
assert.equal(hijos(98, "arana"), 1, "#98: la araña");
assert.equal(hijos(114, "pareja-"), 88, "#114: 22 parejas de R-5 por fuera y 22 por dentro");
assert.equal(hijos(114, "eslabon-"), 21, "#114: 21 eslabones rojos");
assert.equal(hijos(114, "papa-noel") + hijos(114, "feliz-navidad"), 3, "#114: 3 metalizados");
assert.deepEqual(["oscuro-", "claro-", "impreso-"].map((p) => hijos(134, p)), [19, 16, 9], "#134: 19 + 16 + 9 globos en las tres franjas");
assert.equal(hijos(135, "cristal-"), 4, "#135: 4 cristales con globitos");
assert.equal(rama(135).filter((x) => /^nivel-\d+$/.test(x)).length + 1, 25, "#135: 25 cuartetos");
assert.equal(hijos(149, "fuera-"), 22, "#149: 22 R-12 en la fila de fuera");
assert.equal(hijos(149, "ojo-"), 16, "#149: 16 ojos");
assert.equal(hijos(149, "arana-"), 2, "#149: 2 arañas");
assert.equal(hijos(152, "negros-"), 6, "#152: 6 racimos de R-5 negros");
console.log(`OK estructuras: ${extraidas} estructuras raíz se extraen con lo suyo (${enSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos y las medidas
// ----------------------------------------------------------------------------------------------------------

const porCodigo = (n: number) => {
  const cuenta: Record<string, number> = {};
  for (const g of armadas.get(n)!.globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
assert.equal(porCodigo(35)["C-12|009"], 48, "#35: 48 corazones C-12 rosados");
assert.equal(porCodigo(35)["R-5|076"], 28, "#35: 7 cuartetos R-5 en el tronco");
assert.deepEqual([porCodigo(45)["R-12|032"], porCodigo(45)["R-9|032"], porCodigo(45)["R-5|015"], porCodigo(45)["R-5|570"]], [12, 28, 14, 14], "#45: 3 cuartetos R-12, 7 R-9 y 14 + 14 acentos");
assert.equal(porCodigo(57)["R-5|015"], 15, "#57: 3 flores de 5 pétalos rojos");
assert.equal(porCodigo(76)["R-12|005"], 128, "#76: 32 cuartetos blancos o impresos");
assert.deepEqual([porCodigo(92)["R-12|011"], porCodigo(92)["R-12|030"], porCodigo(92)["R-12|061"], porCodigo(92)["R-12|023"]], [16, 16, 16, 16], "#92: 16 cuartetos en espiral de 4 colores");
assert.equal(Object.entries(porCodigo(92)).filter(([k]) => k.startsWith("LOL-12")).reduce((s, [, n]) => s + n, 0), 13, "#92: 13 eslabones");
assert.equal(porCodigo(114)["LOL-6|015"], 21, "#114: 21 eslabones rojos");
assert.equal(porCodigo(114)["R-5|970"], 88, "#114: 88 R-5 dorados en parejas");
assert.deepEqual([porCodigo(134)["R-12|971"], porCodigo(134)["R-12|406"]], [19, 16], "#134: 19 champaña y 16 perla");
assert.deepEqual([porCodigo(135)["R-12|029"], porCodigo(135)["R-12|050"], porCodigo(135)["R-12|406"], porCodigo(135)["R-12|390"], porCodigo(135)["R-18|390"]], [40, 20, 20, 80, 4], "#135: 10 cuartetos verdes y 5 lilas dobles, 5 perla, 5 graffiti y 4 cristales grandes");
assert.equal(porCodigo(149)["R-12|027"], 22, "#149: 22 R-12 eucalipto por fuera");
assert.equal(porCodigo(149)["R-9|005"], 16, "#149: 16 ojos R-9 blancos");
assert.equal(porCodigo(152)["R-12|031"], 14, "#152: anillos de 8 y 6 R-12 verde lima");
assert.equal(porCodigo(152)["R-5|080"], 24, "#152: 6 racimos de 4 R-5 negros");
// Alto total de cada idea (cm) y ancho de las que lo dicen las fotos.
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => !x.id.endsWith("-amarre")).map((x) => x.caja.max.y));
const ancho = (n: number) => { const p = armadas.get(n)!.porNodo.filter((x) => x.globos.length); return Math.max(...p.map((x) => x.caja.max.x)) - Math.min(...p.map((x) => x.caja.min.x)); };
for (const [n, min, max] of [
  [35, 120, 135], [41, 220, 240], [45, 170, 185], [57, 125, 140], [76, 240, 260], [78, 100, 120], [91, 210, 230], [92, 280, 305],
  [98, 235, 260], [114, 250, 270], [127, 220, 240], [134, 230, 245], [135, 235, 260], [149, 245, 262], [152, 80, 95],
] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm (${min}–${max})`);
for (const [n, min, max] of [[35, 100, 115], [76, 195, 215], [92, 440, 470], [114, 330, 355], [134, 320, 350], [135, 300, 330], [149, 190, 205]] as const) {
  assert.ok(ancho(n) >= min && ancho(n) <= max, `#${n}: ancho ${ancho(n).toFixed(0)} cm (${min}–${max})`);
}
console.log("OK conteos: niveles, corazones, acentos, eslabones, franjas, ojos y medidas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_15) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  const derivadosDe = indexarEscena(item!, armadas.get(i.numero));
  assert.ok(derivadosDe.length > 0 && derivadosDe.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
  const nombres = derivadosDe.map((h) => `${h.tipo}|${h.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir`);
  for (const id of ramas.get(i.numero)!.keys()) assert.ok(derivadosDe.some((h) => h.apareceEn?.[0]?.nodoIds.includes(id)), `${i.id}: «${id}» sale al indexar`);
  derivados += derivadosDe.length;
}
console.log(`OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas`);

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-15.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; tipo: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-15.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-15.json");
  for (const i of LOTE_15) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas.find((x) => x.slug === i.slug)!;
    assert.ok(datos, `${i.slug}: en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    // Cada producto publicado está en sus productos, con su nombre, url y código tal cual (el formato puede ser el de
    // la foto: el mismo producto de la tienda en otra talla, la nota lo dice).
    for (const m of datos.productos_mapeados ?? []) {
      const mios = i.productos.filter((p) => p.nombre === m.nombre && p.url === m.url);
      assert.ok(mios.length, `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) for (const p of mios) {
        assert.equal(p.codigo, m.codigo, `${i.slug}: código de «${m.nombre}»`);
        assert.equal(formatoPorId(p.formato ?? "")?.tipo, formatoPorId(m.formato ?? "")?.tipo, `${i.slug}: «${m.nombre}» del mismo tipo de globo`);
      }
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: no se cruzan)");

console.log("OK test-ideas-lote-15");
