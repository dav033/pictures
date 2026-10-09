/**
 * La medida de proporciones (`lib-proporciones.ts`): lo armado idéntico a la foto da 1, y cada defecto que se quiere ver
 * (una guirnalda corrida o más larga por un lado, globos más chicos, un fondo más bajo) lo baja y se nota en la medida que le toca.
 * Sin coste.
 *
 * Run: npx tsx scripts/test/test-proporciones-foto.ts
 */
import assert from "node:assert/strict";
import { cajaDeDiscos, discosDeLaFoto, iouDeCajas, medirProporciones, unirPorId, type Disco, type FondoMedido } from "../exp/lib-proporciones";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Un semiarco: tramo de arriba de `x0` a `x1` a `y`, y columna que baja por `x1` hasta `y1`; globos de radio `r`. */
function semiarco(x0: number, x1: number, y: number, y1: number, r = 0.04): Disco[] {
  const discos: Disco[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += r * 1.5) discos.push({ x, y, r });
  for (let yy = y + r * 1.5; yy <= y1; yy += r * 1.5) discos.push({ x: x1, y: yy, r });
  return discos;
}
const mismo = (a: string, b: string) => a === b;
const medir = (foto: Disco[], armado: Disco[], fondosFoto: FondoMedido[] = [], fondosArmados: FondoMedido[] = []) =>
  medirProporciones({ foto, armado, aspecto: 0.75, fondosFoto, fondosArmados, mismoFondo: mismo, esTelon: (id) => id === "marco_tela" });

const foto = semiarco(0.2, 0.62, 0.25, 0.8);

console.log("Lo idéntico");
prueba("lo armado igual a la foto da 1 en todo", () => {
  const m = medir(foto, foto);
  assert.equal(m.iou, 1);
  assert.equal(m.bordes.medio, 0);
  assert.equal(m.silueta.medio, 0);
  assert.equal(m.diametro.razon, 1);
  assert.equal(m.puntaje, 1);
});

console.log("Los defectos");
prueba("un tramo de arriba más largo por la izquierda sale en el borde izquierdo con signo positivo y baja el puntaje", () => {
  const largo = semiarco(0.08, 0.62, 0.25, 0.8);
  const m = medir(foto, largo);
  assert.ok(m.bordes.izquierda > 0.05, `izquierda ${m.bordes.izquierda}`);
  assert.ok(Math.abs(m.bordes.derecha) < 0.03 && Math.abs(m.bordes.abajo) < 0.08);
  assert.ok(m.silueta.ancho > 0.01, `ancho de franja ${m.silueta.ancho}`);
  assert.ok(m.puntaje < medir(foto, foto).puntaje - 0.05, `puntaje ${m.puntaje}`);
});

prueba("una columna que se queda corta sale en el borde de abajo con signo negativo", () => {
  const corta = semiarco(0.2, 0.62, 0.25, 0.6);
  const m = medir(foto, corta);
  assert.ok(m.bordes.abajo < -0.1, `abajo ${m.bordes.abajo}`);
});

prueba("un tramo de arriba más bajo (inclinado distinto) se ve en las franjas verticales", () => {
  const bajo = semiarco(0.2, 0.62, 0.4, 0.8);
  const m = medir(foto, bajo);
  assert.ok(m.silueta.arriba > 0.02, `arriba ${m.silueta.arriba}`);
  assert.ok(m.bordes.arriba < -0.1, `borde de arriba ${m.bordes.arriba}`);
});

prueba("los globos a la mitad de tamaño dan una razón de diámetros de 0,5", () => {
  const chicos = foto.map((d) => ({ ...d, r: d.r / 2 }));
  assert.equal(medir(foto, chicos).diametro.razon, 0.5);
});

console.log("Fondos");
const caja = { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.7 };
prueba("un fondo más bajo que el de la foto pierde solape; el mismo da 1; sin fondo armado, null", () => {
  assert.equal(medir(foto, foto, [{ id: "lentejuelas", caja }], [{ id: "lentejuelas", caja }]).fondos[0]!.iou, 1);
  const abajo = { ...caja, y0: 0.35, y1: 0.85 };
  assert.ok(medir(foto, foto, [{ id: "lentejuelas", caja }], [{ id: "lentejuelas", caja: abajo }]).fondos[0]!.iou! < 0.6);
  assert.equal(medir(foto, foto, [{ id: "lentejuelas", caja }], []).fondos[0]!.iou, null);
});

prueba("de un telón no cuenta lo armado por debajo de lo que la foto deja ver (el pie tapado)", () => {
  const visible = { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.5 };
  const hastaElPiso = { ...visible, y1: 0.8 };
  assert.equal(medir(foto, foto, [{ id: "marco_tela", caja: visible }], [{ id: "marco_tela", caja: hastaElPiso }]).fondos[0]!.iou, 1);
  assert.ok(medir(foto, foto, [{ id: "lentejuelas", caja: visible }], [{ id: "lentejuelas", caja: hastaElPiso }]).fondos[0]!.iou! < 0.6, "un fondo que no es telón sí paga lo que sobra");
});

prueba("los fondos del mismo id se unen en una caja (tres pedestales detectados, un nodo armado)", () => {
  const unidos = unirPorId([{ id: "pedestales", caja: { x0: 0, y0: 0.5, x1: 0.2, y1: 0.9 } }, { id: "pedestales", caja: { x0: 0.25, y0: 0.6, x1: 0.4, y1: 0.9 } }, { id: "marco_tela", caja }]);
  assert.equal(unidos.length, 2);
  assert.deepEqual(unidos[0]!.caja, { x0: 0, y0: 0.5, x1: 0.4, y1: 0.9 });
});

prueba("una caja detectada como globo que es un pedestal no cuenta como globo de la foto", () => {
  const pedestal = { id: "pedestales", caja: { x0: 0.1, y0: 0.6, x1: 0.4, y1: 0.95 } };
  const globos = [{ x: 0.25, y: 0.775, w: 0.3, h: 0.35, d: 0.35 }, { x: 0.7, y: 0.3, w: 0.08, h: 0.08, d: 0.08 }];
  const discos = discosDeLaFoto(globos, [pedestal]);
  assert.equal(discos.length, 1);
  assert.deepEqual(discos[0], { x: 0.7, y: 0.3, r: 0.04 });
});

prueba("la caja de los discos ignora un globo suelto lejano y el solape de dos cajas es una intersección sobre unión", () => {
  const c = cajaDeDiscos([...foto, { x: 0.01, y: 0.99, r: 0.005 }]);
  assert.ok(c && c.x0 > 0.1 && c.y1 < 0.95, JSON.stringify(c));
  assert.equal(iouDeCajas({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 0, y0: 0, x1: 0.5, y1: 1 }), 0.5);
});

console.log(`test-proporciones-foto: ${pruebas} pruebas ok`);
