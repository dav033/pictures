/**
 * La biblioteca del taller 3D (`biblioteca.ts` y `productos-tienda.ts`). Sin coste: no llama a ninguna IA ni a la red.
 * - extraer un conjunto de cada estructura de cada escena predefinida conserva exactamente los globos (cuántos, de qué
 *   formato y color, y dónde: puesto donde estaba, cada globo en su sitio ±0,01 cm) y los materiales de esa rama
 *   (la estructura, lo que cuelga de ella y lo que va pegado a sus globos);
 * - insertar el conjunto en otra escena suma exactamente sus materiales, sin avisos, con ids que no chocan, y la
 *   escena de entrada no cambia; insertar una escena entera y una pieza sola, igual;
 * - ids estables: extraer dos veces, o de la misma escena con otros ids, da el mismo conjunto («estructura», «hijo-N»);
 * - lo que va en cada conjunto de Halloween (los 14 ojos y las 2 arañas del aro, los ojos de los racimos, las calabazas
 *   y el remate del arco) y lo que no (la calabaza bruja sobre la mesa, las manos sobre el panel);
 * - el índice: ids y contenidos sin duplicados, cada derivado apunta a su escena y a piezas que existen, y lo derivado
 *   igual a algo de fábrica se une a ello (el racimo de ojos saltones de la foto 1 es la predefinida);
 * - `productosDe` da nombre exacto y url de la tienda para cada globo liso de la tabla oficial (o «sin verificar» con una
 *   búsqueda) y, para cada item, globos + utilería + escenografía con nombre y url;
 * - filtros (tipo, ocasión, color, producto «R-12 Reflex Dorado 970», texto sin tildes) y la biblioteca propia
 *   (JSON de ida y vuelta, `validarItem` descarta lo que no cuadra y las urls que no son públicas).
 */
import assert from "node:assert/strict";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import { repartirEscenografia } from "../../src/lib/catalogo/lista-por-repositorio";
import { armarEscena, type Escena, type EscenaArmada, type NodoEscena } from "../../src/lib/globos3d/escena";
import { ESCENAS_PREDEFINIDAS, escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { IDEAS_SEMPERTEX } from "../../src/lib/globos3d/ideas-sempertex";
import { sumarMateriales } from "../../src/lib/globos3d/mezcla";
import type { MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import { corazonesSinCobertura, coloresDelFormato, FORMATOS_GLOBO } from "../../src/lib/globos3d/formatos";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";
import { GLOBOS_TIENDA, NO_ESTAN_EN_LA_TIENDA, productoDeGlobo } from "../../src/lib/globos3d/productos-tienda";
import { IMPRESOS_TIENDA } from "../../src/lib/globos3d/impresos-catalogo";
import { METALIZADOS_TIENDA } from "../../src/lib/globos3d/metalizados";
import {
  BIBLIOTECA_FABRICA, bibliotecaCompleta, claveContenido, clasePieza, contenidoDeEscena, decoracionesPegadas, escenaDeConjunto, escenaDeItem, extraerConjunto,
  filtrarBiblioteca, firmaDeClave, huellaItem, indexarEscena, insertarEnEscena, itemDeEscena, itemDeNodo, miembrosDeConjunto, productosDe, resumenDe, tipoDePieza,
  unirBiblioteca, validarItem,
  type Conjunto, type ItemBiblioteca, type ResumenItem,
} from "../../src/lib/globos3d/biblioteca";

const ordenar = (m: readonly MaterialDecoracion[]) => sumarMateriales(m).filter((x) => x.cantidad > 0).map((x) => `${x.formatoId}|${x.codigo}|${Math.round(x.cantidad * 1000) / 1000}`).sort();
const mismosMateriales = (a: readonly MaterialDecoracion[], b: readonly MaterialDecoracion[], que: string) => assert.deepEqual(ordenar(a), ordenar(b), `${que}: materiales distintos`);
const itemConjunto = (c: Conjunto, id: string): ItemBiblioteca => ({ id, tipo: "conjunto", nombre: c.raiz.nombre, descripcion: "", ocasiones: [], contenido: { tipo: "conjunto", conjunto: c } });

// ----------------------------------------------------------------------------------------------------------
// 1. Extraer un conjunto conserva exactamente su rama
// ----------------------------------------------------------------------------------------------------------

const armadas = new Map<string, EscenaArmada>();
let conjuntosProbados = 0, globosComparados = 0;
const conjuntos: Array<{ escena: string; nodo: string; conjunto: Conjunto; materiales: MaterialDecoracion[] }> = [];
for (const p of ESCENAS_PREDEFINIDAS) {
  const escena = p.escena;
  const armada = armarEscena(escena);
  armadas.set(p.id, armada);
  const pegadas = decoracionesPegadas(escena, armada);
  for (const nodo of escena.nodos) {
    if (clasePieza(nodo.pieza) !== "estructura") continue;
    const que = `${p.id} / ${nodo.id}`;
    const conjunto = extraerConjunto(escena, nodo.id, { armada });
    assert.ok(conjunto, `${que}: sale el conjunto`);
    const ids = miembrosDeConjunto(escena, nodo.id, armada, pegadas);
    // Todos sus miembros entran (ninguno se queda fuera por no poder llevarse con la estructura).
    assert.equal(conjunto.hijos.length, ids.length - 1, `${que}: entran todos sus miembros`);
    assert.deepEqual(conjunto.hijos.map((h) => h.id), ids.slice(1).map((_, i) => `hijo-${i + 1}`), `${que}: ids estables`);
    const deLaRama = armada.porNodo.filter((n) => ids.includes(n.id));
    const materiales = sumarMateriales(...deLaRama.map((n) => n.materiales));
    // Solo, en su sala y donde estaba: los mismos globos, en el mismo sitio.
    const sola = armarEscena(escenaDeConjunto(conjunto, { sala: escena.sala, donde: conjunto.sugerida }));
    assert.deepEqual(sola.avisos, [], `${que}: el conjunto solo arma sin avisos`);
    mismosMateriales(sola.materiales, materiales, que);
    const firma = (g: { formatoId: string; codigo: string; infladoCm: number; nudo: { x: number; y: number; z: number } }) => `${g.formatoId}|${g.codigo}|${g.infladoCm}|${g.nudo.x.toFixed(2)}|${g.nudo.y.toFixed(2)}|${g.nudo.z.toFixed(2)}`;
    const antes = deLaRama.flatMap((n) => n.globos).map(firma).sort();
    const despues = sola.globos.map(firma).sort();
    assert.equal(despues.length, antes.length, `${que}: mismos globos`);
    assert.deepEqual(despues.map((s) => s.replace(/-0\.00/g, "0.00")), antes.map((s) => s.replace(/-0\.00/g, "0.00")), `${que}: cada globo en su sitio`);
    // Y en el origen (como se ve en la biblioteca), los mismos materiales.
    mismosMateriales(armarEscena(escenaDeConjunto(conjunto)).materiales, materiales, `${que} (en el origen)`);
    globosComparados += antes.length;
    conjuntosProbados++;
    conjuntos.push({ escena: p.id, nodo: nodo.id, conjunto, materiales });
  }
}
assert.ok(conjuntosProbados >= 17, `se probaron ${conjuntosProbados} conjuntos`);
console.log(`OK extraer: ${conjuntosProbados} conjuntos de ${ESCENAS_PREDEFINIDAS.length} escenas, ${globosComparados} globos en su sitio`);

// Lo que va en cada conjunto de Halloween (y lo que no).
const hijosDe = (escena: string, nodo: string) => conjuntos.find((c) => c.escena === escena && c.nodo === nodo)!.conjunto.hijos.map((h) => h.nombre);
const aro = hijosDe("halloween_aro_ojos", "aro");
assert.equal(aro.filter((n) => n.startsWith("Ojo con venas")).length, 14, "el aro lleva sus 14 ojos");
assert.ok(aro.includes("Araña grande") && aro.includes("Araña chica"), "y sus dos arañas");
const racimos = hijosDe("halloween_marco_mesas", "racimos");
assert.equal(racimos.filter((n) => n.startsWith("Ojos saltones")).length, 4, "los 4 racimos de ojos van con los racimos");
assert.ok(!racimos.some((n) => n.startsWith("Mano")), "las manos van en el panel del marco, no en los racimos");
const arco = hijosDe("halloween_arco_calabazas", "arco");
assert.deepEqual(arco, ["Calabaza grande (izquierda)", "Calabaza grande (derecha)", "Globo de remate R-24"], "el arco lleva sus calabazas y el remate; la bruja va en la mesa");
assert.ok(hijosDe("halloween_arbol_fantasmas", "arbol").includes("Ramas trenzadas"), "el árbol lleva sus ramas");
assert.deepEqual(hijosDe("pared_fondo_columnas", "pared"), ["Flores en la pared"], "la pared lleva sus flores colgadas");
console.log(`OK conjuntos de Halloween: aro ${aro.length}, racimos ${racimos.length}, arco ${arco.length}`);

// ----------------------------------------------------------------------------------------------------------
// 2. Ids estables
// ----------------------------------------------------------------------------------------------------------

for (const { escena: id, nodo } of conjuntos.filter((c) => c.conjunto.hijos.length > 0)) {
  const escena = escenaPredefinida(id);
  const a = extraerConjunto(escena, nodo);
  assert.deepEqual(a, extraerConjunto(escena, nodo), `${id}/${nodo}: extraer dos veces da lo mismo`);
  // La misma escena con otros ids (y en otro orden de ids): el mismo conjunto.
  const renombrar = (x: string) => `otra-${x}`;
  const otra: Escena = {
    ...escena, nodos: escena.nodos.map((n): NodoEscena => {
      const c = n.colocacion;
      return { ...n, id: renombrar(n.id), colocacion: c.en === "ancla" || c.en === "sobre" ? { ...c, padreId: renombrar(c.padreId) } : c };
    }),
  };
  assert.equal(JSON.stringify(extraerConjunto(otra, renombrar(nodo))), JSON.stringify(a), `${id}/${nodo}: con otros ids, el mismo conjunto`);
}
console.log("OK ids estables");

// ----------------------------------------------------------------------------------------------------------
// 3. Insertar en otra escena
// ----------------------------------------------------------------------------------------------------------

let insertados = 0;
for (const [k, c] of conjuntos.entries()) {
  // En la escena siguiente de la lista (otra sala, otras piezas).
  const destinoId = ESCENAS_PREDEFINIDAS[(ESCENAS_PREDEFINIDAS.findIndex((p) => p.id === c.escena) + 1) % ESCENAS_PREDEFINIDAS.length]!.id;
  const destino = escenaPredefinida(destinoId);
  const copia = structuredClone(destino);
  const antes = armadas.get(destinoId)!;
  const r = insertarEnEscena(destino, itemConjunto(c.conjunto, `prueba-${k}`));
  assert.deepEqual(destino, copia, "la escena de entrada no cambia");
  assert.equal(r.ids.length, 1 + c.conjunto.hijos.length, `${c.escena}/${c.nodo} → ${destinoId}: entran todas sus piezas`);
  assert.equal(new Set(r.escena.nodos.map((n) => n.id)).size, r.escena.nodos.length, "ids sin chocar");
  assert.equal(r.raizId, r.ids[0]);
  const despues = armarEscena(r.escena);
  assert.deepEqual(despues.avisos, [], `${c.escena}/${c.nodo} → ${destinoId}: sin avisos`);
  mismosMateriales(despues.materiales, sumarMateriales(antes.materiales, c.materiales), `${c.escena}/${c.nodo} → ${destinoId}`);
  insertados++;
}
// Una escena entera dentro de otra y una pieza sola.
{
  const a = escenaPredefinida("pared_fondo_columnas"), b = escenaPredefinida("halloween_aro_ojos");
  const item = itemDeEscena({ id: "x", nombre: "Aro", ocasiones: ["halloween"], escena: b });
  const r = insertarEnEscena(a, item);
  assert.equal(r.escena.nodos.length, a.nodos.length + b.nodos.length);
  mismosMateriales(armarEscena(r.escena).materiales, sumarMateriales(armadas.get("pared_fondo_columnas")!.materiales, armadas.get("halloween_aro_ojos")!.materiales), "escena dentro de escena");
  const flor = BIBLIOTECA_FABRICA.find((i) => i.id === "decoracion:flor5")!;
  const r2 = insertarEnEscena(a, flor);
  assert.equal(r2.escena.nodos.length, a.nodos.length + 1);
  mismosMateriales(armarEscena(r2.escena).materiales, sumarMateriales(armadas.get("pared_fondo_columnas")!.materiales, armarEscena(escenaDeItem(flor)).materiales), "una decoración sola");
}
console.log(`OK insertar: ${insertados} conjuntos en otra escena suman exactamente sus materiales; escena y pieza sola también`);

// ----------------------------------------------------------------------------------------------------------
// 4. El índice
// ----------------------------------------------------------------------------------------------------------

const biblioteca = bibliotecaCompleta();
assert.equal(new Set(biblioteca.map((i) => i.id)).size, biblioteca.length, "ids sin duplicados");
const claves = biblioteca.map((i) => claveContenido(i.contenido));
assert.equal(new Set(claves).size, claves.length, "contenidos sin duplicados");
const porTipo = new Map<string, number>();
for (const i of biblioteca) porTipo.set(i.tipo, (porTipo.get(i.tipo) ?? 0) + 1);
assert.equal(porTipo.get("escena"), ESCENAS_PREDEFINIDAS.length + IDEAS_SEMPERTEX.filter((i) => i.contenido.tipo === "escena").length + REFERENCIAS_DUENO.length, "todas las escenas predefinidas, las de ideas de Sempertex y las referencias del dueño");
for (const t of ["conjunto", "estructura", "decoracion", "utileria"]) assert.ok((porTipo.get(t) ?? 0) > 0, `hay items de tipo ${t}`);
for (const i of biblioteca) {
  assert.equal(i.tipo === "escena", i.contenido.tipo === "escena", `${i.id}: tipo y contenido casan`);
  assert.equal(i.tipo === "conjunto", i.contenido.tipo === "conjunto", `${i.id}: tipo y contenido casan`);
  assert.ok(i.nombre.trim().length > 0 && i.ocasiones.length > 0, `${i.id}: nombre y ocasión`);
  for (const o of i.apareceEn ?? []) {
    const escena = biblioteca.find((x) => x.id === o.itemId);
    assert.ok(escena && escena.contenido.tipo === "escena", `${i.id}: su escena ${o.itemId} está en la biblioteca`);
    const ids = new Set(escena.contenido.tipo === "escena" ? escena.contenido.escena.nodos.map((n) => n.id) : []);
    assert.ok(o.nodoIds.length > 0 && o.nodoIds.every((n) => ids.has(n)), `${i.id}: sus piezas existen en ${o.itemId}`);
  }
}
// Los nombres dentro de una escena no se repiten.
for (const e of biblioteca.filter((i) => i.tipo === "escena")) {
  const nombres = contenidoDeEscena(biblioteca, e.id).filter((i) => i.derivado).map((i) => `${i.tipo}|${i.nombre}`);
  assert.equal(new Set(nombres).size, nombres.length, `${e.id}: nombres sin repetir (${nombres.join(", ")})`);
  assert.ok(contenidoDeEscena(biblioteca, e.id).length > 0, `${e.id}: algo sale de ella`);
}
// Lo derivado igual a algo de fábrica se une a ello.
const ojosSaltones = biblioteca.find((i) => i.id === "decoracion:ojos_saltones")!;
assert.ok(ojosSaltones.apareceEn?.some((o) => o.itemId === "escena:halloween_marco_mesas" && o.nodoIds.length === 4), "el racimo de ojos saltones de la foto 1 es la predefinida (4 veces)");
assert.ok(!biblioteca.some((i) => i.derivado && i.contenido.tipo === "pieza" && claveContenido(i.contenido) === claveContenido(ojosSaltones.contenido)), "sin copia derivada");
// Las dos columnas iguales del primer preset son una sola estructura.
const columnas = biblioteca.filter((i) => i.apareceEn?.some((o) => o.itemId === "escena:arco_organico_columnas_guirnalda" && o.nodoIds.includes("columna-izq")));
assert.equal(columnas.length, 1);
assert.deepEqual(columnas[0]!.apareceEn![0]!.nodoIds, ["columna-izq", "columna-der"]);
assert.equal(columnas[0]!.nombre, "Columna");
console.log(`OK índice: ${biblioteca.length} items (${[...porTipo].map(([t, n]) => `${n} ${t}`).join(", ")}) sin duplicados`);

// Lo de fábrica es perezoso (ver `ideas-sempertex/tipos.ts`): su tipo se declara sin armarlo y debe casar con lo que
// sale al armarlo; la pestaña Biblioteca junta por firmas (las calcula su motor fuera de la página) y debe dar lo mismo
// que juntar por claves enteras.
for (const i of BIBLIOTECA_FABRICA) if (i.contenido.tipo === "pieza") assert.equal(i.tipo, tipoDePieza(i.contenido.pieza), `${i.id}: el tipo declarado casa con su pieza`);
for (const idea of IDEAS_SEMPERTEX) assert.equal(idea.clase, idea.contenido.tipo === "escena" ? "escena" : tipoDePieza(idea.contenido.pieza), `${idea.id}: su clase casa con su contenido`);
{
  const algunas = new Map(BIBLIOTECA_FABRICA.filter((i) => i.tipo === "escena").slice(0, 12).map((i) => [i.id, indexarEscena(i)]));
  const porClave = unirBiblioteca(BIBLIOTECA_FABRICA, algunas);
  const porFirma = unirBiblioteca(BIBLIOTECA_FABRICA, algunas, (i) => firmaDeClave(claveContenido(i.contenido)));
  const resumen = (l: readonly ItemBiblioteca[]) => l.map((i) => `${i.id}|${i.nombre}|${i.ocasiones.join(",")}|${(i.apareceEn ?? []).map((o) => `${o.itemId}:${o.nodoIds.join("+")}`).join(";")}`);
  assert.deepEqual(resumen(porFirma), resumen(porClave), "juntar por firmas da lo mismo que por claves");
  console.log(`OK perezoso: ${BIBLIOTECA_FABRICA.length} items de fábrica con su tipo declarado; firmas = claves en ${porClave.length} items`);
}

// ----------------------------------------------------------------------------------------------------------
// 5. Productos
// ----------------------------------------------------------------------------------------------------------

const TIENDA = "https://sempertex.com/";
let verificados = 0, sinVerificar = 0;
for (const ref of TABLA_SEMPERTEX.referencias) {
  for (const f of FORMATOS_GLOBO) {
    if (!coloresDelFormato(f.id).some((c) => c.codigo === ref.codigo)) continue;
    const p = productoDeGlobo(f.id, ref.codigo);
    assert.ok(p.nombre.startsWith("GLOBO "), `${f.id} ${ref.codigo}: nombre exacto`);
    if (p.estado === "verificado") {
      assert.ok(p.url.startsWith(`${TIENDA}products/`), `${f.id} ${ref.codigo}: url de producto`);
      verificados++;
    } else {
      assert.ok(p.url.startsWith(`${TIENDA}search?q=`), `${f.id} ${ref.codigo}: sin verificar, con búsqueda`);
      const sinCobertura = corazonesSinCobertura([{ formatoId: f.id, codigo: ref.codigo }]).length === 1;
      assert.ok(NO_ESTAN_EN_LA_TIENDA.some((x) => x.codigo === ref.codigo && x.tipo === f.tipo) || sinCobertura, `${f.id} ${ref.codigo}: está en la lista de lo que no está en la tienda o es un corazón sin cobertura`);
      sinVerificar++;
    }
  }
}
assert.ok(GLOBOS_TIENDA.length >= 200, "más de 200 productos de globos lisos");
assert.equal(new Set(GLOBOS_TIENDA.map((p) => `${p.tipo}|${p.codigo}`)).size, GLOBOS_TIENDA.length, "un producto por tipo y color");
assert.ok(GLOBOS_TIENDA.every((p) => p.url.startsWith("/products/") && p.nombre === p.nombre.trim()), "urls relativas de producto");
// Los ejemplos del dueño.
assert.equal(productoDeGlobo("R-12", "061").url, "https://sempertex.com/products/globo-para-fiesta-latex-redondo-fashion-naranja");
assert.equal(productoDeGlobo("T-260", "080").url, "https://sempertex.com/products/globo-para-fiesta-latex-tubito-fashion-negro");
assert.equal(productoDeGlobo("LOL-12", "061").url, "https://sempertex.com/products/globo-para-fiesta-latex-link-o-loon-fashion-naranja");
const dorado = productoDeGlobo("R-12", "970");
assert.deepEqual([dorado.nombre, dorado.estado, dorado.tallaEnTienda], ["GLOBO LATEX REDONDO REFLEX DORADO", "verificado", true]);

let lineas = 0;
let ideasConMobiliario = 0;
for (const item of biblioteca) {
  const productos = productosDe(item);
  // REQ-013 T25: repartir las líneas de escenografía por repositorio no pierde ni repite ninguna, ni cambia su orden dentro de cada parte.
  const partida = repartirEscenografia(escenaDeItem(item), productos.escenografia);
  assert.deepEqual(productos.escenografia.filter((l) => partida.mobiliario.includes(l)), partida.mobiliario, `${item.id}: Mobiliario conserva el orden de siempre`);
  assert.deepEqual(productos.escenografia.filter((l) => partida.escenografia.includes(l)), partida.escenografia, `${item.id}: Escenografía conserva el orden de siempre`);
  assert.equal(partida.mobiliario.length + partida.escenografia.length, productos.escenografia.length, `${item.id}: el reparto por repositorio conserva todas las líneas, una vez cada una`);
  assert.ok(partida.mobiliario.every((l) => l.clase === "escenografia") && partida.escenografia.filter((l) => l.clase !== "escenografia").length === productos.escenografia.filter((l) => l.clase !== "escenografia").length, `${item.id}: papel y follaje se quedan en Escenografía`);
  if (partida.mobiliario.length) ideasConMobiliario++;
  for (const g of productos.globos) {
    assert.ok(g.cantidad > 0 && g.nombreOficial === `${g.formatoId} ${g.color} ${g.codigo}`, `${item.id}: ${g.nombreOficial}`);
    assert.ok(g.producto.nombre && g.producto.url.startsWith(TIENDA), `${item.id}: ${g.nombreOficial} con producto y url`);
    lineas++;
  }
  assert.equal(productos.totalGlobos, productos.globos.reduce((s, g) => s + g.cantidad, 0));
  for (const u of productos.utileria) assert.ok(u.nombre && (u.generico || u.url.startsWith("/products/")), `${item.id}: utilería ${u.nombre} con url`);
  if (item.tipo === "utileria") assert.ok(productos.utileria.length > 0, `${item.id}: la utilería trae su producto`);
}
// Globos impresos y metalizados: el producto exacto de su catálogo (nombre y url de la tienda), en su sección, con la
// cantidad de la pieza por sus copias; los globos impresos se marcan en su línea de globos (se compran como el impreso).
const enTienda = (url: string) => `https://sempertex.com${url}`;
const urlImpresos = new Map(IMPRESOS_TIENDA.map((i) => [enTienda(i.url), i]));
const urlMetalizados = new Map(METALIZADOS_TIENDA.map((m) => [enTienda(m.url), m]));
let lineasImpresos = 0, lineasMetalizados = 0, lineasGenericas = 0;
for (const item of biblioteca) {
  const productos = productosDe(item);
  const escena = escenaDeItem(item);
  const conImpresos = escena.nodos.some((n) => n.pieza.impresos?.length);
  // Todo metalizado es un producto: el de la tienda o uno genérico (sin url).
  const conMetalizados = escena.nodos.some((n) => n.pieza.tipo === "metalizado");
  for (const t of productos.tienda) {
    assert.ok(t.cantidad > 0 && t.piezas.length > 0 && t.detalle, `${item.id}: ${t.nombre}`);
    if (t.seccion === "impresos") {
      const i = urlImpresos.get(t.url);
      assert.ok(i && i.nombre === t.nombre, `${item.id}: impreso ${t.nombre} con su nombre y url exactos del catálogo`);
      lineasImpresos++;
    } else if (t.generico) {
      assert.ok(t.url === "" && t.nombre.startsWith("Genérico:"), `${item.id}: metalizado genérico ${t.nombre} sin url y dicho genérico`);
      lineasGenericas++;
    } else {
      const m = urlMetalizados.get(t.url);
      assert.ok(m && m.nombre === t.nombre, `${item.id}: metalizado ${t.nombre} con su nombre y url exactos del catálogo`);
      lineasMetalizados++;
    }
  }
  if (conImpresos) {
    assert.ok(productos.tienda.some((t) => t.seccion === "impresos"), `${item.id}: lleva impresos y salen en productos`);
    const impresos = productos.tienda.filter((t) => t.seccion === "impresos").reduce((s, t) => s + t.cantidad, 0);
    assert.equal(productos.globos.reduce((s, g) => s + (g.impresos ?? 0), 0), impresos, `${item.id}: los globos impresos se marcan en su línea`);
  }
  if (conMetalizados) assert.ok(productos.tienda.some((t) => t.seccion === "metalizados"), `${item.id}: lleva metalizados y salen en productos`);
  if (!conImpresos && !conMetalizados) assert.equal(productos.tienda.length, 0, `${item.id}: sin impresos ni metalizados`);
}
assert.ok(lineasImpresos >= 10 && lineasMetalizados >= 5 && lineasGenericas >= 5, `líneas de impresos (${lineasImpresos}), metalizados (${lineasMetalizados}) y metalizados genéricos (${lineasGenericas})`);
// Una idea con los dos: el arco de año nuevo (números metalizados) y la pasión del fútbol (balón impreso).
const anoNuevo = productosDe(biblioteca.find((i) => i.id === "idea:arco-ano-nuevo")!);
assert.ok(anoNuevo.tienda.some((t) => t.seccion === "metalizados" && t.url.startsWith(enTienda("/products/globo-metalizado-numero"))), "arco de año nuevo: números metalizados con url");
console.log(`OK impresos y metalizados en productos: ${lineasImpresos} líneas de impresos y ${lineasMetalizados} de metalizados, con nombre y url exactos; ${lineasGenericas} de metalizados genéricos`);

const marco = productosDe(biblioteca.find((i) => i.id === "escena:halloween_marco_mesas")!);
assert.ok(marco.utileria.length >= 5 && marco.escenografia.some((e) => e.nombre.startsWith("Mesa cilíndrica")) && marco.escenografia.some((e) => e.clase === "papel"), "escena con utilería, escenografía y papel por separado");
console.log(`OK productos: ${verificados} combinaciones formato-color con producto verificado, ${sinVerificar} sin verificar; ${lineas} líneas de globos con producto y url`);
// Las mesas cilíndricas de la idea de Halloween las dibuja la idea (escenografía de Sempertex, sin `mueble` del catálogo): no son mobiliario.
const partidaMarco = repartirEscenografia(escenaDeItem(biblioteca.find((i) => i.id === "escena:halloween_marco_mesas")!), marco.escenografia);
assert.deepEqual(partidaMarco.mobiliario, [], "las mesas de una idea de Sempertex siguen en Escenografía");
assert.deepEqual(partidaMarco.escenografia, marco.escenografia, "y la lista de siempre queda entera, en su orden");
console.log(`OK lista por repositorio: ${ideasConMobiliario} ideas de la fábrica traen mobiliario del catálogo en su lista; el reparto conserva todas las líneas`);

// ----------------------------------------------------------------------------------------------------------
// 6. Filtros
// ----------------------------------------------------------------------------------------------------------

const resumenes = new Map<string, ResumenItem>(biblioteca.map((i) => [i.id, resumenDe(i, armarEscena(escenaDeItem(i)))]));
// «Usa R-5 Reflex Dorado 970» (el racimo dorado, el árbol); el R-12 Reflex Dorado no lo usa nada todavía.
const conDorado = filtrarBiblioteca(biblioteca, resumenes, { producto: "R-5|970" });
assert.ok(conDorado.length > 0 && conDorado.every((i) => resumenes.get(i.id)!.productos.includes("R-5|970")), "filtro por producto: R-5 Reflex Dorado 970");
assert.ok(conDorado.some((i) => i.id === "decoracion:racimo_dorado") && !conDorado.some((i) => i.id === "decoracion:flor_lazos_dorados"), "el racimo dorado sí; la flor de lazos dorados es de T-260");
assert.deepEqual(filtrarBiblioteca(biblioteca, resumenes, { producto: "R-12|970" }).map((i) => i.id), biblioteca.filter((i) => resumenes.get(i.id)!.productos.includes("R-12|970")).map((i) => i.id), "R-12 Reflex Dorado 970: solo lo que lo usa");
assert.ok(filtrarBiblioteca(biblioteca, resumenes, { tipo: "escena", ocasion: "halloween" }).filter((i) => i.fuente?.tipo !== "idea-sempertex").length === 5, "5 escenas de Halloween del taller (más las de ideas de Sempertex)");
assert.deepEqual(filtrarBiblioteca(biblioteca, resumenes, { texto: "arana LAZOS" }).map((i) => i.id).sort(), biblioteca.filter((i) => /araña de lazos/i.test(i.nombre) || /araña de lazos/i.test(i.descripcion)).map((i) => i.id).sort(), "texto sin tildes ni mayúsculas");
assert.ok(filtrarBiblioteca(biblioteca, resumenes, { color: "061" }).every((i) => resumenes.get(i.id)!.colores.includes("061")), "filtro por color");
assert.ok(filtrarBiblioteca(biblioteca, resumenes, { texto: "reflex dorado" }).length >= conDorado.length, "el texto busca también en los colores");
console.log(`OK filtros: ${conDorado.length} items usan R-5 Reflex Dorado 970`);

// ----------------------------------------------------------------------------------------------------------
// 7. Biblioteca propia: guardar desde la escena y leer lo guardado
// ----------------------------------------------------------------------------------------------------------

const escenaAro = escenaPredefinida("halloween_aro_ojos");
const propio = itemDeNodo(escenaAro, "aro", { id: "propio:1", nombre: "Mi aro", ocasiones: ["halloween"] });
assert.ok(propio && propio.tipo === "conjunto" && propio.propio, "una estructura con decoraciones se guarda como conjunto");
const leido = validarItem(JSON.parse(JSON.stringify(propio)));
assert.ok(leido);
assert.equal(claveContenido(leido.contenido), claveContenido(propio.contenido), "JSON de ida y vuelta");
assert.equal(huellaItem(leido), huellaItem(propio));
assert.equal(itemDeNodo(escenaAro, "ojo-1", { id: "propio:2" })?.tipo, "decoracion");
assert.equal(itemDeNodo(escenaPredefinida("halloween_marco_mesas"), "mesa-baja", { id: "propio:3" }), null, "la escenografía no se guarda sola");
assert.equal(validarItem({ ...propio, tipo: "escena" }), null, "tipo y contenido tienen que casar");
assert.equal(validarItem({ ...propio, fuente: { tipo: "propio", titulo: "x", fotoUrl: "data:image/png;base64,AAAA" } }), null, "nada de imágenes embebidas");
assert.equal(validarItem({ ...propio, fuente: { tipo: "idea-sempertex", titulo: "x", url: "http://sempertex.com/blogs/x" } }), null, "solo https");
assert.ok(validarItem({ ...propio, fuente: { tipo: "idea-sempertex", titulo: "Idea", url: "https://sempertex.com/blogs/ideas/x", fotoUrl: "https://cdn.shopify.com/x.jpg" } }));
assert.equal(validarItem("basura"), null);
assert.throws(() => itemDeEscena({ id: "x", nombre: "x", ocasiones: [], escena: escenaAro, fuente: { tipo: "idea-sempertex", titulo: "x", fotoUrl: "file:///C:/foto.jpg" } }));
console.log("OK biblioteca propia");
