/**
 * La medida de pendiente, afinado y zonas de color (`lib-zonas.ts`, REQ-001): lo armado igual a la foto da error 0; un tramo de
 * arriba plano contra uno que sube, uno parejo contra uno que se adelgaza y colores mezclados contra colores por tramos se ven en
 * la medida que les toca. Sin coste ni red.
 *
 * Run: npx tsx scripts/test/test-zonas-foto.ts
 */
import assert from "node:assert/strict";
import type { Caja, Disco } from "../exp/lib-proporciones";
import { errorDeZonasDeColor, medirTramo } from "../exp/lib-zonas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Un tramo de arriba de `x0` a `x1`: en cada x, dos globos de radio `r(x)` centrados en `y(x)`. */
function tramo(x0: number, x1: number, y: (x: number) => number, r: (x: number) => number, color: (x: number) => string = () => "blanco"): Disco[] {
  const discos: Disco[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += 0.02) for (const k of [-0.5, 0.5]) discos.push({ x, y: y(x) + k * r(x), r: r(x), color: color(x) });
  return discos;
}
/** Una columna que baja desde el extremo derecho del tramo (la franja del borde deja de ser tramo). */
const columna = (x: number, y0: number, y1: number): Disco[] => Array.from({ length: 12 }, (_, k) => ({ x: x + (k % 2) * 0.02, y: y0 + ((y1 - y0) * k) / 11, r: 0.04, color: "vino" }));
const caja = (d: readonly Disco[]): Caja => ({ x0: Math.min(...d.map((q) => q.x - q.r)), x1: Math.max(...d.map((q) => q.x + q.r)), y0: Math.min(...d.map((q) => q.y - q.r)), y1: Math.max(...d.map((q) => q.y + q.r)) });

const plano = tramo(0.1, 0.5, () => 0.3, () => 0.04);
const base = [...plano, ...columna(0.55, 0.3, 0.9)];

prueba("lo armado igual a la foto: pendiente y afinado iguales, error 0", () => {
  const t = medirTramo(base, base, caja(base));
  assert.ok(t);
  assert.equal(t.error, 0);
  assert.equal(t.derivaFoto, t.derivaArmado);
});

prueba("un tramo plano contra uno que sube hacia la derecha: la pendiente lo dice con signo", () => {
  const sube = [...tramo(0.1, 0.5, (x) => 0.4 - 0.25 * (x - 0.1), () => 0.04), ...columna(0.55, 0.3, 0.9)];
  const t = medirTramo(base, sube, caja(base))!;
  assert.ok(Math.abs(t.derivaFoto) < 0.02, `foto ${t.derivaFoto}`);
  assert.ok(t.derivaArmado < -0.05, `armado ${t.derivaArmado}`);
  assert.ok(t.error > 0.04, `error ${t.error}`);
});

prueba("un tramo parejo contra uno que se adelgaza hacia la izquierda: el afinado lo dice", () => {
  const afina = [...tramo(0.1, 0.5, () => 0.3, (x) => 0.02 + 0.05 * ((x - 0.1) / 0.4)), ...columna(0.55, 0.3, 0.9)];
  const t = medirTramo(base, afina, caja(base))!;
  assert.ok(t.afinadoArmado > t.afinadoFoto + 0.04, `afinado ${t.afinadoFoto} → ${t.afinadoArmado}`);
});

prueba("sin tramo en la foto (solo una columna) no hay medida", () => {
  const solo = columna(0.5, 0.1, 0.9);
  assert.equal(medirTramo(solo, solo, caja(solo)), null);
});

prueba("colores por tramos contra colores mezclados por todas partes: las zonas lo ven; idéntico da 0", () => {
  const porTramos = tramo(0.1, 0.5, () => 0.3, () => 0.04, (x) => (x < 0.3 ? "blanco" : "beige"));
  const mezclados = porTramos.map((d, i) => ({ ...d, color: i % 2 ? "blanco" : "beige" }));
  assert.equal(errorDeZonasDeColor(porTramos, porTramos, caja(porTramos)), 0);
  const e = errorDeZonasDeColor(porTramos, mezclados, caja(porTramos))!;
  assert.ok(e > 0.3, `error ${e}`);
  assert.equal(errorDeZonasDeColor(porTramos.map(({ color: _, ...d }) => d), mezclados, caja(porTramos)), null, "sin colores en la foto no hay medida");
});

console.log(`test-zonas-foto: ${pruebas} pruebas ok`);
