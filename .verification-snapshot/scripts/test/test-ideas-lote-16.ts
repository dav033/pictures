/**
 * Lote 16 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-16.ts`): ramos,
 * centros de mesa y estructuras. Sin coste: no llama a ninguna IA ni a la red.
 * - son las 15 del lote (`clasif/lote-16.json`), con id «idea:<slug>», en orden y sin repetir; su foto y sus ocasiones
 *   son las de la fuente (`fuenteIdea`, `ocasionesDeEtiquetas`); la nota dice qué quedó igual y qué no;
 * - cada idea arma (escena sin avisos, todo puesto, nada bajo el piso ni fuera de la sala) y cada globo y tubito usa un
 *   color que se fabrica en su formato, inflado dentro de lo que da ese formato (los tubos de Link-O-Loon 660 también);
 * - montaje: cada estructura es su propio árbol; las raíces son estructuras de globos o armazones (escenografía: el
 *   peso de un ramo, una base, una maceta) con globos colgados, y nada cuelga de una pieza que no esté.
 *   `extraerConjunto` de cada raíz se lleva su rama entera: sus materiales son exactamente los de la rama y, sola, arma
 *   lo mismo (cada globo en su sitio); todo el látex de la escena es de alguna rama;
 * - productos: por formato y código cuadran exactos con los materiales del 3D (todo es contado en la foto); los impresos
 *   y los metalizados de la tienda cuadran con los que lista la escena armada; lo publicado sale tal cual (nombre y url)
 *   y lo publicado que se dibuja con otra pieza (la calabaza de #155) cotiza con su producto;
 * - lo contado en las fotos (celdas de la bandera, globos de helio, letras, corazones, penacho, lunares, flores);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, da al menos un item por cada raíz (un
 *   conjunto si lleva decoraciones), con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan números, slugs, fotos y productos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_16 } from "../../src/lib/globos3d/ideas-sempertex/lote-16";
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

const NUMEROS = [155, 172, 174, 177, 178, 179, 185, 186, 198, 199, 200, 201, 202, 204, 208];
const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
const idDe = (n: number) => LOTE_16.find((i) => i.numero === n)!.id;

// ----------------------------------------------------------------------------------------------------------
// 1. Las 15 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_16.map((i) => i.numero), NUMEROS, "los 15 números del lote 16, en orden");
assert.equal(new Set(LOTE_16.map((i) => i.id)).size, 15, "ids sin repetir");
for (const i of LOTE_16) {
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
for (const i of LOTE_16) {
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
for (const i of LOTE_16) {
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
assert.deepEqual(raicesDe.get(idDe(155)), ["armazon", "ramo"], "#155: el armazón de la base (con el 8) y el ramo de helio");
assert.ok(hijosDe(155, "armazon").includes("ocho") && hijosDe(155, "armazon").includes("base"), "#155: el armazón lleva la base orgánica y el 8");
assert.deepEqual(raicesDe.get(idDe(172)), ["bandera"], "#172: la pared es la raíz");
for (const [n, raiz] of [[174, "base"], [177, "base"], [179, "base"], [185, "base"], [199, "base"], [200, "base"]] as const) assert.ok(raicesDe.get(idDe(n))![0] === raiz && hijosDe(n, raiz).includes("varilla"), `#${n}: la base de cuartetos es la raíz y lleva su varilla`);
assert.deepEqual(raicesDe.get(idDe(186)), ["pata-izquierda", "pata-derecha", "arco"], "#186: dos patas y el arco, cada uno su árbol");
assert.deepEqual(raicesDe.get(idDe(198)), ["pedestal", "ramo"], "#198: el pedestal con su base y el ramo");
assert.deepEqual(raicesDe.get(idDe(208)), ["ramo"], "#208: el ramo con su sombrero");
console.log(`OK montaje: ${ramas} raíces; cada conjunto se lleva su rama exacta (${globosEnSuSitio} globos en su sitio) y todo el látex es de alguna`);

// ----------------------------------------------------------------------------------------------------------
// 4. Productos
// ----------------------------------------------------------------------------------------------------------

let lineas = 0, impresos = 0, metalizados = 0;
for (const i of LOTE_16) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenas.get(i.id)!, armada = armadas.get(i.id)!;
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(/^GLOBO /.test(p.nombre), `${que}: «${p.nombre}» es un globo de la tienda`);
    // Un liso que la tienda no vende (el Link-O-Loon 660 lila de #185) queda con la búsqueda de la tienda.
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
const producto = (n: number, url: string) => LOTE_16.find((i) => i.numero === n)!.productos.filter((p) => p.url === url);
assert.deepEqual(producto(155, "/products/globo-para-fiesta-latex-redondo-2-caras-calabaza-fashion-naranja").map((p) => [p.formato, p.codigo, p.cantidad]), [["R-12", "061", 2]], "#155: las 2 calabazas publicadas cotizan como su producto");
assert.equal(producto(200, "/products/globo-redondo-fashion-blush-crema")[0]?.codigo, "663", "#200: la Blush Crema publicada va con el código medido");
assert.equal(producto(201, "/products/globo-redondo-fashion-blush-crema")[0]?.codigo, "661", "#201: la Blush Crema publicada va con el código medido");
assert.equal(producto(177, "/products/globo-metalizado-corazon-rojo-2")[0]?.cantidad, 3, "#177: 3 corazones rojos de la tienda");
assert.equal(producto(198, "/products/globo-metalizado-corazon-rosado-i-love-you")[0]?.cantidad, 2, "#198: 2 corazones «I love you»");
assert.equal(producto(204, "/products/globo-met-18-c-zon-feliz-dia-mama-x-1")[0]?.cantidad, 2, "#204: 2 corazones «Feliz Día Mamá» (el publicado)");
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
assert.deepEqual(porCodigo(172, "bandera"), { "R-12|041": 16, "R-12|015": 42, "R-12|005": 32, "R-12|390": 9, "R-9|015": 30, "R-9|005": 33 }, "#172: 10 × 9 grandes y 72 chicos, celda a celda");
assert.equal(empiezan(155, "helio-").length, 7, "#155: ramo de 7 R-12");
assert.equal(metales(155).length, 1, "#155: el 8 metalizado");
assert.equal(empiezan(174, "penacho-").length, 16, "#174: penacho de 16 T-260");
assert.deepEqual(metales(177).map((x) => x.id).sort(), ["corazon-arriba", "corazon-filigrana-1", "corazon-filigrana-2", "letra-i", "letra-o", "letra-u", "letra-y"], "#177: «I», «YOU» y 3 corazones");
assert.equal(empiezan(178, "trio-").length, 7, "#178: 7 tríos plata (4 en las cintas y 3 bajo la nube)");
assert.deepEqual(porCodigo(179, "base"), { "R-12|015": 4 }, "#179: cuarteto de R-12 «Corazones por siempre»");
assert.equal(empiezan(186, "lunar-").length, 17, "#186: 17 lunares en el arco");
assert.equal(empiezan(186, "entorchado-").length, 8, "#186: 4 T-260 entorchados por pata");
assert.equal(nodos(198).filter((x) => x.id.startsWith("helio-")).length + metales(198).filter((x) => x.id === "corazon-remate").length, 7, "#198: ramo de 6 R-12 y el corazón de remate");
assert.equal(empiezan(198, "flor-").length, 4, "#198: 3 flores de lazos y la flor del amarre");
assert.equal(nodos(199).filter((x) => /^(verde|blanco)-/.test(x.id)).length, 6, "#199: dos tríos de helio");
assert.equal(empiezan(199, "collar-").length, 3, "#199: 3 collares de burbujitas");
assert.equal(empiezan(200, "dorado-").length, 7, "#200: 7 R-5 Silk Dorado");
assert.equal(empiezan(201, "flor-").length, 5, "#201: la flor grande y 4 flores de tubito");
assert.equal(empiezan(201, "rosado-").length + empiezan(201, "durazno-").length, 17, "#201: 7 R-5 rosados y 10 durazno en las ramas");
assert.equal(metales(202).length, 9, "#202: el «1», «FELIZ» y «DÍA»");
assert.equal(metales(204).length, 2, "#204: 2 corazones metalizados");
assert.equal(empiezan(204, "florecita-").length, 3, "#204: 3 florecitas de lazos");
assert.equal(empiezan(208, "helio-").length, 6, "#208: ramo de 6 R-12");
const alto = (n: number) => Math.max(...armadas.get(idDe(n))!.porNodo.map((x) => x.caja.max.y));
for (const [n, min, max] of [[155, 205, 225], [174, 150, 175], [177, 220, 240], [178, 95, 110], [185, 255, 275], [186, 185, 205], [198, 255, 275], [199, 220, 245], [202, 250, 275], [208, 160, 180]] as const) assert.ok(alto(n) >= min && alto(n) <= max, `#${n}: alto ${alto(n).toFixed(0)} cm`);
console.log("OK conteos: bandera celda a celda, ramos, letras y corazones, penacho, lunares, flores y alturas de la foto");

// ----------------------------------------------------------------------------------------------------------
// 6. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-16.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-16.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-16.json");
  for (const i of LOTE_16) {
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
for (const i of LOTE_16) {
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

console.log("OK test-ideas-lote-16");
