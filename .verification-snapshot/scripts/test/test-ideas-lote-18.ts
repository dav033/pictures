/**
 * Lote 18 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-18.ts`): columnas,
 * colgantes y el cohete. Sin coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-18.json`), con id «idea:<slug>», en orden y sin repetir; su foto y sus ocasiones
 *   son las de la fuente (`fuenteIdea`, `ocasionesDeEtiquetas`); la nota dice qué quedó igual y qué no;
 * - cada idea arma (escena sin avisos, todo puesto, nada bajo el piso ni fuera de la sala) y cada globo y tubito usa un
 *   color que se fabrica en su formato, inflado dentro de lo que da ese formato (los tubos de Link-O-Loon 660 también);
 * - montaje: cada estructura es su propio árbol; las raíces son estructuras de globos o armazones (escenografía: el
 *   peso de un ramo, una base, una maceta) con globos colgados, y nada cuelga de una pieza que no esté.
 *   `extraerConjunto` de cada raíz se lleva su rama entera: sus materiales son exactamente los de la rama y, sola, arma
 *   lo mismo (cada globo en su sitio); todo el látex de la escena es de alguna rama;
 * - productos: por formato y código cuadran exactos con los materiales del 3D (todo es contado en la foto); los impresos
 *   y los metalizados de la tienda cuadran con los que lista la escena armada; lo publicado sale tal cual (nombre y url)
 *   (los tubitos y el R-12 blanco del cohete);
 * - lo contado en las fotos: cuartetos por nivel y niveles con sus colores vistos de frente, alturas de cada nivel (las
 *   medidas, no el paso del taller), racimos, rizos, corazones, tréboles, popós, metalizados y el alto total;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, da al menos un item por cada raíz (un
 *   conjunto si lleva decoraciones), con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan números, slugs, fotos y productos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_18 } from "../../src/lib/globos3d/ideas-sempertex/lote-18";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { metalizadoPorUrl } from "../../src/lib/globos3d/metalizados";
import { GLOBOS_TIENDA } from "../../src/lib/globos3d/productos-tienda";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [326, 329, 330, 334, 335, 338, 341, 342, 344, 353, 354, 356, 363, 367, 374];
const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
const idDe = (n: number) => LOTE_18.find((i) => i.numero === n)!.id;

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_18.map((i) => i.numero), NUMEROS, "los 15 números del lote 16, en orden");
assert.equal(new Set(LOTE_18.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_18) {
  const que = `${i.numero} ${i.slug}`;
  assert.equal(i.id, `idea:${i.slug}`, `${que}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 200, `${que}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${que}: la nota dice qué quedó igual y qué no`);
  const fuente = fuenteIdea(i.slug);
  assert.ok(fuente, `${que}: está en las fuentes`);
  assert.equal(fuente!.numero, i.numero, `${que}: número de la fuente`);
  assert.deepEqual(i.ocasiones, ocasionesDeEtiquetas(fuente!.etiquetas), `${que}: ocasiones de sus etiquetas (${fuente!.etiquetas.join(", ")})`);
  assert.ok(i.ocasiones.every((o) => OCASIONES.includes(o)), `${que}: ocasiones de la lista`);
  assert.equal(i.fotoUrl, fuente!.fotoUrl, `${que}: la foto de la fuente`);
  const foto = new URL(i.fotoUrl);
  assert.ok(foto.protocol === "https:" && foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${que}: foto https del CDN de Sempertex`);
  assert.equal(i.contenido.tipo, "escena", `${que}: es una escena`);
}
console.log("OK lote: 15 ideas con id, nombre, nota, foto y ocasiones de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<string, EscenaArmada>();
const escenas = new Map<string, Escena>();
let globosTotales = 0, tubosTotales = 0;
for (const i of LOTE_18) {
  const que = `${i.numero} ${i.slug}`;
  if (i.contenido.tipo !== "escena") continue;
  const escena = i.contenido.escena;
  const armada = armarEscena(escena);
  escenas.set(i.id, escena);
  armadas.set(i.id, armada);
  assert.deepEqual(armada.avisos, [], `${que}: arma sin avisos`);
  assert.ok(armada.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), `${que}: cada pieza quedó puesta`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  assert.equal(new Set(escena.nodos.map((n) => n.id)).size, escena.nodos.length, `${que}: ids de nodo sin repetir`);
  const sala = armada.sala;
  for (const n of armada.porNodo) {
    assert.ok(n.caja.min.y >= -1, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo (${n.caja.max.y.toFixed(1)})`);
    assert.ok(Math.max(Math.abs(n.caja.min.x), Math.abs(n.caja.max.x)) <= sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(Math.max(Math.abs(n.caja.min.z), Math.abs(n.caja.max.z)) <= sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo`);
  }
  assert.ok(armada.globos.length > 0, `${que}: tiene globos`);
  globosTotales += armada.globos.length;
  for (const g of armada.globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f, `${que}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${que}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(Math.abs(infladoValido(f!, g.infladoCm) - g.infladoCm) < 0.01, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm cabe en su formato`);
  }
  for (const t of armada.tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    assert.ok(f && (f.tipo === "tubito" || (f.tipo === "link" && f.largoCm)), `${que}: tubo de ${t.formatoId} (tubito o Link-O-Loon 660)`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
    tubosTotales++;
  }
}
console.log(`OK armado: 15 escenas sin avisos y dentro de su sala, ${globosTotales} globos y ${tubosTotales} tramos de tubo en colores que se fabrican`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: cada estructura su árbol; su conjunto se lleva exactamente su rama
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
const conLatex = (armada: EscenaArmada, id: string) => { const n = armada.porNodo.find((x) => x.id === id); return (n?.globos.length ?? 0) + (n?.tubos.filter((t) => !t.papel).length ?? 0) > 0; };
/** Las raíces: estructuras de globos sueltas, y armazones (escenografía suelta) con látex colgado. */
function raices(escena: Escena, armada: EscenaArmada): string[] {
  return escena.nodos.filter((n) => n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre"
    && (clasePieza(n.pieza) === "estructura" || (n.pieza.tipo === "escenografia" && miembrosDeConjunto(escena, n.id, armada).some((m) => conLatex(armada, m))))).map((n) => n.id);
}
const raicesDe = new Map<string, string[]>();
let ramas = 0, globosEnSuSitio = 0;
for (const i of LOTE_18) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenas.get(i.id)!, armada = armadas.get(i.id)!;
  const ids = new Set(escena.nodos.map((n) => n.id));
  for (const n of escena.nodos) if (n.colocacion.en === "sobre" || n.colocacion.en === "ancla") assert.ok(ids.has(n.colocacion.padreId) && n.colocacion.padreId !== n.id, `${que}: «${n.nombre}» cuelga de una pieza que está`);
  const lista = raices(escena, armada);
  raicesDe.set(i.id, lista);
  assert.ok(lista.length >= 1, `${que}: tiene al menos una estructura raíz`);
  const dueno = new Map<string, string>();
  for (const id of lista) {
    const rama = miembrosDeConjunto(escena, id, armada);
    for (const m of rama) {
      assert.ok(!dueno.has(m) || dueno.get(m) === id, `${que}: «${m}» es de dos ramas (${dueno.get(m)} y ${id})`);
      dueno.set(m, id);
    }
    const conjunto = extraerConjunto(escena, id, { armada });
    assert.ok(conjunto, `${que} / ${id}: sale el conjunto`);
    assert.equal(conjunto!.hijos.length, rama.length - 1, `${que} / ${id}: entran todos sus miembros`);
    const deLaRama = armada.porNodo.filter((n) => rama.includes(n.id));
    const materiales = ordenar(sumarMateriales(...deLaRama.map((n) => n.materiales)));
    const sola = armarEscena(escenaDeConjunto(conjunto!, { sala: escena.sala, donde: conjunto!.sugerida }));
    assert.deepEqual(sola.avisos, [], `${que} / ${id}: sola arma sin avisos`);
    assert.deepEqual(ordenar(sola.materiales), materiales, `${que} / ${id}: sus materiales son exactamente los de su rama`);
    const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(1)}|${g.nudo.y.toFixed(1)}|${g.nudo.z.toFixed(1)}`.replace(/-0\.0(?!\d)/g, "0.0");
    assert.deepEqual(sola.globos.map(firma).sort(), deLaRama.flatMap((n) => n.globos).map(firma).sort(), `${que} / ${id}: sola, cada globo en su sitio`);
    globosEnSuSitio += sola.globos.length;
    ramas++;
  }
  for (const n of armada.porNodo) if (n.globos.length || n.tubos.some((t) => !t.papel)) assert.ok(dueno.has(n.id), `${que}: «${n.nombre}» es de una estructura`);
}
const hijosDe = (n: number, raiz: string) => miembrosDeConjunto(escenas.get(idDe(n))!, raiz, armadas.get(idDe(n))!).slice(1);
assert.deepEqual(raicesDe.get(idDe(326)), ["armazon"], "#326: el armazón del cohete lleva el cohete y la nube");
assert.ok(["nube", "aletas", "espiral-tobera", "cuerpo-centro", "llama-1"].every((x) => hijosDe(326, "armazon").includes(x)), "#326: nube, aletas, espiral, cuerpo y llamas cuelgan del armazón");
for (const n of [329, 330, 356]) assert.deepEqual(raicesDe.get(idDe(n)), ["cordon"], `#${n}: el colgante cuelga entero de su cordón del techo`);
for (const n of [334, 335, 338, 341, 342, 353, 354, 363, 367, 374]) {
  const raiz = raicesDe.get(idDe(n))!;
  assert.equal(raiz.length, 1, `#${n}: una sola raíz (${raiz.join(", ")})`);
  assert.ok(hijosDe(n, raiz[0]!).includes("varilla"), `#${n}: la base de cuartetos es la raíz y lleva su varilla`);
  assert.equal(hijosDe(n, raiz[0]!).length, escenas.get(idDe(n))!.nodos.length - 1, `#${n}: todo cuelga de la base`);
}
assert.deepEqual(raicesDe.get(idDe(344)), ["azul-1", "ramo"], "#344: la columna y el ramo de helio, cada uno su árbol");
console.log(`OK montaje: ${ramas} raíces; cada conjunto se lleva su rama exacta (${globosEnSuSitio} globos en su sitio) y todo el látex es de alguna`);

// ----------------------------------------------------------------------------------------------------------
// 4. Productos
// ----------------------------------------------------------------------------------------------------------

let lineas = 0, impresos = 0, metalizados = 0;
for (const i of LOTE_18) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenas.get(i.id)!, armada = armadas.get(i.id)!;
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(/^GLOBO /.test(p.nombre), `${que}: «${p.nombre}» es un globo de la tienda`);
    // Un liso que la tienda no vende queda con la búsqueda de la tienda.
    assert.ok(p.url.startsWith("/products/") || (p.url.startsWith("/search?q=") && p.formato !== null && !GLOBOS_TIENDA.some((x) => x.tipo === formatoPorId(p.formato!)?.tipo && x.codigo === p.codigo)), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad !== null) assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.cantidad !== null && p.formato && p.codigo) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: ${p.formato} ${p.codigo} del producto se fabrica`);
  }
  const del3D = new Map<string, number>();
  for (const m of sumarMateriales(armada.materiales)) if (m.cantidad > 0) del3D.set(clave(m.formatoId, m.codigo), (del3D.get(clave(m.formatoId, m.codigo)) ?? 0) + Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && p.formato && p.codigo) pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: los productos cuadran con los materiales del 3D`);
  lineas += pedidos.size;
  const deLaEscena = new Map<string, number>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)!.copias;
    if (nodo.pieza.tipo === "escenografia") continue;
    for (const p of (armarPieza(nodo.pieza).productos ?? []).filter((x) => x.url)) deLaEscena.set(p.url, (deLaEscena.get(p.url) ?? 0) + p.cantidad * copias);
  }
  const especiales = new Map<string, number>();
  for (const p of i.productos) {
    if (p.cantidad === null) continue;
    const impreso = impresoPorUrl(p.url);
    if (impreso) {
      impresos += p.cantidad;
      assert.ok(impreso.surtido ? impreso.surtido.includes(p.codigo ?? "") : p.codigo === impreso.codigoBase, `${que}: «${p.nombre}» en un color del impreso (${p.codigo})`);
    }
    if (p.formato === null) { metalizados += p.cantidad; assert.ok(metalizadoPorUrl(p.url), `${que}: «${p.nombre}» es un metalizado de la tienda`); }
    if (impreso || p.formato === null) especiales.set(p.url, (especiales.get(p.url) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...especiales.entries()].sort(), [...deLaEscena.entries()].sort(), `${que}: impresos y metalizados = los de la escena armada`);
  // Sin cantidad, solo lo publicado que la foto no muestra.
  for (const p of i.productos.filter((x) => x.cantidad === null)) assert.ok(!i.productos.some((x) => x.cantidad !== null && x.url === p.url), `${que}: «${p.nombre}» sin cantidad no sale también contado`);
}
const producto = (n: number, url: string) => LOTE_18.find((i) => i.numero === n)!.productos.filter((p) => p.url === url);
const cantidades = (n: number) => LOTE_18.find((i) => i.numero === n)!.productos.map((p) => `${p.formato}|${p.codigo}|${p.cantidad}`);
const publicado326 = (formato: string, codigo: string, url: string) => LOTE_18.find((i) => i.numero === 326)!.productos.some((p) => p.formato === formato && p.codigo === codigo && (p.cantidad ?? 0) > 0 && p.url === url);
assert.ok(publicado326("T-260", "015", "/products/globo-para-fiesta-latex-tubito-fashion-rojo"), "#326: el T-260 rojo publicado cotiza con su producto");
assert.ok(publicado326("T-260", "020", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo"), "#326: el T-260 amarillo publicado cotiza con su producto");
assert.ok(publicado326("R-12", "005", "/products/globo-para-fiesta-latex-redondo-fashion-blanco"), "#326: el R-12 blanco publicado cotiza con su producto");
assert.equal(producto(329, "/products/globo-para-fiesta-latex-redondo-infinity-corazones-por-siempre-fashion-rojo")[0]?.cantidad, 9, "#329: 5 pétalos y 4 del cuarteto con «Corazones por siempre»");
assert.equal(producto(338, "/products/globo-para-fiesta-latex-redondo-2-caras-happy-halloween-fashion-surtido-negro-naranja")[0]?.cantidad, 10, "#338: los 10 naranjas con «Happy Halloween»");
assert.equal(producto(353, "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente")[0]?.cantidad, 8, "#353: los 8 cristal de escarcha");
assert.equal(producto(363, "/products/globo-para-fiesta-latex-redondo-infinity-confetti-multicolor-pastel-fashion-transparente")[0]?.cantidad, 4, "#363: el cuarteto de confites");
assert.equal(producto(374, "/products/globo-metalizado-festivo")[0]?.cantidad, 1, "#374: el «Feliz Cumpleaños Festivo» de la tienda");
assert.ok(cantidades(341).includes("LOL-660|009|2") && cantidades(342).includes("LOL-660|040|2"), "#341 y #342: 2 Link-O-Loon 660 por columna");
assert.ok(cantidades(354).includes("R-12|080|12") && cantidades(354).includes("R-12|005|12"), "#354: 12 negros y 12 blancos");
assert.ok(cantidades(335).includes("R-12|080|1"), "#335: la bomba negra");
console.log(`OK productos: ${lineas} líneas de látex cuadran con el 3D; ${impresos} globos impresos y ${metalizados} metalizados de la tienda con su producto`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

const nodos = (n: number) => escenas.get(idDe(n))!.nodos;
const hecho = (n: number, id: string) => armadas.get(idDe(n))!.porNodo.find((x) => x.id === id)!;
const porCodigo = (n: number, id: string) => {
  const cuenta: Record<string, number> = {};
  for (const g of hecho(n, id).globos) cuenta[`${g.formatoId}|${g.codigo}`] = (cuenta[`${g.formatoId}|${g.codigo}`] ?? 0) + 1;
  return cuenta;
};
const empiezan = (n: number, prefijo: string) => nodos(n).filter((x) => x.id.startsWith(prefijo));
const metales = (n: number) => nodos(n).filter((x) => x.pieza.tipo === "metalizado");
const niveles = (n: number) => nodos(n).filter((x) => x.pieza.tipo === "columna");
const globosDe = (n: number) => armadas.get(idDe(n))!.globos;
const cuenta = (n: number, f: string, c: string) => globosDe(n).filter((g) => g.formatoId === f && g.codigo === c).length;
for (const [n, k] of [[334, 14], [335, 6], [338, 5], [344, 8], [353, 9], [354, 6], [367, 15]] as const) {
  assert.equal(niveles(n).length, k, `#${n}: ${k} niveles de cuartetos`);
  for (const x of niveles(n)) assert.equal(hecho(n, x.id).globos.length, 4, `#${n}: «${x.nombre}» es un cuarteto`);
}
assert.deepEqual(porCodigo(335, "rojo-bomba"), { "R-12|015": 3, "R-12|080": 1 }, "#335: el último nivel con la bomba negra");
assert.deepEqual(porCodigo(335, "verde-azul"), { "R-12|029": 2, "R-12|038": 2 }, "#335: la transición verde-azul de la espiral");
assert.equal(cuenta(353, "R-12", "012"), 10, "#353: 10 fucsia");
assert.equal(cuenta(353, "R-12", "390"), 8, "#353: 8 cristal");
assert.equal(cuenta(353, "R-12", "080"), 18, "#353: 18 negros");
assert.equal(empiezan(353, "corazon-").length, 6, "#353: 6 corazoncitos C-6");
assert.equal(empiezan(330, "racimo-").length, 8, "#330: racimo de 8 R-12");
assert.equal(empiezan(330, "rizo-").length, 5, "#330: 5 rizos");
assert.equal(empiezan(356, "racimo-").length, 7, "#356: racimo de 7 R-12");
assert.equal(empiezan(356, "rizo-").length, 4, "#356: 4 rizos");
assert.equal(cuenta(330, "R-36", "061") + cuenta(356, "R-36", "020"), 2, "#330 y #356: el R-36 de abajo");
assert.equal(empiezan(329, "trebol-").length, 5, "#329: 5 tréboles");
assert.equal(empiezan(329, "pierna-").length, 4, "#329: 4 piernas");
assert.equal(empiezan(367, "popo-").length, 4, "#367: 4 popós");
assert.equal(empiezan(367, "cuello-").length, 9, "#367: cuello de 9 niveles de R-5");
assert.equal(empiezan(341, "mariposa-").length + empiezan(342, "mariposa-").length, 8, "#341 y #342: 4 mariposas cada una");
assert.equal(empiezan(326, "cuerpo-").length, 7, "#326: 7 T-260 en el cuerpo");
assert.equal(empiezan(326, "llama-").length, 4, "#326: 4 llamas");
assert.equal(empiezan(344, "helio-").length, 3, "#344: ramo de 3 R-12");
assert.equal(empiezan(374, "voluta-").length, 3, "#374: 3 volutas");
assert.deepEqual(metales(334).map((x) => x.id), ["uno", "cinco"], "#334: el 1 y el 5");
for (const n of [335, 341, 342, 344, 354, 374]) assert.equal(metales(n).length, 1, `#${n}: un metalizado`);
assert.equal(metales(363).length, 2, "#363: el cupcake y la vela");
// Las alturas medidas: cada nivel a la altura de su centro en la foto (no al paso del taller).
const centroY = (n: number, id: string) => { const gs = hecho(n, id).globos; return gs.reduce((s, g) => s + g.nudo.y, 0) / gs.length; };
const paso = (n: number, a: string, b: string) => centroY(n, b) - centroY(n, a);
assert.ok(Math.abs(paso(354, "nivel-2", "nivel-6") - (455 - 240) / 3.1) < 1.5, `#354: del segundo al último nivel ${paso(354, "nivel-2", "nivel-6").toFixed(1)} cm (la foto: 69,4)`);
assert.ok(Math.abs(paso(334, "naranja-cuello-1", "naranja-cuello-2") - (357 - 265) / 2.5) < 1.5, "#334: el cuello de 7 niveles de R-5 mide lo de la foto (36,8 cm)");
assert.ok(Math.abs(paso(344, "azul-2", "azul-4") - (487 - 290) / 2.65) < 1.5, "#344: los niveles en lo que mide la foto (74,3 cm del segundo al último)");
const alto = (n: number) => Math.max(...armadas.get(idDe(n))!.porNodo.map((x) => x.caja.max.y));
for (const [n, min, max] of [[326, 180, 200], [334, 205, 225], [335, 155, 175], [338, 135, 155], [341, 180, 200], [342, 180, 200], [344, 200, 220], [353, 245, 265], [354, 155, 175], [363, 175, 195], [367, 200, 225], [374, 165, 185]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
for (const n of [329, 330, 356]) assert.ok(alto(n) >= 299 && Math.min(...armadas.get(idDe(n))!.porNodo.map((x) => x.caja.min.y)) > 60, `#${n}: cuelga del techo sin llegar al piso`);
console.log("OK conteos: niveles y colores de cada cuarteto, racimos, rizos, corazones, tréboles, popós, metalizados y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-18.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-18.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-18.json");
  for (const i of LOTE_18) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas.find((x) => x.slug === i.slug);
    assert.ok(datos, `${i.slug}: está en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos!.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos!.productos_mapeados ?? []) {
      assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.url === m.url), `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.codigo === m.codigo), `${i.slug}: «${m.nombre}» con su código publicado (${m.codigo})`);
    }
  }
  console.log("OK índice local: números, slugs, fotos y productos publicados tal cual");
} else {
  console.log("(sin los datos locales del índice: no se cruzan)");
}

// ----------------------------------------------------------------------------------------------------------
// 7. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0, conjuntos = 0;
for (const i of LOTE_18) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.tipo, "escena", `${i.id}: es una escena`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  const escena = escenas.get(i.id)!;
  const hijos = indexarEscena(item!, armadas.get(i.id));
  assert.ok(hijos.length > 0 && hijos.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
  const nombres = hijos.map((h) => `${h.tipo}|${h.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir (${nombres.join(", ")})`);
  for (const raiz of raicesDe.get(i.id)!) {
    const conHijos = escena.nodos.some((n) => (n.colocacion.en === "sobre" || n.colocacion.en === "ancla") && n.colocacion.padreId === raiz);
    const suyos = hijos.filter((h) => (h.tipo === "conjunto" || h.tipo === "estructura") && h.apareceEn?.[0]?.nodoIds.includes(raiz));
    assert.ok(suyos.length >= 1, `${i.id}: la raíz «${raiz}» sale en la biblioteca`);
    if (conHijos) {
      assert.ok(suyos.some((h) => h.tipo === "conjunto"), `${i.id}: «${raiz}» sale con sus decoraciones`);
      conjuntos++;
    }
  }
  derivados += hijos.length;
}
console.log(`OK biblioteca: las 15 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items de indexar sus escenas (${conjuntos} conjuntos de raíz)`);

console.log("OK test-ideas-lote-18");
