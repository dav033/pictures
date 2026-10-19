/**
 * Lote 26 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-26.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-26.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus
 *   etiquetas (`ocasionesDeEtiquetas`) y la foto de su fuente (`fuenteIdea`); la nota dice qué quedó igual y qué no;
 * - cada escena arma sin avisos, nada bajo el piso ni fuera de la sala, y cada globo y tubito usa un color que se
 *   fabrica en su formato, inflado dentro de lo que da ese formato;
 * - montaje: cada estructura es su propio árbol: la raíz suelta, su amarre escondido (`oculto`) colgado de ella donde se
 *   pidió, y todo lo suyo colgado del amarre (o de las anclas de la raíz); `extraerConjunto` de cada raíz trae todos
 *   sus miembros y arma solo exactamente lo de su rama (materiales y cada globo en su sitio); en la rama solo va
 *   escenografía de papel, foil o el palito de madera (cintas, sombrero, abanicos, metalizados genéricos); lo suelto es
 *   escenografía o utilería (mesas, tortas, platos, papel de seda);
 * - los códigos del 3D (formato + código) son los de sus productos y al revés, con la misma cantidad; los impresos y
 *   metalizados de la tienda, con su cantidad; lo publicado, con su nombre, url y código;
 * - lo contado en las fotos (niveles, globos de helio, calabacitas y resortes, globos de la vaca, letras, pétalos, corazones,
 *   rizos, adornos de tubito, flores…) y las alturas;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, da un conjunto o estructura por raíz.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_26 } from "../../src/lib/globos3d/ideas-sempertex/lote-26";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada, type NodoEscena } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { impresoPorId, impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [347, 371, 379, 384, 386, 387, 388, 391, 395, 398, 412, 416, 430, 431, 433];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_26.map((i) => i.numero), NUMEROS, "los 15 números del lote 26, en orden");
assert.equal(new Set(LOTE_26.map((i) => i.id)).size, NUMEROS.length, "ids sin repetir");
for (const i of LOTE_26) {
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
  const c = LOTE_26.find((x) => x.numero === n)!.contenido;
  if (c.tipo !== "escena") throw new Error(`#${n} es una escena`);
  return c.escena;
};
const armadas = new Map<number, EscenaArmada>();
let globosTotales = 0, tubitosTotales = 0;
for (const i of LOTE_26) {
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
for (const i of LOTE_26) {
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
for (const n of NUMEROS) assert.equal(ramas.get(n)!.length, 1, `#${n}: una estructura`);
assert.deepEqual(NUMEROS.map((n) => ramas.get(n)![0]!.raiz), ["espiral-abajo", "columna", "base", "lila", "columna", "base", "cuerpo", "columna", "base", "base", "espiral", "cenefa", "base", "corazon", "base"], "las raíces");
console.log(`OK montaje: ${extraidas} estructuras raíz con su amarre escondido se extraen con lo suyo (${enSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
let lineas = 0;
for (const i of LOTE_26) {
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
const nodo = (n: number, id: string) => {
  const x = armadas.get(n)!.porNodo.find((k) => k.id === id);
  assert.ok(x, `#${n}: «${id}» está`);
  return x!;
};
const porNumero = (n: number) => LOTE_26.find((i) => i.numero === n)!;
const cantidadDe = (n: number, url: string) => porNumero(n).productos.filter((p) => p.url === url && p.cantidad !== null).reduce((s, p) => s + p.cantidad!, 0);
const impreso = (id: string) => impresoPorId(id)!.url;
assert.equal(cantidadDe(371, impreso("infinity-happy-birthday-diamante-escarchado-dorado-fashion-negro")), 2, "#371: 2 «Happy Birthday Diamante» publicados");
assert.equal(cantidadDe(371, impreso("infinity-diamantes-cobre-fashion-blanco")), 2, "#371: 2 «Diamantes Cobre» publicados");
assert.ok(cantidadDe(371, impreso("infinity-metalink-plata-graffiti-fashion-negro")) >= 2, "#371: el Metalink Plata Graffiti publicado");
assert.equal(cantidadDe(371, "/products/globo-metalizado-numero-4-plata"), 1, "#371: el número 4 plata de la tienda");
assert.equal(cantidadDe(379, impreso("infinity-polka-blanco-fashion-rojo")), 2, "#379: el nivel rojo con el Polka Blanco");
assert.equal(cantidadDe(384, impreso("infinity-corazones-modernos-fashion-surtido")), 8, "#384: el fucsia y el rosado con Corazones Modernos");
for (const n of [386, 391]) assert.equal(cantidadDe(n, impreso("infinity-polka-blanco-fashion-rojo")), 11, `#${n}: 7 de la columna, 3 mariquitas y 1 de helio con Polka Blanco`);
assert.equal(cantidadDe(387, impreso("corazon-2-caras-love-fashion-rojo")), 5, "#387: 5 corazones «LOVE»");
assert.ok(porNumero(388).productos.filter((p) => p.url.includes("surtido-tropical") || p.url.endsWith("tubito-fashion-amarillo")).every((p) => p.cantidad === null), "#388: el surtido tropical y el T-260 amarillo publicados, sin cantidad");
assert.ok(cantidadDe(430, impreso("infinity-metalink-plata-graffiti-fashion-negro")) >= 10 && cantidadDe(430, impreso("infinity-graffiti-invierno-fashion-rojo")) >= 1, "#430: los dos impresos publicados");
assert.equal(cantidadDe(430, "/products/globo-para-fiesta-latex-tubito-reflex-plata"), 5, "#430: 5 rizos de T-260 Reflex Plata (publicado)");
assert.equal(cantidadDe(431, impreso("infinity-graffiti-invierno-fashion-rojo")), 5, "#431: 5 Graffiti Invierno publicados");
assert.equal(cantidadDe(431, "/products/globo-para-fiesta-latex-tubito-reflex-plata"), 6, "#431: 6 adornos de T-260 Reflex Plata");
assert.equal(cantidadDe(433, "/products/globo-para-fiesta-latex-redondo-fashion-rosado"), nodo(433, "corazon-grande").globos.length + nodo(433, "corazon-chico").globos.length, "#433: los corazones de R-5 Fashion Rosado (publicado)");
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D (impresos y metalizados de la tienda con su cantidad)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const conPrefijo = (n: number, prefijo: string) => escenaDe(n).nodos.filter((x) => x.id.startsWith(prefijo));
const mat = (n: number, id: string) => ordenar(nodo(n, id).materiales);
assert.deepEqual(mat(347, "espiral-abajo"), ["R-9|031|8", "R-9|051|8"], "#347: espiral de 4 cuartetos verde y morado (abajo)");
assert.deepEqual(mat(347, "espiral-arriba"), ["R-9|031|8", "R-9|051|8"], "#347: espiral de 4 cuartetos (arriba)");
for (const p of ["base-", "naranja-lunares-", "negro-lunares-"]) assert.equal(conPrefijo(347, p).length, 4, `#347: cuarteto de lunares «${p}»`);
assert.deepEqual(mat(347, "naranja-r18"), ["R-18|061|1"], "#347: el R-18 naranja");
assert.equal(conPrefijo(347, "calabaza-").length, 5, "#347: 5 calabacitas");
assert.equal(conPrefijo(347, "resorte-").length, 5, "#347: 5 resortes");
assert.deepEqual(mat(371, "base"), ["R-12|080|4"], "#371: base de cuarteto negro");
assert.equal(conPrefijo(371, "helio-").length, 6, "#371: ramo de 6");
assert.equal(conPrefijo(371, "rizo-").length, 4, "#371: 4 rizos blancos");
assert.equal(conPrefijo(371, "numero-").length, 2, "#371: el 4 y el 0");
assert.deepEqual(mat(379, "base"), ["R-18|031|4"], "#379: base de cuarteto R-18");
assert.equal(escenaDe(379).nodos.filter((x) => x.id.startsWith("vaca-") && nodo(379, x.id).globos.some((g) => g.formatoId === "R-12" && g.codigo === "005")).length, 9, "#379: la vaca de 9 R-12");
assert.equal(["amarillo", "rojo", "azul", "naranja"].flatMap((c) => conPrefijo(379, `${c}-`)).length, 16, "#379: 4 niveles de 2 R-12 y 2 R-9");
assert.equal(conPrefijo(379, "verde-").length, 3, "#379: 3 cuartetos verdes entre niveles");
assert.equal(conPrefijo(379, "flor-").length, 3, "#379: 3 flores");
assert.deepEqual(mat(384, "lila"), ["R-12|050|4"], "#384: base lila");
for (const id of ["fucsia", "rosado"]) assert.equal(nodo(384, id).globos.filter((g) => g.estampado?.impreso).length, 4, `#384: cuarteto ${id} impreso`);
assert.equal(conPrefijo(384, "cuerpo-").length, 4, "#384: cuerpo de 4 T-260");
for (const n of [386, 391]) {
  assert.deepEqual(mat(n, "columna"), ["R-12|005|14", "R-12|015|7", "R-12|080|7"], `#${n}: espiral de 7 cuartetos`);
  assert.equal(conPrefijo(n, "helio-").length, 4, `#${n}: ramo de 4`);
  assert.equal(escenaDe(n).nodos.filter((x) => /^mariquita-\d-(cuerpo|cara)$/.test(x.id)).length, 3, `#${n}: 3 mariquitas`);
}
assert.deepEqual(mat(387, "base"), ["R-9|015|4"], "#387: base de cuarteto rojo");
assert.equal(conPrefijo(387, "corazon-").length, 5, "#387: 5 corazones");
assert.equal(conPrefijo(387, "letra-").length, 5, "#387: L, O, V y E (con su palo del medio)");
assert.deepEqual(mat(387, "flor"), ["R-5|005|6", "R-5|015|1"], "#387: flor de 6 pétalos con centro");
assert.deepEqual(mat(388, "cuerpo"), ["R-12|012|6", "R-12|020|6", "R-12|031|6", "R-12|061|6"], "#388: 6 cuartetos en espiral");
assert.deepEqual(mat(388, "cabeza"), ["R-24|240|1"], "#388: cabeza R-24 neón azul");
assert.equal(conPrefijo(388, "oreja-").length + conPrefijo(388, "ojo-").length + conPrefijo(388, "labio-").length, 6, "#388: 2 orejas, 2 ojos y 2 labios");
assert.deepEqual(mat(395, "base"), ["R-12|080|4"], "#395: base de cuarteto negro");
assert.equal(conPrefijo(395, "punta-").length, 4, "#395: 4 R-5 en las puntas");
assert.equal(escenaDe(395).nodos.filter((x) => /^torre-\w+-negro$/.test(x.id)).length, 2, "#395: 2 torres de helio");
assert.ok(nodo(395, "momia").solidos.length >= 10 && nodo(395, "momia").solidos.every((s) => s.acabado === "foil"), "#395: la momia de foil");
assert.deepEqual(mat(398, "base"), ["R-12|015|4"], "#398: base de cuarteto rojo");
assert.ok(nodo(398, "fuste").tubos.length > 0 && nodo(398, "fuste").tubos.every((t) => t.formatoId === "LOL-660"), "#398: fuste de 660");
assert.equal(conPrefijo(398, "boton-").length, 3, "#398: 3 botones");
assert.ok(nodo(398, "muneco").globos.some((g) => g.formatoId === "LOL-12") && nodo(398, "muneco").globos.some((g) => g.formatoId === "R-12"), "#398: muñeco de LOL-12 y R-12");
assert.equal(conPrefijo(412, "espiral").reduce((s, x) => s + nodo(412, x.id).globos.length, 0), 28, "#412: espiral de 7 cuartetos");
assert.equal(conPrefijo(412, "flor-").length, 5, "#412: corona de 5 florecitas");
assert.deepEqual(mat(412, "cabeza"), ["R-18|005|1"], "#412: cabeza R-18");
assert.equal(nodo(416, "cenefa").globos.length, 96, "#416: cenefa de 3 × 32");
assert.equal(nodo(416, "cenefa-derecha").globos.length, 24, "#416: vuelta de 3 × 8");
assert.equal(conPrefijo(430, "helio-").length, 6, "#430: ramo de 6");
assert.equal(conPrefijo(430, "rizo-").length, 5, "#430: 5 rizos");
assert.ok(nodo(430, "corazon").globos.length >= 50 && nodo(430, "corazon").globos.every((g) => g.formatoId === "R-5" && g.codigo === "981"), "#430: corazón de R-5 plata");
assert.equal(conPrefijo(431, "veteado-").length, 5, "#431: 5 veteados");
assert.equal(conPrefijo(431, "adorno-").length, 6, "#431: 6 adornos de T-260");
assert.equal(escenaDe(431).nodos.filter((x) => /^corazon-(rojo|cristal|rosado)/.test(x.id)).length, 4, "#431: 4 corazones C-12");
assert.deepEqual(mat(433, "base"), ["R-12|010|4"], "#433: base palo de rosa");
assert.equal(conPrefijo(433, "oro-").length, 22, "#433: 6 racimitos dorados (22 R-5)");
assert.ok(nodo(433, "corazon-grande").globos.length > nodo(433, "corazon-chico").globos.length, "#433: dos corazones tejidos");
// Alturas (lo más alto de lo que tiene globos, tubitos o foil), medidas en la foto.
const alto = (n: number) => Math.max(...armadas.get(n)!.porNodo.filter((x) => x.globos.length || x.tubos.some((t) => !t.papel) || x.solidos.some((s) => s.acabado === "foil" || s.acabado === "foil_mate")).map((x) => x.caja.max.y));
for (const [n, min, max] of [[347, 230, 255], [371, 245, 270], [379, 235, 260], [384, 180, 200], [386, 240, 260], [387, 115, 135], [388, 180, 200], [391, 240, 260], [395, 255, 280], [398, 220, 240], [412, 245, 265], [416, 300, 320], [430, 255, 285], [431, 128, 148], [433, 218, 238]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: niveles, ramos de helio, calabacitas, resortes, la vaca, letras, corazones, rizos, adornos, flores y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_26) {
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
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-26.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-26.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-26.json");
  for (const i of LOTE_26) {
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

console.log("OK test-ideas-lote-26");
