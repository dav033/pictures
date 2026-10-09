/**
 * Lo que comparten las pruebas de REQ-012 (mesas y sillas desacopladas): un pequeño marco de pruebas, una sala grande, atajos para
 * llamar a las herramientas de la IA y leer lo que hay en la escena (mesas, sillas de cada mesa, cajas en el mundo).
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { mesaDePieza, sillasDePieza } from "../../src/lib/globos3d/mobiliario-conjunto";
import { conjuntoDe } from "../../src/lib/globos3d/mobiliario-conjunto-escena";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
export const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
export const fin = (archivo: string) => console.log(`${archivo}: ${pruebas} pruebas ok`);

export const salaGrande = (): Escena => ({ sala: { ...SALA_INICIAL, anchoCm: 1400, fondoCm: 1200 }, nodos: [] });
export const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(1)} (esperado ${esperado} ±${tol})`);

/** Llama a una herramienta de la IA y falla la prueba si la rechaza. */
export const llamar = (escena: Escena, herramienta: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, herramienta, args);
  if (!r.ok) assert.fail(`${herramienta}: ${r.error}`);
  return r;
};
/** Llama a una herramienta que debe rechazar el pedido y devuelve el error. */
export const falla = (escena: Escena, herramienta: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, herramienta, args);
  assert.ok(!r.ok, `${herramienta} debía fallar`);
  return r.ok ? "" : r.error;
};

export const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
export const caja = (e: Escena, id: string) => armarEscena(e).porNodo.find((n) => n.id === id)!.caja;
export const centro = (c: { min: { x: number; z: number }; max: { x: number; z: number } }) => ({ x: (c.min.x + c.max.x) / 2, z: (c.min.z + c.max.z) / 2 });
export const mesas = (e: Escena) => e.nodos.filter((n) => mesaDePieza(n.pieza));
export const sillasDe = (e: Escena, mesaId: string) => conjuntoDe(e, mesaId)?.sillas ?? null;
/** Cuántas sillas tiene de verdad una mesa (las del grupo de sillas, no las de su nombre). */
export const cuantas = (e: Escena, mesaId: string) => { const s = sillasDe(e, mesaId); return s ? sillasDePieza(s.pieza)!.puestos.length : 0; };
export const medidas = (p: Pieza) => { const { min, max } = armarPieza(p).caja; return { ancho: max.x - min.x, fondo: max.z - min.z, alto: max.y - min.y, y0: min.y }; };
export const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
