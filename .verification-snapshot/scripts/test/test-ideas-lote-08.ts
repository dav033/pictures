/**
 * Lote 08 de las ideas de fiesta de sempertex.com digitalizadas (`src/lib/globos3d/ideas-sempertex/lote-08.ts`). Sin
 * coste: no llama a ninguna IA ni a la red.
 * - son las 20 del lote (`clasif/lote-08.json`), con id «idea:<slug>», en orden y sin repetir; ocasiones de sus etiquetas
 *   (`ocasionesDeEtiquetas`) y la foto de su fuente;
 * - cada idea arma (escena sin avisos, nada bajo el piso ni fuera de la sala) y cada globo y tubito usa un color que se
 *   fabrica en su formato, inflado dentro de lo que da ese formato;
 * - los códigos del 3D (formato + código) son los de sus productos, y al revés: cada producto de globo con cantidad
 *   sale en el 3D, con la misma cantidad (lisos e impresos de la tienda juntos, por formato y color de fondo); los
 *   impresos y la utilería de la tienda cuadran con lo que lleva la escena; los publicados van tal cual;
 * - en las escenas, cada estructura raíz (y cada base con lo suyo colgado) se extrae con `extraerConjunto`: entran
 *   todos sus miembros y sola arma lo mismo (materiales y cada globo en su sitio) que su rama; lo contado en la foto
 *   cuelga de su estructura (moños y cerezas, flores, balones, la retícula de las mallas, los neones);
 * - lo que va puesto en un punto exacto queda donde se midió (el topiario con el balón en el piso, la calabaza sobre
 *   la columna, los globos de helio a su altura);
 * - la biblioteca (BIBLIOTECA_FABRICA) las incluye con su fuente; al indexar, lo de sus escenas sale como items que
 *   apuntan a ellas, con nombres sin repetir.
 * Si están los datos locales del índice (`ideas-fiesta-sempertex/`), se cruzan slug, foto y productos con ellos.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOTE_08 } from "../../src/lib/globos3d/ideas-sempertex/lote-08";
import { ocasionesDeEtiquetas } from "../../src/lib/globos3d/ideas-sempertex";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { urlDeIdea } from "../../src/lib/globos3d/ideas-sempertex/tipos";
import { armarEscena, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import { IMPRESOS_TIENDA } from "../../src/lib/globos3d/impresos-catalogo";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { BIBLIOTECA_FABRICA, OCASIONES, clasePieza, escenaDeConjunto, extraerConjunto, indexarEscena, miembrosDeConjunto } from "../../src/lib/globos3d/biblioteca";

const NUMEROS = [581, 582, 595, 596, 601, 605, 608, 617, 623, 644, 646, 668, 695, 709, 710, 712, 713, 716, 751, 779];
const porNumero = (n: number) => LOTE_08.find((i) => i.numero === n)!;
const escenaDe = (n: number): Escena => { const c = porNumero(n).contenido; if (c.tipo !== "escena") throw new Error(`${n}: no es escena`); return c.escena; };

// ----------------------------------------------------------------------------------------------------------
// 1. Las 20 del lote
// ----------------------------------------------------------------------------------------------------------

assert.deepEqual(LOTE_08.map((i) => i.numero), NUMEROS, "los 20 números del lote 08, en orden");
assert.equal(new Set(LOTE_08.map((i) => i.id)).size, 20, "ids sin repetir");
for (const i of LOTE_08) {
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

for (const i of LOTE_08) {
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
    assert.ok(n.caja.min.z >= -sala.fondoCm / 2 - 1 && n.caja.max.z <= sala.fondoCm / 2 + 1, `${que}: «${n.nombre}» dentro de la sala a lo hondo (${n.caja.min.z.toFixed(1)}…${n.caja.max.z.toFixed(1)})`);
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
console.log(`OK armado: ${LOTE_08.length} escenas sin avisos, dentro de su sala y con colores que existen en su formato`);

// ----------------------------------------------------------------------------------------------------------
// 3. Productos: los códigos y las cantidades del 3D son los de la idea
// ----------------------------------------------------------------------------------------------------------

/** Los impresos y la utilería de la tienda que lleva una escena (por url), por lo que arman sus piezas. */
function productosDePiezas(escena: Escena, armada: EscenaArmada): Map<string, number> {
  const salida = new Map<string, number>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    const utileria = nodo.pieza.tipo === "escenografia" ? nodo.pieza.productos ?? [] : [];
    for (const p of [...(armarPieza(nodo.pieza).productos ?? []), ...utileria]) if (p.url.startsWith("/products/")) salida.set(p.url, (salida.get(p.url) ?? 0) + p.cantidad * copias);
  }
  return salida;
}
const URLS_IMPRESOS = new Set(IMPRESOS_TIENDA.map((i) => i.url));
let lineas = 0, impresos = 0;
for (const i of LOTE_08) {
  const que = `${i.numero} ${i.slug}`;
  const del3D = materialesDe.get(i.id)!;
  assert.ok(i.productos.length > 0, `${que}: lista de productos`);
  const globos = i.productos.filter((p) => p.nombre.startsWith("GLOBO "));
  for (const p of i.productos) {
    assert.ok(p.url.startsWith("/products/"), `${que}: «${p.nombre}» con url relativa de la tienda`);
    if (p.codigo !== null && p.formato !== null) assert.ok(coloresDelFormato(p.formato).some((r) => r.codigo === p.codigo), `${que}: ${p.formato} ${p.codigo} del producto se fabrica`);
    if (p.cantidad !== null) assert.ok(p.cantidad > 0 && Number.isInteger(p.cantidad) && p.contada === true, `${que}: «${p.nombre}» con cantidad contada`);
    if (p.cantidad !== null && p.nombre.startsWith("GLOBO ")) assert.ok(p.codigo !== null && p.formato !== null, `${que}: «${p.nombre}» con cantidad dice formato y código`);
  }
  // Los globos (lisos e impresos) cuadran por formato y color con el 3D.
  const pedidos = new Map<string, number>();
  for (const p of globos.filter((x) => x.cantidad !== null)) pedidos.set(clave(p.formato, p.codigo), (pedidos.get(clave(p.formato, p.codigo)) ?? 0) + p.cantidad!);
  for (const [k, n] of del3D) assert.ok(pedidos.has(k), `${que}: ${k} del 3D (×${n}) es de un producto de la idea`);
  for (const [k, cantidad] of pedidos) {
    const n = del3D.get(k) ?? 0;
    const tubito = formatoPorId(k.split("|")[0]!)?.tipo === "tubito";
    if (tubito) assert.equal(Math.ceil(n - 1e-9), cantidad, `${que}: ${k} contado ×${cantidad}, en el 3D ${n.toFixed(2)} tubitos`);
    else assert.equal(n, cantidad, `${que}: ${k} contado ×${cantidad}, en el 3D ×${n}`);
    lineas++;
  }
  // Los impresos y la utilería de la tienda, con la cantidad que lleva la escena.
  const dePiezas = productosDePiezas(escenaDe(i.numero), armadas.get(i.id)!);
  const listados = new Map<string, number>();
  for (const p of i.productos.filter((x) => x.cantidad !== null && (URLS_IMPRESOS.has(x.url) || !x.nombre.startsWith("GLOBO ")))) listados.set(p.url, (listados.get(p.url) ?? 0) + p.cantidad!);
  assert.deepEqual([...listados.entries()].sort(), [...dePiezas.entries()].sort(), `${que}: impresos y utilería de la tienda, los de la escena`);
  impresos += [...dePiezas.values()].reduce((s, x) => s + x, 0);
}
console.log(`OK productos: ${lineas} líneas de globos cuadran exactas con el 3D; ${impresos} impresos y piezas de utilería de la tienda cuadran con la escena`);

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
for (const i of LOTE_08) {
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
const hijos = (n: number, nodo: string) => ramas.get(n)!.find((r) => r.nodo === nodo)?.nombres ?? [];
const cuantos = (n: number, nodo: string, prefijo: string) => hijos(n, nodo).filter((x) => x.startsWith(prefijo)).length;
// 581: los 35 globos contados (11 + 11 + 13) y los tres moños, cada uno con sus dos cerezas.
assert.equal(hijos(581, "soporte").filter((x) => x.includes("(zona ")).length, 35, "#581: los 35 globos de la guirnalda");
assert.equal(cuantos(581, "soporte", "Moño"), 3, "#581: tres moños");
assert.equal(cuantos(581, "soporte", "Corazón C-12"), 6, "#581: seis cerezas");
assert.equal(cuantos(595, "soporte", "R-9 Silk Blanco Nácar del aro"), 10, "#595: 10 blancos en el aro");
assert.equal(cuantos(595, "soporte", "R-5 Fashion Rojo del aro"), 5, "#595: 5 rojos en el aro");
assert.equal(hijos(596, "columna").filter((x) => x.startsWith("R-12") && x.includes("helio")).length, 3, "#596: los tres globos de helio cuelgan de la columna");
assert.ok(hijos(601, "jarron-base").some((x) => x.startsWith("Flor fucsia")) && hijos(601, "jarron-base").some((x) => x.startsWith("Flor de 5 lazos")), "#601: el jarrón lleva sus dos flores");
assert.equal(cuantos(605, "base", "Pétalo"), 9, "#605: la flor de 9 pétalos cuelga de la base");
assert.equal(cuantos(617, "nucleo", "R-12 Fashion Rojo"), 16, "#617: dos anillos de 8 rojos");
assert.equal(cuantos(617, "nucleo", "R-12 Fashion Amarillo"), 8, "#617: dos cuartetos amarillos");
assert.equal(cuantos(617, "nucleo", "R-5 Fashion Azul Rey"), 3, "#617: el tallo de 3 R-5");
assert.equal(hijos(623, "guirnalda").filter((x) => x.includes("Feliz Grado") && x.startsWith("R-12 Feliz")).length, 3, "#623: tres «Feliz Grado» en la guirnalda");
for (const n of [644, 646]) {
  assert.equal(cuantos(n, "soporte", "LOL-12"), 6, `#${n}: 6 eslabones`);
  assert.equal(hijos(n, "soporte").filter((x) => x.includes("de la unión")).length, 12, `#${n}: una pareja en cada unión`);
}
assert.equal(ramas.get(668)!.length, 2, "#668: dos ramos con su huevo");
assert.equal(hijos(709, "pared").length, 28, "#709: los 28 globos de encima (14 balones y 14 negros)");
assert.equal(hijos(710, "malla").length, 49, "#710: la retícula de 7 × 7");
assert.equal(hijos(712, "franja-azul").filter((x) => x.startsWith("Franja")).length, 4, "#712: las cinco franjas apiladas en una sola pared");
assert.equal(cuantos(716, "fondo", "Flor melón"), 26, "#716: 26 flores");
assert.equal(cuantos(716, "fondo", "Florecita"), 9, "#716: 9 florecitas");
assert.equal(hijos(751, "columna").filter((x) => x.startsWith("Calabaza")).length, 1, "#751: la calabaza remata la columna");
assert.equal(hijos(779, "malla").length, 117, "#779: la retícula de 13 × 9 neones");
console.log(`OK escenas: ${extraidas} estructuras raíz se extraen con lo suyo (${globosEnSuSitio} globos en su sitio)`);

// ----------------------------------------------------------------------------------------------------------
// 5. Lo puesto en un punto exacto queda donde se midió
// ----------------------------------------------------------------------------------------------------------

const nodoArmado = (n: number, id: string) => armadas.get(porNumero(n).id)!.porNodo.find((x) => x.id === id)!;
/** El pie del cuerpo de un globo (la caja de la escena cuenta desde el nudo). */
const pieDe = (g: { nudo: { y: number }; direccion: { y: number }; infladoCm: number }) => g.nudo.y + g.direccion.y * centroCuerpo("redondo", g.infladoCm) - g.infladoCm / 2;
const balon = pieDe(nodoArmado(617, "balon").globos[0]!);
assert.ok(balon >= -1 && balon <= 3, `#617: el balón apoyado en el piso (${balon.toFixed(1)})`);
const calabaza = nodoArmado(751, "calabaza").globos[0]!, columna751 = nodoArmado(751, "columna");
const centroCalabaza = { y: calabaza.nudo.y + calabaza.direccion.y * centroCuerpo("redondo", calabaza.infladoCm), z: calabaza.nudo.z + calabaza.direccion.z * centroCuerpo("redondo", calabaza.infladoCm) };
const pieCalabaza = centroCalabaza.y - calabaza.infladoCm / 2;
assert.ok(pieCalabaza > columna751.caja.max.y - 15 && pieCalabaza < columna751.caja.max.y + 3, `#751: la calabaza se apoya en la columna (${pieCalabaza.toFixed(1)} sobre ${columna751.caja.max.y.toFixed(1)})`);
assert.ok(Math.abs(centroCalabaza.z) < 12, "#751: la calabaza encima de la columna, no delante");
const helio = nodoArmado(596, "helio-arriba");
assert.ok(helio.caja.max.y > 250 && helio.caja.max.y < 300, `#596: el globo de helio de arriba a ~2,7 m (${helio.caja.max.y.toFixed(1)})`);
const flor605 = nodoArmado(605, "petalo-1");
assert.ok(flor605.caja.max.y > 170 && flor605.caja.max.y < 215, `#605: la flor a ~2 m (${flor605.caja.max.y.toFixed(1)})`);
console.log("OK puestos: balón en el piso, calabaza sobre su columna, helio y flor a la altura medida");

// ----------------------------------------------------------------------------------------------------------
// 6. Datos locales del índice (si están): slug, foto y productos publicados tal cual
// ----------------------------------------------------------------------------------------------------------

const RAIZ = path.resolve(process.cwd(), "..", "ideas-fiesta-sempertex");
if (existsSync(path.join(RAIZ, "ideas-v3.json")) && existsSync(path.join(RAIZ, "clasif", "lote-08.json"))) {
  type IdeaIndice = { slug: string; imagenes: string[]; productos_mapeados?: Array<{ nombre: string; url: string; formato: string | null; codigo: string | null }> };
  const ideas = JSON.parse(readFileSync(path.join(RAIZ, "ideas-v3.json"), "utf8")) as IdeaIndice[];
  const clasif = JSON.parse(readFileSync(path.join(RAIZ, "clasif", "todas.json"), "utf8")) as Array<{ numero: number; slug: string }>;
  assert.deepEqual(JSON.parse(readFileSync(path.join(RAIZ, "clasif", "lote-08.json"), "utf8")), NUMEROS, "los números son los de clasif/lote-08.json");
  for (const i of LOTE_08) {
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
// 7. La biblioteca
// ----------------------------------------------------------------------------------------------------------

let derivados = 0;
for (const i of LOTE_08) {
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
console.log(`OK biblioteca: las 20 en BIBLIOTECA_FABRICA con su fuente; ${derivados} items salen de indexar sus escenas`);
