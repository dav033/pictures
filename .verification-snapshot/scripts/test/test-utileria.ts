/**
 * Prueba sin coste de la utilería de fiesta (`utileria.ts`, `utileria-escenas.ts`, `utileria-catalogo.ts`):
 * - cada pieza (y cada una del grupo «Utilería de fiesta») se arma, es escenografía sin materiales de globo, apoya su
 *   base en y = 0 y lleva su producto (nombre exacto y url del catálogo, o «genérico»);
 * - el cordón del banderín es una catenaria que pasa por sus dos puntos con la caída pedida, y en las escenas de
 *   Halloween ni el cordón ni los banderines atraviesan globos;
 * - la utilería de mesa queda apoyada sobre la tapa de su mesa (±1 cm);
 * - la lista «Productos de fiesta» trae cada producto con su nombre exacto y su url;
 * - los globos de las escenas no cambian por la utilería.
 */
import assert from "node:assert/strict";
import { armarEscena, type Escena, type EscenaArmada, type NodoArmado } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { puntosSolido } from "../../src/lib/globos3d/escenografia";
import type { Vec3 } from "../../src/lib/globos3d/modulos";
import { CATALOGO_UTILERIA, productoCatalogo } from "../../src/lib/globos3d/utileria-catalogo";
import {
  agregarUtileria, bandeja, banderin, bolsaDulces, cajaRegalo, calabazaDulces, catenaria, cordonBanderin, cubiertos, gorrito, letrero, mantel, paquete, platos,
  productosDeFiesta, puntosBanderinEn, servilletas, sobreMesa, superficieEn, vasos, velas,
} from "../../src/lib/globos3d/utileria";
import { UTILERIA_LISTA } from "../../src/lib/globos3d/utileria-escenas";

const resumen: string[] = [];
const cerca = (a: number, b: number, tol: number, msj: string) => assert.ok(Math.abs(a - b) <= tol, `${msj}: ${a.toFixed(2)} vs ${b.toFixed(2)}`);

// 1. Catálogo: handles únicos, urls de producto y nombres no vacíos.
{
  const ids = new Set<string>();
  for (const p of CATALOGO_UTILERIA) {
    assert.ok(!ids.has(p.id), `id repetido ${p.id}`);
    ids.add(p.id);
    assert.ok(p.url === `/products/${p.id}`, `url de ${p.id}`);
    assert.ok(p.nombre.trim().length > 2, `nombre de ${p.id}`);
  }
  const halloween = CATALOGO_UTILERIA.filter((p) => p.tematica.startsWith("halloween")).length;
  assert.ok(CATALOGO_UTILERIA.length > 500 && halloween > 60, "el catálogo trae la utilería de la tienda");
  resumen.push(`catálogo ${CATALOGO_UTILERIA.length} productos (${halloween} de Halloween)`);
}

// 2. Cada pieza se arma: escenografía sin globos ni materiales, base en y = 0, con su producto.
const PIEZAS: Array<[string, Pieza]> = [
  ["banderín", banderin({ recorrido: { tipo: "recto", desde: { x: -100, y: 0, z: 0 }, hasta: { x: 100, y: 10, z: 0 } }, caidaCm: 20, cantidad: 9, forma: "triangulo", anchoCm: 18, altoCm: 24, colores: ["#f07a1a", "#6d3a8f"], motivos: [{ dibujo: "calavera" }, { dibujo: "murcielago" }, { dibujo: "calabaza" }, { dibujo: "texto", texto: "Happy Halloween" }], cordon: "#1a1414", productoId: "cartel-de-letras-happy-halloween" })],
  ["platos", platos({ cantidad: 5, diametroCm: 18, hex: "#f07a1a", motivo: { dibujo: "lunares" }, productoId: "plato-desechable-polka-rayas-naranja-negro" })],
  ["plato de pie", platos({ cantidad: 1, diametroCm: 23, hex: "#9b6fc6", dePie: true, productoId: "plato-deluxe-oxo", variante: "lila" })],
  ["vasos", vasos({ cantidad: 3, altoCm: 9, diametroCm: 7.5, hex: "#f07a1a", servilleta: "#8cc63f", productoId: "vaso-desechable-halloween-noche", servilletaProductoId: "servilleta-polka-verde-lima" })],
  ["servilletas", servilletas({ cantidad: 10, ladoCm: 12.5, hex: "#9b6fc6", productoId: "servilleta-polka-lila" })],
  ["cubiertos", cubiertos({ juegos: 2, hex: "#1a1414", productoIds: { tenedor: "tenedor-desechable-deluxe-oxo", cuchillo: "cuchillo-desechable-deluxe-oxo", cuchara: "cuchara-desechable-deluxe-oxo" } })],
  ["bandeja", bandeja({ anchoCm: 28, fondoCm: 20, hex: "#f07a1a", productoId: "bandeja-telarana-naranja" })],
  ["bolsa", bolsaDulces({ anchoCm: 25, altoCm: 26, fondoCm: 8, hex: "#f07a1a", motivo: { dibujo: "calabaza" }, productoId: "bolsita-dulces-halloween-calabaza" })],
  ["cubeta", calabazaDulces({ diametroCm: 19, altoCm: 15, hex: "#f07a1a", productoId: "balde-calabaza" })],
  ["gorrito", gorrito({ altoCm: 16, diametroCm: 11, hex: "#d4af37", productoId: "gorros-metalizado-feliz-ano" })],
  ["letrero", letrero({ forma: "calabaza", anchoCm: 30, altoCm: 26, hex: "#f07a1a", motivo: { dibujo: "calabaza" }, apoyo: "atril", productoId: null })],
  ["topper", letrero({ forma: "rectangulo", anchoCm: 12, altoCm: 6, hex: "#f4a6c0", motivo: { dibujo: "texto", texto: "Feliz cumpleaños" }, apoyo: "palito", productoId: "topper-feliz-cumpleanos-fantasia" })],
  ["velas", velas({ cantidad: 6, altoCm: 6, hex: "#e0218a", productoId: "vela-espiralada-neon" })],
  ["caja de regalo", cajaRegalo({ ladoCm: 20, altoCm: 16, hex: "#6d3a8f", liston: "#8cc63f", productoId: null })],
  ["paquete", paquete({ anchoCm: 20, altoCm: 26, fondoCm: 3, hex: "#1a1414", motivo: { dibujo: "texto", texto: "Halloween" }, productoId: "kit-desechable-fantasmitas" })],
  ["mantel", mantel({ anchoCm: 120, fondoCm: 60, caidaCm: 40, hex: "#1a1414", productoId: "mantel-fiesta-desechable-plastico-rectangular" })],
  ...UTILERIA_LISTA.map((u): [string, Pieza] => [`lista ${u.id}`, u.crear()]),
];
for (const [nombre, pieza] of PIEZAS) {
  assert.equal(pieza.tipo, "escenografia", `${nombre}: es escenografía`);
  if (pieza.tipo !== "escenografia") continue;
  const armada = armarPieza(pieza);
  assert.ok(armada.solidos && armada.solidos.length > 0, `${nombre}: tiene sólidos`);
  assert.equal(armada.globos.length + armada.materiales.length, 0, `${nombre}: no es globo ni da materiales de globo`);
  for (const s of armada.solidos) for (const q of puntosSolido(s)) assert.ok([q.x, q.y, q.z].every(Number.isFinite), `${nombre}: puntos finitos`);
  assert.ok(pieza.utileria, `${nombre}: dice qué utilería es`);
  assert.ok(pieza.productos?.length, `${nombre}: lleva su producto`);
  for (const p of pieza.productos ?? []) {
    assert.ok(p.cantidad >= 1, `${nombre}: cantidad`);
    if (p.generico) assert.ok(p.nombre.startsWith("Genérico") && p.url === "", `${nombre}: genérico marcado`);
    else assert.equal(productoCatalogo(p.url.replace("/products/", ""))?.nombre, p.nombre, `${nombre}: nombre exacto del catálogo`);
  }
  // La base en y = 0 (el banderín cuelga de su cordón y el mantel cae desde la tapa: no apoyan).
  if (pieza.utileria !== "banderin" && pieza.utileria !== "mantel") cerca(armada.caja.min.y, 0, 0.35, `${nombre}: apoya en y = 0`);
}
resumen.push(`${PIEZAS.length} piezas arman`);

// 3. Catenaria: pasa por sus dos puntos, baja la caída pedida en el medio y es convexa (cuelga, no hace panza arriba).
{
  const desde: Vec3 = { x: -120, y: 200, z: -50 }, hasta: Vec3 = { x: 90, y: 185, z: -40 };
  const puntos = catenaria(desde, hasta, 25, 64);
  cerca(puntos[0]!.x, desde.x, 0.01, "empieza en «desde»"); cerca(puntos[0]!.y, desde.y, 0.01, "empieza en «desde» (y)");
  cerca(puntos[64]!.x, hasta.x, 0.01, "acaba en «hasta»"); cerca(puntos[64]!.y, hasta.y, 0.05, "acaba en «hasta» (y)"); cerca(puntos[64]!.z, hasta.z, 0.01, "acaba en «hasta» (z)");
  cerca((desde.y + hasta.y) / 2 - puntos[32]!.y, 25, 0.3, "caída en el medio");
  for (let i = 1; i < 64; i++) assert.ok(puntos[i - 1]!.y + puntos[i + 1]!.y - 2 * puntos[i]!.y >= -1e-6, "convexa");
  // Con caída 0 es recta; alrededor de una mesa, sus extremos quedan en el círculo.
  const recta = catenaria(desde, hasta, 0, 8);
  cerca(recta[4]!.y, (desde.y + hasta.y) / 2, 1e-6, "sin caída, recta");
  const arco = cordonBanderin({ recorrido: { tipo: "arco", radioCm: 33, desdeGrados: -70, hastaGrados: 70 }, caidaCm: 3 });
  for (const p of arco) cerca(Math.hypot(p.x, p.z), 33, 0.01, "el cordón rodea la mesa");
  cerca(-Math.min(...arco.map((p) => p.y)), 3, 0.05, "caída del cordón de la mesa");
}

// 4. Las escenas de Halloween: banderines sin atravesar globos, utilería de mesa apoyada, productos y globos intactos.
type Cuerpo = { c: Vec3; r: number };
const cuerpos = (a: EscenaArmada | NodoArmado): Cuerpo[] => a.globos.map((g) => {
  const r = g.infladoCm / 2, l = r + g.cuelloExtraCm;
  return { c: { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l }, r };
});
/** Lo que se mete el punto en el globo más metido (cm; ≤ 0 si no toca ninguno). */
const metido = (p: Vec3, todos: readonly Cuerpo[]) => Math.max(-Infinity, ...todos.map((b) => b.r - Math.hypot(p.x - b.c.x, p.y - b.c.y, p.z - b.c.z)));
const sinUtileria = (e: Escena): Escena => ({ ...e, nodos: e.nodos.filter((n) => !(n.pieza.tipo === "escenografia" && n.pieza.utileria)) });
const DE_MESA = new Set(["plato", "vaso", "servilleta", "cubiertos", "bandeja"]);

const ESPERADOS: Record<string, { banderines: number; deMesa: number; productos: string[] }> = {
  halloween_marco_mesas: { banderines: 3, deMesa: 8, productos: ["FESTON FANTASMA BLANCO - NEGRO", "CARTEL DE LETRAS HAPPY HALLOWEEN", "PLATO DELUXE OXO GRANDE", "PLATO HAPPY HALLOWEEN", "VASO DELUXE OXO PEQUEÑO", "SERVILLETA POLKA LILA", "BALDE CALABAZA", "BOLSITA DULCES HALLOWEEN CALABAZA", "KIT DESECHABLE FANTASMITAS"] },
  halloween_arco_calabazas: { banderines: 1, deMesa: 6, productos: ["CARTEL DE LETRAS HAPPY HALLOWEEN", "PLATO POLKA / RAYAS NARANJA-NEGRO", "VASO HALLOWEEN NOCHE", "SERVILLETA HALLOWEEN NOCHE", "BANDEJA OVALADA DELUXE OXO", "TENEDOR DELUXE OXO"] },
};
for (const [id, esperado] of Object.entries(ESPERADOS)) {
  const escena = escenaPredefinida(id);
  const a = armarEscena(escena);
  assert.equal(a.avisos.length, 0, `${id}: sin avisos (${a.avisos.join(" ")})`);
  const globos = cuerpos(a);
  const utileria = escena.nodos.filter((n) => n.pieza.tipo === "escenografia" && n.pieza.utileria);
  // Banderines: ni el cordón ni los banderines se meten en un globo (0,5 cm de tolerancia por el redondeo).
  const banderines = utileria.filter((n) => n.pieza.tipo === "escenografia" && n.pieza.utileria === "banderin");
  assert.equal(banderines.length, esperado.banderines, `${id}: banderines`);
  let peor = -Infinity;
  for (const n of banderines) {
    const hecho = a.porNodo.find((x) => x.id === n.id)!;
    assert.equal(hecho.copias, 1, `${id}/${n.id}: puesto`);
    for (const s of hecho.solidos) for (const q of puntosSolido(s)) { const m = metido(q, globos); peor = Math.max(peor, m); assert.ok(m <= 0.5, `${id}/${n.id}: atraviesa un globo ${m.toFixed(1)} cm`); }
  }
  // Utilería de mesa: su base sobre la tapa de lo que tiene debajo (±1 cm).
  // (Los platos negros de la foto 1 van en el piso, sobre el tapete: no cuentan como de mesa.)
  const deMesa = utileria.filter((n) => n.pieza.tipo === "escenografia" && DE_MESA.has(n.pieza.utileria ?? "") && (a.porNodo.find((x) => x.id === n.id)?.caja.min.y ?? 0) > 30);
  assert.equal(deMesa.length, esperado.deMesa, `${id}: utilería de mesa`);
  const mesas = a.porNodo.filter((x) => escena.nodos.find((n) => n.id === x.id)?.pieza.tipo === "escenografia" && !utileria.some((u) => u.id === x.id));
  for (const n of deMesa) {
    const hecho = a.porNodo.find((x) => x.id === n.id)!;
    const cx = (hecho.caja.min.x + hecho.caja.max.x) / 2, cz = (hecho.caja.min.z + hecho.caja.max.z) / 2;
    const tapas = mesas.map((m) => superficieEn(m.solidos, cx, cz)).filter((y): y is number => y !== null && y > 30);
    assert.ok(tapas.length > 0, `${id}/${n.id}: hay una mesa debajo`);
    cerca(hecho.caja.min.y, Math.max(...tapas), 1, `${id}/${n.id}: apoyada en la tapa`);
  }
  // Productos de fiesta: cada uno con su nombre exacto y su url del catálogo; genérico solo el letrero.
  const productos = productosDeFiesta(escena, a);
  for (const nombre of esperado.productos) assert.ok(productos.some((p) => p.nombre === nombre), `${id}: falta «${nombre}» en la lista`);
  for (const p of productos) {
    if (p.generico) { assert.ok(p.url === "" && p.nombre.startsWith("Genérico"), `${id}: genérico`); continue; }
    const c = productoCatalogo(p.url.replace("/products/", ""));
    assert.ok(c && c.nombre === p.nombre && c.url === p.url, `${id}: «${p.nombre}» con su url ${p.url}`);
    assert.ok(p.cantidad >= 1 && p.piezas.length > 0, `${id}: cantidad y piezas de «${p.nombre}»`);
  }
  assert.ok(productos.filter((p) => p.generico).every((p) => /letrero/.test(p.nombre)), `${id}: solo el letrero es genérico`);
  // Los globos y los materiales no cambian por la utilería.
  const sola = armarEscena(sinUtileria(escena));
  assert.equal(JSON.stringify(a.globos), JSON.stringify(sola.globos), `${id}: los globos no cambian`);
  assert.equal(JSON.stringify(a.materiales), JSON.stringify(sola.materiales), `${id}: los materiales no cambian`);
  resumen.push(`${id.replace("halloween_", "")}: ${utileria.length} piezas de utilería, ${productos.length} productos, banderín a ${(-peor).toFixed(1)} cm del globo más cercano`);
}

// 5. Foto 2: el banderín cuelga de la cara de dentro de los globos de las patas (a ≤ 3 cm de un globo en cada punta).
{
  const escena = escenaPredefinida("halloween_arco_calabazas");
  const a = armarEscena(escena);
  const arco = a.porNodo.find((n) => n.id === "arco")!;
  const nodo = escena.nodos.find((n) => n.id === "fiesta-banderin-arco")!;
  assert.ok(nodo.pieza.tipo === "escenografia" && nodo.colocacion.en === "libre", "el banderín del arco va suelto");
  const hecho = a.porNodo.find((n) => n.id === nodo.id)!;
  const globosArco = cuerpos(arco);
  for (const x of [hecho.caja.min.x, hecho.caja.max.x]) {
    const punta = { x, y: hecho.caja.max.y - 0.2, z: (hecho.caja.min.z + hecho.caja.max.z) / 2 };
    const distancia = -metido(punta, globosArco);
    assert.ok(distancia <= 3 && distancia >= -0.5, `la punta del banderín toca la pata (${distancia.toFixed(1)} cm)`);
  }
  // Lo mismo con lo que ofrece el grupo: entre dos puntos del arco y sobre la mesa.
  const p = puntosBanderinEn(arco, 0.6);
  const medio = { x: (p.desde.x + p.hasta.x) / 2, y: p.desde.y, z: p.desde.z };
  const lista = UTILERIA_LISTA.find((u) => u.id === "banderin_halloween")!;
  const pieza = lista.crear({ desde: { x: p.desde.x - medio.x, y: 0, z: 0 }, hasta: { x: p.hasta.x - medio.x, y: 0, z: 0 } });
  const conBanderin = agregarUtileria(escena, pieza, { en: "libre", xCm: medio.x, yCm: medio.y, zCm: medio.z, giroGrados: 0 }, "Banderín nuevo", "fiesta-nuevo");
  const enMesa = sobreMesa(conBanderin.escena, "mesa", -30, 18);
  assert.ok(enMesa, "hay tapa en la mesa");
  const conPlatos = agregarUtileria(conBanderin.escena, UTILERIA_LISTA.find((u) => u.id === "platos_halloween")!.crear(), enMesa!, "Platos nuevos", "fiesta-platos-nuevos");
  const b = armarEscena(conPlatos.escena);
  const nuevo = b.porNodo.find((n) => n.id === conBanderin.id)!;
  for (const s of nuevo.solidos) for (const q of puntosSolido(s)) assert.ok(metido(q, cuerpos(b)) <= 0.5, "el banderín nuevo no atraviesa globos");
  const platosNuevos = b.porNodo.find((n) => n.id === conPlatos.id)!;
  cerca(platosNuevos.caja.min.y, 75.4, 1, "los platos nuevos sobre la mesa");
  assert.ok(productosDeFiesta(conPlatos.escena, b).some((x) => x.nombre === "PLATO POLKA / RAYAS NARANJA-NEGRO"), "los platos nuevos salen en la lista");
  assert.equal(JSON.stringify(b.globos), JSON.stringify(a.globos), "agregar utilería no cambia los globos");
}

console.log(`test-utileria OK · ${resumen.join(" · ")}`);
