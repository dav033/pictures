/**
 * Lote 05 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-05.ts`): 9
 * centros de mesa y 11 columnas. Sin coste: no llama a ninguna IA ni a la red.
 * - son las 20 del lote (`clasif/lote-05.json`), con id «idea:<slug>», en orden y sin repetir; su foto y sus ocasiones
 *   son las de la fuente (`fuenteIdea`, `ocasionesDeEtiquetas`);
 * - cada idea arma (escena sin avisos, todo puesto, nada bajo el piso ni fuera de la sala) y cada globo y tubito usa un
 *   color que se fabrica en su formato, inflado dentro de lo que da ese formato;
 * - el montaje: la estructura principal es la raíz (suelta), su varilla cuelga de ella justo donde se pidió (no tocó
 *   ningún globo) y todo lo demás cuelga de la varilla; extraer el conjunto de la raíz se lleva la escena entera (la
 *   biblioteca la saca «sola con sus decoraciones»);
 * - productos: por formato y código cuadran exactos con los materiales del 3D (todo es contado en la foto); los
 *   impresos y los metalizados de la tienda cuadran con los que lista la escena armada, con su producto exacto del
 *   catálogo; lo que la idea publica sale tal cual (nombre y url);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente y, al indexar, lo de sus escenas sale con nombres sin
 *   repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan números, slugs, fotos y productos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_05 } from "../../src/lib/globos3d/ideas-sempertex/lote-05";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex/index";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { impresoPorUrl } from "../../src/lib/globos3d/impresos-catalogo";
import { BIBLIOTECA_FABRICA, OCASIONES, extraerConjunto, indexarEscena } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [270, 271, 273, 279, 280, 282, 284, 290, 302, 337, 339, 346, 352, 355, 361, 366, 368, 369, 373, 378];
const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;

// ----------------------------------------------------------------------------------------------------------
// 1. Las 20 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_05.map((i) => i.numero), NUMEROS, "los 20 números del lote 05, en orden");
assert.equal(new Set(LOTE_05.map((i) => i.id)).size, 20, "ids sin repetir");
for (const i of LOTE_05) {
  assert.equal(i.id, `idea:${i.slug}`, `${i.numero}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 0, `${i.numero}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota) && !i.nota.includes("…") && i.nota.length > 120, `${i.numero}: la nota dice qué quedó igual y qué no`);
  assert.ok(i.ocasiones.length > 0 && i.ocasiones.every((o) => OCASIONES.includes(o)), `${i.numero}: ocasiones de la lista (${i.ocasiones.join(", ")})`);
  const fuente = fuenteIdea(i.slug);
  assert.ok(fuente, `${i.slug}: está en las fuentes`);
  assert.equal(fuente!.numero, i.numero, `${i.slug}: número de la fuente`);
  assert.equal(i.fotoUrl, fuente!.fotoUrl, `${i.slug}: la foto es la de la fuente`);
  assert.deepEqual(i.ocasiones, ocasionesDeEtiquetas(fuente!.etiquetas), `${i.slug}: ocasiones de sus etiquetas`);
  const foto = new URL(i.fotoUrl);
  assert.ok(foto.protocol === "https:" && foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${i.numero}: foto https del CDN de Sempertex`);
  assert.equal(i.contenido.tipo, "escena", `${i.numero}: es una escena`);
}
console.log("OK lote: 20 ideas con id, nombre, nota, foto y ocasiones de su fuente");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<string, EscenaArmada>();
const escenas = new Map<string, Escena>();
let globosTotales = 0;
for (const i of LOTE_05) {
  const que = `${i.numero} ${i.slug}`;
  if (i.contenido.tipo !== "escena") continue;
  const escena = i.contenido.escena;
  const armada = armarEscena(escena);
  escenas.set(i.id, escena);
  armadas.set(i.id, armada);
  assert.deepEqual(armada.avisos, [], `${que}: arma sin avisos`);
  assert.ok(armada.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), `${que}: cada pieza quedó puesta`);
  assert.equal(new Set(escena.nodos.map((n) => n.nombre)).size, escena.nodos.length, `${que}: nombres de nodo sin repetir`);
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
    assert.ok(Math.abs(infladoValido(f!, g.infladoCm) - g.infladoCm) < 1e-9, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm cabe en su formato`);
  }
  for (const t of armada.tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    assert.ok(f && f.tipo === "tubito", `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
  }
}
console.log(`OK armado: 20 escenas sin avisos, dentro de su sala, ${globosTotales} globos con colores que existen en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Montaje: raíz, varilla y lo que cuelga de ella; el conjunto de la raíz es la escena entera
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_05) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenas.get(i.id)!, armada = armadas.get(i.id)!;
  const [raiz, varilla, ...resto] = escena.nodos;
  assert.ok(raiz && raiz.colocacion.en === "libre", `${que}: la raíz va suelta`);
  assert.ok(["columna", "metalizado"].includes(raiz.pieza.tipo), `${que}: la raíz es una estructura (${raiz.pieza.tipo})`);
  assert.ok(varilla && varilla.pieza.tipo === "escenografia" && varilla.colocacion.en === "sobre" && varilla.colocacion.padreId === raiz.id, `${que}: la varilla cuelga de la raíz`);
  assert.ok(resto.every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "varilla"), `${que}: todo lo demás cuelga de la varilla`);
  // La varilla quedó donde se pidió (su base 1,5 cm bajo el punto): no se apoyó en ningún globo de la raíz.
  if (raiz.colocacion.en === "libre" && varilla.colocacion.en === "sobre") {
    const g = (raiz.colocacion.giroGrados * Math.PI) / 180, p = varilla.colocacion.puntoCm;
    const esperado = { x: raiz.colocacion.xCm + p.x * Math.cos(g) + p.z * Math.sin(g), y: raiz.colocacion.yCm + p.y - 1.5, z: raiz.colocacion.zCm - p.x * Math.sin(g) + p.z * Math.cos(g) };
    const t = armada.porNodo.find((n) => n.id === "varilla")!.puestas[0]!.marco.t;
    assert.ok(Math.hypot(t.x - esperado.x, t.y - esperado.y, t.z - esperado.z) < 0.05, `${que}: la varilla quedó donde se pidió`);
  }
  const conjunto = extraerConjunto(escena, raiz.id, { armada });
  assert.ok(conjunto, `${que}: se extrae el conjunto de la raíz`);
  assert.equal(conjunto!.hijos.length, escena.nodos.length - 1, `${que}: el conjunto de la raíz se lleva toda la escena`);
}
console.log("OK montaje: la estructura principal es la raíz y su conjunto se lleva todo (varilla en su sitio)");

// ----------------------------------------------------------------------------------------------------------
// 4. Productos
// ----------------------------------------------------------------------------------------------------------

let lineas = 0, impresos = 0, metalizados = 0;
for (const i of LOTE_05) {
  const que = `${i.numero} ${i.slug}`;
  const escena = escenas.get(i.id)!, armada = armadas.get(i.id)!;
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(/^GLOBO /.test(p.nombre), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url de la tienda (${p.url})`);
    if (p.cantidad !== null) assert.ok(Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${que}: «${p.nombre}» contado en la foto`);
    if (p.formato && p.codigo) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: ${p.formato} ${p.codigo} del producto se fabrica`);
  }
  // Látex: por formato y código, lo de los productos (lisos e impresos) es lo del 3D.
  const del3D = new Map<string, number>();
  for (const m of armada.materiales) del3D.set(clave(m.formatoId, m.codigo), (del3D.get(clave(m.formatoId, m.codigo)) ?? 0) + Math.ceil(m.cantidad - 1e-9));
  const pedidos = new Map<string, number>();
  for (const p of i.productos) if (p.cantidad !== null && p.formato && p.codigo) pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad);
  assert.deepEqual([...pedidos.entries()].sort(), [...del3D.entries()].sort(), `${que}: los productos cuadran con los materiales del 3D`);
  lineas += pedidos.size;
  // Impresos y metalizados: los productos de la escena armada (url → cantidad), con el producto exacto del catálogo.
  const deLaEscena = new Map<string, number>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)!.copias;
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
console.log(`OK productos: ${lineas} líneas de látex cuadran con el 3D; ${impresos} globos impresos y ${metalizados} metalizados con su producto`);

// ----------------------------------------------------------------------------------------------------------
// 5. Datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-05.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-05.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-05.json");
  for (const i of LOTE_05) {
    assert.equal(clasif.find((x) => x.numero === i.numero)?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas.find((x) => x.slug === i.slug);
    assert.ok(datos, `${i.slug}: está en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos!.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    for (const m of datos!.productos_mapeados ?? []) assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.url === m.url), `${i.slug}: publica «${m.nombre}» y está en sus productos`);
  }
  console.log("OK índice local: números, slugs, fotos y productos publicados tal cual");
} else {
  console.log("(sin los datos locales del índice: no se cruzan)");
}

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_05) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.tipo, "escena", `${i.id}: es una escena`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  const hijos = indexarEscena(item!, armadas.get(i.id));
  assert.ok(hijos.length > 0 && hijos.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
  const nombres = hijos.map((h) => `${h.tipo}|${h.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir (${nombres.join(", ")})`);
  const raiz = escenas.get(i.id)!.nodos[0]!;
  assert.ok(hijos.some((h) => h.tipo === "conjunto" && h.apareceEn?.[0]?.nodoIds[0] === raiz.id), `${i.id}: la estructura principal sale con sus decoraciones`);
  derivados += hijos.length;
}
console.log(`OK biblioteca: las 20 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas`);
