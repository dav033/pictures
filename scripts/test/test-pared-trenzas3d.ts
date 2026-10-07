/**
 * Pared de trenzas alternando tamaños del taller 3D (`armarParedTrenzas`), contra el PDF de Sempertex («Murales
 * con trenzas alternando tamaños») y Celebra ed. 27, p. 42. Sin coste.
 * - densidad: con R-12 a 25 y 20 cm, 6 cuartetos por metro de trenza y ~50 cm de ancho por trenza;
 * - cada trenza alterna grande y chico, y la vecina empieza con el tamaño opuesto (el desfase que las encaja);
 * - de frente el grande muestra 2 globos y el chico 3 (el chico va girado 1/8, con un globo al frente);
 * - la pared es densa: casi toda la superficie de frente está cubierta (toda, contando lo que cede el látex);
 * - las anclas están al frente (+Z), sobre la superficie, en el eje de cada trenza y en las costuras;
 * - la réplica de Celebra ed. 27: 5 trenzas × 13 cuartetos, R-12 y R-9 Pastel Mate Rosado (la revista: 128 + 128).
 */
import assert from "node:assert/strict";
import { PARED_TRENZAS_INICIAL, armarParedTrenzas, superficieFrontal, type GloboDeParedTrenzas } from "../../src/lib/globos3d/pared-trenzas";
import { CELEBRA_27 } from "../../src/lib/globos3d/mezcla";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";

// Densidad: una trenza de 3 m con R-12 a 25/20 lleva 18 cuartetos (6 por metro); cada trenza aporta ~50 cm.
const tres = armarParedTrenzas({ ...PARED_TRENZAS_INICIAL, anchoCm: 50, altoCm: 300 });
assert.equal(tres.columnas, 1);
assert.equal(tres.niveles, 18, `cuartetos en 3 m: ${tres.niveles}`);
assert.ok(Math.abs(100 / tres.pasoCm - 6) < 0.05, `cuartetos por metro: ${(100 / tres.pasoCm).toFixed(2)} (PDF: 6)`);
assert.ok(Math.abs(tres.anchoTrenzaCm - 50) < 0.5, `ancho por trenza: ${tres.anchoTrenzaCm} (PDF: ~50)`);
// El mural del PDF: 3,40 × 2,60 m → 7 trenzas de ~15-16 cuartetos.
const pdf = armarParedTrenzas({ ...PARED_TRENZAS_INICIAL, anchoCm: 340, altoCm: 260 });
assert.equal(pdf.columnas, 7, `trenzas en 3,40 m: ${pdf.columnas}`);
assert.ok(pdf.niveles >= 15 && pdf.niveles <= 16, `cuartetos por trenza en 2,60 m: ${pdf.niveles}`);
assert.equal(pdf.globos.length, pdf.columnas * pdf.niveles * 4);

// Alternancia y desfase: en cada trenza grande y chico se alternan; en cada nivel, trenzas vecinas tienen tamaños opuestos.
const tamano = (globos: readonly GloboDeParedTrenzas[], columna: number, nivel: number) => globos.find((g) => g.columna === columna && g.nivel === nivel)!.tamano;
for (let c = 0; c < pdf.columnas; c++) {
  assert.equal(tamano(pdf.globos, c, 0), c % 2 === 0 ? "grande" : "chico", `la trenza ${c + 1} empieza con el ${c % 2 === 0 ? "grande" : "chico"}`);
  for (let n = 1; n < pdf.niveles; n++) assert.notEqual(tamano(pdf.globos, c, n), tamano(pdf.globos, c, n - 1), `trenza ${c + 1}: los niveles ${n} y ${n + 1} no alternan`);
  if (c > 0) for (let n = 0; n < pdf.niveles; n++) assert.notEqual(tamano(pdf.globos, c, n), tamano(pdf.globos, c - 1, n), "trenzas vecinas: tamaños opuestos en el mismo nivel");
}
const alReves = armarParedTrenzas({ ...PARED_TRENZAS_INICIAL, empiezaCon: "chico" });
assert.equal(tamano(alReves.globos, 0, 0), "chico", "«empieza con el chico» cambia la primera trenza");
for (const g of pdf.globos) assert.equal(g.infladoCm, g.tamano === "grande" ? 25 : 20);
assert.equal(pdf.cuartetos.grande + pdf.cuartetos.chico, pdf.columnas * pdf.niveles);

// De frente: cuántos globos de un cuarteto miran al frente (z del cuerpo > 25 % del radio del cuarteto).
const deFrente = (globos: readonly GloboDeParedTrenzas[]) => globos.filter((g) => g.direccion.z > 0.3).length;
const cuarteto = (c: number, n: number) => pdf.globos.filter((g) => g.columna === c && g.nivel === n);
assert.equal(deFrente(cuarteto(0, 0)), 2, "el cuarteto grande muestra 2 globos (izquierda y derecha)");
const chico = cuarteto(0, 1);
assert.equal(deFrente(chico), 1, "el chico tiene 1 globo al frente (el del centro)");
assert.equal(chico.filter((g) => Math.abs(g.direccion.x) > 0.9).length, 2, "y 2 a los lados: de frente se ven 3");

// Densidad de frente: casi toda la pared tiene globo delante. Con esferas exactas quedan los rombitos donde se
// tocan cuatro globos (~9 %); con lo que cede el látex al amarrar (radio un 12 % mayor) se cierran.
const frente = superficieFrontal(pdf.globos);
const apretada = superficieFrontal(pdf.globos, 0.06);
let cubiertos = 0, cubiertosApretada = 0, total = 0;
for (let x = 15; x < pdf.anchoCm - 15; x += 3) for (let y = 15; y < pdf.altoCm - 15; y += 3) { total++; if (frente(x, y) > 0) cubiertos++; if (apretada(x, y) > 0) cubiertosApretada++; }
assert.ok(cubiertos / total > 0.88, `pared densa: ${(100 * cubiertos / total).toFixed(1)} % cubierta de frente con esferas exactas`);
assert.ok(cubiertosApretada / total > 0.98, `pared densa: ${(100 * cubiertosApretada / total).toFixed(1)} % cubierta con el látex apretado`);
// Y plana: el frente de los globos no se sale más de ~1/2 diámetro entre el más adelantado y el promedio.
const zs: number[] = [];
for (let x = 15; x < pdf.anchoCm - 15; x += 5) for (let y = 15; y < pdf.altoCm - 15; y += 5) zs.push(frente(x, y));
const maximo = Math.max(...zs);
assert.ok(maximo < 30, `frente a ${maximo.toFixed(1)} cm del plano de los ejes (plana, sin bultos)`);

// Anclas: al frente, sobre la superficie (ni enterradas ni flotando), en eje y costuras de cada nivel.
assert.equal(pdf.anclas.length, pdf.columnas * pdf.niveles + (pdf.columnas - 1) * pdf.niveles);
for (const a of pdf.anclas) {
  assert.deepEqual(a.normal, { x: 0, y: 0, z: 1 }, "las anclas miran al frente");
  assert.ok(a.posicion.z > 12 && a.posicion.z < 30, `ancla ${a.tipo} (${a.columna}, ${a.nivel}) a z = ${a.posicion.z.toFixed(1)}`);
}
assert.ok(pdf.anclas.some((a) => a.tipo === "union") && pdf.anclas.some((a) => a.tipo === "trenza"));

// Patrones: por tamaño (grandes de un color, chicos de otro) y por trenza.
const porTamano = armarParedTrenzas({ ...PARED_TRENZAS_INICIAL, patron: "por_tamano", colores: ["609", "005"] });
for (const g of porTamano.globos) assert.equal(g.codigo, g.tamano === "grande" ? "609" : "005");
const porTrenza = armarParedTrenzas({ ...PARED_TRENZAS_INICIAL, patron: "columnas", colores: ["609", "009"] });
for (const g of porTrenza.globos) assert.equal(g.codigo, g.columna % 2 === 0 ? "609" : "009");

// Celebra ed. 27: R-12 (25 cm) y R-9 (20 cm) Pastel Mate Rosado, 5 trenzas × 13 cuartetos, 2,5 × 2,17 m.
const celebra = armarParedTrenzas(CELEBRA_27.pared);
assert.equal(celebra.columnas, 5);
assert.equal(celebra.niveles, 13);
assert.deepEqual(celebra.cuartetos, { grande: 33, chico: 32 });
assert.deepEqual(celebra.materiales, [{ formatoId: "R-12", codigo: "609", cantidad: 132 }, { formatoId: "R-9", codigo: "609", cantidad: 128 }]);
for (const m of celebra.materiales) assert.ok(coloresDelFormato(m.formatoId).some((c) => c.codigo === m.codigo), `${m.codigo} existe en ${m.formatoId}`);
// La revista: 128 R-12 + 128 R-9 (64 cuartetos); la réplica difiere en un cuarteto grande.
assert.ok(Math.abs(celebra.globos.length - 256) <= 4, `globos de la pared: ${celebra.globos.length} (revista: 256)`);

console.log(`OK test-pared-trenzas3d: 6 cuartetos/m y 50 cm por trenza (PDF), alternancia y desfase entre trenzas, 2 y 3 globos de frente, ${(100 * cubiertos / total).toFixed(0)} % cubierta (${(100 * cubiertosApretada / total).toFixed(0)} % apretada), ${pdf.anclas.length} anclas al frente; Celebra ed. 27 = ${celebra.columnas}×${celebra.niveles} cuartetos (${celebra.globos.length} globos)`);
