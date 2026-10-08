/**
 * Lote 25 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-25.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-25.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); la nota dice qué quedó igual y qué no;
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se
 *   fabrica en su formato, inflado dentro de lo que da ese formato;
 * - montaje: cada estructura es su propio árbol: la raíz suelta, su amarre escondido (`oculto`) colgado de ella donde se
 *   pidió, y todo lo suyo colgado del amarre (o de las anclas de la raíz); `extraerConjunto` de cada raíz trae todos
 *   sus miembros y arma solo exactamente lo de su rama (materiales y cada globo en su sitio); en la rama solo va
 *   escenografía de papel, foil o madera (cintas, palitos, palos escondidos); lo suelto es escenografía (el pedestal
 *   con su vaso, la base de césped);
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos y
 *   metalizados de la tienda, con su cantidad; lo publicado, con su nombre, url y código;
 * - lo contado en las fotos (cuartetos y niveles, globos de helio, burbujas de dentro, espirales, flores, ventanas, rasgos
 *   de las figuras…) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, da un conjunto o estructura por raíz.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_25 } from "../../src/lib/globos3d/ideas-sempertex/lote-25";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada, type NodoEscena } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorId, impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorId, metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import { GLOBOS_TIENDA } from "../../src/lib/globos3d/productos-tienda";
import { armarBurbuja } from "../../src/lib/globos3d/burbujas";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [272, 275, 276, 278, 287, 289, 291, 296, 304, 310, 311, 323, 327, 343, 345];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_25.map((i) => i.numero), NUMEROS, "los 15 números del lote 25, en orden");
assert.equal(new Set(LOTE_25.map((i) => i.id)).size, NUMEROS.length, "ids sin repetir");
for (const i of LOTE_25) {
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
  const c = LOTE_25.find((x) => x.numero === n)!.contenido;
  if (c.tipo !== "escena") throw new Error(`#${n} es una escena`);
  return c.escena;
};
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_25) {
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
for (const i of LOTE_25) {
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
    assert.ok(clasePieza(raiz.pieza) === "estructura" && raiz.pieza.tipo !== "metalizado", `${que}: «${raiz.id}» es una estructura de globos`);
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
  // Toda pieza está en una rama o es escenografía o utilería suelta; ninguna en dos ramas.
  const vistos = lista.flatMap((r) => r.ids);
  assert.equal(new Set(vistos).size, vistos.length, `${que}: ninguna pieza en dos ramas`);
  for (const n of escena.nodos.filter((x) => !vistos.includes(x.id))) {
    assert.ok(n.colocacion.en === "libre" && ["escenografia", "utileria"].includes(clasePieza(n.pieza)), `${que}: «${n.id}» suelto es escenografía o utilería`);
  }
  const ADORNO = new Set(["papel", "foil", "foil_mate", "madera"]);
  for (const r of lista) for (const id of r.ids.filter((x) => x !== r.raiz && x !== `${r.raiz}-amarre`)) {
    const p = porId.get(id)!.pieza;
    assert.ok(p.tipo !== "escenografia" || (!p.utileria && p.elementos.every((e) => ADORNO.has(e.acabado))), `${que} ${r.raiz}: «${id}» no es mesa ni utilería (solo papel, foil o el palito)`);
  }
  ramas.set(i.numero, lista);
}
assert.deepEqual(ramas.get(323)!.map((r) => r.raiz), ["edificio-izquierdo", "edificio-derecho", "contorno"], "#323: los dos edificios y el contorno blanco");
for (const n of NUMEROS.filter((x) => x !== 323)) assert.equal(ramas.get(n)!.length, 1, `#${n}: una estructura`);
console.log(`OK montaje: ${extraidas} estructuras raíz con su amarre escondido se extraen con lo suyo (${enSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_25) {
  const que = `${i.numero} ${i.slug}`;
  const a = armadas.get(i.numero)!;
  const escena = escenaDe(i.numero);
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(a.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  const metalizados = new Map<string, number>();
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    // El Corazón 6 Fashion Fucsia (Celebra) no tiene página en la tienda: va con su búsqueda, como en los lotes 16 y 18.
    assert.ok(p.url.startsWith("/products/") || (p.url.startsWith("/search?q=") && p.formato !== null && !GLOBOS_TIENDA.some((x) => x.tipo === formatoPorId(p.formato!)?.tipo && x.codigo === p.codigo)), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
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
const porNumero = (n: number) => LOTE_25.find((i) => i.numero === n)!;
const cantidadDe = (n: number, url: string) => porNumero(n).productos.filter((p) => p.url === url && p.cantidad !== null).reduce((s, p) => s + p.cantidad!, 0);
const urlImpreso = (id: string) => impresoPorId(id)!.url;
for (const id of ["corazon-te-amo-rosado", "corazones-plata", "corazon-lavanda"]) assert.equal(cantidadDe(272, metalizadoPorId(id)!.url), 1, `#272: el metalizado ${id}`);
assert.equal(cantidadDe(275, urlImpreso("infinity-corazones-brillantes-fashion-metal-surtido")), 1, "#275: el Corazones Brillantes publicado");
assert.equal(cantidadDe(275, "/products/globo-para-fiesta-latex-corazon-fashion-rojo"), 7, "#275: 4 corazones rojos del cuarteto y 3 dentro de la burbuja");
assert.equal(cantidadDe(276, urlImpreso("infinity-feliz-dia-corazones-brillantes-metal-surtido")), 2, "#276: los 2 Feliz Día publicados");
assert.equal(cantidadDe(287, urlImpreso("infinity-feliz-dia-corazones-brillantes-metal-surtido")), 1, "#287: el Feliz Día dentro de la burbuja");
assert.equal(cantidadDe(289, urlImpreso("2-caras-happy-halloween-fashion-surtido-negro-naranja")), 1, "#289: el naranja «Happy Halloween»");
assert.equal(cantidadDe(296, urlImpreso("infinity-graffiti-invierno-fashion-transparente")), 1, "#296: la burbuja de remolinos blancos");
assert.ok(porNumero(296).productos.some((p) => p.url === "/products/globo-para-fiesta-latex-redondo-fashion-transparente" && p.cantidad === null), "#296: el cristal liso publicado, sin cantidad");
assert.equal(cantidadDe(304, urlImpreso("infinity-polka-blanco-fashion-verde-lima")), 1, "#304: el huevo Polka publicado");
assert.ok(porNumero(304).productos.filter((p) => p.url.endsWith("tubito-fashion-amarillo") || p.url.endsWith("redondo-fashion-surtido")).every((p) => p.cantidad === null), "#304: el T-260 amarillo y el surtido, sin cantidad");
assert.equal(cantidadDe(310, urlImpreso("infinity-i-love-you-moderno-fashion-rojo")), 1, "#310: el «Te amo»");
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
const propiedades = (n: number, id: string) => {
  const p = escenaDe(n).nodos.find((x) => x.id === id)!.pieza;
  if (p.tipo !== "decoracion") throw new Error(`#${n} «${id}» no es una decoración`);
  return p.decoracion;
};
const burbujaDe = (n: number, id: string) => { const d = propiedades(n, id); if (d.tipo !== "burbuja") throw new Error(`#${n} «${id}» no es una burbuja`); return armarBurbuja(d.propiedades); };
assert.deepEqual(mat(272, "base"), ["R-5|981|4"], "#272: cuarteto R-5 plata");
assert.deepEqual(mat(272, "fucsia"), ["R-5|012|4"], "#272: cuarteto R-5 fucsia");
assert.ok((() => { const d = propiedades(272, "perlas"); return d.tipo === "rizo" && d.propiedades.forma === "burbujas" && d.propiedades.cantidad === 26; })(), "#272: aro de 26 burbujitas");
assert.equal(escenaDe(272).nodos.filter((x) => x.pieza.tipo === "metalizado").length, 3, "#272: 3 metalizados («Te Amo» y los dos corazones de helio)");
assert.equal(conPrefijo(272, "helio-").length, 3, "#272: ramo de 3");
assert.deepEqual(mat(275, "base"), ["C-12|009|4"], "#275: cuarteto de corazones rosados");
assert.deepEqual(mat(275, "corazones-rojos"), ["C-12|015|4"], "#275: cuarteto de corazones rojos");
assert.equal(burbujaDe(275, "burbuja").colocados, 9, "#275: los 9 de dentro caben");
assert.deepEqual(mat(276, "base"), ["R-12|806|12"], "#276: 3 cuartetos nácar");
assert.equal(conPrefijo(276, "dorado-").length, 2, "#276: 2 cuartetos dorados");
assert.equal(conPrefijo(276, "espiral-").length, 3, "#276: 3 espirales");
assert.equal(conPrefijo(276, "flor-").length, 2, "#276: 2 flores");
assert.deepEqual(mat(278, "racimo"), ["R-5|031|4"], "#278: cuarteto verde");
assert.deepEqual(mat(278, "naranja"), ["R-5|061|4"], "#278: cuarteto naranja");
assert.equal(conPrefijo(278, "petalo-").length, 4, "#278: flor de 4 pétalos");
assert.equal(burbujaDe(278, "burbuja").colocados, 1, "#278: el «40» dentro de la burbuja");
assert.equal(burbujaDe(287, "burbuja").colocados, 1, "#287: el «Feliz Día» dentro de la burbuja");
assert.equal(conPrefijo(287, "flor-").length, 3, "#287: 3 flores");
assert.ok(nodo(287, "base").globos.length >= 10 && nodo(287, "base").globos.every((g) => g.codigo === "009"), "#287: base orgánica rosada");
assert.deepEqual(mat(289, "pies"), ["R-5|029|4"], "#289: pies de cuarteto");
assert.equal(conPrefijo(289, "cabeza-").length, 11, "#289: cabeza de 8 R-5 por delante y 3 detrás");
assert.equal(conPrefijo(289, "pelo-").length, 4, "#289: 3 R-5 negros y los picos de pelo");
assert.equal(conPrefijo(289, "ojo-").length, 2, "#289: 2 ojos");
assert.equal(conPrefijo(289, "tornillo-").length, 2, "#289: 2 tornillos");
assert.equal(conPrefijo(289, "helio-").length, 2, "#289: ramo de 2");
assert.deepEqual(mat(291, "base"), ["R-9|031|2", "R-9|051|2"], "#291: cuarteto verde y violeta");
assert.equal(conPrefijo(291, "ojo-").length, 3, "#291: 3 ojos");
assert.equal(conPrefijo(291, "espiral-").length, 2, "#291: 2 espirales naranja");
assert.deepEqual(mat(296, "flor"), ["R-12|915|5", "R-5|970|3"], "#296: nochebuena de 5 pétalos con centro de 3");
assert.equal(conPrefijo(296, "ramita-").length, 2, "#296: 2 ramitas");
assert.deepEqual(mat(296, "dorado"), ["R-9|970|4"], "#296: cuarteto R-9 dorado");
assert.deepEqual(mat(296, "rojo"), ["R-5|915|4"], "#296: cuarteto R-5 rojo");
assert.equal(nodo(304, "base").globos.length + nodo(304, "base-arriba").globos.length, 8, "#304: dos cuartetos de colores");
assert.equal(nodo(304, "pollito").globos.length, 5, "#304: pollito de cuerpo, cabeza, 2 ojos y pico");
assert.deepEqual(mat(310, "base"), ["R-5|051|12"], "#310: 3 cuartetos violeta");
assert.equal(conPrefijo(310, "flor-").length, 2, "#310: 2 flores");
assert.deepEqual(mat(311, "base"), ["R-9|005|4"], "#311: cuarteto blanco");
assert.equal(conPrefijo(311, "flor-").length, 5, "#311: corona de 5 florecitas");
assert.equal(conPrefijo(311, "helio-").length, 5, "#311: ramo de 5");
assert.equal(nodo(323, "edificio-izquierdo").globos.filter((g) => g.codigo === "020").length, 21, "#323: 3 × 7 ventanas amarillas");
assert.equal(nodo(323, "edificio-derecho").globos.filter((g) => g.codigo === "038").length, 15, "#323: 2 × 7 ventanas turquesa y una arriba");
assert.equal(conPrefijo(323, "antena-").length, 5, "#323: antena de 5");
assert.equal(conPrefijo(327, "aleta-").length, 2, "#327: 2 aletas");
assert.ok(nodo(327, "cola").globos.filter((g) => g.formatoId === "R-5").every((g) => g.codigo === "981"), "#327: los R-5 son los plateados");
assert.deepEqual(new Set(nodo(327, "cola").globos.filter((g) => g.formatoId !== "R-5").map((g) => g.codigo)), new Set(["951", "150", "050", "037"]), "#327: los 4 colores grandes");
assert.deepEqual(mat(343, "columna"), ["R-5|040|24"], "#343: 6 cuartetos R-5");
assert.deepEqual(mat(343, "base"), ["R-9|040|4"], "#343: cuarteto R-9 de la base");
assert.deepEqual(mat(345, "base"), ["R-12|029|4"], "#345: cuarteto verde de la base");
assert.equal(conPrefijo(345, "azul-").length, 4, "#345: 4 cuartetos azul rey");
// Alturas (lo más alto de lo que tiene globos, tubitos o foil), medidas en la foto.
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.some((t) => !t.papel) || x.solidos.some((s) => s.acabado === "foil" || s.acabado === "foil_mate")).map((x) => x.caja.max.y));
for (const [n, min, max] of [[272, 220, 240], [275, 75, 92], [276, 115, 135], [278, 100, 115], [287, 85, 100], [289, 140, 155], [291, 140, 158], [296, 115, 130], [304, 92, 108], [310, 90, 110], [311, 158, 172], [323, 240, 258], [327, 205, 220], [343, 145, 170], [345, 125, 140]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: cuartetos, niveles, ramos de helio, burbujas, espirales, flores, ventanas, figuras y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_25) {
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
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-25.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-25.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-25.json");
  for (const i of LOTE_25) {
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

console.log("OK test-ideas-lote-25");
