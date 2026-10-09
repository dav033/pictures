/**
 * El color dominante de cada tramo de una guirnalda (REQ-001): una guirnalda de blanco a la izquierda y arena a la derecha, con
 * acentos plateados chicos regados por todo el recorrido, lleva el blanco y la arena por tramos (antes, con el 70 % exigido y los
 * plateados contando, ningún tramo dominaba y los colores salían mezclados por todas partes). Sin coste ni red.
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

prueba("la mayoría simple con el doble del segundo domina; un reparto parejo no", () => {
  const colores = [BLANCO, ARENA, PLATA];
  const lista = (...c: string[]) => c.map(unGlobo);
  assert.equal(dominanteDe(lista("beige", "beige", "beige", "beige", "blanco", "blanco", "plateado", "plateado"), colores), "arena", "4 de 8, el doble que cada otro");
  assert.equal(dominanteDe(lista("beige", "beige", "beige", "blanco", "blanco", "blanco", "plateado", "plateado"), colores), undefined, "3 contra 3: sin dominante");
  assert.equal(dominanteDe(lista("beige", "beige", "beige", "beige", "blanco", "blanco", "blanco", "plateado"), colores), undefined, "4 contra 3: menos del doble");
  assert.ok(indiceDeDetectado(colores)("beige") >= 0);
});

const caja = (cx: number, cy: number, d: number, color: string): GloboDetectado => ({ box_2d: [Math.round((cy - d / 2) * 1000), Math.round((cx - d / 2) * 1000), Math.round((cy + d / 2) * 1000), Math.round((cx + d / 2) * 1000)], color });

prueba("blanco a la izquierda y arena a la derecha con plateados chicos por todas partes: dominante por punto", () => {
  const puntos = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((x) => ({ x, y: 0.4, grosor: 0.14 }));
  const guirnalda: PiezaLeida = {
    tipo: "guirnalda_organica", puntos, tamanos: {}, racimos: 0.4, colores: [BLANCO, ARENA, PLATA],
    mezcla: { grandes: 0, medianos: 60, chicos: 40, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.04, formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" },
  };
  const l: LecturaFoto = { resumen: "prueba de colores por tramo", aspecto: 1, escala: { altoImagenCm: 300, referencia: "prueba" }, pisoY: 0.95, sala: { pared: "#f0f0f0", piso: "#dddddd" }, piezas: [guirnalda] };
  const globos: GloboDetectado[] = [];
  for (let k = 0; k < 40; k++) {
    const x = 0.1 + (k / 39) * 0.85, lado = ((k * 7) % 5 - 2) * 0.012;
    globos.push(caja(x, 0.4 + lado, 0.09, x < 0.52 ? "blanco" : "beige"));
    if (k % 2 === 0) globos.push(caja(x + 0.01, 0.4 - lado * 2, 0.04, "plateado"));
  }
  const r = medirConDetecciones(l, globos);
  const pieza = r.lectura.piezas[0];
  assert.ok(pieza?.tipo === "guirnalda_organica");
  const dominantes = pieza.puntos.map((q) => q.dominante);
  assert.equal(dominantes[0], "blanco", JSON.stringify(dominantes));
  assert.equal(dominantes[dominantes.length - 1], "arena", JSON.stringify(dominantes));
  assert.ok(dominantes.filter((d) => d === "blanco").length >= 2 && dominantes.filter((d) => d === "arena").length >= 2, JSON.stringify(dominantes));
  // Y el compilador pinta por zonas: el escenario lleva franjas con el dominante.
  const notas = compilarLectura(r.lectura).notas.filter((n) => /dominante/.test(n));
  assert.deepEqual(notas, [], notas.join(" | "));
});

console.log(`test-colores-por-tramo: ${pruebas} pruebas ok`);
