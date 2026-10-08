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
import { DESDE_EL_PISO, SILUETAS_TRAZO, MEZCLA_TRAZO, cajaTrazo, puntosDeSilueta, validarTrazo, type ParametrosTrazoOrganico } from "@/lib/globos3d/trazo-organico";
import { conGenerador, escalarGenerador, piezaDeGenerador } from "@/lib/globos3d/generadores-organicos";
import { armarOrganico, APLASTAMIENTO_MAXIMO } from "@/lib/globos3d/organico";
import { armarPieza } from "@/lib/globos3d/piezas";
import { reemplazarColor } from "@/lib/globos3d/recolorear";
import { crearTrazo, floresPedidas } from "@/lib/globos3d/herramientas-escena-trazo";
import { follajeEnIngles } from "@/lib/globos3d/flores-artificiales";

const colores = [{ codigo: "009", peso: 40 }, { codigo: "570", peso: 35 }, { codigo: "005", peso: 25 }];
const trazo = (silueta: (typeof SILUETAS_TRAZO)[number]["id"], anchoCm = 260, altoCm = 180, grosorCm = 50): ParametrosTrazoOrganico =>
  ({ puntos: puntosDeSilueta(silueta, { anchoCm, altoCm, grosorCm }), mezcla: { ...MEZCLA_TRAZO, "R-24": 0.06 }, colores, racimos: 0.4, semilla: 11 });

for (const { id } of SILUETAS_TRAZO) {
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

console.log("test-trazo-organico: ok");
