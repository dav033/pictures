/**
 * Lote 04 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-04.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 20 del lote (`clasif/lote-04.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus etiquetas
 *   (`ocasionesDeEtiquetas`) y la foto de su fuente;
 * - cada idea arma (escena sin avisos, nada bajo el piso ni fuera de la sala) y cada globo y tubito usa un color que se
 *   fabrica en su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos, y al revés: cada producto con cantidad sale en el
 *   3D, con la misma cantidad; los publicados van tal cual (nombre y url). La idea sin foto (#119) no cuenta nada: sus
 *   productos van sin cantidad y el 3D solo usa sus colores;
 * - en las escenas, cada estructura raíz (y cada base con lo suyo colgado, como los ramos del #184) se extrae con
 *   `extraerConjunto`: entran todos sus miembros, sola arma lo mismo (materiales y cada globo en su sitio) que su rama;
 *   en #160 los cinco tramos del arco y en #184 los dos ramos, cada uno con lo suyo y sin la mesa;
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente; al indexar, lo de sus escenas sale como items que
 *   apuntan a ellas, con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_04 } from "../../src/lib/globos3d/ideas-sempertex/lote-04";
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [930, 940, 947, 974, 979, 30, 61, 65, 87, 94, 95, 97, 119, 125, 126, 154, 160, 176, 184, 229];
/** La idea cuya imagen es el logo de Sempertex: no hay nada que contar. */
const SIN_FOTO = new Set([119]);

// ----------------------------------------------------------------------------------------------------------
// 1. Las 20 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_04.map((i) => i.numero), NUMEROS, "los 20 números del lote 04, en orden");
assert.equal(new Set(LOTE_04.map((i) => i.id)).size, 20, "ids sin repetir");
for (const i of LOTE_04) {
  assert.equal(i.id, `idea:${i.slug}`, `${i.numero}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 80, `${i.numero}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${i.numero}: la nota dice qué quedó igual y qué no`);
  const fuente = fuenteIdea(i.slug);
  assert.ok(fuente, `${i.numero}: está en las fuentes`);
  assert.equal(fuente!.numero, i.numero, `${i.numero}: número de la fuente`);
  assert.deepEqual(i.ocasiones, ocasionesDeEtiquetas(fuente!.etiquetas), `${i.numero}: ocasiones de sus etiquetas (${fuente!.etiquetas.join(", ")})`);
  assert.ok(i.ocasiones.every((o) => OCASIONES.includes(o)), `${i.numero}: ocasiones de la lista`);
  assert.equal(i.fotoUrl, fuente!.fotoUrl, `${i.numero}: la foto de la fuente`);
  const foto = new URL(i.fotoUrl);
  assert.ok(foto.protocol === "https:" && foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${i.numero}: foto https del CDN de Sempertex`);
}
console.log("OK lote: 20 ideas con id, nombre, nota, ocasiones de sus etiquetas y su foto");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<string, EscenaArmada>();
const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
const materialesDe = new Map<string, Map<string, number>>();

for (const i of LOTE_04) {
  const que = `${i.numero} ${i.slug}`;
  assert.equal(i.contenido.tipo, "escena", `${que}: todas son escenas`);
  if (i.contenido.tipo !== "escena") continue;
  const escena = i.contenido.escena;
  const armada = armarEscena(escena);
  armadas.set(i.id, armada);
  assert.deepEqual(armada.avisos, [], `${que}: arma sin avisos`);
  assert.ok(armada.porNodo.every((n) => n.copias > 0), `${que}: cada pieza quedó puesta`);
  const sala = armada.sala;
  for (const n of armada.porNodo) {
    assert.ok(n.caja.min.y >= -1, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo (${n.caja.max.y.toFixed(1)})`);
    assert.ok(Math.abs(n.caja.min.x) <= sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -sala.fondoCm / 2 - 1 && n.caja.max.z <= sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo`);
  }
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
  assert.equal(new Set(escena.nodos.map((n) => n.id)).size, escena.nodos.length, `${que}: ids de nodo sin repetir`);
  assert.ok(armada.globos.length > 0, `${que}: tiene globos`);
  for (const g of armada.globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f, `${que}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${que}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(g.infladoCm >= f!.diametroMaxCm * 0.4 - 0.01 && g.infladoCm <= f!.diametroMaxCm + 0.01, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm`);
  }
  for (const t of armada.tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    assert.ok(f && f.tipo === "tubito", `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
  }
  const porClave = new Map<string, number>();
  for (const m of armada.materiales) porClave.set(clave(m.formatoId, m.codigo), (porClave.get(clave(m.formatoId, m.codigo)) ?? 0) + m.cantidad);
  materialesDe.set(i.id, porClave);
}
console.log(`OK armado: ${LOTE_04.length} escenas sin avisos, dentro de su sala y con colores que existen en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

let lineas = 0;
for (const i of LOTE_04) {
  const que = `${i.numero} ${i.slug}`;
  const del3D = materialesDe.get(i.id)!;
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url relativa de la tienda`);
    if (p.codigo !== null && p.formato !== null) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: ${p.formato} ${p.codigo} del producto se fabrica`);
    if (p.cantidad !== null) assert.ok(p.cantidad > 0 && Number.isInteger(p.cantidad) && p.contada === true && p.codigo !== null && p.formato !== null, `${que}: «${p.nombre}» con cantidad contada dice formato y código`);
  }
  if (SIN_FOTO.has(i.numero)) {
    // Sin foto no se cuenta nada: los productos van sin cantidad y el 3D usa solo sus colores (en cualquier talla).
    assert.ok(i.productos.every((p) => p.cantidad === null), `${que}: sin foto, ningún producto con cantidad`);
    const codigos = new Set(i.productos.map((p) => p.codigo));
    for (const k of del3D.keys()) assert.ok(codigos.has(k.split("|")[1]!), `${que}: ${k} del 3D es un color publicado`);
    continue;
  }
  const pedidos = new Map<string, number>();
  for (const p of i.productos.filter((x) => x.cantidad !== null)) pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad!);
  for (const [k, n] of del3D) assert.ok(pedidos.has(k), `${que}: ${k} del 3D (×${n}) es de un producto de la idea`);
  for (const [k, cantidad] of pedidos) {
    const n = del3D.get(k) ?? 0;
    // Los globos, exactos; los tubitos se compran enteros (el 3D cuenta por largo).
    const tubito = formatoPorId(k.split("|")[0]!)?.tipo === "tubito";
    if (tubito) assert.equal(Math.ceil(n - 1e-9), cantidad, `${que}: ${k} contado ×${cantidad}, en el 3D ${n.toFixed(2)} tubitos`);
    else assert.equal(n, cantidad, `${que}: ${k} contado ×${cantidad}, en el 3D ×${n}`);
    lineas++;
  }
}
console.log(`OK productos: ${lineas} líneas contadas cuadran exactas con el 3D (la idea sin foto, sin cantidades)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Las estructuras raíz de cada escena se extraen con lo suyo
// ----------------------------------------------------------------------------------------------------------

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
type Rama = { nodo: string; nombres: string[]; materiales: string[] };
/** Las raíces: estructuras de globos y bases (escenografía) de las que cuelga algo; nada que cuelgue de otra pieza. */
function raices(escena: Escena): string[] {
  const padres = new Set(escena.nodos.flatMap((n) => (n.colocacion.en === "ancla" || n.colocacion.en === "sobre" ? [n.colocacion.padreId] : [])));
  return escena.nodos.filter((n) => n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre" && (clasePieza(n.pieza) === "estructura" || (n.pieza.tipo === "escenografia" && padres.has(n.id)))).map((n) => n.id);
}
const ramas = new Map<number, Rama[]>();
let extraidas = 0, globosEnSuSitio = 0;
for (const i of LOTE_04) {
  if (i.contenido.tipo !== "escena") continue;
  const escena = i.contenido.escena, armada = armadas.get(i.id)!;
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
    assert.deepEqual(ordenar(sola.materiales), materiales, `${que}: sola gasta lo mismo que su rama`);
    const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(1)}|${g.nudo.y.toFixed(1)}|${g.nudo.z.toFixed(1)}`.replace(/-0\.0/g, "0.0");
    assert.deepEqual(sola.globos.map(firma).sort(), deLaRama.flatMap((n) => n.globos).map(firma).sort(), `${que}: cada globo en su sitio`);
    assert.deepEqual(ordenar(armarEscena(escenaDeConjunto(conjunto!)).materiales), materiales, `${que}: en el origen, lo mismo`);
    globosEnSuSitio += sola.globos.length;
    extraidas++;
    lista.push({ nodo: id, nombres: conjunto!.hijos.map((h) => h.nombre), materiales });
  }
  ramas.set(i.numero, lista);
}
// #160: los cinco tramos del arco, cada uno solo y de su color; la mesa y la utilería no son de ninguno.
const r160 = ramas.get(160)!;
assert.deepEqual(r160.map((r) => r.nodo), ["tramo-merlot", "tramo-eucalipto", "tramo-cobrizo", "tramo-amarillo", "tramo-naranja"], "#160: los cinco tramos son raíces");
const color160: Record<string, string> = { "tramo-merlot": "018", "tramo-eucalipto": "027", "tramo-cobrizo": "062", "tramo-amarillo": "021", "tramo-naranja": "061" };
for (const r of r160) {
  assert.deepEqual(r.nombres, [], `#160 ${r.nodo}: sin decoraciones (la mesa va aparte)`);
  assert.ok(r.materiales.every((m) => m.split("|")[1] === color160[r.nodo]), `#160 ${r.nodo}: todo de su color (${r.materiales.join(", ")})`);
}
// #184: cada ramo es su escalera con sus globos; el izquierdo 3 amarillos y 4 perla, el derecho 3 y 5.
const r184 = ramas.get(184)!;
assert.deepEqual(r184.map((r) => [r.nodo, r.materiales]), [
  ["ramo-izquierdo", ["R-12|021|3", "R-12|873|4"]],
  ["ramo-derecho", ["R-12|021|3", "R-12|873|5"]],
], "#184: los dos ramos, cada uno con sus globos");
// Los arcos con decoraciones las llevan consigo.
const hijos = (n: number, nodo: string) => ramas.get(n)!.find((r) => r.nodo === nodo)!.nombres;
assert.equal(hijos(61, "arco").filter((x) => x.startsWith("Araña")).length, 2, "#61: el arco lleva sus dos arañas");
assert.equal(hijos(94, "arco").filter((x) => x.startsWith("Florecita")).length, 10, "#94: el arco lleva sus 10 florecitas");
assert.equal(hijos(95, "arco").filter((x) => x.startsWith("Flor")).length, 15, "#95: el arco lleva sus 15 flores");
assert.equal(hijos(97, "arco").filter((x) => x.startsWith("Girasol")).length, 4, "#97: el arco lleva sus 4 girasoles");
assert.equal(hijos(126, "semiarco").length, 4, "#126: el semiarco lleva sus 4 globos grandes");
assert.ok(hijos(940, "bola").length >= 11, "#940: la bola lleva sus flores");
console.log(`OK escenas: ${extraidas} estructuras raíz se extraen con lo suyo (${globosEnSuSitio} globos en su sitio); #160 en 5 tramos, #184 en 2 ramos`);

// ----------------------------------------------------------------------------------------------------------
// 5. Datos locales del índice (si están): slug, foto y productos publicados tal cual
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-04.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-04.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-04.json");
  for (const i of LOTE_04) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas.find((x) => x.slug === i.slug);
    assert.ok(datos, `${i.slug}: está en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos!.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos!.productos_mapeados ?? []) {
      assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.url === m.url), `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.codigo === m.codigo), `${i.slug}: «${m.nombre}» con su código publicado (${m.codigo})`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else {
  console.log("(sin los datos locales del índice: no se cruzan)");
}

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_04) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.tipo, "escena", `${i.id}: tipo de item`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.ok(item!.fuente?.titulo.includes(i.nombre), `${i.id}: título de la fuente`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  const derivadosIdea = indexarEscena(item!, armadas.get(i.id));
  assert.ok(derivadosIdea.length > 0 && derivadosIdea.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
  const nombres = derivadosIdea.map((h) => `${h.tipo}|${h.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir (${nombres.join(", ")})`);
  derivados += derivadosIdea.length;
}
const conjuntos = (n: number) => indexarEscena(BIBLIOTECA_FABRICA.find((x) => x.id === LOTE_04.find((i) => i.numero === n)!.id)!).filter((h) => h.tipo === "conjunto").length;
assert.ok(conjuntos(61) >= 1 && conjuntos(94) >= 1 && conjuntos(95) >= 1 && conjuntos(97) >= 1 && conjuntos(940) >= 1, "los arcos y la bola con decoraciones salen como conjunto");
console.log(`OK biblioteca: las 20 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas`);

