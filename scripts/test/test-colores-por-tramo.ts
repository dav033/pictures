/**
 * El color dominante de cada tramo de una guirnalda (REQ-001): una guirnalda de blanco a la izquierda, arena al medio y vino a la
 * derecha, con acentos plateados chicos regados por todo el recorrido, lleva los tres por tramos; y una guirnalda de colores
 * parejos mezclados al azar (con los mismos acentos) NO se pinta por tramos: a lo más el 2 % de las guirnaldas (6 y 12 puntos,
 * 2 y 3 colores, colocación al azar y semillas distintas) sale con algún tramo falso. Sin coste ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-colores-por-tramo.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import type { ColorLeido, LecturaFoto } from "@/lib/globos3d/lectura-foto";
import { dominantesPorTramo, indiceDeDetectado, repartoDeColores } from "@/lib/globos3d/medir-colores";
import { medirConDetecciones, type GloboDetectado } from "@/lib/globos3d/medir-con-detecciones";
import type { Globo } from "@/lib/globos3d/medir-geometria";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const BLANCO: ColorLeido = { nombre: "blanco", hex: "#F5F5F5", peso: 30, acabado: "mate" };
const ARENA: ColorLeido = { nombre: "arena", hex: "#D8C3A0", peso: 30, acabado: "mate" };
const VINO: ColorLeido = { nombre: "vino", hex: "#6D1A2B", peso: 20, acabado: "cromado" };
const AZUL: ColorLeido = { nombre: "azul", hex: "#2F6DB5", peso: 20, acabado: "mate" };
const PLATA: ColorLeido = { nombre: "plata", hex: "#C0C0C0", peso: 40, acabado: "cromado" };
const unGlobo = (color: string): Globo => ({ x: 0, y: 0, d: 0.09, w: 0.09, h: 0.09, color, entero: true });
const repetir = (color: string, n: number): Globo[] => Array.from({ length: n }, () => unGlobo(color));

prueba("el barrido: un tramo de dos puntos seguidos con mayoría clara domina; un reparto parejo o pocos globos, no", () => {
  const colores = [BLANCO, ARENA, PLATA];
  const ix = indiceDeDetectado(colores);
  const ref = [0.34, 0.33, 0.33];
  const claro = dominantesPorTramo([repetir("beige", 7), repetir("beige", 6).concat(repetir("blanco", 1)), repetir("blanco", 4).concat(repetir("beige", 4))], colores, ix, ref);
  assert.deepEqual(claro.slice(0, 2), ["arena", "arena"], JSON.stringify(claro));
  const parejo = dominantesPorTramo([repetir("beige", 4).concat(repetir("blanco", 4)), repetir("beige", 4).concat(repetir("blanco", 4)), repetir("beige", 4).concat(repetir("blanco", 4))], colores, ix, ref);
  assert.deepEqual(parejo, [undefined, undefined, undefined]);
  const pocos = dominantesPorTramo([repetir("beige", 4), repetir("beige", 4)], colores, ix, ref);
  assert.deepEqual(pocos, [undefined, undefined], "8 globos entre los dos: pocos para decir un tramo");
  const solo = dominantesPorTramo([repetir("beige", 14)], colores, ix, ref);
  assert.deepEqual(solo, [undefined], "un punto solo no hace un tramo");
});

prueba("la ventaja se mide contra el reparto del cuerpo de la pieza: lo mismo es un tramo contra una parte de 0,2 y azar contra una de 0,5", () => {
  const colores = [BLANCO, ARENA];
  const ix = indiceDeDetectado(colores);
  const tramos = [repetir("blanco", 6).concat(repetir("beige", 2)), repetir("blanco", 6).concat(repetir("beige", 2))];
  assert.deepEqual(dominantesPorTramo(tramos, colores, ix, [0.5, 0.5]), [undefined, undefined]);
  assert.deepEqual(dominantesPorTramo(tramos, colores, ix, [0.2, 0.8]), ["blanco", "blanco"]);
  assert.equal(repartoDeColores(tramos[0]!, colores, ix)[0], 0.75);
});

const caja = (cx: number, cy: number, d: number, color: string): GloboDetectado => ({ box_2d: [Math.round((cy - d / 2) * 1000), Math.round((cx - d / 2) * 1000), Math.round((cy + d / 2) * 1000), Math.round((cx + d / 2) * 1000)], color });
const puntosDe = (n: number) => Array.from({ length: n }, (_, k) => ({ x: 0.08 + (k * 0.84) / (n - 1), y: 0.4, grosor: 0.14 }));
const lectura = (colores: ColorLeido[], puntos: number): LecturaFoto => ({
  resumen: "prueba de colores por tramo", aspecto: 1, escala: { altoImagenCm: 300, referencia: "prueba" }, pisoY: 0.95, sala: { pared: "#f0f0f0", piso: "#dddddd" },
  piezas: [{
    tipo: "guirnalda_organica", puntos: puntosDe(puntos), tamanos: {}, racimos: 0.4, colores,
    mezcla: { grandes: 0, medianos: 60, chicos: 40, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.04, formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" },
  }],
});
/** Un generador determinista por semilla. */
const generador = (semilla: number) => { let e = (semilla * 2654435761) % 4294967296; return () => { e = (e * 1664525 + 1013904223) % 4294967296; return e / 4294967296; }; };
/**
 * `cuerpo` globos del cuerpo (0,09) en lugares al azar a lo largo de la guirnalda, de color `colorEn(x, azar)`, y un plateado chico
 * por cada dos (0,04) en lugares al azar también.
 */
function globosAlAzar(cuerpo: number, azar: () => number, colorEn: (x: number, azar: () => number) => string): GloboDetectado[] {
  const globos: GloboDetectado[] = [];
  for (let k = 0; k < cuerpo; k++) {
    const x = 0.06 + azar() * 0.88;
    globos.push(caja(x, 0.4 + (azar() - 0.5) * 0.05, 0.09, colorEn(x, azar)));
    if (k % 2 === 0) globos.push(caja(0.06 + azar() * 0.88, 0.4 + (azar() - 0.5) * 0.05, 0.04, "plateado"));
  }
  return globos;
}
const dominantesDe = (l: LecturaFoto, globos: GloboDetectado[]) => {
  const pieza = medirConDetecciones(l, globos).lectura.piezas[0];
  assert.ok(pieza?.tipo === "guirnalda_organica");
  return pieza.puntos.map((q) => q.dominante);
};

const TRES = (x: number) => (x < 0.36 ? "blanco" : x < 0.66 ? "beige" : "vino");

prueba("blanco a la izquierda, arena al medio y vino a la derecha con plateados chicos por todas partes: los tres salen por tramos", () => {
  const l = lectura([BLANCO, ARENA, VINO, PLATA], 8);
  const globos = globosAlAzar(120, generador(5), TRES);
  const dominantes = dominantesDe(l, globos);
  assert.equal(dominantes[0], "blanco", JSON.stringify(dominantes));
  assert.ok(dominantes.includes("arena"), JSON.stringify(dominantes));
  assert.equal(dominantes[dominantes.length - 1], "vino", JSON.stringify(dominantes));
  const notas = compilarLectura(medirConDetecciones(l, globos).lectura).notas.filter((n) => /dominante/.test(n));
  assert.deepEqual(notas, [], notas.join(" | "));
});

prueba("con solo 48 globos del cuerpo (6 por punto) la misma guirnalda sigue por tramos: recuerdo de puntos y casi ningún color errado", () => {
  const l = lectura([BLANCO, ARENA, VINO, PLATA], 8);
  let aciertos = 0, errados = 0, total = 0;
  for (let semilla = 1; semilla <= 30; semilla++) {
    const dominantes = dominantesDe(l, globosAlAzar(48, generador(semilla), TRES));
    dominantes.forEach((d, i) => {
      total++;
      const esperado = TRES(puntosDe(8)[i]!.x);
      const nombre = esperado === "beige" ? "arena" : esperado;
      if (d === nombre) aciertos++; else if (d) errados++;
    });
  }
  const recuerdo = aciertos / total;
  console.log(`    48 globos: recuerdo ${(100 * recuerdo).toFixed(0)} % de los puntos, ${errados} de ${total} con otro color`);
  assert.ok(recuerdo >= 0.4, `recuerdo ${recuerdo}`);
  assert.ok(errados <= 0.03 * total, `${errados} errados de ${total}`);
});

prueba("colores parejos mezclados al azar con acentos (2 y 3 colores, 6 y 12 puntos, 48 a 160 globos, colocación y semillas al azar): a lo más el 2 % de las guirnaldas sale con un tramo falso", () => {
  const casos: Array<{ colores: ColorLeido[]; paleta: string[]; puntos: number }> = [];
  for (const puntos of [6, 12]) {
    casos.push({ colores: [BLANCO, ARENA, PLATA], paleta: ["blanco", "beige"], puntos });
    casos.push({ colores: [BLANCO, ARENA, AZUL, PLATA], paleta: ["blanco", "beige", "azul"], puntos });
  }
  let guirnaldas = 0, falsas = 0;
  const POR_CASO = 150;
  for (const [c, caso] of casos.entries()) {
    for (let semilla = 1; semilla <= POR_CASO; semilla++) {
      const azar = generador(1000 * (c + 1) + semilla);
      const cuerpo = 48 + Math.floor(azar() * 113);
      const globos = globosAlAzar(cuerpo, azar, (_, a) => caso.paleta[Math.floor(a() * caso.paleta.length)]!);
      guirnaldas++;
      if (dominantesDe(lectura(caso.colores, caso.puntos), globos).some(Boolean)) falsas++;
    }
  }
  console.log(`    tramos falsos: ${falsas} de ${guirnaldas} guirnaldas parejas (${(100 * falsas / guirnaldas).toFixed(1)} %)`);
  assert.ok(falsas <= 0.02 * guirnaldas, `${falsas} de ${guirnaldas}`);
});

console.log(`test-colores-por-tramo: ${pruebas} pruebas ok`);
