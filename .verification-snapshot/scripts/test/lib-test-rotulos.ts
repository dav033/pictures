/** Ayudas compartidas de las pruebas de rótulos (`test-rotulos*.ts`). */
import assert from "node:assert/strict";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { armarEscenografia, type RotuloEscenografia } from "../../src/lib/globos3d/escenografia";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { elementosDeEscenografia, type PiezaEscenografia } from "../../src/lib/globos3d/mobiliario-pieza";
import { type Pieza } from "../../src/lib/globos3d/piezas";
import { type Mascara } from "../../src/lib/globos3d/rotulo-contornos";

/** Cuenta y muestra cada prueba; `terminar` dice cuántas fueron. */
let pruebas = 0;
export const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
export const terminar = (archivo: string) => console.log(`${archivo}: ${pruebas} pruebas ok`);

export const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
export const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(3)} (esperado ${esperado} ±${tol})`);
export const herramienta = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  if (!r.ok) assert.fail(r.error);
  return r;
};
export const escenografia = (p: Pieza): PiezaEscenografia => (p.tipo === "escenografia" ? p : assert.fail("no es escenografía"));
export const rotuloDe = (escena: Escena, id: string): RotuloEscenografia | undefined => escenografia(escena.nodos.find((n) => n.id === id)!.pieza).mueble?.rotulo;
export const ultimo = (p: PiezaEscenografia) => armarEscenografia(elementosDeEscenografia(p)).at(-1)!;
export const color = (nombre: string, hex: string, acabado: "mate" | "brillante" | "cromado" | "perla" = "mate") => ({ nombre, hex, peso: 100, acabado });

/** Una máscara de `ancho` × `alto` píxeles: lo que valga 1 en `f(x, y)` es tinta. */
export const mascara = (ancho: number, alto: number, f: (x: number, y: number) => boolean): Mascara => {
  const datos = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) datos[y * ancho + x] = f(x, y) ? 1 : 0;
  return { datos, ancho, alto };
};

