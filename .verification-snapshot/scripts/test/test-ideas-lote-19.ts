/**
 * Lote 19 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-19.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-19.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`);
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se fabrica
 *   en su formato, inflado dentro de lo que da ese formato;
 * - montaje: la estructura es la raíz (suelta), su amarre cuelga de ella en el piso, donde se pidió, y no se ve (una
 *   escenografía sin elementos); lo demás cuelga del amarre; el conjunto de la raíz se lleva la escena entera;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos,
 *   metalizados y utilería de la tienda, con las piezas que los llevan; lo publicado que la foto no tiene, sin cantidad;
 * - lo contado en las fotos (niveles, cuartetos, globos, rizos, flores, huesos, impresos) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_19 } from "../../src/lib/globos3d/ideas-sempertex/lote-19";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, extraerConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [375, 381, 382, 385, 390, 396, 397, 401, 403, 407, 411, 423, 426, 427, 428];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_19.map((i) => i.numero), NUMEROS, "los 15 números del lote 19, en orden");
assert.equal(new Set(LOTE_19.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_19) {
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
const porNumero = (n: number) => LOTE_19.find((i) => i.numero === n)!;
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
for (const i of LOTE_19) {
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
    assert.ok(f && f.tipo === "tubito", `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
    tubitosTotales++;
  }
  globosTotales += a.globos.length;
}
console.log(`OK armado: 15 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubitosTotales} tramos de tubito en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: raíz, amarre invisible y lo que cuelga; el conjunto de la raíz es la escena entera
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_19) {
  const que = `#${i.numero}`;
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const [raiz, amarre, ...resto] = escena.nodos;
  assert.ok(raiz && raiz.colocacion.en === "libre", `${que}: la raíz va suelta`);
  // La raíz es la estructura; la del corazón entrelazado (#427) es su cuerda de tubitos trenzados (una figura).
  assert.equal(clasePieza(raiz.pieza), i.numero === 427 ? "decoracion" : "estructura", `${que}: la raíz es la estructura (${raiz.pieza.tipo})`);
  // Ninguna escenografía que se vea, fuera de la utilería de la tienda (el cartel de #428).
  for (const n of escena.nodos) if (n.pieza.tipo === "escenografia" && !n.pieza.utileria) assert.equal(n.pieza.elementos.length, 0, `${que}: «${n.nombre}» no se ve`);
  if (i.numero === 426) assert.equal(escena.nodos.length, 1, `${que}: el corazón en malla va solo`);
  else {
    assert.ok(amarre && amarre.id === `${raiz.id}-amarre` && amarre.pieza.tipo === "escenografia" && amarre.colocacion.en === "sobre" && amarre.colocacion.padreId === raiz.id, `${que}: el amarre cuelga de la raíz`);
    assert.ok(resto.length > 0 && resto.every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === amarre.id), `${que}: todo lo demás cuelga del amarre`);
    // El amarre quedó en el piso, donde se pidió (no se apoyó en ningún globo de la raíz).
    const t = armada.porNodo.find((n) => n.id === amarre.id)!.puestas[0]!.marco.t;
    assert.ok(Math.abs(t.y) < 0.05, `${que}: el amarre quedó en el piso (${t.y.toFixed(2)})`);
  }
  const conjunto = extraerConjunto(escena, raiz.id, { armada });
  assert.ok(conjunto, `${que}: se extrae el conjunto de la raíz`);
  assert.equal(conjunto!.hijos.length, escena.nodos.length - 1, `${que}: el conjunto de la raíz se lleva toda la escena`);
}
// Lo colgado queda donde se pidió (en el mundo), también bajo una raíz girada (#401, #411).
const origen = (n: number, id: string) => armadas.get(n)!.porNodo.find((x) => x.id === id)!.puestas[0]!.marco.t;
const cerca = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.05;
assert.ok(cerca(origen(401, "pareja-1-izquierda"), { x: -13.7, y: 12.22, z: -5 }), "#401: la pareja de la base, a la izquierda y detrás del eje");
assert.ok(cerca(origen(375, "cafe-1"), { x: 0, y: 33.45, z: 0 }), "#375: el primer café a la altura medida");
console.log("OK montaje: la estructura es la raíz, el amarre en el piso y sin dibujo, lo colgado en su sitio y su conjunto se lleva todo");

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_19) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i.numero);
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const deTienda = new Map<string, number>();
  for (const p of i.productos) {
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.formato === null) { deTienda.set(p.url, (deTienda.get(p.url) ?? 0) + p.cantidad); continue; }
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.codigo && coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  // Los impresos de la tienda: cada uno con los globos que lo llevan en el 3D.
  const impresos3D = new Map<string, number>();
  for (const g of a.globos) if (g.estampado?.impreso) impresos3D.set(clave(g.formatoId, g.codigo), (impresos3D.get(clave(g.formatoId, g.codigo)) ?? 0) + 1);
  const impresosProd = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && impresoPorUrl(p.url)) impresosProd.set(clave(p.formato, p.codigo), (impresosProd.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  assert.deepEqual([...impresosProd.entries()].sort(), [...impresos3D.entries()].sort(), `${que}: los impresos del 3D son los de sus productos`);
  // Los metalizados y la utilería de la tienda, con las piezas que los llevan.
  const esperados = new Map<string, number>();
  for (const nodo of escena.nodos) {
    if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) esperados.set(nodo.pieza.metalizado.producto.url, (esperados.get(nodo.pieza.metalizado.producto.url) ?? 0) + 1);
    if (nodo.pieza.tipo === "escenografia") for (const p of nodo.pieza.productos ?? []) if (!p.generico) esperados.set(p.url, (esperados.get(p.url) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...deTienda.entries()].sort(), [...esperados.entries()].sort(), `${que}: metalizados y utilería de la tienda con su cantidad`);
  for (const url of deTienda.keys()) assert.ok(metalizadoPorUrl(url) || url === "/products/cartel-decorativo-feliz-dia-corazones-modernos", `${que}: ${url} es de la tienda`);
  // Sin cantidad, solo un publicado que la foto no muestra: su liso no queda en el 3D (fuera de los impresos).
  const lisos3D = new Map([...del3D].map(([k, n]) => [k, n - (impresosProd.get(k) ?? 0)]));
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(p.codigo === null || !((lisos3D.get(clave(p.formato, p.codigo)) ?? 0) > 0), `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  lineas += pedidos.size + deTienda.size;
}
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (impresos, metalizados y utilería de la tienda incluidos)`);

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
// Niveles de cuarteto contados.
for (const [n, niveles] of [[375, 6], [382, 1], [385, 6], [390, 6], [396, 2], [397, 13], [407, 2], [411, 5]] as const) assert.equal(cuartetos(n), niveles, `#${n}: ${niveles} cuartetos`);
assert.equal(nodo(401, "eje").globos.length, 40, "#401: eje de 10 niveles de R-5 aguamarina");
assert.equal(ids(401, "pareja-").length, 12, "#401: 6 parejas de R-12");
assert.equal(ids(401, "helio-").length, 5, "#401: 5 globos de helio");
assert.equal(ids(381, "eslabon-").length, 3, "#381: 3 eslabones");
assert.equal(ids(381, "anillo-").length, 4, "#381: 4 anillos de R-5");
assert.deepEqual(porCodigo(382, "tubo"), { "R-5|020": 1, "R-5|412": 1, "R-5|038": 1, "R-5|061": 1, "R-5|050": 1, "R-5|540": 1 }, "#382: 6 R-5 apilados, uno de cada color");
assert.deepEqual(nodo(382, "tubo").globos.map((g) => g.codigo), ["020", "412", "038", "061", "050", "540"], "#382: los R-5 de abajo arriba");
assert.deepEqual(nodo(403, "tubo").globos.map((g) => g.codigo), ["009", "021", "038", "050", "230", "009"], "#403: los R-5 de abajo arriba");
assert.equal(ids(385, "hueso-").length, 3, "#385: 3 huesos");
assert.equal(impresos(385), 12, "#385: 3 cuartetos impresos");
assert.equal(impresos(375), 1, "#375: la cabeza impresa");
assert.equal(impresos(396), 8, "#396: 2 cuartetos negros impresos");
assert.equal(ids(390, "flor-").length, 4, "#390: 4 flores de tubito");
assert.equal(ids(396, "tallo-").length, 3, "#396: tallo de 3 tubitos");
assert.deepEqual(porCodigo(396, "cristal"), { "R-18|390": 1, "R-5|212": 5, "R-5|261": 2, "R-5|220": 3 }, "#396: cristal R-18 con 10 R-5 dentro");
assert.equal(ids(403, "rizo-").length, 8, "#403: 8 rizos");
assert.equal(ids(407, "racimo-").length, 12, "#407: 12 racimos de 4 R-5 en la corona");
assert.equal(ids(411, "rizo-").length, 5, "#411: 5 rizos");
assert.equal(ids(423, "r5-").length, 4, "#423: 4 R-5 en las orejas");
assert.equal(ids(427, "rojo-").length, 10, "#427: 10 R-5 rojos");
assert.equal(escenaDe(428).nodos.filter((x) => x.pieza.tipo === "organico").length, 14, "#428: 14 bloques de color");
assert.ok(Math.abs(nodo(426, "corazon").globos.length - 64) <= 6, `#426: ~64 globos (${nodo(426, "corazon").globos.length})`);
// Alturas (lo más alto con globos, tubitos o metalizados, cm).
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.some((t) => !t.papel) || escenaDe(n).nodos.find((y) => y.id === x.id)?.pieza.tipo === "metalizado").map((x) => x.caja.max.y));
for (const [n, min, max] of [[375, 160, 175], [381, 235, 250], [382, 165, 180], [385, 150, 165], [390, 210, 225], [396, 175, 185], [397, 220, 230], [401, 195, 210], [403, 165, 175], [407, 108, 116]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: niveles, cuartetos, impresos, rizos, flores, huesos y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_19) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
}
assert.ok(porNumero(407).productos.some((p) => p.cantidad === 1 && metalizadoPorUrl(p.url)), "#407: el corazón «Te Amo» de la tienda");
assert.ok(porNumero(428).productos.some((p) => p.cantidad === 1 && p.url === "/products/cartel-decorativo-feliz-dia-corazones-modernos"), "#428: el cartel de la tienda");
console.log("OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente");

// ----------------------------------------------------------------------------------------------------------
// 7. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-19.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-19.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-19.json");
  for (const i of LOTE_19) {
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

console.log("OK test-ideas-lote-19");
