/**
 * Lote 02 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-02.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 20 del lote (`clasif/lote-02.json`), con id «idea:<slug>», en orden y sin repetir;
 * - cada idea arma (escena sin avisos, nada bajo el piso ni fuera de la sala) y cada globo y tubito usa un color que
 *   se fabrica en su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos, y al revés: cada producto con cantidad sale en el
 *   3D; cuando la idea publica productos, los publicados van tal cual (nombre y url);
 * - las cantidades del 3D cuadran con las de los productos: exactas con las contadas en la foto y ±10 % con las
 *   publicadas;
 * - las fotos son https del CDN de Sempertex y la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente; al
 *   indexar, lo de sus escenas sale como items que apuntan a ellas, con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_02 } from "../../src/lib/globos3d/ideas-sempertex/lote-02";
import { urlDeIdea, type IdeaDigitalizada } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { BIBLIOTECA_FABRICA, OCASIONES, indexarEscena } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [503, 505, 506, 531, 544, 550, 557, 559, 560, 561, 562, 563, 593, 594, 597, 598, 600, 603, 606, 609];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 20 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_02.map((i) => i.numero), NUMEROS, "los 20 números del lote 02, en orden");
assert.equal(new Set(LOTE_02.map((i) => i.id)).size, 20, "ids sin repetir");
for (const i of LOTE_02) {
  assert.equal(i.id, `idea:${i.slug}`, `${i.numero}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 80, `${i.numero}: nombre y nota`);
  assert.ok(/Igual:/.test(i.nota) && /Distinto:/.test(i.nota), `${i.numero}: la nota dice qué quedó igual y qué no`);
  assert.ok(i.ocasiones.length > 0 && i.ocasiones.every((o) => OCASIONES.includes(o)), `${i.numero}: ocasiones de la lista (${i.ocasiones.join(", ")})`);
  const foto = new URL(i.fotoUrl);
  assert.equal(foto.protocol, "https:", `${i.numero}: foto https`);
  assert.ok((foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/")) || foto.hostname === "cdn.shopify.com", `${i.numero}: foto del CDN de Sempertex`);
}
console.log("OK lote: 20 ideas con id, nombre, nota, ocasiones y foto https del CDN");

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<string, EscenaArmada | null>();
const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
/** Materiales del 3D por formato y código. */
const materialesDe = new Map<string, Map<string, number>>();

for (const i of LOTE_02) {
  const que = `${i.numero} ${i.slug}`;
  const armada = i.contenido.tipo === "escena" ? armarEscena(i.contenido.escena) : null;
  armadas.set(i.id, armada);
  const pieza = i.contenido.tipo === "pieza" ? armarPieza(i.contenido.pieza) : null;
  const globos = armada ? armada.globos : pieza!.globos;
  const tubos = armada ? armada.tubos : pieza!.tubos;
  const materiales = armada ? armada.materiales : pieza!.materiales;
  if (armada) {
    assert.deepEqual(armada.avisos, [], `${que}: arma sin avisos`);
    assert.ok(armada.porNodo.every((n) => n.copias > 0), `${que}: cada pieza quedó puesta`);
    const sala = armada.sala;
    for (const n of armada.porNodo) {
      assert.ok(n.caja.min.y >= -1, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
      assert.ok(n.caja.max.y <= sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo (${n.caja.max.y.toFixed(1)})`);
      assert.ok(Math.abs(n.caja.min.x) <= sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
      assert.ok(n.caja.min.z >= -sala.fondoCm / 2 - 1 && n.caja.max.z <= sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo`);
    }
    assert.equal(new Set(i.contenido.tipo === "escena" ? i.contenido.escena.nodos.map((n) => n.nombre) : []).size, i.contenido.tipo === "escena" ? i.contenido.escena.nodos.length : 0, `${que}: nombres de nodo sin repetir`);
  }
  assert.ok(globos.length > 0, `${que}: tiene globos`);
  for (const g of globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f, `${que}: formato ${g.formatoId}`);
    assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${que}: ${g.formatoId} ${g.codigo} se fabrica`);
    assert.ok(g.infladoCm >= f!.diametroMaxCm * 0.4 - 0.01 && g.infladoCm <= f!.diametroMaxCm + 0.01, `${que}: ${g.formatoId} inflado a ${g.infladoCm} cm`);
  }
  for (const t of tubos.filter((x) => !x.papel)) {
    const f = formatoPorId(t.formatoId);
    assert.ok(f && f.tipo === "tubito", `${que}: tubito ${t.formatoId}`);
    assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${que}: ${t.formatoId} ${t.codigo} se fabrica`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 0.01, `${que}: ${t.formatoId} de ${t.grosorCm} cm de grueso`);
  }
  const porClave = new Map<string, number>();
  for (const m of materiales) porClave.set(clave(m.formatoId, m.codigo), (porClave.get(clave(m.formatoId, m.codigo)) ?? 0) + m.cantidad);
  materialesDe.set(i.id, porClave);
}
console.log(`OK armado: ${LOTE_02.length} ideas sin avisos, dentro de su sala y con colores que existen en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

let contadas = 0, publicadas = 0;
for (const i of LOTE_02) {
  const que = `${i.numero} ${i.slug}`;
  const del3D = materialesDe.get(i.id)!;
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/") || p.url.startsWith("/search?q="), `${que}: «${p.nombre}» con url relativa de la tienda`);
    if (p.codigo !== null && p.formato !== null) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: ${p.formato} ${p.codigo} del producto se fabrica`);
    if (p.cantidad !== null) assert.ok(p.cantidad > 0 && p.codigo !== null && p.formato !== null, `${que}: «${p.nombre}» con cantidad dice formato y código`);
  }
  // Lo que pide la foto (productos con cantidad), sumado por formato y código.
  const pedidos = new Map<string, { cantidad: number; contada: boolean }>();
  for (const p of i.productos.filter((x) => x.cantidad !== null)) {
    const k = clave(p.formato, p.codigo);
    const previo = pedidos.get(k) ?? { cantidad: 0, contada: true };
    pedidos.set(k, { cantidad: previo.cantidad + p.cantidad!, contada: previo.contada && Boolean(p.contada) });
  }
  for (const [k, n] of del3D) assert.ok(pedidos.has(k), `${que}: ${k} del 3D (×${n}) es de un producto de la idea`);
  for (const [k, p] of pedidos) {
    const n = del3D.get(k) ?? 0;
    if (p.contada) { contadas++; assert.equal(n, p.cantidad, `${que}: ${k} contado ×${p.cantidad}, en el 3D ×${n}`); }
    else { publicadas++; assert.ok(Math.abs(n - p.cantidad) <= Math.max(0.1 * p.cantidad, 0.5), `${que}: ${k} publicado ×${p.cantidad}, en el 3D ×${n} (±10 %)`); }
  }
}
console.log(`OK productos: ${contadas} líneas contadas en la foto cuadran exactas con el 3D (${publicadas} publicadas, ±10 %)`);

// ----------------------------------------------------------------------------------------------------------
// 4. Datos locales del índice (si están): slug, foto y productos publicados tal cual
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-02.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-02.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-02.json");
  for (const i of LOTE_02) {
    const c = clasif.find((x) => x.numero === i.numero);
    assert.equal(c?.slug, i.slug, `${i.numero}: slug del índice`);
    const datos = ideas.find((x) => x.slug === i.slug);
    assert.ok(datos, `${i.slug}: está en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos!.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    // Cada producto publicado sale tal cual (nombre y url); el formato y el código, salvo los corregidos con la foto.
    for (const m of datos!.productos_mapeados ?? []) {
      assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.url === m.url), `${i.slug}: publica «${m.nombre}» y está en sus productos`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else {
  console.log("(sin los datos locales del índice: no se cruzan)");
}

// ----------------------------------------------------------------------------------------------------------
// 5. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_02) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.tipo, i.contenido.tipo === "escena" ? "escena" : clasePara(i), `${i.id}: tipo de item`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.ok(item!.fuente?.titulo.includes(i.nombre), `${i.id}: título de la fuente`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
  if (item!.contenido.tipo === "escena") {
    const hijos = indexarEscena(item!, armadas.get(i.id) ?? undefined);
    assert.ok(hijos.length > 0 && hijos.every((h) => h.apareceEn?.[0]?.itemId === i.id), `${i.id}: lo de su escena sale y apunta a ella`);
    const nombres = hijos.map((h) => `${h.tipo}|${h.nombre}`);
    assert.equal(new Set(nombres).size, nombres.length, `${i.id}: nombres sin repetir (${nombres.join(", ")})`);
    derivados += hijos.length;
  }
}
console.log(`OK biblioteca: las 20 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas`);

function clasePara(i: IdeaDigitalizada): string {
  return i.contenido.tipo === "pieza" && (i.contenido.pieza.tipo === "decoracion" || i.contenido.pieza.tipo === "globo") ? "decoracion" : "estructura";
}
