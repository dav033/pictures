/**
 * El montón de piso bajo el pie de una guirnalda es parte de ella (REQ-001): sube hasta el borde de abajo del cuerpo y no deja hueco
 * (sin correrse de lado); el que está lejos, solapado o colgado de la punta de arriba no se toca. Sin coste ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-montones-al-pie.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema, type LecturaFoto, type PiezaLeida } from "@/lib/globos3d/lectura-foto";
import { montonesAlPie } from "@/lib/globos3d/montones-al-pie";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const blanco = [{ nombre: "blanco", hex: "#f5f3ee", peso: 100, acabado: "mate" as const }];
const MEZCLA = { grandes: 20, medianos: 60, chicos: 20, diametroGrande: 0.09, diametroMediano: 0.065, diametroChico: 0.03, formatoGrande: "R-18" as const, formatoMediano: "R-12" as const, formatoChico: "R-5" as const };
const columna: PiezaLeida = { tipo: "guirnalda_organica", puntos: [{ x: 0.2, y: 0.3, grosor: 0.15 }, { x: 0.74, y: 0.3, grosor: 0.15 }, { x: 0.74, y: 0.7, grosor: 0.15 }], tamanos: {}, mezcla: MEZCLA, racimos: 0.3, colores: blanco };
const monton = (x: number, yArriba: number): PiezaLeida => ({ tipo: "racimo_piso", x, yPie: 0.9, yArriba, ancho: 0.22, tamanos: {}, mezcla: MEZCLA, racimos: 0.6, colores: blanco });
const lectura = (piezas: PiezaLeida[]): LecturaFoto => LecturaFotoSchema.parse({ resumen: "prueba de montones", aspecto: 0.75, escala: { altoImagenCm: 400, referencia: "prueba" }, pisoY: 0.85, sala: { pared: "#ece8e2", piso: "#8a5a36" }, piezas });
const elMonton = (l: LecturaFoto) => l.piezas.find((p) => p.tipo === "racimo_piso") as Extract<PiezaLeida, { tipo: "racimo_piso" }>;

prueba("un montón con hueco bajo el pie de la columna sube hasta su borde de abajo y no se corre de lado", () => {
  const notas: string[] = [];
  const m = elMonton(montonesAlPie(lectura([columna, monton(0.71, 0.8)]), notas));
  assert.equal(m.x, 0.71);
  assert.equal(m.yArriba, 0.775);
  assert.equal(notas.length, 1);
});

prueba("un montón solapado, sin hueco, no se toca, ni uno lejos del extremo ni uno con el arriba muy por debajo", () => {
  const l = lectura([columna, monton(0.74, 0.7)]);
  assert.equal(montonesAlPie(l, []), l);
  const lejos = lectura([columna, monton(0.3, 0.8)]);
  assert.equal(montonesAlPie(lejos, []), lejos);
  const colgado = lectura([columna, monton(0.74, 0.84)]);
  assert.equal(montonesAlPie(colgado, []), colgado);
});

prueba("un montón bajo la punta de ARRIBA de la guirnalda (colgado de un aro) no se mueve: solo el pie de la columna lo atrae", () => {
  const arco: PiezaLeida = { ...(columna as Extract<PiezaLeida, { tipo: "guirnalda_organica" }>), puntos: [{ x: 0.3, y: 0.2, grosor: 0.15 }, { x: 0.74, y: 0.2, grosor: 0.15 }, { x: 0.74, y: 0.7, grosor: 0.15 }] };
  const colgado = lectura([arco, monton(0.2, 0.3)]);
  assert.equal(montonesAlPie(colgado, []), colgado);
});

prueba("el compilador arma el montón ya pegado (y lo dice en las notas)", () => {
  const c = compilarLectura(lectura([columna, monton(0.71, 0.8)]));
  assert.ok(c.notas.some((n) => /del pie de una guirnalda; sube hasta su borde de abajo/.test(n)), c.notas.join(" | "));
  const nodo = c.escena.nodos.find((n) => n.id.startsWith("racimo-piso"))!;
  const aMano = compilarLectura(lectura([columna, monton(0.71, 0.775)])).escena.nodos.find((n) => n.id.startsWith("racimo-piso"))!;
  assert.deepEqual(nodo.colocacion, aMano.colocacion, "queda donde lo pondría quien lo hubiera leído ya pegado");
});

console.log(`test-montones-al-pie: ${pruebas} pruebas ok`);
