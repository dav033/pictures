/**
 * Trazo orgánico (`trazo-organico.ts`): la guirnalda orgánica que sigue cualquier silueta. Sin coste (solo el motor).
 * - cada silueta con nombre arma sin aplastar de más, con globos de varios tamaños y dentro de su caja (±15 %);
 * - las que nacen del piso llegan al piso y las de pared no (sus extremos llevan remate);
 * - el grosor de cada punto se ve: una punta fina no lleva R-24 y el lado cargado lleva más globos;
 * - como pieza con `generador`: escalar (más ancha) y recolorear vuelven a armar bien y conservan el generador;
 * - los datos malos dan un error claro.
 *
 * Run: npx tsx scripts/test/test-trazo-organico.ts
 */
import assert from "node:assert/strict";
import { DESDE_EL_PISO, SILUETAS_TRAZO, MEZCLA_TRAZO, esColumnaTrazo, cajaTrazo, puntosDeSilueta, validarTrazo, type ParametrosTrazoOrganico } from "@/lib/globos3d/trazo-organico";
import { conGenerador, escalarGenerador, piezaDeGenerador } from "@/lib/globos3d/generadores-organicos";
import { armarOrganico, APLASTAMIENTO_MAXIMO } from "@/lib/globos3d/organico";
import { armarPieza } from "@/lib/globos3d/piezas";
import { reemplazarColor } from "@/lib/globos3d/recolorear";
import { DECLARACIONES_ESCENA } from "@/lib/globos3d/herramientas-escena";
import { crearTrazo, floresLeidas, floresPedidas, TIPOS_FOLLAJE } from "@/lib/globos3d/herramientas-escena-trazo";
import { FLORES_ARTIFICIALES, follajeEnIngles } from "@/lib/globos3d/flores-artificiales";

const colores = [{ codigo: "009", peso: 40 }, { codigo: "570", peso: 35 }, { codigo: "005", peso: 25 }];
const trazo = (silueta: (typeof SILUETAS_TRAZO)[number]["id"], anchoCm = 260, altoCm = 180, grosorCm = 50): ParametrosTrazoOrganico =>
  ({ puntos: puntosDeSilueta(silueta, { anchoCm, altoCm, grosorCm }), mezcla: { ...MEZCLA_TRAZO, "R-24": 0.06 }, colores, racimos: 0.4, semilla: 11 });

for (const { id } of SILUETAS_TRAZO.filter((x) => x.grupo === "guirnalda")) {
  const t = trazo(id);
  const pieza = piezaDeGenerador({ tipo: "trazo", trazo: t });
  const r = armarOrganico(pieza.opciones);
  assert.ok(r.globos.length > 60, `${id}: ${r.globos.length} globos`);
  assert.ok(r.medidas.peorAplastamiento <= APLASTAMIENTO_MAXIMO + 0.02, `${id}: aplasta ${r.medidas.peorAplastamiento}`);
  const formatos = new Set(r.globos.map((g) => g.formatoId));
  assert.ok(formatos.size >= 3, `${id}: solo ${[...formatos].join(", ")}`);
  const armada = armarPieza(pieza);
  const ancho = armada.caja.max.x - armada.caja.min.x, alto = armada.caja.max.y - armada.caja.min.y;
  assert.ok(ancho > 260 * 0.85 && ancho < 260 * 1.15, `${id}: ancho ${ancho.toFixed(0)}`);
  assert.ok(alto > 180 * 0.8 && alto < 180 * 1.18, `${id}: alto ${alto.toFixed(0)}`);
  const alPiso = armada.caja.min.y < 8;
  const naceDelPiso = DESDE_EL_PISO.has(id);
  assert.equal(alPiso, naceDelPiso, `${id}: min y ${armada.caja.min.y.toFixed(1)}`);
  const tapas = pieza.opciones.tramos[0]!.tapas!;
  if (id === "feston") assert.deepEqual(tapas, { inicio: true, fin: true });
  if (id === "semiarco_izquierdo") assert.deepEqual(tapas, { inicio: false, fin: true });
}

// Columnas: la irregular es la silueta de una normal (recta, de su grosor); las de forma libre se corren de lado.
for (const { id } of SILUETAS_TRAZO.filter((x) => x.grupo === "columna")) {
  const ancho = id === "columna_recta" ? 60 : 130;
  const pieza = piezaDeGenerador({ tipo: "trazo", trazo: { silueta: id, puntos: puntosDeSilueta(id, { anchoCm: ancho, altoCm: 220, grosorCm: 60 }), mezcla: MEZCLA_TRAZO, colores, semilla: 3 } });
  const caja = armarPieza(pieza).caja;
  assert.ok(caja.min.y < 8, `${id}: nace del piso (${caja.min.y.toFixed(1)})`);
  assert.ok(Math.abs(caja.max.y - caja.min.y - 220) < 35, `${id}: alto ${(caja.max.y - caja.min.y).toFixed(0)}`);
  const anchoArmado = caja.max.x - caja.min.x;
  if (id === "columna_recta") assert.ok(anchoArmado < 95, `recta: ancho ${anchoArmado.toFixed(0)}`);
  else assert.ok(anchoArmado > 105, `${id}: se corre de lado (${anchoArmado.toFixed(0)})`);
  assert.ok(esColumnaTrazo(id) && !esColumnaTrazo("feston"));
}

// El grosor manda: en una punta de 22 cm no cabe un R-24; donde carga hay más globos.
const desigual: ParametrosTrazoOrganico = { puntos: [{ x: -150, y: 150, grosor: 22 }, { x: 0, y: 140, grosor: 45 }, { x: 150, y: 150, grosor: 90 }], mezcla: { "R-24": 0.2, "R-18": 0.2, "R-12": 0.4, "R-9": 0.2 }, colores, semilla: 5 };
const rd = armarOrganico(piezaDeGenerador({ tipo: "trazo", trazo: desigual }).opciones);
assert.ok(!rd.globos.some((g) => g.formatoId === "R-24" && g.fraccion < 0.15), "un R-24 en la punta fina");
const izquierda = rd.globos.filter((g) => g.centro.x < -50).length, derecha = rd.globos.filter((g) => g.centro.x > 50).length;
assert.ok(derecha > izquierda * 1.5, `cargado ${derecha} vs fino ${izquierda}`);

// Editable por el generador.
const base = piezaDeGenerador({ tipo: "trazo", trazo: trazo("feston") });
const ancha = conGenerador(base, escalarGenerador(base.generador!, { anchoCm: 400 }));
const anchoNuevo = armarPieza(ancha).caja;
assert.ok(anchoNuevo.max.x - anchoNuevo.min.x > 360, `más ancha: ${(anchoNuevo.max.x - anchoNuevo.min.x).toFixed(0)}`);
assert.ok(ancha.generador && Math.abs(cajaTrazo(ancha.generador.trazo).anchoCm - 400) <= 1, `${ancha.generador && cajaTrazo(ancha.generador.trazo).anchoCm}`);
const roja = reemplazarColor(base, "009", "005").valor;
assert.equal(roja.generador!.trazo.colores[0]!.codigo, "005", "el recolor alcanza al generador");
assert.equal(roja.opciones.colores[0]!.codigo, "005");

// Datos malos.
assert.match(validarTrazo({ ...trazo("feston"), puntos: [{ x: 0, y: 100, grosor: 40 }] }) ?? "", /al menos 2 puntos/);
assert.match(validarTrazo({ ...trazo("feston"), puntos: [{ x: 0, y: 100, grosor: 4 }, { x: 10, y: 100, grosor: 40 }] }) ?? "", /fuera de rango/);
assert.throws(() => piezaDeGenerador({ tipo: "trazo", trazo: { ...trazo("feston"), colores: [] } }), /color/);

// Follaje pedido por nombre (y color): hojas en los huecos, sin cotizar como globo; los nombres malos dan error.
const conHojas = crearTrazo({ silueta: "feston", ancho_cm: 300, follaje: ["monstera", "palma dorada"] }, colores).pieza;
const hojas = armarPieza(conHojas).flores;
assert.ok(hojas.length >= 4, `${hojas.length} hojas`);
assert.ok(hojas.every((f) => f.tipo === "monstera" || f.tipo === "palma"));
assert.ok(hojas.some((f) => f.tipo === "palma" && f.hex === "#c9a14a"), "la palma dorada");
assert.throws(() => floresPedidas(["girasol"]), /desconocido/);
assert.throws(() => floresPedidas(["monstera azul"]), /viene en/);
assert.match(follajeEnIngles(hojas), /(monstera leaves and gold palm fronds|gold palm fronds and monstera leaves)/);

// La pampa: «pampa», «pampas», «pasto de la pampa»… son el tipo `pampa` (plumas), no la hoja seca (el abanico dorado).
for (const pedido of ["pampa", "pampas", "Pampas  Grass", "pasto de la pampa", "hierba de la pampa", "plumas de pampa"]) {
  const r = floresPedidas([pedido]);
  assert.deepEqual(r.proporcion.map((p) => [p.tipo, p.colorId]), [["pampa", "beige"]], pedido);
}
assert.deepEqual(floresPedidas(["pasto de la pampa beige"]).proporcion.map((p) => [p.tipo, p.colorId]), [["pampa", "beige"]], "el color va tras el alias largo");
assert.deepEqual(floresPedidas(["pampas rosa", "hoja_seca dorada"]).proporcion.map((p) => [p.tipo, p.colorId]), [["pampa", "rosa"], ["hoja_seca", "dorada"]], "la hoja seca sigue siendo la hoja seca");
assert.throws(() => floresPedidas(["pasto de la pampa verde"]), /viene en beige, crema/);
// Los colores llegan en plural o concordados, como los dicta la gente.
for (const [pedido, colorId] of [["pampas doradas", "dorada"], ["pampa dorado", "dorada"], ["pampas blancas", "blanca"], ["pampas rosas", "rosa"], ["pampa natural", "beige"], ["pampas café", "beige"], ["pampa marrón", "beige"], ["Pampas Terracota", "terracota"], ["pampa grass", "beige"], ["pampa grass cremas", "crema"], ["pampa beiges", "beige"]] as const) {
  assert.deepEqual(floresPedidas([pedido]).proporcion.map((p) => [p.tipo, p.colorId]), [["pampa", colorId]], pedido);
}
assert.deepEqual(floresPedidas(["rosas blancas", "monstera dorada"]).proporcion.map((p) => [p.tipo, p.colorId]), [["rosa", "blanca"], ["monstera", "dorada"]]);
// Lo que lee una foto no falla nunca: color desconocido → el primero con nota; follaje desconocido → se salta con nota.
const leido = floresLeidas(["pampas moradas", "girasol azul", "monstera"]);
assert.deepEqual(leido.flores!.proporcion.map((p) => [p.tipo, p.colorId]), [["pampa", "beige"], ["monstera", "verde"]]);
assert.ok(leido.notas.length === 2 && /moradas/.test(leido.notas[0]!) && /girasol/.test(leido.notas[1]!), leido.notas.join(" | "));
assert.deepEqual(floresLeidas(["girasol"]).flores, null);
assert.deepEqual(floresLeidas(["pampas doradas"]).notas, []);
assert.ok(TIPOS_FOLLAJE.includes("pampa"), "la IA de escena ofrece la pampa");
const declaraciones = JSON.stringify(DECLARACIONES_ESCENA);
assert.match(declaraciones, /pampa, /, "la IA de escena lee «pampa» entre los follajes");
assert.match(declaraciones, /pasto de la pampa/);
const conPampas = crearTrazo({ silueta: "feston", ancho_cm: 300, follaje: ["pasto de la pampa dorada"] }, colores).pieza;
const pampas = armarPieza(conPampas).flores;
assert.ok(pampas.length >= 4 && pampas.every((f) => f.tipo === "pampa" && f.hex === FLORES_ARTIFICIALES.pampa.colores.find((c) => c.id === "dorada")!.hex), `${pampas.length} pampas doradas`);
// El texto de FLUX: plumas de pampa (con su color), no «hojas»; la hoja seca ya no se dice pampa.
assert.match(follajeEnIngles(pampas), /^Artificial gold pampas grass plumes tucked between the balloons/);
const crema = armarPieza(crearTrazo({ silueta: "feston", ancho_cm: 300, follaje: ["pampa crema"] }, colores).pieza).flores;
assert.match(follajeEnIngles(crema), /cream pampas grass plumes/);
const secas = armarPieza(crearTrazo({ silueta: "feston", ancho_cm: 300, follaje: ["hoja_seca beige"] }, colores).pieza).flores;
assert.match(follajeEnIngles(secas), /beige dried palm fans/);
assert.doesNotMatch(follajeEnIngles(secas), /pampas/);

console.log("test-trazo-organico: ok");
