/**
 * Lote 01 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-01.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 20 del lote (`clasif/lote-01.json`), con id «idea:<slug>», en orden y sin repetir;
 * - cada idea arma (escena sin avisos; pieza con globos) y cada globo y tubito usa un color que se fabrica en su
 *   formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D son los de sus productos: cuando la idea publica productos, esos mismos códigos (nombre, url,
 *   formato y código tal cual), y lo que no es de un producto con código solo puede ser el liso que reemplaza a un
 *   impreso; las cantidades del 3D cuadran con las de los productos (±10 %), por producto y en total;
 * - las fotos son https del CDN de Sempertex y la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente; al
 *   indexar, lo de sus escenas sale como items que apuntan a ellas.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_01 } from "../../src/lib/globos3d/ideas-sempertex/lote-01";
import { urlDeIdea, type IdeaDigitalizada } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, bibliotecaCompleta, productosDe } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [6, 64, 84, 110, 137, 141, 159, 163, 164, 212, 288, 308, 316, 372, 417, 432, 434, 435, 446, 501];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 20 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_01.map((i) => i.numero), NUMEROS, "los 20 números del lote 01, en orden");
assert.equal(new Set(LOTE_01.map((i) => i.id)).size, 20, "ids sin repetir");
for (const i of LOTE_01) {
  assert.equal(i.id, `idea:${i.slug}`, `${i.numero}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 40, `${i.numero}: nombre y nota`);
  assert.ok(i.ocasiones.length > 0 && i.ocasiones.every((o) => OCASIONES.includes(o)), `${i.numero}: ocasiones de la lista (${i.ocasiones.join(", ")})`);
  const foto = new URL(i.fotoUrl);
  assert.equal(foto.protocol, "https:", `${i.numero}: foto https`);
  assert.ok((foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/")) || foto.hostname === "cdn.shopify.com", `${i.numero}: foto del CDN de Sempertex`);
  assert.ok(i.productos.length > 0, `${i.numero}: productos`);
  for (const p of i.productos) {
    assert.ok(p.nombre.startsWith("GLOBO "), `${i.numero}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/"), `${i.numero}: url de la tienda (${p.url})`);
    assert.ok(p.cantidad !== null && Number.isInteger(p.cantidad) && p.cantidad > 0 && p.contada === true, `${i.numero}: cantidad contada en la foto (ninguna idea del lote publica «Materiales»)`);
  }
}
console.log("OK lote: 20 ideas, ids, ocasiones, fotos y productos");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

type Armada = { materiales: MaterialDecoracion[]; globos: Array<{ formatoId: string; codigo: string; infladoCm: number }>; tubos: Array<{ formatoId: string; codigo: string }> };
function armar(i: IdeaDigitalizada): Armada {
  if (i.contenido.tipo === "escena") {
    const a = armarEscena(i.contenido.escena);
    assert.deepEqual(a.avisos, [], `${i.numero}: la escena arma sin avisos`);
    assert.ok(a.porNodo.every((n) => n.copias > 0), `${i.numero}: cada pieza de la escena quedó puesta`);
    return a;
  }
  return armarPieza(i.contenido.pieza);
}

const armadas = new Map<number, Armada>();
let globosTotales = 0;
for (const i of LOTE_01) {
  const a = armar(i);
  armadas.set(i.numero, a);
  assert.ok(a.globos.length > 0, `${i.numero}: tiene globos`);
  globosTotales += a.globos.length;
  for (const g of a.globos) {
    const formato = formatoPorId(g.formatoId);
    assert.ok(formato, `${i.numero}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${i.numero}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(Math.abs(infladoValido(formato, g.infladoCm) - g.infladoCm) < 1e-9, `${i.numero}: ${g.formatoId} inflado a ${g.infladoCm} cm cabe en su formato`);
  }
  for (const t of a.tubos.filter((x) => x.formatoId !== "papel")) assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${i.numero}: tubito ${t.formatoId} ${t.codigo} se fabrica`);
  // Los productos con código también existen en su formato.
  for (const p of i.productos) if (p.formato && p.codigo) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${i.numero}: producto ${p.formato} ${p.codigo} existe`);
}
console.log(`OK arman: ${globosTotales} globos, todos en colores que se fabrican en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Códigos y cantidades del 3D = los de sus productos
// ----------------------------------------------------------------------------------------------------------

const clave = (formato: string, codigo: string) => `${formato}|${codigo}`;
for (const i of LOTE_01) {
  const a = armadas.get(i.numero)!;
  const del3D = new Map(sumarMateriales(a.materiales).filter((m) => m.cantidad > 0).map((m) => [clave(m.formatoId, m.codigo), m.cantidad]));
  const conCodigo = new Map<string, number>();
  for (const p of i.productos) if (p.formato && p.codigo) conCodigo.set(clave(p.formato, p.codigo), (conCodigo.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad!);
  const impresos = i.productos.filter((p) => p.codigo === null).reduce((s, p) => s + p.cantidad!, 0);
  // Cada producto con código está en el 3D con su cantidad (±10 %; puede sumar el liso que reemplaza a un impreso de su color).
  for (const [k, cantidad] of conCodigo) {
    const hay = del3D.get(k) ?? 0;
    assert.ok(hay >= Math.floor(cantidad * 0.9) && hay <= Math.ceil(cantidad * 1.1) + impresos, `${i.numero}: ${k} — producto ${cantidad}, 3D ${hay}`);
  }
  // Lo que sobra en el 3D (códigos sin producto, o más de lo del producto) es solo el liso de los impresos.
  let sobra = 0;
  for (const [k, hay] of del3D) {
    const extra = hay - (conCodigo.get(k) ?? 0);
    if (extra > 0) sobra += extra;
    if (!conCodigo.has(k)) assert.ok(impresos > 0, `${i.numero}: ${k} está en el 3D sin ser de un producto (y la idea no tiene impresos)`);
  }
  assert.ok(Math.abs(sobra - impresos) <= Math.ceil(impresos * 0.1), `${i.numero}: los lisos que reemplazan a impresos (${sobra}) son los impresos contados (${impresos})`);
  // En total, lo que se compra = lo que se arma (±10 %).
  const total3D = [...del3D.values()].reduce((s, n) => s + n, 0);
  const totalProductos = i.productos.reduce((s, p) => s + p.cantidad!, 0);
  assert.ok(Math.abs(total3D - totalProductos) <= Math.max(1, totalProductos * 0.1), `${i.numero}: total 3D ${total3D} vs productos ${totalProductos}`);
}
console.log("OK códigos y cantidades: el 3D usa los productos de cada idea, en su cantidad");

// Lo contado en las fotos (lo que se miró con lupa): los ramos por piso y los arcos por niveles.
const globosDe = (n: number) => armadas.get(n)!.globos.length;
const contados: Record<number, number> = { 6: 10, 159: 15, 163: 12, 164: 12, 212: 11, 316: 16, 417: 12, 434: 10, 435: 12, 446: 14, 64: 88, 84: 96, 110: 208, 141: 176 };
for (const [n, esperado] of Object.entries(contados)) assert.equal(globosDe(Number(n)), esperado, `idea ${n}: ${esperado} globos contados`);
// El arco azul y rojo: 11 bloques de 2 cuartetos que empiezan y terminan en rojo (6 rojos y 5 azules).
const m64 = new Map(armadas.get(64)!.materiales.map((m) => [m.codigo, m.cantidad]));
assert.equal(m64.get("015"), 48, "arco 64: 6 bloques rojos de 2 cuartetos");
assert.equal(m64.get("038"), 40, "arco 64: 5 bloques azul caribe");
// El arco regalitos: 30 cuartetos, 12 moños y 4 R-5 en cada pie.
const e137 = LOTE_01.find((i) => i.numero === 137)!;
assert.ok(e137.contenido.tipo === "escena");
const a137 = armarEscena(e137.contenido.escena);
const monos137 = a137.porNodo.filter((n) => n.id.startsWith("mono-"));
assert.equal(monos137.length, 12, "arco 137: 12 moños");
assert.equal(a137.porNodo.find((n) => n.id === "pies")?.copias, 8, "arco 137: 4 R-5 en cada pie");
assert.equal(a137.porNodo.find((n) => n.id === "arco")?.globos.length, 120, "arco 137: 30 cuartetos");
// Los moños miran al frente (su cara, +y local, va hacia +z) y van por fuera de los globos (no enterrados en el hueco).
const frenteArco = a137.porNodo.find((n) => n.id === "arco")!.globos.reduce((z, g) => Math.max(z, g.nudo.z + g.direccion.z * g.infladoCm * 0.6), -Infinity) - 3;
for (const m of monos137) {
  assert.ok(m.puestas[0]!.marco.m[7] > 0.99, "arco 137: moño de frente");
  assert.ok(m.caja.max.z > frenteArco, `arco 137: ${m.id} asoma por delante de los cuartetos`);
}
// Las columnas apiladas: cada banda encima de la anterior, sin huecos ni montadas (por el centro de sus globos).
for (const n of [372, 432, 501]) {
  const idea = LOTE_01.find((i) => i.numero === n)!;
  assert.ok(idea.contenido.tipo === "escena");
  const a = armarEscena(idea.contenido.escena);
  const columnas = a.porNodo.filter((x) => idea.contenido.tipo === "escena" && idea.contenido.escena.nodos.find((y) => y.id === x.id)?.pieza.tipo === "columna");
  for (let k = 1; k < columnas.length; k++) {
    const abajo = columnas[k - 1]!.caja, arriba = columnas[k]!.caja;
    assert.ok(arriba.min.y > abajo.min.y && arriba.min.y < abajo.max.y + 2, `idea ${n}: «${columnas[k]!.nombre}» va justo encima de «${columnas[k - 1]!.nombre}»`);
  }
  const remate = a.porNodo[a.porNodo.length - 1]!;
  assert.ok(remate.caja.max.y > Math.max(...columnas.map((c) => c.caja.max.y)), `idea ${n}: el remate queda arriba`);
}
console.log("OK conteos: ramos por piso, arcos por niveles, 12 moños de frente y columnas apiladas");

// ----------------------------------------------------------------------------------------------------------
// 4. La biblioteca las incluye con su fuente
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_01) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.numero}: está en BIBLIOTECA_FABRICA`);
  assert.equal(item.fuente?.tipo, "idea-sempertex", `${i.numero}: fuente idea-sempertex`);
  assert.equal(item.fuente?.url, urlDeIdea(i.slug), `${i.numero}: url de la idea`);
  assert.equal(item.fuente?.fotoUrl, i.fotoUrl, `${i.numero}: foto de la idea`);
  assert.equal(item.descripcion, i.nota, `${i.numero}: la nota es su descripción`);
  assert.equal(item.tipo, i.contenido.tipo === "escena" ? "escena" : i.contenido.pieza.tipo === "decoracion" ? "decoracion" : "estructura", `${i.numero}: tipo de item`);
  // Su lista de compra sale (cada globo con nombre y url de la tienda).
  const lista = productosDe(item);
  const firma = (xs: ReadonlyArray<{ formatoId: string; codigo: string; cantidad: number }>) => xs.map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
  assert.deepEqual(firma(lista.globos), firma(sumarMateriales(armadas.get(i.numero)!.materiales).filter((m) => m.cantidad > 0)), `${i.numero}: productosDe da sus mismos globos`);
  assert.ok(lista.globos.every((g) => g.producto.url.startsWith("https://")), `${i.numero}: cada globo con su producto de la tienda`);
}
const completa = bibliotecaCompleta();
const derivados = completa.filter((x) => x.apareceEn?.some((o) => LOTE_01.some((i) => i.id === o.itemId)));
assert.ok(derivados.length >= 6, `lo de las escenas del lote se indexa (${derivados.length} items)`);
console.log(`OK biblioteca: las 20 con su fuente; ${derivados.length} items derivados de sus escenas`);

// ----------------------------------------------------------------------------------------------------------
// 5. Cruce con los datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json"))) {
  type IdeaV3 = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ url: string; nombre: string; tipo: string; formato: string | null; codigo: string | null }> };
  const v3 = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaV3[];
  const lote = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-01.json"), "utf8")) as number[];
  assert.deepEqual(lote, NUMEROS, "clasif/lote-01.json");
  for (const i of LOTE_01) {
    const d = v3[i.numero - 1]!;
    assert.equal(d.slug, i.slug, `${i.numero}: slug del índice`);
    assert.equal(d.imagenes[0], i.fotoUrl, `${i.numero}: la primera imagen del índice`);
    for (const p of d.productos_mapeados ?? []) {
      const mio = i.productos.find((x) => x.url === p.url);
      assert.ok(mio, `${i.numero}: el producto publicado «${p.nombre}» está`);
      assert.equal(mio.nombre, p.nombre, `${i.numero}: nombre exacto`);
      assert.equal(mio.codigo, p.codigo, `${i.numero}: código exacto de «${p.nombre}»`);
      // El mapeo de la tienda pone «C-12» a impresos redondos (Infinity® «GLOBO REDONDO …»): la foto manda.
      if (p.formato && !(p.codigo === null && p.nombre.includes("REDONDO"))) assert.ok(i.productos.some((x) => x.url === p.url && x.formato === p.formato), `${i.numero}: formato de «${p.nombre}»`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: se omite el cruce)");

console.log("OK test-ideas-lote-01");
