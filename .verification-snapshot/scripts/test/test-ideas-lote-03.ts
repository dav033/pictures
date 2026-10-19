/**
 * Lote 03 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-03.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 20 del lote (`clasif/lote-03.json`), con id «idea:<slug>», en orden y sin repetir;
 * - cada idea arma (escena sin avisos; pieza con globos) y cada globo y tubito usa un color que se fabrica en su
 *   formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D son los de sus productos (nombre, url, formato y código tal cual): lo que no es de un producto con
 *   código solo puede ser el liso que reemplaza a un impreso; el graffiti transparente de un doble globo no se dibuja
 *   (se ve el liso de dentro, que es otro producto de la lista); las cantidades cuadran (±10 %), por producto y en total;
 * - los ramos van por pisos PLANOS (todos los globos de un piso a la misma altura, un piso cada ~29 cm) con los globos
 *   contados en la foto, y las estructuras con lo contado (bandas, flores, nodos de la malla);
 * - las fotos son https del CDN de Sempertex y la biblioteca las incluye con su fuente, sin ids repetidos: las que ya
 *   entraron desde `ideas-impresos.ts` con el mismo id quedan en `LOTE_03_REPETIDAS` (fuera de `LOTE_03`).
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_03, LOTE_03_COMPLETO, LOTE_03_REPETIDAS } from "../../src/lib/globos3d/ideas-sempertex/lote-03";
import { IDEAS_SEMPERTEX } from "../../src/lib/globos3d/ideas-sempertex";
import { urlDeIdea, type IdeaDigitalizada } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";
import { coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, bibliotecaCompleta, productosDe } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [627, 630, 632, 641, 642, 659, 665, 682, 694, 708, 728, 729, 735, 740, 798, 818, 819, 873, 894, 895];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 20 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_03_COMPLETO.map((i) => i.numero), NUMEROS, "los 20 números del lote 03, en orden");
assert.equal(new Set(LOTE_03_COMPLETO.map((i) => i.id)).size, 20, "ids sin repetir");
for (const i of LOTE_03_COMPLETO) {
  assert.equal(i.id, `idea:${i.slug}`, `${i.numero}: id «idea:<slug>»`);
  assert.ok(i.nombre.trim().length > 3 && i.nota.trim().length > 80, `${i.numero}: nombre y nota`);
  assert.ok(i.nota.includes("Igual:") && i.nota.includes("Distinto:"), `${i.numero}: la nota dice qué quedó igual y qué no`);
  assert.ok(i.ocasiones.length > 0 && i.ocasiones.every((o) => OCASIONES.includes(o)), `${i.numero}: ocasiones de la lista (${i.ocasiones.join(", ")})`);
  const foto = new URL(i.fotoUrl);
  assert.equal(foto.protocol, "https:", `${i.numero}: foto https`);
  assert.ok(foto.hostname === "sempertex.com" && foto.pathname.startsWith("/cdn/"), `${i.numero}: foto del CDN de Sempertex`);
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

type Armada = { materiales: MaterialDecoracion[]; globos: Array<{ formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number }; direccion: { x: number; y: number; z: number } }>; tubos: Array<{ formatoId: string; codigo: string }> };
const escenas = new Map<number, EscenaArmada>();
function armar(i: IdeaDigitalizada): Armada {
  if (i.contenido.tipo === "escena") {
    const a = armarEscena(i.contenido.escena);
    assert.deepEqual(a.avisos, [], `${i.numero}: la escena arma sin avisos`);
    assert.ok(a.porNodo.every((n) => n.copias > 0), `${i.numero}: cada pieza de la escena quedó puesta`);
    escenas.set(i.numero, a);
    return a;
  }
  return armarPieza(i.contenido.pieza);
}

const armadas = new Map<number, Armada>();
let globosTotales = 0;
for (const i of LOTE_03_COMPLETO) {
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
  for (const p of i.productos) if (p.formato && p.codigo) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${i.numero}: producto ${p.formato} ${p.codigo} existe`);
}
console.log(`OK arman: ${globosTotales} globos, todos en colores que se fabrican en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Códigos y cantidades del 3D = los de sus productos
// ----------------------------------------------------------------------------------------------------------

/** El graffiti transparente de un doble globo («Graffiti Invierno + Fashion Verde»): por fuera; se ve el liso de dentro. */
const esEnvoltura = (p: IdeaDigitalizada["productos"][number]) => p.codigo === null && p.nombre.includes("GRAFFITI") && p.nombre.includes("TRANSPARENTE");
/** 873: los 5 pétalos son UN R-12 torcido en burbujas (se compra 1); el 3D dibuja 5 R-12 al mínimo. */
const PETALOS_DE_UN_GLOBO: Readonly<Record<number, { clave: string; en3D: number }>> = { 873: { clave: "R-12|005", en3D: 5 } };

const clave = (formato: string, codigo: string) => `${formato}|${codigo}`;
for (const i of LOTE_03_COMPLETO) {
  const a = armadas.get(i.numero)!;
  const del3D = new Map(sumarMateriales(a.materiales).filter((m) => m.cantidad > 0).map((m) => [clave(m.formatoId, m.codigo), Math.ceil(m.cantidad - 1e-9)]));
  const torcido = PETALOS_DE_UN_GLOBO[i.numero];
  const conCodigo = new Map<string, number>();
  for (const p of i.productos) if (p.formato && p.codigo) conCodigo.set(clave(p.formato, p.codigo), (conCodigo.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad!);
  if (torcido) { assert.equal(conCodigo.get(torcido.clave), 1, `${i.numero}: se compra 1 globo para los pétalos`); conCodigo.set(torcido.clave, torcido.en3D); }
  const impresos = i.productos.filter((p) => p.codigo === null && !esEnvoltura(p)).reduce((s, p) => s + p.cantidad!, 0);
  for (const [k, cantidad] of conCodigo) {
    const hay = del3D.get(k) ?? 0;
    assert.ok(hay >= Math.floor(cantidad * 0.9) && hay <= Math.ceil(cantidad * 1.1) + impresos, `${i.numero}: ${k} — producto ${cantidad}, 3D ${hay}`);
  }
  let sobra = 0;
  for (const [k, hay] of del3D) {
    const extra = hay - (conCodigo.get(k) ?? 0);
    if (extra > 0) sobra += extra;
    if (!conCodigo.has(k)) assert.ok(impresos > 0, `${i.numero}: ${k} está en el 3D sin ser de un producto (y la idea no tiene impresos)`);
  }
  assert.ok(Math.abs(sobra - impresos) <= Math.ceil(impresos * 0.1), `${i.numero}: los lisos que reemplazan a impresos (${sobra}) son los impresos contados (${impresos})`);
  // Cada envoltura de graffiti tiene su liso de dentro en la lista, en la misma cantidad.
  for (const p of i.productos.filter(esEnvoltura)) assert.ok(i.productos.some((x) => x.codigo !== null && x.cantidad === p.cantidad), `${i.numero}: «${p.nombre}» lleva su liso de dentro`);
  const total3D = [...del3D.values()].reduce((s, n) => s + n, 0) - (torcido ? torcido.en3D - 1 : 0);
  const totalProductos = i.productos.filter((p) => !esEnvoltura(p)).reduce((s, p) => s + p.cantidad!, 0);
  assert.ok(Math.abs(total3D - totalProductos) <= Math.max(1, totalProductos * 0.1), `${i.numero}: total 3D ${total3D} vs productos ${totalProductos}`);
}
console.log("OK códigos y cantidades: el 3D usa los productos de cada idea, en su cantidad");

// ----------------------------------------------------------------------------------------------------------
// 4. Lo contado en las fotos
// ----------------------------------------------------------------------------------------------------------

/** Ramos: globos por piso, de arriba abajo (lo contado en la foto, con los que asoman por detrás). */
const PISOS: Readonly<Record<number, number[]>> = {
  627: [2, 3, 2, 3, 3], 641: [3, 3, 3], 642: [4, 3, 3, 3], 659: [3, 3, 3, 3], 665: [3, 3, 3], 694: [3, 2, 3, 3], 735: [3, 2, 3, 3],
  740: [3, 3, 3, 3], 798: [4, 3, 4, 3], 818: [3, 3, 3, 3], 819: [3, 2, 4, 3], 894: [3, 2, 3, 3], 895: [3, 2, 4],
};
for (const [n, pisos] of Object.entries(PISOS)) {
  const a = escenas.get(Number(n));
  assert.ok(a, `ramo ${n}: es una escena`);
  // El centro del cuerpo de cada globo, agrupado por altura: cada piso es plano.
  const alturas = a.globos.map((g) => Math.round((g.nudo.y + g.direccion.y * centroCuerpo("redondo", g.infladoCm)) * 10) / 10);
  const porAltura = new Map<number, number>();
  for (const y of alturas) porAltura.set(y, (porAltura.get(y) ?? 0) + 1);
  const deArriba = [...porAltura.entries()].sort((x, y) => y[0] - x[0]);
  assert.deepEqual(deArriba.map(([, k]) => k), pisos, `ramo ${n}: pisos planos con ${pisos.join(" + ")} globos`);
  for (let k = 1; k < deArriba.length; k++) {
    const paso = deArriba[k - 1]![0] - deArriba[k]![0];
    assert.ok(paso >= 27 && paso <= 31, `ramo ${n}: un piso cada ~29 cm (${paso})`);
  }
  // Cada globo con su cinta al peso.
  const cintas = a.solidos.filter((s) => s.forma === "cilindro" && s.radioCm < 1).length;
  assert.equal(cintas, a.globos.length, `ramo ${n}: una cinta por globo`);
}
const globosDe = (n: number) => armadas.get(n)!.globos.length;
const contados: Record<number, number> = { 630: 11, 632: 20, 682: 49, 708: 99, 728: 11, 729: 11, 873: 5 };
for (const [n, esperado] of Object.entries(contados)) assert.equal(globosDe(Number(n)), esperado, `idea ${n}: ${esperado} globos`);
// 682: los 12 cuartetos van encima del balón (3 rojos, 3 azules, 6 amarillos, de abajo arriba).
{
  const a = escenas.get(682)!;
  const balon = a.porNodo.find((x) => x.id === "balon")!;
  const bandas = ["rojo", "azul", "amarillo"].map((id) => a.porNodo.find((x) => x.id === id)!);
  assert.deepEqual(bandas.map((b) => b.globos.length), [12, 12, 24], "682: 3 + 3 + 6 cuartetos");
  assert.ok(bandas[0]!.caja.min.y > balon.caja.min.y + 40, "682: la columna empieza sobre el balón");
  for (let k = 1; k < 3; k++) assert.ok(bandas[k]!.caja.min.y > bandas[k - 1]!.caja.min.y && bandas[k]!.caja.min.y < bandas[k - 1]!.caja.max.y + 2, `682: «${bandas[k]!.nombre}» va justo encima`);
}
// 708: 13 R-5 verdes delante de la malla, en los nodos de dentro.
{
  const a = escenas.get(708)!;
  const verdes = a.porNodo.filter((x) => x.id.startsWith("verde-"));
  assert.equal(verdes.length, 13, "708: 13 nodos verdes");
  const malla = a.porNodo.find((x) => x.id === "malla")!;
  for (const x of verdes) assert.ok(x.caja.max.z > malla.caja.max.z - 6, `708: ${x.id} asoma por delante de la malla`);
}
// 632: dos flores de 5 R-5 a los lados y el R-24 encima de los cuartetos.
{
  const a = escenas.get(632)!;
  assert.equal(a.porNodo.filter((x) => x.id.startsWith("flor-")).reduce((s, x) => s + x.globos.length, 0), 10, "632: 2 flores de 5 R-5");
  const gigante = a.porNodo.find((x) => x.id === "gigante")!;
  const arriba = a.porNodo.find((x) => x.id === "nivel-2")!;
  assert.ok(gigante.caja.min.y > arriba.caja.min.y && gigante.caja.max.y > arriba.caja.max.y + 40, "632: el R-24 encima");
}
console.log("OK conteos: ramos por pisos planos, cuartetos sobre el balón, nodos de la malla y flores");

// ----------------------------------------------------------------------------------------------------------
// 5. La biblioteca las incluye con su fuente
// ----------------------------------------------------------------------------------------------------------

// Ninguna idea del lote repite el id de otra de la biblioteca: las que ya están (desde ideas-impresos.ts) quedan aparte.
assert.equal(LOTE_03.length + LOTE_03_REPETIDAS.length, 20, "el lote entero, entre las que entran y las repetidas");
for (const i of LOTE_03_REPETIDAS) assert.equal(IDEAS_SEMPERTEX.filter((x) => x.id === i.id).length, 1, `${i.numero}: ya está una vez en la biblioteca (otra fuente)`);
for (const i of LOTE_03) assert.equal(IDEAS_SEMPERTEX.filter((x) => x.id === i.id).length, 1, `${i.numero}: una sola vez en IDEAS_SEMPERTEX`);
for (const i of LOTE_03) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.numero}: está en BIBLIOTECA_FABRICA`);
  assert.equal(item.fuente?.tipo, "idea-sempertex", `${i.numero}: fuente idea-sempertex`);
  assert.equal(item.fuente?.url, urlDeIdea(i.slug), `${i.numero}: url de la idea`);
  assert.equal(item.fuente?.fotoUrl, i.fotoUrl, `${i.numero}: foto de la idea`);
  assert.equal(item.descripcion, i.nota, `${i.numero}: la nota es su descripción`);
  assert.equal(item.tipo, i.contenido.tipo === "escena" ? "escena" : i.contenido.pieza.tipo === "decoracion" ? "decoracion" : "estructura", `${i.numero}: tipo de item`);
  const lista = productosDe(item);
  const firma = (xs: ReadonlyArray<{ formatoId: string; codigo: string; cantidad: number }>) => xs.map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
  assert.deepEqual(firma(lista.globos), firma(sumarMateriales(armadas.get(i.numero)!.materiales).filter((m) => m.cantidad > 0)), `${i.numero}: productosDe da sus mismos globos`);
  assert.ok(lista.globos.every((g) => g.producto.url.startsWith("https://")), `${i.numero}: cada globo con su producto de la tienda`);
}
const completa = bibliotecaCompleta();
const derivados = completa.filter((x) => x.apareceEn?.some((o) => LOTE_03.some((i) => i.id === o.itemId)));
assert.ok(derivados.length >= 10, `lo de las escenas del lote se indexa (${derivados.length} items)`);
console.log(`OK biblioteca: ${LOTE_03.length} con su fuente (${LOTE_03_REPETIDAS.map((i) => i.numero).join(", ") || "ninguna"} ya estaban con el mismo id); ${derivados.length} items derivados de sus escenas`);

// ----------------------------------------------------------------------------------------------------------
// 6. Cruce con los datos locales del índice (si están)
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json"))) {
  type IdeaV3 = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ url: string; nombre: string; tipo: string; formato: string | null; codigo: string | null }> };
  const v3 = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaV3[];
  const lote = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-03.json"), "utf8")) as number[];
  assert.deepEqual(lote, NUMEROS, "clasif/lote-03.json");
  for (const i of LOTE_03_COMPLETO) {
    const d = v3[i.numero - 1]!;
    assert.equal(d.slug, i.slug, `${i.numero}: slug del índice`);
    assert.equal(d.imagenes[0], i.fotoUrl, `${i.numero}: la primera imagen del índice`);
    for (const p of d.productos_mapeados ?? []) {
      const mio = i.productos.find((x) => x.url === p.url);
      assert.ok(mio, `${i.numero}: el producto publicado «${p.nombre}» está`);
      assert.equal(mio.nombre, p.nombre, `${i.numero}: nombre exacto`);
      assert.equal(mio.codigo, p.codigo, `${i.numero}: código exacto de «${p.nombre}»`);
      // Los impresos y surtidos (sin código) llevan la talla que muestra la foto (el balón y la columna de 682).
      if (p.formato && p.codigo !== null) assert.equal(mio.formato, p.formato, `${i.numero}: formato de «${p.nombre}»`);
    }
  }
  console.log("OK índice local: slugs, fotos y productos publicados tal cual");
} else console.log("(sin los datos locales del índice: se omite el cruce)");

console.log("OK test-ideas-lote-03");
