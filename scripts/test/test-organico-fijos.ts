/**
 * Globos FIJOS del motor orgánico (`organico-fijos.ts`, `organico-color.ts`): los gigantes y grandes que la foto tiene en un
 * sitio y con un color. Sin coste.
 * - cada fijo queda donde se pidió, con su código, su inflado medido y sin que la relajación lo mueva;
 * - ocupa el sitio de la estructura: el total de su formato no sube (un gigante fijo no deja otro gigante al lado), y si el
 *   color obligó a bajar de formato, se descuenta del formato PEDIDO (`formatoPedidoId`);
 * - su color cuenta en la cuota de su color: «50 % dorados» incluye a los fijos dorados;
 * - dos fijos que se montan son el mismo globo visto dos veces: el segundo no se pone (y se avisa); dos fijos que no se montan
 *   no se mueven entre sí;
 * - un fijo de color cristal con confeti sale marcado con confeti;
 * - sin fijos, el armado es el mismo de siempre (ver `test-organico-instantanea.ts`).
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-organico-fijos.ts
 */
import assert from "node:assert/strict";
import { armarOrganico, olvidarEmpaquesOrganicos, type GloboFijo, type GloboOrganico } from "../../src/lib/globos3d/organico";
import { MEZCLA_TRAZO, opcionesTrazoOrganico, puntosDeSilueta, type ParametrosTrazoOrganico } from "../../src/lib/globos3d/trazo-organico";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const DORADO = "032", BLANCO = "005", ROSA = "011";
const MEZCLA = { ...MEZCLA_TRAZO, "R-36": 0.04, "R-24": 0.08 };
const festonConFijos = (fijos?: readonly GloboFijo[], colores: ParametrosTrazoOrganico["colores"] = [{ codigo: DORADO, peso: 50 }, { codigo: BLANCO, peso: 50 }]): ParametrosTrazoOrganico => ({
  puntos: puntosDeSilueta("feston", { anchoCm: 320, altoCm: 170, grosorCm: 100 }), mezcla: MEZCLA, colores, racimos: 0.3, semilla: 9, ...(fijos ? { fijos } : {}),
});
const armar = (t: ParametrosTrazoOrganico) => { olvidarEmpaquesOrganicos(); return armarOrganico(opcionesTrazoOrganico(t)); };
const cuenta = (globos: readonly GloboOrganico[], formato: string) => globos.filter((g) => g.formatoId === formato).length;

const base = armar(festonConFijos());
const gigantesBase = cuenta(base.globos, "R-36");
// Sitios sobre el cuerpo del festón (el eje baja a y ≈ 100 en el centro).
const FIJO_A: GloboFijo = { formatoId: "R-36", codigo: DORADO, x: -95, y: 150, infladoCm: 80 };
const FIJO_B: GloboFijo = { formatoId: "R-24", codigo: BLANCO, x: 100, y: 150 };

console.log("Posición, color e inflado");
prueba("cada fijo queda donde se pidió, con su código y su inflado, y la relajación no lo mueve", () => {
  const r = armar(festonConFijos([FIJO_A, FIJO_B]));
  const a = r.globos.find((g) => g.formatoId === "R-36" && g.codigo === DORADO && Math.hypot(g.centro.x - FIJO_A.x, g.centro.y - FIJO_A.y) < 0.5);
  const b = r.globos.find((g) => g.formatoId === "R-24" && g.codigo === BLANCO && Math.hypot(g.centro.x - FIJO_B.x, g.centro.y - FIJO_B.y) < 0.5);
  assert.ok(a, "el R-36 dorado quedó en su sitio");
  assert.ok(b, "el R-24 blanco quedó en su sitio");
  assert.equal(a!.infladoCm, 80, "el diámetro medido manda sobre el nominal");
  assert.ok(a!.centro.z >= 0, "va por delante del eje, en la cara que se ve");
});

console.log("Totales por formato");
prueba("un gigante fijo ocupa el sitio de uno de la estructura: no sobra otro al lado", () => {
  assert.ok(gigantesBase >= 2, `el festón de prueba lleva ${gigantesBase} gigantes sin fijos`);
  const con1 = armar(festonConFijos([FIJO_A]));
  assert.ok(cuenta(con1.globos, "R-36") <= gigantesBase, `R-36: ${gigantesBase} → ${cuenta(con1.globos, "R-36")}`);
  assert.ok(cuenta(con1.globos, "R-36") >= gigantesBase - 1);
});

prueba("si el color obligó a bajar de formato, se descuenta el formato PEDIDO: el R-24 fijo no deja un R-36 de más", () => {
  // La foto pide un gigante; en su color solo hay R-24: se dibuja un R-24 y sigue contando como gigante.
  const bajado: GloboFijo = { formatoId: "R-24", formatoPedidoId: "R-36", codigo: DORADO, x: -95, y: 150, infladoCm: 80 };
  const sinPedido: GloboFijo = { formatoId: "R-24", codigo: DORADO, x: -95, y: 150, infladoCm: 80 };
  const con = armar(festonConFijos([bajado]));
  const sin = armar(festonConFijos([sinPedido]));
  assert.equal(cuenta(con.globos, "R-36"), gigantesBase - 1, "un R-36 menos de estructura");
  assert.equal(cuenta(sin.globos, "R-36"), gigantesBase, "sin el formato pedido, el gigante de la estructura se queda (el defecto que se corrige)");
});

console.log("Colores");
prueba("los fijos cuentan en la cuota de su color (50 % dorados incluye a los fijos dorados)", () => {
  const fijos: GloboFijo[] = [
    { formatoId: "R-36", codigo: DORADO, x: -110, y: 140 }, { formatoId: "R-24", codigo: DORADO, x: -60, y: 110 },
    { formatoId: "R-24", codigo: DORADO, x: 0, y: 100 }, { formatoId: "R-24", codigo: DORADO, x: 70, y: 115 }, { formatoId: "R-24", codigo: DORADO, x: 115, y: 150 },
  ];
  const r = armar(festonConFijos(fijos));
  const dorados = r.globos.filter((g) => g.codigo === DORADO).length;
  const parte = dorados / r.globos.length;
  assert.ok(Math.abs(parte - 0.5) < 0.04, `dorados ${dorados} de ${r.globos.length} (${(parte * 100).toFixed(1)} %)`);
  for (const f of fijos) assert.ok(r.globos.some((g) => g.codigo === DORADO && Math.hypot(g.centro.x - f.x, g.centro.y - f.y) < 0.5), `fijo ${f.formatoId} en (${f.x}, ${f.y})`);
});

prueba("un fijo de un color fuera de la paleta conserva su código y no cuenta en ninguna cuota", () => {
  const r = armar(festonConFijos([{ formatoId: "R-24", codigo: ROSA, x: 0, y: 100 }]));
  assert.ok(r.globos.some((g) => g.codigo === ROSA && g.formatoId === "R-24" && Math.hypot(g.centro.x, g.centro.y - 100) < 0.5));
  assert.ok(Math.abs(r.globos.filter((g) => g.codigo === DORADO).length / r.globos.length - 0.5) < 0.04);
});

prueba("un fijo de cristal con confeti sale marcado con confeti", () => {
  const colores = [{ codigo: DORADO, peso: 40 }, { codigo: BLANCO, peso: 40 }, { codigo: "390", peso: 20, confeti: true, formatos: ["R-12", "R-18", "R-24"] }];
  const r = armar(festonConFijos([{ formatoId: "R-24", codigo: "390", x: 0, y: 100 }], colores));
  const g = r.globos.find((x) => x.codigo === "390" && Math.hypot(x.centro.x, x.centro.y - 100) < 0.5);
  assert.ok(g, "el fijo cristal está");
  assert.equal(g!.confeti, true);
});

console.log("Fijos entre sí");
prueba("dos fijos que se montan son uno: el segundo no se pone y se avisa", () => {
  const r = armar(festonConFijos([{ formatoId: "R-24", codigo: DORADO, x: 0, y: 105 }, { formatoId: "R-24", codigo: BLANCO, x: 6, y: 108 }]));
  assert.ok(r.globos.some((g) => g.codigo === DORADO && Math.hypot(g.centro.x, g.centro.y - 105) < 0.5), "el primero se queda");
  assert.ok(!r.globos.some((g) => g.codigo === BLANCO && g.formatoId === "R-24" && Math.hypot(g.centro.x - 6, g.centro.y - 108) < 0.5), "el segundo no");
  assert.ok(r.avisos.some((a) => /se montaban sobre otro fijo/.test(a)), r.avisos.join(" | "));
});

prueba("dos fijos pegados pero sin montarse no se empujan entre sí", () => {
  // R-24 de 48 cm a 49 cm de distancia: se tocan sin pasar del aplastamiento permitido.
  const a: GloboFijo = { formatoId: "R-24", codigo: DORADO, x: -25, y: 105 }, b: GloboFijo = { formatoId: "R-24", codigo: BLANCO, x: 24.5, y: 105 };
  const r = armar(festonConFijos([a, b]));
  for (const f of [a, b]) assert.ok(r.globos.some((g) => g.codigo === f.codigo && g.formatoId === "R-24" && Math.hypot(g.centro.x - f.x, g.centro.y - f.y) < 0.5), `${f.codigo} se movió`);
});

prueba("lo que se arma sin fijos no cambia por existir los fijos (misma pieza, mismos globos)", () => {
  assert.equal(JSON.stringify(armar(festonConFijos())), JSON.stringify(base));
  assert.equal(JSON.stringify(armar(festonConFijos([]))), JSON.stringify(base));
});

console.log(`test-organico-fijos: ${pruebas} pruebas ok`);
