/**
 * Lote 22 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-22.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-22.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`);
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se
 *   fabrica en su formato, inflado dentro de lo que da ese formato;
 * - montaje: la estructura principal es la raíz (suelta); su amarre cuelga de ella justo donde se pidió, es delgado y
 *   **oculto** (no se dibuja), sin globos debajo, y lo demás cuelga del amarre; el conjunto de la raíz se lleva la
 *   escena entera; la única escenografía es el amarre, las cintas, el foil, la utilería, la canasta y las hojas;
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos de
 *   la tienda, con los globos que los llevan; la utilería de la tienda, con la de la escena; lo publicado, con su
 *   nombre, url y código; #786 y #928 gastan exactamente sus «Materiales» (y salen sin `contada`);
 * - lo contado en las fotos (huecos, cruces, cuartetos, niveles, impresos, tríos, collares, flores, rizos) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que los lotes: cada lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa los lotes.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_22 } from "../../src/lib/globos3d/ideas-sempertex/lote-22";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import { CATALOGO_UTILERIA } from "../../src/lib/globos3d/utileria-catalogo";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, extraerConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [774, 778, 786, 787, 802, 856, 883, 887, 902, 903, 905, 917, 919, 925, 928];
/** Las que publican «Materiales» con cantidades: lo que dice la lista, exacto. */
const MATERIALES: Readonly<Record<number, Readonly<Record<string, number>>>> = {
  786: { "R-9|126": 20, "R-12|080": 2, "R-12|061": 1, "T-260|931": 2 },
  928: { "R-12|880": 12, "R-12|062": 12, "R-12|073": 12, "R-5|870": 12, "R-18|880": 2, "R-9|080": 1, "T-260|080": 3, "R-12|080": 1 },
};

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_22.map((i) => i.numero), NUMEROS, "los 15 números del lote 22, en orden");
assert.equal(new Set(LOTE_22.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_22) {
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
const porNumero = (n: number) => LOTE_22.find((i) => i.numero === n)!;
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
for (const i of LOTE_22) {
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
// 3. Montaje: raíz, amarre oculto y lo que cuelga; el conjunto de la raíz es la escena entera
// ----------------------------------------------------------------------------------------------------------

const nodoArmado = (n: number, id: string) => {
  const x = armadas.get(n)!.porNodo.find((y) => y.id === id);
  assert.ok(x, `#${n}: nodo ${id}`);
  return x!;
};
for (const i of LOTE_22) {
  const que = `#${i.numero}`;
  const escena = escenaDe(i.numero), armada = armadas.get(i.numero)!;
  const [raiz, segundo, ...resto] = escena.nodos;
  assert.ok(raiz && raiz.colocacion.en === "libre", `${que}: la raíz va suelta`);
  assert.equal(clasePieza(raiz.pieza), "estructura", `${que}: la raíz es la estructura principal (${raiz.pieza.tipo})`);
  const conjunto = extraerConjunto(escena, raiz.id, { armada });
  assert.ok(conjunto, `${que}: se extrae el conjunto de la raíz`);
  assert.equal(conjunto!.hijos.length, escena.nodos.length - 1, `${que}: el conjunto de la raíz se lleva toda la escena`);
  // El mural navideño no lleva nada colgado: es solo su raíz.
  if (i.numero === 778) { assert.equal(escena.nodos.length, 1, "#778: solo el mural"); continue; }
  assert.ok(segundo && segundo.id === "amarre" && segundo.pieza.tipo === "escenografia" && segundo.colocacion.en === "sobre" && segundo.colocacion.padreId === raiz.id, `${que}: el amarre cuelga de la raíz`);
  assert.ok(resto.every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "amarre"), `${que}: todo lo demás cuelga del amarre`);
  if (raiz.colocacion.en === "libre" && segundo.colocacion.en === "sobre") {
    const g = (raiz.colocacion.giroGrados * Math.PI) / 180, p = segundo.colocacion.puntoCm;
    const esperado = { x: raiz.colocacion.xCm + p.x * Math.cos(g) + p.z * Math.sin(g), y: raiz.colocacion.yCm + p.y - 1.5, z: raiz.colocacion.zCm - p.x * Math.sin(g) + p.z * Math.cos(g) };
    const t = nodoArmado(i.numero, "amarre").puestas[0]!.marco.t;
    assert.ok(Math.hypot(t.x - esperado.x, t.y - esperado.y, t.z - esperado.z) < 0.05, `${que}: el amarre quedó donde se pidió (sin globos debajo)`);
  }
  // Oculto y delgado: existe (da el marco) pero no se dibuja.
  if (segundo.pieza.tipo === "escenografia") for (const e of segundo.pieza.elementos) assert.ok(e.forma === "cilindro" && e.radioCm <= 0.6 && e.oculto === true, `${que}: el amarre es delgado y oculto`);
  assert.ok(nodoArmado(i.numero, "amarre").solidos.every((s) => s.oculto === true), `${que}: el amarre armado sigue oculto`);
  // No hay más escenografía que el amarre, las cintas, el foil, la utilería, la canasta y las hojas.
  for (const n of escena.nodos.filter((x) => x.pieza.tipo === "escenografia")) {
    if (n.pieza.tipo !== "escenografia") continue;
    const ok = n.id === "amarre" || n.id === "cintas" || n.id === "canasta" || n.id.startsWith("hoja-") || Boolean(n.pieza.utileria) || n.pieza.elementos.every((e) => e.acabado === "foil" || e.acabado === "foil_mate");
    assert.ok(ok, `${que}: «${n.nombre}» es amarre, cintas, foil, utilería, canasta u hoja`);
  }
}
// Los amarres por dentro: en las columnas, por el eje (dentro de los cuartetos); en lo demás, detrás de la estructura.
const caja = (n: number, id: string) => nodoArmado(n, id).caja;
for (const n of [787, 802, 917, 919, 925]) {
  const c = caja(n, "amarre");
  assert.ok(Math.abs((c.min.x + c.max.x) / 2) < 0.05 && Math.abs((c.min.z + c.max.z) / 2) < 0.05, `#${n}: el amarre va por el eje`);
}
for (const [n, raiz] of [[774, "malla"], [786, "base"], [856, "malla"], [883, "racimo"], [887, "base"], [902, "semiarco"], [903, "semiarco"], [905, "semiarco"], [928, "aro"]] as const) {
  assert.ok(caja(n, "amarre").max.z < caja(n, raiz).min.z, `#${n}: el amarre va detrás de la estructura`);
}
console.log("OK montaje: la estructura principal es la raíz, el amarre oculto en su sitio y su conjunto se lleva todo");

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_22) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i.numero);
  const fuente = fuenteIdea(i.slug)!;
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const metalizados = new Map<string, number>();
  const utileria = new Map<string, number>();
  for (const p of i.productos) {
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad === null) continue;
    assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0, `${que}: «${p.nombre}» con cantidad entera`);
    // Con «Materiales», lo de la lista sale con su cantidad publicada (sin `contada`); lo demás, contado en la foto.
    if (MATERIALES[i.numero]) assert.ok(p.contada === undefined, `${que}: «${p.nombre}» con la cantidad de los «Materiales»`);
    else assert.equal(p.contada, true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.formato === null) {
      if (metalizadoPorUrl(p.url)) metalizados.set(p.url, (metalizados.get(p.url) ?? 0) + p.cantidad);
      else if (CATALOGO_UTILERIA.some((u) => u.url === p.url)) utileria.set(p.url, (utileria.get(p.url) ?? 0) + p.cantidad);
      else assert.ok(fuente.productos.some((q) => q.url === p.url), `${que}: «${p.nombre}» es un producto que publica la idea`);
      continue;
    }
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.codigo && coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: «${p.nombre}» con formato y código que se fabrican`);
    pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: el 3D gasta exactamente lo de sus productos`);
  if (MATERIALES[i.numero]) assert.deepEqual([...del3D.entries()].sort(), Object.entries(MATERIALES[i.numero]!).sort(), `${que}: el 3D gasta exactamente sus «Materiales»`);
  const impresos3D = new Map<string, number>();
  for (const nodo of a.porNodo) for (const g of nodo.globos) if (g.estampado?.impreso) impresos3D.set(clave(g.formatoId, g.codigo), (impresos3D.get(clave(g.formatoId, g.codigo)) ?? 0) + 1);
  const impresosProd = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && impresoPorUrl(p.url)) impresosProd.set(clave(p.formato, p.codigo), (impresosProd.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  for (const [k, n] of impresosProd) assert.ok((impresos3D.get(k) ?? 0) >= n, `${que}: ${n} impresos ${k} en el 3D`);
  const esperados = new Map<string, number>();
  for (const nodo of escena.nodos) if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) esperados.set(nodo.pieza.metalizado.producto.url, (esperados.get(nodo.pieza.metalizado.producto.url) ?? 0) + 1);
  assert.deepEqual([...metalizados.entries()].sort(), [...esperados.entries()].sort(), `${que}: metalizados de la tienda con su cantidad`);
  const utileriaEscena = new Map<string, number>();
  for (const nodo of escena.nodos) if (nodo.pieza.tipo === "escenografia") for (const p of nodo.pieza.productos ?? []) if (!p.generico && p.url) utileriaEscena.set(p.url, (utileriaEscena.get(p.url) ?? 0) + p.cantidad);
  assert.deepEqual([...utileria.entries()].sort(), [...utileriaEscena.entries()].sort(), `${que}: la utilería de la tienda con su cantidad`);
  const lisos3D = new Map([...del3D].map(([k, n]) => [k, n - (impresosProd.get(k) ?? 0)]));
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(p.codigo === null || !((lisos3D.get(clave(p.formato, p.codigo)) ?? 0) > 0), `${que}: «${p.nombre}» sin cantidad no está en el 3D`);
  lineas += pedidos.size + metalizados.size + utileria.size;
}
// Lo publicado, con cantidad (la foto lo tiene).
const conCantidad = (n: number, url: string) => porNumero(n).productos.filter((p) => p.url === url && p.cantidad !== null).reduce((s, p) => s + p.cantidad!, 0);
assert.equal(conCantidad(786, "/products/globo-para-fiesta-latex-redondo-2-caras-calabaza-luz-fashion-negro"), 2, "#786: 2 «Calabaza Luz»");
assert.equal(conCantidad(786, "/products/globo-para-fiesta-latex-redondo-2-caras-happy-halloween-fashion-surtido-negro-naranja"), 1, "#786: 1 «Happy Halloween»");
assert.equal(conCantidad(883, "/products/globo-metalizado-love-1"), 1, "#883: el redondo «LOVE» publicado");
for (const u of ["/products/plato-love", "/products/vaso-love", "/products/servilleta-pequena-love", "/products/kit-diy-guirnalda-amor-y-amistad"]) assert.equal(conCantidad(883, u), 1, `#883: ${u}`);
assert.equal(conCantidad(887, "/products/globo-para-fiesta-latex-redondo-infinity-interrogacion-fashion-negro"), 1, "#887: el «?» publicado");
assert.equal(conCantidad(902, "/products/globo-para-fiesta-latex-redondo-infinity-animal-print-fashion-y-metal-surtido"), 6, "#902: 6 animal print");
assert.equal(conCantidad(905, "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente"), 6, "#905: 6 Graffiti Invierno");
assert.ok(conCantidad(905, "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa") > 0, "#905: el Reflex Dorado Rosa publicado");
assert.equal(conCantidad(928, "/products/mantel-fiesta-desechable-redondo-poliester-telarana"), 1, "#928: el mantel de telaraña");
assert.equal(conCantidad(928, "/products/globo-para-fiesta-latex-redondo-infinity-arana-metalink-fashion-negro"), 1, "#928: el R-12 Metalink");
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (impresos, metalizados y utilería de la tienda; los «Materiales» de #786 y #928, exactos)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const ids = (n: number, prefijo: string) => escenaDe(n).nodos.filter((x) => x.id.startsWith(prefijo)).map((x) => x.id);
const impresos = (n: number) => armadas.get(n)!.globos.filter((g) => g.estampado?.impreso).length;
const porCodigo = (n: number, id: string) => {
  const cuenta: Record<string, number> = {};
  for (const g of nodoArmado(n, id).globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
// Murales: 53 blancos de corazones en 7 filas (8 y 7); la pared de 10 × 10 con 55 dorados y 25 impresos.
assert.equal(ids(774, "blanco-").length, 53, "#774: 53 R-12 de corazones en los huecos");
assert.equal(impresos(774), 53, "#774: los 53 impresos");
for (let j = 1; j <= 7; j++) assert.equal(ids(774, `blanco-${j}-`).length, j % 2 === 1 ? 8 : 7, `#774: fila ${j} de ${j % 2 === 1 ? 8 : 7}`);
assert.deepEqual(porCodigo(778, "mural"), { "R-12|015": 55, "R-12|030": 60, "R-5|570": 55, "R-12|032": 10 }, "#778: 40 rojos y 60 verdes, 55 dorados y 25 impresos (15 rojos y 10 verdes)");
assert.equal(impresos(778), 25, "#778: 25 impresos navideños");
// Calabaza noche: 20 R-9 en la base, 2 calabazas con cara y el naranja impreso.
assert.deepEqual(porCodigo(786, "base"), { "R-9|126": 20 }, "#786: base de 20 R-9 té verde");
assert.equal(ids(786, "calabaza-").length, 2, "#786: 2 calabazas");
// Nota musical: 4 cuartetos R-9, 4 anillos de R-5 negro, el tallo y la nota.
assert.equal(armadas.get(787)!.globos.filter((g) => g.formatoId === "R-9").length, 16, "#787: 4 cuartetos R-9");
assert.equal(ids(787, "negro-").length, 4, "#787: 4 anillos de R-5 negros");
// Olla: 4 patas, olla, araña y 3 de helio con sus cintas.
assert.equal(nodoArmado(802, "patas").globos.length, 4, "#802: 4 patas");
assert.equal(ids(802, "helio-").length, 3, "#802: 3 globos de helio");
assert.ok(escenaDe(802).nodos.some((x) => x.id === "cintas" && x.pieza.tipo === "escenografia" && x.pieza.elementos.length === 3), "#802: 3 cintas");
// Primaveral: 2 flores, 3 metalizados de figura y el pasto.
assert.equal(ids(856, "flor-").length, 2, "#856: 2 flores");
assert.deepEqual(["abeja", "mariposa", "caracol"].map((x) => ids(856, x).length), [1, 1, 1], "#856: abeja, mariposa y caracol");
// Revelación: el R-36, el collar de 22 alternados, 4 «baby» y 4 acentos.
assert.equal(ids(887, "collar-").length, 22, "#887: collar de 22 R-5");
assert.equal(impresos(887), 5, "#887: el «?» y 4 «baby»");
assert.equal(nodoArmado(887, "interrogacion").globos[0]!.formatoId, "R-36", "#887: el «?» es R-36");
// Semiarcos: 2 R-24 y 6 impresos en #902 y #905, 6 hojas; 5 flores y 4 rizos en #903.
assert.equal(impresos(902), 6, "#902: 6 animal print");
assert.equal(ids(902, "hoja-").length, 6, "#902: 6 hojas de monstera");
assert.equal(armadas.get(902)!.globos.filter((g) => g.formatoId === "R-24").length, 2, "#902: 2 R-24");
assert.equal(ids(903, "flor-").length, 5, "#903: 5 flores");
assert.equal(ids(903, "rizo-").length, 4, "#903: 4 rizos");
assert.ok(escenaDe(903).nodos.filter((x) => x.id.startsWith("flor-")).every((x) => x.pieza.tipo === "decoracion" && x.pieza.decoracion.tipo === "flor" && x.pieza.decoracion.propiedades.petalos.cantidad === 5), "#903: flores de 5 pétalos");
assert.equal(impresos(905), 6, "#905: 6 Graffiti Invierno");
assert.equal(armadas.get(905)!.globos.filter((g) => g.formatoId === "R-24").length, 2, "#905: 2 R-24");
// Sorbete: 9 cuartetos, la cereza y el pitillo de dos tubitos.
assert.equal(armadas.get(917)!.globos.length, 37, "#917: 9 cuartetos y la cereza");
assert.equal(ids(917, "pitillo-").length, 2, "#917: pitillo de dos T-260");
// Sorpresa neón: 6 niveles, 3 vueltas y 3 cintas verticales, 2 moños, 3 de helio impresos.
assert.equal(armadas.get(919)!.globos.filter((g) => !g.estampado?.impreso).length, 24, "#919: 6 cuartetos");
assert.equal(ids(919, "vuelta-").length + ids(919, "cinta-").length + ids(919, "mono-").length, 8, "#919: 3 vueltas, 3 cintas y 2 moños");
assert.equal(impresos(919), 3, "#919: 3 de helio impresos");
// Tazmania: 6 cuartetos R-12 y el remate de 4 R-5.
assert.equal(armadas.get(925)!.globos.filter((g) => g.formatoId === "R-12").length, 24, "#925: 6 cuartetos R-12");
// Telaraña: 36 R-12 (12 de cada color), 2 R-18, 4 tríos, la araña con su Metalink y el mantel.
assert.deepEqual(porCodigo(928, "aro"), { "R-12|880": 12, "R-12|062": 12, "R-12|073": 12 }, "#928: 36 R-12, 12 de cada color");
assert.equal(ids(928, "trio-").length, 4, "#928: 4 tríos de R-5 dorado");
assert.equal(impresos(928), 1, "#928: el cuerpo Metalink de la araña");
// Alturas (lo más alto con globos, tubitos o foil, cm; la caja de un globo es su esfera desde el nudo).
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.id !== "amarre" && x.id !== "cintas").map((x) => x.caja.max.y));
for (const [n, min, max] of [[774, 190, 215], [778, 245, 270], [786, 92, 106], [787, 165, 178], [802, 88, 100], [856, 228, 245], [883, 96, 108], [887, 158, 175], [902, 265, 285], [903, 245, 265], [905, 210, 230], [917, 182, 196], [919, 235, 252], [925, 192, 206], [928, 200, 220]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: huecos, cruces, cuartetos y niveles, impresos, tríos, collar, flores, rizos y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_22) {
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
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-22.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-22.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-22.json");
  for (const i of LOTE_22) {
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

console.log("OK test-ideas-lote-22");
