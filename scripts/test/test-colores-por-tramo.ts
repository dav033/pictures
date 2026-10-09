/**
 * El color dominante de cada tramo de una guirnalda (REQ-001): una guirnalda de blanco a la izquierda, arena al medio y vino a la
 * derecha, con acentos plateados chicos regados por todo el recorrido, lleva los tres por tramos (antes, con el 70 % exigido y los
 * plateados contando, ningún tramo dominaba). Y una guirnalda de dos colores parejos mezclados con los mismos acentos NO se pinta
 * por tramos (el azar de seis globos por punto no es un tramo). Sin coste ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-colores-por-tramo.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import type { ColorLeido, LecturaFoto, PiezaLeida } from "@/lib/globos3d/lectura-foto";
import { dominanteDe, indiceDeDetectado } from "@/lib/globos3d/medir-colores";
import { medirConDetecciones, type GloboDetectado } from "@/lib/globos3d/medir-con-detecciones";
import type { Globo } from "@/lib/globos3d/medir-geometria";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const BLANCO: ColorLeido = { nombre: "blanco", hex: "#F5F5F5", peso: 30, acabado: "mate" };
const ARENA: ColorLeido = { nombre: "arena", hex: "#D8C3A0", peso: 30, acabado: "mate" };
const PLATA: ColorLeido = { nombre: "plata", hex: "#C0C0C0", peso: 40, acabado: "cromado" };
const unGlobo = (color: string): Globo => ({ x: 0, y: 0, d: 0.09, w: 0.09, h: 0.09, color, entero: true });

prueba("domina quien tiene mayoría, el doble del segundo, ventaja sobre su parte en el cuerpo y una cuenta que el azar no da; con menos de 8 globos, nadie", () => {
  const colores = [BLANCO, ARENA, PLATA];
  const lista = (...c: string[]) => c.map(unGlobo);
  const repetir = (color: string, n: number) => Array.from({ length: n }, () => color);
  assert.equal(dominanteDe(lista(...repetir("beige", 8), ...repetir("blanco", 2), ...repetir("plateado", 2)), colores), "arena", "8 de 12, con el reparto de la pieza en 30/30/40");
  assert.equal(dominanteDe(lista(...repetir("beige", 6), "blanco"), colores), undefined, "siete globos: pocos para decir un tramo");
  assert.equal(dominanteDe(lista(...repetir("beige", 5), ...repetir("blanco", 5)), colores), undefined, "5 contra 5: sin dominante");
  assert.equal(dominanteDe(lista(...repetir("beige", 6), ...repetir("blanco", 4)), colores), undefined, "6 de 10: menos del doble del segundo");
  assert.ok(indiceDeDetectado(colores)("beige") >= 0);
});

prueba("la ventaja se mide contra el reparto del cuerpo de la pieza, no contra su peso: 4 de 6 grandes no es un tramo si la pieza es mitad y mitad", () => {
  const colores = [BLANCO, ARENA];
  const lista = [...Array.from({ length: 6 }, () => unGlobo("blanco")), ...Array.from({ length: 2 }, () => unGlobo("beige"))];
  assert.equal(dominanteDe(lista, colores, indiceDeDetectado(colores), [0.5, 0.5]), undefined, "6 de 8 contra una parte de 0,5: se da por azar con frecuencia");
  assert.equal(dominanteDe(lista, colores, indiceDeDetectado(colores), [0.2, 0.8]), "blanco", "contra una parte de 0,2 sí es un tramo");
});

const caja = (cx: number, cy: number, d: number, color: string): GloboDetectado => ({ box_2d: [Math.round((cy - d / 2) * 1000), Math.round((cx - d / 2) * 1000), Math.round((cy + d / 2) * 1000), Math.round((cx + d / 2) * 1000)], color });

const VINO: ColorLeido = { nombre: "vino", hex: "#6D1A2B", peso: 20, acabado: "cromado" };
const PUNTOS = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.94].map((x) => ({ x, y: 0.4, grosor: 0.14 }));
const lectura = (colores: ColorLeido[]): LecturaFoto => ({
  resumen: "prueba de colores por tramo", aspecto: 1, escala: { altoImagenCm: 300, referencia: "prueba" }, pisoY: 0.95, sala: { pared: "#f0f0f0", piso: "#dddddd" },
  piezas: [{
    tipo: "guirnalda_organica", puntos: PUNTOS, tamanos: {}, racimos: 0.4, colores,
    mezcla: { grandes: 0, medianos: 60, chicos: 40, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.04, formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" },
  }],
});
/** Una guirnalda de 96 globos del cuerpo (12 por punto) con un plateado chico entre cada dos, el color del cuerpo según `colorEn(x, k)`. */
function globosConAcentos(colorEn: (x: number, k: number) => string): GloboDetectado[] {
  const globos: GloboDetectado[] = [];
  for (let k = 0; k < 96; k++) {
    const x = 0.06 + (k / 95) * 0.9, lado = ((k * 7) % 5 - 2) * 0.012;
    globos.push(caja(x, 0.4 + lado, 0.09, colorEn(x, k)));
    if (k % 2 === 0) globos.push(caja(x + 0.01, 0.4 - lado * 2, 0.04, "plateado"));
  }
  return globos;
}
const dominantesDe = (l: LecturaFoto, globos: GloboDetectado[]) => {
  const pieza = medirConDetecciones(l, globos).lectura.piezas[0];
  assert.ok(pieza?.tipo === "guirnalda_organica");
  return pieza.puntos.map((q) => q.dominante);
};

prueba("blanco a la izquierda, arena al medio y vino a la derecha con plateados chicos por todas partes: los tres salen por tramos", () => {
  const l = lectura([BLANCO, ARENA, VINO, PLATA]);
  const dominantes = dominantesDe(l, globosConAcentos((x) => (x < 0.36 ? "blanco" : x < 0.66 ? "beige" : "vino")));
  assert.equal(dominantes[0], "blanco", JSON.stringify(dominantes));
  assert.ok(dominantes.includes("arena"), JSON.stringify(dominantes));
  assert.equal(dominantes[dominantes.length - 1], "vino", JSON.stringify(dominantes));
  // Y el compilador los pinta sin queja.
  const notas = compilarLectura(medirConDetecciones(l, globosConAcentos((x) => (x < 0.36 ? "blanco" : x < 0.66 ? "beige" : "vino"))).lectura).notas.filter((n) => /dominante/.test(n));
  assert.deepEqual(notas, [], notas.join(" | "));
});

prueba("dos colores parejos mezclados al azar (con los mismos acentos) no se pintan por tramos: a lo más 1 guirnalda de 40 con algún tramo", () => {
  const l = lectura([BLANCO, ARENA, PLATA]);
  let conTramos = 0;
  for (let semilla = 1; semilla <= 40; semilla++) {
    // Un generador simple determinista por semilla: el color de cada globo, 50/50.
    let estado = semilla * 2654435761 % 4294967296;
    const azar = () => { estado = (estado * 1664525 + 1013904223) % 4294967296; return estado / 4294967296; };
    const globos = globosConAcentos(() => (azar() < 0.5 ? "blanco" : "beige"));
    if (dominantesDe(l, globos).some(Boolean)) conTramos++;
  }
  assert.ok(conTramos <= 1, `${conTramos} de 40 guirnaldas parejas salieron con algún tramo de color`);
});

console.log(`test-colores-por-tramo: ${pruebas} pruebas ok`);
