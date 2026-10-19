/**
 * Lote 07 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-07.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 20 del lote (`clasif/lote-07.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus etiquetas
 *   (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`);
 * - cada idea arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se fabrica en
 *   su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad (lo contado en la
 *   foto); los impresos de la tienda van con el látex de su globo; los publicados, tal cual (nombre, url y código);
 * - en las escenas, cada estructura raíz se extrae con `extraerConjunto`: entran todos sus miembros y sola arma lo mismo
 *   (materiales y cada globo en su sitio) que su rama; en las 4 escenas del lote (#443, #460, #465, #467) y en las
 *   columnas con raíz (#380, #409) se comprueba qué lleva cada una;
 * - lo contado en las fotos (niveles, cuartetos, flores, eslabones, globos);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente; al indexar, lo de sus escenas sale con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_07 } from "../../src/lib/globos3d/ideas-sempertex/lote-07";
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [380, 392, 394, 399, 400, 404, 409, 436, 441, 443, 460, 465, 467, 489, 495, 519, 521, 530, 534, 538];
const ESCENAS_DEL_LOTE = [443, 460, 465, 467];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 20 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_07.map((i) => i.numero), NUMEROS, "los 20 números del lote 07, en orden");
assert.equal(new Set(LOTE_07.map((i) => i.id)).size, 20, "ids sin repetir");
for (const i of LOTE_07) {
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
}
console.log("OK lote: 20 ideas con id, nota, ocasiones de sus etiquetas y foto de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
const escenaDe = (i: (typeof LOTE_07)[number]): Escena => (i.contenido.tipo === "escena" ? i.contenido.escena : { sala: { anchoCm: 600, fondoCm: 500, altoCm: 320, tonos: { piso: "#ccc", paredes: "#eee", techo: "#fff" }, mostrar: { piso: true, fondo: true, laterales: true, techo: true } }, nodos: [{ id: "pieza", nombre: "pieza", pieza: i.contenido.pieza, colocacion: i.contenido.sugerida ?? { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] });
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0;
for (const i of LOTE_07) {
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
console.log(`OK armado: 20 ideas sin avisos y dentro de su sala, ${globosTotales} globos en colores que se fabrican en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

let lineas = 0, impresos = 0;
for (const i of LOTE_07) {
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
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (${impresos} globos impresos de la tienda)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Las estructuras raíz de cada escena se extraen con lo suyo
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
type Rama = { nodo: string; ids: string[]; materiales: string[] };
/** Las raíces: estructuras de globos que no cuelgan de otra pieza. */
const raices = (escena: Escena) => escena.nodos.filter((n) => n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre" && clasePieza(n.pieza) === "estructura").map((n) => n.id);
const ramas = new Map<number, Rama[]>();
let extraidas = 0, enSuSitio = 0;
for (const i of LOTE_07) {
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
// En las 4 escenas del lote, toda estructura es raíz y nada de escenografía cuelga de ella.
for (const n of ESCENAS_DEL_LOTE) {
  const i = LOTE_07.find((x) => x.numero === n)!;
  if (i.contenido.tipo !== "escena") throw new Error(`${n} es una escena`);
  const escena = i.contenido.escena;
  const estructuras = escena.nodos.filter((x) => clasePieza(x.pieza) === "estructura").map((x) => x.id);
  assert.deepEqual(raices(escena), estructuras, `#${n}: cada estructura es un nodo raíz`);
  for (const r of ramas.get(n)!) for (const id of r.ids.slice(1)) assert.notEqual(clasePieza(escena.nodos.find((x) => x.id === id)!.pieza), "escenografia", `#${n} ${r.nodo}: la escenografía no va con la estructura`);
}
assert.deepEqual(ramas.get(443)!.map((r) => r.nodo).sort(), ["colgante-centro", "colgante-derecha", "colgante-fondo-1", "colgante-fondo-2", "colgante-izquierda", "colgante-izquierda-fondo", "racimo-azul", "racimo-rojo"], "#443: 6 colgantes y 2 racimos, cada uno raíz");
for (const r of ramas.get(443)!.filter((x) => x.nodo.startsWith("colgante"))) assert.deepEqual(r.materiales, ["R-12|005|8", "R-12|015|8", "R-12|040|8"], `#443 ${r.nodo}: 2 cuartetos de cada color`);
const r460 = rama(460, "malla");
assert.equal(r460.ids.filter((x) => x.startsWith("flor-")).length, 10, "#460: la malla lleva sus 10 flores");
assert.ok(r460.materiales.includes("LOL-12|040|112"), "#460: la malla de 112 eslabones");
assert.deepEqual(rama(465, "globos-faldon").materiales, ["R-12|971|11"], "#465: la fila de 11 R-12 champaña, sola");
assert.equal(rama(467, "guirnalda").ids.length, 1, "#467: la guirnalda va sola (banderín, faroles y mesa aparte)");
// Las columnas con raíz: la estructura con todo lo suyo.
assert.equal(rama(380, "tallo").ids.length, 8, "#380: el tallo lleva base, calabaza, cuello, 3 cuartetos y la araña");
assert.equal(rama(409, "tallo").ids.length, 11, "#409: el tallo lleva los 6 cuartetos, el racimo, el otro par de tubitos y el R-24");
assert.equal(rama(441, "corona").ids.length, 5, "#441: la corona lleva su moño y sus 3 rizos");
assert.equal(rama(399, "columna").ids.length, 8, "#399: la columna lleva el R-24 y el ramo de helio");
assert.equal(rama(400, "columna").ids.length, 6, "#400: la columna lleva el R-24 y sus 4 corazones");
assert.equal(rama(495, "m").ids.length, 5, "#495: la M lleva sus 3 flores y el globo de helio");
assert.equal(rama(519, "base").ids.length, 15, "#519: la base lleva el anillo, el moño, 7 tallos y 5 flores");
console.log(`OK escenas: ${extraidas} estructuras raíz se extraen con lo suyo (${enSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodo = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!;
const globos = (n: number) => armadas.get(n)!.globos.length;
const contados: Record<number, number> = { 380: 23, 392: 53, 394: 61, 404: 53, 409: 37, 436: 144, 443: 168, 465: 11, 495: 119, 519: 39, 530: 31, 534: 26, 538: 45 };
for (const [n, k] of Object.entries(contados)) assert.equal(globos(Number(n)), k, `#${n}: ${k} globos contados`);
// #392 y #394: tallo de 8 y 10 niveles de R-5 con 2 cruces de tubito; #404: 9 niveles y 2 cinturas de 3 niveles de R-5.
assert.equal(nodo(392, "tallo").globos.length, 32, "#392: tallo de 8 niveles");
assert.equal(nodo(394, "tallo").globos.length, 40, "#394: tallo de 10 niveles");
for (const n of [392, 394]) assert.equal(armadas.get(n)!.porNodo.filter((x) => x.id.startsWith("cruz")).length, 2, `#${n}: 2 cruces`);
assert.deepEqual(["cintura-abajo", "cintura-arriba"].map((id) => nodo(404, id).globos.length), [12, 12], "#404: dos cinturas de 3 cuartetos de R-5");
// #436: 36 cuartetos, 4 niveles por banda (8 la verde lima, que va a los dos lados del azul).
{
  const cuenta = new Map<string, number>();
  for (const g of armadas.get(436)!.globos) cuenta.set(g.codigo, (cuenta.get(g.codigo) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries(cuenta), { "212": 32, "261": 32, "030": 32, "230": 32, "240": 16 }, "#436: bandas de 4 niveles por lado y 4 azules arriba");
}
// #530: 15 eslabones rojos en el aro, 5 uniones verdes, flor de 5 R-12 y flor de 5 R-5 con centro.
assert.equal(armadas.get(530)!.porNodo.filter((x) => x.id.startsWith("eslabon")).length, 15, "#530: 15 eslabones");
assert.equal(armadas.get(530)!.porNodo.filter((x) => x.id.startsWith("union")).length, 5, "#530: 5 uniones");
// #538: 10 tercias (5 delante, 5 detrás) de 3 R-5 y 10 pétalos.
assert.equal(armadas.get(538)!.porNodo.filter((x) => x.id.startsWith("tercia")).reduce((s, x) => s + x.globos.length, 0), 30, "#538: 10 tercias de 3");
// #460: 10 flores de 11 R-5 (5 + 5 + centro); #534: 5 flores con su tallo; #519: 5 flores y 7 tallos.
assert.ok(armadas.get(460)!.porNodo.filter((x) => x.id.startsWith("flor-")).every((x) => x.globos.length === 11), "#460: flores de 5 + 5 + 1");
assert.equal(armadas.get(534)!.porNodo.filter((x) => x.id.startsWith("tallo-")).length, 5, "#534: 5 tallos");
assert.equal(armadas.get(519)!.porNodo.filter((x) => x.id.startsWith("tallo-")).length, 7, "#519: 7 tallos");
// Alturas: columnas de ~1,7–2,2 m.
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.map((x) => x.caja.max.y));
for (const [n, min, max] of [[380, 200, 245], [392, 150, 175], [394, 160, 185], [399, 175, 300], [400, 160, 185], [404, 205, 230], [409, 180, 200]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: niveles, cuartetos, bandas, eslabones, tercias, flores y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_07) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  if (item!.contenido.tipo === "escena") {
    const hijos = indexarEscena(item!, armadas.get(i.numero));
    assert.ok(hijos.length > 0 && hijos.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
    const nombres = hijos.map((h) => `${h.tipo}|${h.nombre}`);
    assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir`);
    derivados += hijos.length;
  }
}
console.log(`OK biblioteca: las 20 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas`);

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

/** Publicados cuyo formato se corrigió con la foto (el mapeo lo deduce del nombre: R-12). */
const FORMATO_CORREGIDO = new Set(["404|839", "404|870", "441|970", "489|663", "495|870", "495|839"]);
const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-07.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-07.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-07.json");
  for (const i of LOTE_07) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas[i.numero - 1]!;
    assert.equal(datos.slug, i.slug, `${i.numero}: slug en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos.productos_mapeados ?? []) {
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

console.log("OK test-ideas-lote-07");
