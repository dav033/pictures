/**
 * El recuadro de un montón de piso sale de sus globos detectados (REQ-001): el lector lo pone a ojo (corrido, más alto que lo que
 * hay) y la medición lo lleva a donde están los globos; con una detección que se perdió la mitad del montón se queda lo leído.
 * Sin coste ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-monton-medido.ts
 */
import assert from "node:assert/strict";
import { LecturaFotoSchema, type LecturaFoto, type PiezaLeida } from "@/lib/globos3d/lectura-foto";
import { medirConDetecciones, type GloboDetectado } from "@/lib/globos3d/medir-con-detecciones";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const blanco = [{ nombre: "blanco", hex: "#f5f3ee", peso: 100, acabado: "mate" as const }];
const MEZCLA = { grandes: 20, medianos: 60, chicos: 20, diametroGrande: 0.09, diametroMediano: 0.065, diametroChico: 0.03, formatoGrande: "R-18" as const, formatoMediano: "R-12" as const, formatoChico: "R-5" as const };
const monton: PiezaLeida = { tipo: "racimo_piso", x: 0.7, yPie: 0.9, yArriba: 0.7, ancho: 0.24, tamanos: {}, mezcla: MEZCLA, racimos: 0.6, colores: blanco };
const lectura = (p: PiezaLeida): LecturaFoto => LecturaFotoSchema.parse({ resumen: "prueba de monton medido", aspecto: 1, escala: { altoImagenCm: 400, referencia: "prueba" }, pisoY: 0.85, sala: { pared: "#ece8e2", piso: "#8a5a36" }, piezas: [p] });
const caja = (cx: number, cy: number, d: number): GloboDetectado => ({ box_2d: [Math.round((cy - d / 2) * 1000), Math.round((cx - d / 2) * 1000), Math.round((cy + d / 2) * 1000), Math.round((cx + d / 2) * 1000)], color: "blanco" });
/** Una rejilla de globos de `d` entre (x0, y0) y (x1, y1). */
function rejilla(x0: number, y0: number, x1: number, y1: number, d: number): GloboDetectado[] {
  const salida: GloboDetectado[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += d * 0.7) for (let y = y0; y <= y1 + 1e-9; y += d * 0.7) salida.push(caja(x, y, d));
  return salida;
}
const medido = (globos: GloboDetectado[]) => medirConDetecciones(lectura(monton), globos).lectura.piezas[0] as Extract<PiezaLeida, { tipo: "racimo_piso" }>;

prueba("el montón leído más alto y más a la izquierda que sus globos toma el recuadro de los globos", () => {
  const m = medido(rejilla(0.72, 0.78, 0.8, 0.88, 0.03));
  assert.ok(Math.abs(m.x - 0.76) <= 0.02, `x ${m.x}`);
  assert.ok(m.yArriba >= 0.74 && m.yArriba <= 0.78, `arriba ${m.yArriba}`);
  assert.ok(m.yPie >= 0.86 && m.yPie <= 0.92, `pie ${m.yPie}`);
  assert.ok(m.ancho >= 0.07 && m.ancho <= 0.14, `ancho ${m.ancho}`);
});

prueba("si la detección solo cubre una parte baja del montón (menos de la mitad de su alto), se queda lo leído", () => {
  const m = medido(rejilla(0.66, 0.84, 0.78, 0.88, 0.02));
  assert.equal(m.yArriba, 0.7);
  assert.equal(m.x, 0.7);
});

console.log(`test-monton-medido: ${pruebas} pruebas ok`);
