/**
 * Lote 10 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-10.ts`): cuatro
 * escenas completas (#836, #260, #319, #333) y seis estructuras. Sin coste: no llama a ninguna IA ni a la red.
 * - son las 10 del lote (`clasif/lote-10.json`), con id «idea:<slug>», en orden y sin repetir; su foto y sus ocasiones
 *   son las de la fuente (`fuenteIdea`, `ocasionesDeEtiquetas`); la nota dice qué quedó igual y qué no;
 * - cada idea arma (escena sin avisos, todo puesto, nada bajo el piso ni fuera de la sala) y cada globo y tubito usa un
 *   color que se fabrica en su formato, inflado dentro de lo que da ese formato;
 * - montaje: cada estructura es su propio árbol; las raíces son estructuras de globos o armazones (escenografía) con
 *   globos colgados, y nada cuelga de una pieza que no esté. `extraerConjunto` de cada raíz se lleva su rama entera:
 *   sus materiales son exactamente los de la rama y, sola, arma lo mismo (cada globo en su sitio);
 * - en las escenas, la mesa y la utilería no son de ninguna estructura;
 * - productos: por formato y código cuadran exactos con los materiales del 3D (todo es contado en la foto); los impresos
 *   y los metalizados cuadran con los que lista la escena armada; lo que la idea publica sale tal cual (nombre y url);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, da al menos un item por cada estructura
 *   raíz (un conjunto si lleva decoraciones), con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan números, slugs, fotos y productos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_10 } from "../../src/lib/globos3d/ideas-sempertex/lote-10";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex/index";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [796, 836, 904, 927, 980, 51, 260, 286, 319, 333];
/** Las escenas completas según la clasificación (las demás son estructuras o centros de mesa). */
const ESCENAS = new Set([836, 260, 319, 333]);
const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;

// ----------------------------------------------------------------------------------------------------------
// 1. Las 10 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_10.map((i) => i.numero), NUMEROS, "los 10 números del lote 10, en orden");
assert.equal(new Set(LOTE_10.map((i) => i.id)).size, 10, "ids sin repetir");
for (const i of LOTE_10) {
  assert.equal(i.id, `idea:${i.slug}`, `${i.numero}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 120, `${i.numero}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${i.numero}: la nota dice qué quedó igual y qué no`);
  const fuente = fuenteIdea(i.slug);
  assert.ok(fuente, `${i.numero}: está en las fuentes`);
  assert.equal(fuente!.numero, i.numero, `${i.numero}: número de la fuente`);
  assert.deepEqual(i.ocasiones, ocasionesDeEtiquetas(fuente!.etiquetas), `${i.numero}: ocasiones de sus etiquetas (${fuente!.etiquetas.join(", ")})`);
  assert.ok(i.ocasiones.every((o) => OCASIONES.includes(o)), `${i.numero}: ocasiones de la lista`);
  assert.equal(i.fotoUrl, fuente!.fotoUrl, `${i.numero}: la foto de la fuente`);
  const foto = new URL(i.fotoUrl);
  assert.ok(foto.protocol === "https:" && foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${i.numero}: foto https del CDN de Sempertex`);
  assert.equal(i.contenido.tipo, "escena", `${i.numero}: es una escena`);
}
console.log("OK lote: 10 ideas con id, nombre, nota, foto y ocasiones de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<string, EscenaArmada>();
const escenas = new Map<string, Escena>();
let globosTotales = 0;
for (const i of LOTE_10) {
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
    assert.ok(f && f.tipo === "tubito", `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
  }
}
console.log(`OK armado: 10 escenas sin avisos, dentro de su sala, ${globosTotales} globos con colores que existen en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: cada estructura su árbol; su conjunto se lleva exactamente su rama
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
const tieneGlobos = (escena: Escena, armada: EscenaArmada, id: string) => miembrosDeConjunto(escena, id, armada).some((m) => (armada.porNodo.find((n) => n.id === m)?.globos.length ?? 0) + (armada.porNodo.find((n) => n.id === m)?.tubos.filter((t) => !t.papel).length ?? 0) > 0);
/** Las raíces: estructuras de globos sueltas, y armazones (escenografía suelta) con globos colgados. */
function raices(escena: Escena, armada: EscenaArmada): string[] {
  return escena.nodos.filter((n) => n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre"
    && (clasePieza(n.pieza) === "estructura" || (n.pieza.tipo === "escenografia" && escena.nodos.some((h) => (h.colocacion.en === "sobre" || h.colocacion.en === "ancla") && h.colocacion.padreId === n.id) && tieneGlobos(escena, armada, n.id)))).map((n) => n.id);
}
const raicesDe = new Map<string, string[]>();
let ramas = 0, globosEnSuSitio = 0;
for (const i of LOTE_10) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenas.get(i.id)!, armada = armadas.get(i.id)!;
  const ids = new Set(escena.nodos.map((n) => n.id));
  for (const n of escena.nodos) if (n.colocacion.en === "sobre" || n.colocacion.en === "ancla") assert.ok(ids.has(n.colocacion.padreId) && n.colocacion.padreId !== n.id, `${que}: «${n.nombre}» cuelga de una pieza que está`);
  const lista = raices(escena, armada);
  raicesDe.set(i.id, lista);
  assert.ok(lista.length >= 1, `${que}: tiene al menos una estructura raíz`);
  // Todo globo de la escena es de una sola rama (no hay dos estructuras colgadas de una varilla común).
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
    const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(1)}|${g.nudo.y.toFixed(1)}|${g.nudo.z.toFixed(1)}`.replace(/-0\.0/g, "0.0");
    assert.deepEqual(sola.globos.map(firma).sort(), deLaRama.flatMap((n) => n.globos).map(firma).sort(), `${que} / ${id}: sola, cada globo en su sitio`);
    globosEnSuSitio += sola.globos.length;
    ramas++;
  }
  // Ningún globo queda fuera de las ramas: cada pieza con látex es de alguna estructura.
  for (const n of armada.porNodo) if (n.globos.length || n.tubos.some((t) => !t.papel)) assert.ok(dueno.has(n.id), `${que}: «${n.nombre}» es de una estructura`);
  // Las mesas y la utilería de las escenas no son de ninguna estructura.
  if (ESCENAS.has(i.numero)) for (const n of escena.nodos) if (clasePieza(n.pieza) === "utileria" || /^mesa/.test(n.id)) assert.ok(!dueno.has(n.id), `${que}: «${n.nombre}» va aparte`);
}
// Lo que se cuenta uno a uno: la malla de #260 y las uvas, el ramo y los rizos de #796.
const idDe = (n: number) => LOTE_10.find((i) => i.numero === n)!.id;
const nodos260 = escenas.get(idDe(260))!.nodos;
assert.equal(nodos260.filter((n) => n.id.startsWith("eslabon-")).length, 32, "#260: 32 eslabones plata");
assert.equal(nodos260.filter((n) => n.id.startsWith("violeta-")).length, 11, "#260: 11 violetas en los nudos");
assert.equal(nodos260.filter((n) => n.id.startsWith("fucsia-")).length, 10, "#260: 10 fucsias en los huecos");
assert.equal(nodos260.filter((n) => n.id.startsWith("amarre-")).length, 12, "#260: 12 parejas de amarre");
assert.equal(nodos260.filter((n) => n.id.startsWith("helio-izquierdo")).length, 6, "#260: ramo izquierdo de 6");
assert.equal(nodos260.filter((n) => n.id.startsWith("helio-derecho")).length, 5, "#260: ramo derecho de 5");
assert.deepEqual(raicesDe.get(idDe(260)), ["malla", "racimo-izquierdo", "racimo-derecho"], "#260: la malla y los dos racimos, cada uno su árbol");
const nodos796 = escenas.get(idDe(796))!.nodos;
assert.equal(nodos796.filter((n) => n.id.startsWith("uvas-champana-")).length, 7, "#796: 7 racimos de uvas champaña");
assert.equal(nodos796.filter((n) => n.id.startsWith("uvas-chocolate-")).length, 6, "#796: 6 racimos de uvas chocolate");
assert.equal(nodos796.filter((n) => n.id.startsWith("helio-")).length, 3, "#796: ramo de 3 champaña");
assert.deepEqual(raicesDe.get(idDe(796)), ["armazon", "racimo-piso"], "#796: la guirnalda (su armazón) y el racimo de piso con su ramo");
assert.deepEqual(raicesDe.get(idDe(333)), ["armazon-izquierdo", "armazon-derecho"], "#333: los dos orgánicos, cada uno su árbol");
assert.equal(raicesDe.get(idDe(927))!.length, 6, "#927: dos arcos y cuatro patas");
console.log(`OK montaje: ${ramas} estructuras raíz; cada conjunto se lleva su rama exacta (${globosEnSuSitio} globos en su sitio) y la utilería va aparte`);

// ----------------------------------------------------------------------------------------------------------
// 4. Productos
// ----------------------------------------------------------------------------------------------------------

let lineas = 0, impresos = 0, metalizados = 0;
for (const i of LOTE_10) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenas.get(i.id)!, armada = armadas.get(i.id)!;
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(/^GLOBO /.test(p.nombre), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad !== null) assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.formato && p.codigo) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: ${p.formato} ${p.codigo} del producto se fabrica`);
  }
  const del3D = new Map<string, number>();
  for (const m of armada.materiales) del3D.set(clave(m.formatoId, m.codigo), (del3D.get(clave(m.formatoId, m.codigo)) ?? 0) + Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && p.formato && p.codigo) pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: los productos cuadran con los materiales del 3D`);
  lineas += pedidos.size;
  const deLaEscena = new Map<string, number>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)!.copias;
    if (nodo.pieza.tipo === "escenografia") continue;
    for (const p of armarPieza(nodo.pieza).productos ?? []) deLaEscena.set(p.url, (deLaEscena.get(p.url) ?? 0) + p.cantidad * copias);
  }
  const especiales = new Map<string, number>();
  for (const p of i.productos) {
    if (p.cantidad === null) continue;
    const impreso = impresoPorUrl(p.url);
    if (impreso) {
      impresos += p.cantidad;
      assert.ok(impreso.surtido ? impreso.surtido.includes(p.codigo ?? "") : p.codigo === impreso.codigoBase, `${que}: «${p.nombre}» en un color del impreso (${p.codigo})`);
    }
    if (p.formato === null) metalizados += p.cantidad;
    if (impreso || p.formato === null) especiales.set(p.url, (especiales.get(p.url) ?? 0) + p.cantidad);
  }
  assert.deepEqual([...especiales.entries()].sort(), [...deLaEscena.entries()].sort(), `${que}: impresos y metalizados = los de la escena armada`);
}
assert.ok(impresos === 6 && metalizados === 1, `#260: 6 globos impresos y un metalizado (${impresos}, ${metalizados})`);
console.log(`OK productos: ${lineas} líneas de látex cuadran con el 3D; ${impresos} globos impresos y ${metalizados} metalizado con su producto`);

// ----------------------------------------------------------------------------------------------------------
// 5. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-10.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string; tipo: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-10.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-10.json");
  for (const i of LOTE_10) {
    const c = clasif.find((x) => x.numero === i.numero);
    assert.equal(c?.slug, i.slug, `${i.numero}: slug del índice`);
    assert.equal(c?.tipo === "escena", ESCENAS.has(i.numero), `${i.numero}: escena según la clasificación`);
    const datos = ideas.find((x) => x.slug === i.slug);
    assert.ok(datos, `${i.slug}: está en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos!.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos!.productos_mapeados ?? []) {
      assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.url === m.url), `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.codigo === m.codigo), `${i.slug}: «${m.nombre}» con su código publicado (${m.codigo})`);
    }
  }
  console.log("OK índice local: números, slugs, tipos, fotos y productos publicados tal cual");
} else {
  console.log("(sin los datos locales del índice: no se cruzan)");
}

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0, conjuntos = 0;
for (const i of LOTE_10) {
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
    assert.ok(suyos.length >= 1, `${i.id}: la estructura «${raiz}» sale en la biblioteca`);
    if (conHijos) {
      assert.ok(suyos.some((h) => h.tipo === "conjunto"), `${i.id}: «${raiz}» sale con sus decoraciones`);
      conjuntos++;
    }
  }
  // Cada decoración también sale sola.
  assert.ok(escena.nodos.filter((n) => clasePieza(n.pieza) === "decoracion").every((n) => hijos.some((h) => h.tipo === "decoracion" && h.apareceEn?.[0]?.nodoIds.includes(n.id))), `${i.id}: cada decoración sale sola`);
  derivados += hijos.length;
}
console.log(`OK biblioteca: las 10 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items de indexar sus escenas (${conjuntos} conjuntos de estructura raíz)`);
