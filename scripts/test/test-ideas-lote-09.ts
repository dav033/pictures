/**
 * Lote 09 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-09.ts`): las que
 * dependen de los murales pixelados, el techo y las palmeras y árboles. Sin coste: no llama a ninguna IA ni a la red.
 * - son las 10 del lote, con id «idea:<slug>», en orden y sin repetir; ocasiones de sus etiquetas (`ocasionesDeEtiquetas`)
 *   y la foto de su fuente (`fuenteIdea`); la nota dice qué quedó igual y qué no;
 * - usan los generadores nuevos: 4 murales, 2 de techo y 4 palmeras o árboles;
 * - cada idea arma donde va (el mural en la pared del fondo apoyado en el piso, lo de techo pegado al techo, los árboles
 *   de pie), sin avisos, dentro de la sala, y cada globo y tubito usa un color que se fabrica en su formato;
 * - los murales reproducen su matriz (un globo por celda con color) y sus colores son los publicados (más el blanco del
 *   corazón de #824, que la idea no publica);
 * - los productos: cada línea del 3D (formato + código) con su cantidad exacta; lo publicado va tal cual (nombre y url);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El índice antes que el lote: el lote toma `ocasionesDeEtiquetas` del índice, que a su vez importa el lote.
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { LOTE_09 } from "../../src/lib/globos3d/ideas-sempertex/lote-09";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, SALA_INICIAL, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { armarMural, celdasMural } from "../../src/lib/globos3d/murales";
import { BIBLIOTECA_FABRICA, OCASIONES } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [770, 158, 824, 773, 536, 697, 816, 817, 48, 53];

// ----------------------------------------------------------------------------------------------------------
// 1. Las 10 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_09.map((i) => i.numero), NUMEROS, "los 10 números del lote 09, en orden");
assert.equal(new Set(LOTE_09.map((i) => i.id)).size, NUMEROS.length, "ids sin repetir");
for (const i of LOTE_09) {
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
// Los generadores nuevos: 4 murales, 2 de techo y 4 palmeras o árboles.
const tipos = LOTE_09.map((i) => (i.contenido.tipo === "pieza" ? i.contenido.pieza.tipo : [...new Set(i.contenido.escena.nodos.map((n) => n.pieza.tipo))].join("+")));
assert.deepEqual(tipos, ["mural", "mural", "mural", "mural", "techo", "techo", "arbol_globos", "arbol_globos", "arbol_globos", "arbol_globos"], "cada idea con su generador");
console.log(`OK lote: ${LOTE_09.length} ideas con id, nombre, nota, ocasiones de sus etiquetas y su foto; 4 murales, 2 de techo y 4 árboles`);

// ----------------------------------------------------------------------------------------------------------
// 2. Cada idea arma donde va, con colores que existen en su formato
// ----------------------------------------------------------------------------------------------------------

const clave = (formatoId: string | null, codigo: string | null) => `${formatoId}|${codigo}`;
const armadas = new Map<string, EscenaArmada>();
for (const i of LOTE_09) {
  const que = `${i.numero} ${i.slug}`;
  const escena = i.contenido.tipo === "escena"
    ? i.contenido.escena
    : { sala: SALA_INICIAL, nodos: [{ id: "pieza", nombre: i.nombre, pieza: i.contenido.pieza, colocacion: i.contenido.sugerida! }] };
  if (i.contenido.tipo === "pieza") {
    assert.ok(i.contenido.sugerida, `${que}: dice dónde va`);
    const donde = i.contenido.sugerida!.en;
    const esperado = i.contenido.pieza.tipo === "mural" ? "pared" : i.contenido.pieza.tipo === "techo" ? "techo" : "piso";
    assert.equal(donde, esperado, `${que}: va en ${esperado}`);
  }
  const armada = armarEscena(escena);
  armadas.set(i.id, armada);
  assert.deepEqual(armada.avisos, [], `${que}: arma sin avisos`);
  const sala = armada.sala;
  for (const n of armada.porNodo) {
    assert.ok(n.copias > 0, `${que}: «${n.nombre}» quedó puesta`);
    assert.ok(n.caja.min.y >= -1, `${que}: «${n.nombre}» no se hunde en el piso (${n.caja.min.y.toFixed(1)})`);
    assert.ok(n.caja.max.y <= sala.altoCm + 1, `${que}: «${n.nombre}» cabe bajo el techo (${n.caja.max.y.toFixed(1)})`);
    assert.ok(Math.abs(n.caja.min.x) <= sala.anchoCm / 2 + 1 && Math.abs(n.caja.max.x) <= sala.anchoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo ancho`);
    assert.ok(n.caja.min.z >= -sala.fondoCm / 2 - 1 && n.caja.max.z <= sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo`);
    const pieza = escena.nodos.find((x) => x.id === n.id)!.pieza;
    if (pieza.tipo === "mural" || pieza.tipo === "arbol_globos") assert.ok(Math.abs(n.caja.min.y) < 0.6, `${que}: «${n.nombre}» apoyado en el piso`);
    if (pieza.tipo === "techo") assert.ok(Math.abs(n.caja.max.y - sala.altoCm) < 0.6, `${que}: «${n.nombre}» pegado al techo`);
    if (pieza.tipo === "mural") assert.ok(Math.abs(n.caja.min.z + sala.fondoCm / 2) < 1, `${que}: «${n.nombre}» contra la pared del fondo`);
  }
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
  }
}
console.log("OK armado: cada idea donde va (pared, techo o piso), sin avisos, dentro de su sala y con colores que existen");

// ----------------------------------------------------------------------------------------------------------
// 3. Los murales: su matriz, con los colores publicados
// ----------------------------------------------------------------------------------------------------------

const BLANCO_NO_PUBLICADO = new Map([[824, "005"]]);
for (const i of LOTE_09) {
  if (i.contenido.tipo !== "pieza" || i.contenido.pieza.tipo !== "mural") continue;
  const m = i.contenido.pieza.mural;
  const armado = armarMural(m);
  assert.deepEqual(armado.avisos, [], `${i.numero}: la matriz no pone color en los huecos de su disposición`);
  const { celdas } = celdasMural(m);
  const conGlobo = celdas.filter((c) => c.codigo !== null);
  const deRed = armado.globos.length - (m.encima ?? []).reduce((s, e) => s + e.puntos.length, 0);
  assert.equal(deRed, conGlobo.reduce((s, c) => s + (c.rol === "union" ? 2 : 1), 0), `${i.numero}: un globo por celda con color (dos en cada unión)`);
  for (const c of m.matriz.colores) assert.ok(i.productos.some((p) => p.codigo === c && (p.formato === m.grande.formatoId || p.formato === m.chico?.formatoId)), `${i.numero}: el color ${c} de la matriz está en sus productos`);
  assert.ok(m.matriz.filas.length >= 13 && m.matriz.filas[0]!.length >= 17, `${i.numero}: la matriz trae la resolución de la foto (${m.matriz.filas[0]!.length} × ${m.matriz.filas.length})`);
}
console.log("OK murales: un globo por celda de la matriz");

// ----------------------------------------------------------------------------------------------------------
// 4. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

let lineas = 0;
for (const i of LOTE_09) {
  const que = `${i.numero} ${i.slug}`;
  const del3D = new Map<string, number>();
  for (const m of armadas.get(i.id)!.materiales) del3D.set(clave(m.formatoId, m.codigo), (del3D.get(clave(m.formatoId, m.codigo)) ?? 0) + m.cantidad);
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  for (const p of i.productos) {
    assert.ok(p.nombre.startsWith("GLOBO "), `${que}: «${p.nombre}» es un globo de la tienda`);
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url relativa de la tienda`);
    if (p.codigo !== null && p.formato !== null) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: ${p.formato} ${p.codigo} del producto se fabrica`);
    if (p.cantidad !== null) assert.ok(p.cantidad > 0 && Number.isInteger(p.cantidad) && p.contada === true && p.codigo !== null && p.formato !== null, `${que}: «${p.nombre}» con cantidad contada dice formato y código`);
  }
  const pedidos = new Map<string, number>();
  for (const p of i.productos.filter((x) => x.cantidad !== null)) pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad!);
  for (const [k, n] of del3D) assert.ok(pedidos.has(k), `${que}: ${k} del 3D (×${n}) está en sus productos`);
  for (const [k, cantidad] of pedidos) {
    const n = del3D.get(k) ?? 0;
    const tubito = formatoPorId(k.split("|")[0]!)?.tipo === "tubito";
    if (tubito) assert.equal(Math.ceil(n - 1e-9), cantidad, `${que}: ${k} ×${cantidad}, en el 3D ${n.toFixed(2)} tubitos`);
    else assert.equal(n, cantidad, `${que}: ${k} ×${cantidad}, en el 3D ×${n}`);
    lineas++;
  }
}
console.log(`OK productos: ${lineas} líneas cuadran exactas con el 3D`);

// ----------------------------------------------------------------------------------------------------------
// 5. Datos locales del índice (si están): slug, foto y productos publicados tal cual
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "todas.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string; complejidad: number; falta: string }>;
  for (const i of LOTE_09) {
    const c = clasif.find((x) => x.numero === i.numero);
    assert.equal(c?.slug, i.slug, `${i.numero}: slug del índice`);
    assert.ok(c!.complejidad <= 3, `${i.numero}: complejidad ≤ 3`);
    assert.ok(/mural|pixel|bandera|logo|techo|colgante|palmera|[áa]rbol/i.test(c!.falta), `${i.numero}: le faltaba un generador nuevo («${c!.falta}»)`);
    const datos = ideas.find((x) => x.slug === i.slug);
    assert.ok(datos, `${i.slug}: está en ideas-v3.json`);
    assert.equal(i.fotoUrl, datos!.imagenes[0], `${i.slug}: la foto es imagenes[0]`);
    // Los colores de los murales son los publicados (salvo el blanco del corazón de #824, que la idea no publica).
    if (i.contenido.tipo === "pieza" && i.contenido.pieza.tipo === "mural") {
      const publicados = new Set((datos!.productos_mapeados ?? []).map((m) => m.codigo));
      for (const c of i.contenido.pieza.mural.matriz.colores) assert.ok(publicados.has(c) || BLANCO_NO_PUBLICADO.get(i.numero) === c, `${i.numero}: el color ${c} del mural es de los publicados`);
    }
    for (const m of datos!.productos_mapeados ?? []) {
      assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.url === m.url), `${i.slug}: publica «${m.nombre}» y está en sus productos`);
      if (m.codigo !== null) assert.ok(i.productos.some((p) => p.nombre === m.nombre && p.codigo === m.codigo), `${i.slug}: «${m.nombre}» con su código publicado (${m.codigo})`);
    }
  }
  console.log("OK índice local: slugs, complejidad, lo que faltaba, fotos y productos publicados tal cual");
} else {
  console.log("(sin los datos locales del índice: no se cruzan)");
}

// ----------------------------------------------------------------------------------------------------------
// 6. La biblioteca
// ----------------------------------------------------------------------------------------------------------

for (const i of LOTE_09) {
  const item = BIBLIOTECA_FABRICA.find((x) => x.id === i.id);
  assert.ok(item, `${i.id}: está en la biblioteca de fábrica`);
  assert.equal(item!.fuente?.tipo, "idea-sempertex", `${i.id}: fuente idea-sempertex`);
  assert.equal(item!.fuente?.url, urlDeIdea(i.slug), `${i.id}: url de la idea`);
  assert.equal(item!.fuente?.fotoUrl, i.fotoUrl, `${i.id}: foto de la idea`);
  assert.deepEqual(item!.ocasiones, i.ocasiones, `${i.id}: ocasiones`);
}
console.log(`OK biblioteca: las ${LOTE_09.length} en BIBLIOTECA_FABRICA con su fuente`);
