/**
 * Globos impresos, metalizados y las ideas que dependen de ellos (taller 3D). Sin coste: no llama a ninguna IA.
 * - cada impreso del catálogo de la tienda (75) tiene un estampado válido, un formato que existe y que la tienda vende,
 *   color base y surtido que se fabrican en ese formato, nombre y url únicos;
 * - cada metalizado de la tienda (39; 37 son globos) arma con su contorno: polígono cerrado antihorario, huecos dentro
 *   y horarios, del alto de su talla; los números 0–9, las letras A–Z y las figuras arman; el 0, el 6, el 8 y el 9
 *   tienen sus huecos; la pieza «metalizado» da paneles de foil, no da materiales de látex y lista su producto;
 * - poner impresos en una pieza: cambia el color base (no en un surtido), pone estampado y frente, ajusta los
 *   materiales (siguen sumando los globos) y lista el producto con su cantidad;
 * - cada idea arma sin avisos; todo impreso y metalizado de su ficha sale en lo armado (y nada que no esté en la
 *   ficha), con la cantidad contada; sus globos usan colores que existen en su formato;
 * - determinismo: armar dos veces da lo mismo (contornos, piezas, ideas).
 */
import assert from "node:assert/strict";
import { IMPRESOS_TIENDA, aplicarImpresos, impresoDelColor, impresoPorUrl, type ImpresoCatalogo } from "../../src/lib/globos3d/impresos-catalogo";
import { CARACTERES_METALIZADO, METALIZADOS_TIENDA, contornoMetalizado, metalizadoDeTienda, metalizadoPorUrl, type FormaMetalizado } from "../../src/lib/globos3d/metalizados";
import { erroresImpreso, estampadoCara, EXPRESIONES_CARA } from "../../src/lib/globos3d/estampados";
import { IDEAS_IMPRESOS } from "../../src/lib/globos3d/ideas-impresos";
import { armarPieza, type Pieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import type { ProductoDePieza } from "../../src/lib/globos3d/escenografia";
import type { Punto2 } from "../../src/lib/globos3d/trenza";

const existe = (formatoId: string, codigo: string) => coloresDelFormato(formatoId).some((c) => c.codigo === codigo);
const area = (p: readonly Punto2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]!; return s + a.x * b.y - b.x * a.y; }, 0) / 2;
function dentro(x: number, y: number, poli: readonly Punto2[]): boolean {
  let d = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i]!, b = poli[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) d = !d;
  }
  return d;
}

// ----------------------------------------------------------------------------------------------------------
// 1. Catálogo de impresos
// ----------------------------------------------------------------------------------------------------------
assert.equal(IMPRESOS_TIENDA.length, 75, "75 impresos de la tienda");
assert.equal(new Set(IMPRESOS_TIENDA.map((i) => i.id)).size, 75, "ids únicos");
assert.equal(new Set(IMPRESOS_TIENDA.map((i) => i.url)).size, 75, "urls únicas");
for (const i of IMPRESOS_TIENDA) {
  const donde = `${i.id}`;
  assert.match(i.url, /^\/products\/[a-z0-9-]+$/, `${donde}: url relativa de la tienda`);
  assert.match(i.nombre, /^GLOBO /, `${donde}: nombre de la tienda`);
  assert.ok(formatoPorId(i.formatoId), `${donde}: formato ${i.formatoId} existe`);
  assert.ok(i.tallas.includes(i.formatoId), `${donde}: la tienda lo vende en ${i.formatoId} (${i.tallas.join(", ")})`);
  assert.ok(existe(i.formatoId, i.codigoBase), `${donde}: color base ${i.codigoBase} existe en ${i.formatoId}`);
  for (const c of i.surtido ?? []) assert.ok(existe(i.formatoId, c), `${donde}: surtido ${c} existe en ${i.formatoId}`);
  if (i.surtido) assert.equal(i.codigoBase, i.surtido[0], `${donde}: en un surtido, el color base es el primero`);
  assert.deepEqual(erroresImpreso(i.estampado), [], `${donde}: estampado válido`);
  for (const [c, e] of Object.entries(i.porColor ?? {})) {
    assert.ok(i.surtido?.includes(c), `${donde}: porColor ${c} es del surtido`);
    assert.deepEqual(erroresImpreso(e), [], `${donde}: estampado de ${c} válido`);
  }
  assert.equal(i.estampado.repetir === 1 || i.caras !== "1 cara", true, `${donde}: «1 cara» no repite`);
  if (i.caras === "2 caras") assert.ok(i.estampado.repetir >= 2 || i.estampado.capas.every((c) => c.tipo === "patron"), `${donde}: «2 caras» lleva lo de frente en las dos caras`);
  assert.equal(impresoPorUrl(`https://sempertex.com${i.url}`), i, `${donde}: se encuentra por url completa`);
}
// Lo que el mapeo de las ideas daba como C-12 y es redondo.
assert.equal(IMPRESOS_TIENDA.find((i) => i.id === "infinity-corazones-modernos-fashion-surtido")?.formatoId, "R-12");
assert.equal(IMPRESOS_TIENDA.filter((i) => i.formatoId === "C-12").map((i) => i.id).join(), "corazon-2-caras-love-fashion-rojo", "el único C-12 es el corazón 2 caras LOVE");
// La tinta según el color del surtido.
const mama = IMPRESOS_TIENDA.find((i) => i.id === "infinity-feliz-dia-mama-corazones-fashion-surtido-rojo-blanco")!;
assert.notDeepEqual(impresoDelColor(mama, "015"), impresoDelColor(mama, "005"), "rojo y blanco llevan tinta distinta");
for (const e of EXPRESIONES_CARA) assert.deepEqual(erroresImpreso(estampadoCara(e).impreso!), [], `cara ${e} válida`);
assert.ok(erroresImpreso({ capas: [], repetir: 1 }).length > 0, "sin capas es un error");
assert.ok(erroresImpreso({ capas: [{ tipo: "patron", motivo: "corazon", tintas: [{ hex: "rojo" }], porVuelta: 8, tamanoGrados: 10 }], repetir: 1 }).length > 0, "una tinta que no es hex es un error");

// ----------------------------------------------------------------------------------------------------------
// 2. Metalizados
// ----------------------------------------------------------------------------------------------------------
function revisarContorno(c: { contorno: Punto2[]; huecos: Punto2[][] }, donde: string) {
  assert.ok(c.contorno.length >= 8, `${donde}: contorno con puntos (${c.contorno.length})`);
  assert.ok(area(c.contorno) > 0, `${donde}: contorno antihorario`);
  for (const p of c.contorno) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${donde}: puntos finitos`);
  for (const h of c.huecos) {
    assert.ok(area(h) < 0, `${donde}: hueco horario`);
    assert.ok(Math.abs(area(h)) < area(c.contorno) * 0.5, `${donde}: hueco más chico que la figura`);
    for (const p of h) assert.ok(dentro(p.x, p.y, c.contorno), `${donde}: el hueco queda dentro`);
  }
}
const formas: FormaMetalizado[] = [
  ...CARACTERES_METALIZADO.map((c): FormaMetalizado => (/[0-9]/.test(c) ? { tipo: "numero", valor: Number(c) } : { tipo: "letra", valor: c })),
  ...(["corazon", "estrella", "redondo", "luna", "flor", "nube"] as const).map((tipo): FormaMetalizado => ({ tipo })),
];
assert.equal(CARACTERES_METALIZADO.length, 36, "0–9 y A–Z");
for (const f of formas) {
  if (f.tipo === "letras") continue;
  const c = contornoMetalizado(f, 100);
  revisarContorno(c, JSON.stringify(f));
  const ys = c.contorno.map((p) => p.y), xs = c.contorno.map((p) => p.x);
  assert.ok(Math.abs(Math.min(...ys)) < 0.01 && Math.abs(Math.max(...ys) - 100) < 0.01, `${JSON.stringify(f)}: base en 0 y alto 100`);
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 0.5, `${JSON.stringify(f)}: centrado en x`);
  assert.deepEqual(contornoMetalizado(f, 100), c, `${JSON.stringify(f)}: determinista`);
}
const huecos = (v: number) => contornoMetalizado({ tipo: "numero", valor: v }, 80).huecos.length;
assert.equal(huecos(0), 1, "el 0 tiene su hueco");
assert.equal(huecos(8), 2, "el 8 tiene dos huecos");
assert.equal(huecos(6), 1, "el 6 tiene su hueco");
assert.equal(huecos(9), 1, "el 9 tiene su hueco");
assert.equal(huecos(1), 0, "el 1 no tiene huecos");
assert.ok(contornoMetalizado({ tipo: "letra", valor: "B" }, 40).huecos.length === 2, "la B tiene dos huecos");

assert.equal(METALIZADOS_TIENDA.length, 39, "39 metalizados de la tienda");
assert.equal(new Set(METALIZADOS_TIENDA.map((m) => m.url)).size, 39, "urls únicas");
const globos = METALIZADOS_TIENDA.filter((m) => m.metalizado);
assert.equal(globos.length, 37, "37 son globos (un plato y una cortina no)");
for (const m of METALIZADOS_TIENDA) {
  assert.match(m.url, /^\/products\/[a-z0-9-]+$/, `${m.id}: url relativa`);
  assert.equal(metalizadoPorUrl(m.url), m);
  if (!m.metalizado) { assert.ok(m.nota, `${m.id}: dice por qué no es globo`); continue; }
  assert.ok(m.tallas.includes(m.metalizado.pulgadas), `${m.id}: la tienda lo vende en ${m.metalizado.pulgadas}"`);
  const pieza: Pieza = { tipo: "metalizado", metalizado: metalizadoDeTienda(m.id) };
  const armada = armarPieza(pieza);
  assert.equal(armada.globos.length, 0, `${m.id}: no es látex`);
  assert.equal(armada.materiales.length, 0, `${m.id}: no da materiales de látex`);
  assert.deepEqual(armada.productos, [{ nombre: m.nombre, url: m.url, cantidad: 1 }], `${m.id}: lista su producto`);
  const paneles = (armada.solidos ?? []).filter((s) => s.forma === "panel" && (s.acabado === "foil" || s.acabado === "foil_mate"));
  const f = m.metalizado.forma;
  assert.equal(paneles.length, f.tipo === "letras" ? f.texto.length : f.tipo === "flor" ? 2 : 1, `${m.id}: un panel de foil por globo (y el centro de la flor)`);
  for (const s of paneles) if (s.forma === "panel") revisarContorno(s, m.id);
  const alto = armada.caja.max.y - armada.caja.min.y;
  const esperado = m.metalizado.pulgadas * 2.54;
  assert.ok(alto > esperado * 0.85 && alto < esperado * 1.05, `${m.id}: alto ${alto.toFixed(1)} cm para ${m.metalizado.pulgadas}"`);
  const grosor = armada.caja.max.z - armada.caja.min.z;
  assert.ok(grosor > 4 && grosor < alto * 0.4, `${m.id}: grosor de foil inflado (${grosor.toFixed(1)} cm)`);
  assert.deepEqual(armarPieza(pieza), armada, `${m.id}: determinista`);
}
// Con cinta flota: la base del foil sobre la cinta, y la cinta (papel) baja al peso.
const flotando = armarPieza({ tipo: "metalizado", metalizado: metalizadoDeTienda("estrella-plata-1", { cinta: { largoCm: 120, hex: "#ffffff" } }) });
assert.equal(flotando.tubos.length, 1);
assert.ok(flotando.tubos[0]!.papel, "la cinta es papel");
assert.ok(Math.min(...flotando.tubos[0]!.puntos.map((p) => p.y)) < 0.5, "la cinta llega al peso");
assert.ok(flotando.caja.max.y > 120 + 40, "el foil queda arriba");
// Acostado mira arriba.
const acostado = armarPieza({ tipo: "metalizado", metalizado: { ...metalizadoDeTienda("numero-2-latte"), acostado: true } });
assert.ok(acostado.caja.max.y - acostado.caja.min.y < 20, "acostado queda bajito");
// Números foil de 16", 32", 34" y 40".
for (const pulgadas of [16, 32, 34, 40]) {
  const a = armarPieza({ tipo: "metalizado", metalizado: { forma: { tipo: "numero", valor: 7 }, pulgadas, color: "oro" } });
  assert.ok(Math.abs(a.caja.max.y - a.caja.min.y - pulgadas * 2.54) < 2, `número de ${pulgadas}" mide su alto`);
}

// ----------------------------------------------------------------------------------------------------------
// 3. Impresos en una pieza
// ----------------------------------------------------------------------------------------------------------
const columna: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 120, patron: "salvavidas", colores: ["015", "009"] };
const lisa = armarPieza(columna);
const conImpresos = armarPieza({ ...columna, impresos: [{ impresoId: "infinity-corazones-por-siempre-fashion-surtido-rojo-blanco", codigo: "009" }] });
const total = (a: PiezaArmada) => a.materiales.reduce((s, m) => s + m.cantidad, 0);
const rosados = lisa.globos.filter((g) => g.codigo === "009").length;
assert.ok(rosados > 0);
assert.equal(total(conImpresos), lisa.globos.length, "los materiales siguen sumando los globos");
assert.equal(conImpresos.materiales.find((m) => m.codigo === "009"), undefined, "los rosados pasaron al blanco del impreso");
assert.equal(conImpresos.materiales.find((m) => m.codigo === "005")?.cantidad, rosados, "cuentan como blancos");
assert.deepEqual(conImpresos.productos, [{ nombre: "GLOBO REDONDO INFINITY® CORAZONES POR SIEMPRE FASHION SURTIDO ROJO - BLANCO", url: "/products/globo-para-fiesta-latex-redondo-infinity-corazones-por-siempre-fashion-surtido-rojo-blanco", cantidad: rosados }]);
for (const g of conImpresos.globos) {
  if (g.codigo !== "005") { assert.equal(g.estampado, undefined, "los rojos quedan lisos"); continue; }
  assert.ok(g.estampado?.impreso && g.frente, "los impresos llevan estampado y frente");
  const d = g.direccion, f = g.frente;
  assert.ok(Math.abs(d.x * f.x + d.y * f.y + d.z * f.z) < 1e-6, "el frente es perpendicular al eje");
}
// En un surtido se queda el color del globo (rojo del surtido rojo-blanco), con su tinta.
const rojos = armarPieza({ ...columna, impresos: [{ impresoId: "infinity-corazones-por-siempre-fashion-surtido-rojo-blanco", codigo: "015", cada: 2 }] });
const impresosRojos = rojos.globos.filter((g) => g.estampado);
assert.equal(impresosRojos.length, Math.ceil(lisa.globos.filter((g) => g.codigo === "015").length / 2), "uno de cada dos");
assert.ok(impresosRojos.every((g) => g.codigo === "015"), "surtido: se queda el rojo");
assert.deepEqual(impresosRojos[0]!.estampado!.impreso, IMPRESOS_TIENDA.find((i) => i.id === "infinity-corazones-por-siempre-fashion-surtido-rojo-blanco")!.porColor!["015"], "con la tinta del rojo");
const malo = aplicarImpresos(lisa.globos, lisa.materiales, [{ impresoId: "no-existe", codigo: "015" }, { impresoId: "infinity-polka-blanco-fashion-rojo", codigo: "080" }]);
assert.equal(malo.avisos.length, 2, "avisa lo que no existe y lo que no encuentra globos");
assert.deepEqual(malo.globos, lisa.globos, "y no cambia nada");

// ----------------------------------------------------------------------------------------------------------
// 4. Ideas
// ----------------------------------------------------------------------------------------------------------
assert.ok(IDEAS_IMPRESOS.length >= 8 && IDEAS_IMPRESOS.length <= 10, `8–10 ideas (${IDEAS_IMPRESOS.length})`);
assert.equal(new Set(IDEAS_IMPRESOS.map((i) => i.slug)).size, IDEAS_IMPRESOS.length, "slugs únicos");
const sumar = (lista: ProductoDePieza[], p: ProductoDePieza[]) => { for (const x of p) { const ya = lista.find((y) => y.url === x.url); if (ya) ya.cantidad += x.cantidad; else lista.push({ ...x }); } };
for (const idea of IDEAS_IMPRESOS) {
  assert.equal(idea.url, `https://sempertex.com/blogs/idea-de-fiesta/${idea.slug}`, `${idea.slug}: url de la idea`);
  assert.equal(idea.id, `idea:${idea.slug}`);
  assert.match(idea.fotoUrl, /^https:\/\/sempertex\.com\/cdn\//, `${idea.slug}: foto pública`);
  assert.ok(idea.nota.includes("Se parece") && idea.nota.includes("No:"), `${idea.slug}: nota honesta`);
  const piezas: PiezaArmada[] = [];
  if (idea.contenido.tipo === "pieza") piezas.push(armarPieza(idea.contenido.pieza));
  else {
    const armada = armarEscena(idea.contenido.escena);
    assert.deepEqual(armada.avisos, [], `${idea.slug}: la escena arma sin avisos`);
    for (const n of armada.porNodo) assert.deepEqual(n.avisos, [], `${idea.slug}/${n.id}: sin avisos`);
    for (const n of idea.contenido.escena.nodos) piezas.push(armarPieza(n.pieza));
    // Todo dentro de la sala y nada bajo el piso.
    assert.ok(armada.porNodo.every((n) => n.caja.min.y > -1), `${idea.slug}: nada bajo el piso`);
    assert.deepEqual(armarEscena(idea.contenido.escena), armada, `${idea.slug}: determinista`);
  }
  for (const p of piezas) for (const g of p.globos) assert.ok(existe(g.formatoId, g.codigo), `${idea.slug}: ${g.formatoId} ${g.codigo} existe`);
  const productos: ProductoDePieza[] = [];
  for (const p of piezas) sumar(productos, p.productos ?? []);
  const deFicha = idea.productos.filter((p) => impresoPorUrl(p.url) || metalizadoPorUrl(p.url));
  assert.ok(deFicha.length > 0, `${idea.slug}: depende de impresos o metalizados`);
  for (const p of deFicha) {
    const armado = productos.find((x) => x.url === p.url);
    assert.ok(armado, `${idea.slug}: ${p.nombre} sale en lo armado`);
    if (p.cantidad !== null) assert.equal(armado.cantidad, p.cantidad, `${idea.slug}: ${p.nombre} × ${p.cantidad}`);
  }
  for (const x of productos) assert.ok(idea.productos.some((p) => p.url === x.url), `${idea.slug}: ${x.nombre} está en la ficha`);
  // Los lisos contados: lo armado tiene esa cantidad de globos de ese formato y color.
  for (const p of idea.productos) {
    if (p.cantidad === null || !p.formato || !p.codigo || impresoPorUrl(p.url) || metalizadoPorUrl(p.url)) continue;
    const armados = piezas.reduce((s, a) => s + a.globos.filter((g) => g.formatoId === p.formato && g.codigo === p.codigo && !g.estampado).length, 0);
    assert.equal(armados, p.cantidad, `${idea.slug}: ${p.nombre} × ${p.cantidad} lisos`);
  }
}
// Las cuatro cifras del 2025, de pie en la pata derecha del arco.
const arco = IDEAS_IMPRESOS.find((i) => i.slug === "arco-ano-nuevo")!;
assert.equal(arco.contenido.tipo === "escena" && arco.contenido.escena.nodos.filter((n) => n.pieza.tipo === "metalizado").length, 4);

const usados = new Set<ImpresoCatalogo["id"]>();
for (const idea of IDEAS_IMPRESOS) for (const p of idea.productos) { const i = impresoPorUrl(p.url); if (i) usados.add(i.id); }
console.log(`OK impresos y metalizados: ${IMPRESOS_TIENDA.length} impresos, ${METALIZADOS_TIENDA.length} metalizados (${globos.length} globos), ${formas.length} contornos, ${IDEAS_IMPRESOS.length} ideas (${usados.size} impresos distintos en ellas)`);
