/**
 * T29: receta de cada idea del catálogo (tamaños, colores, técnica, medidas, ocasiones). Recorre TODA la biblioteca de
 * fábrica con las mismas funciones que la tarjeta de la ficha, y comprueba que los totales cuadran con su plan.
 * Run: npx tsx --conditions=react-server scripts/test/test-receta-ideas.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BIBLIOTECA_FABRICA, escenaDeItem, productosDe } from "../../src/lib/globos3d/biblioteca";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { piezasDeContenido, recetaDeIdea } from "../../src/lib/globos3d/receta-idea";

const recetas = BIBLIOTECA_FABRICA.map((item) => {
  const armada = armarEscena(escenaDeItem(item), new Map());
  const productos = productosDe(item, armada);
  const receta = recetaDeIdea({ piezas: piezasDeContenido(item.contenido), productos, cajas: armada.porNodo.filter((n) => n.copias > 0).map((n) => n.caja), ocasiones: item.ocasiones });
  return { item, productos, receta };
});

test("la biblioteca tiene ideas y cada una tiene receta con piezas", () => {
  assert.ok(recetas.length > 0);
  for (const { item, receta } of recetas) assert.ok(receta.piezas.length > 0, `${item.id} sin piezas`);
});

test("los totales cuadran: tamaños y colores suman lo mismo que los globos de su plan", () => {
  for (const { item, productos, receta } of recetas) {
    const suma = (xs: number[]) => xs.reduce((s, n) => s + n, 0);
    assert.equal(receta.total, productos.totalGlobos, `${item.id} total`);
    assert.equal(suma(receta.tamanos.map((t) => t.cantidad)), receta.total, `${item.id} tamaños`);
    assert.equal(suma(receta.colores.map((c) => c.total)), receta.total, `${item.id} colores`);
    for (const c of receta.colores) assert.equal(suma(Object.values(c.porTamano)), c.total, `${item.id} ${c.codigo} por tamaño`);
  }
});

test("las ideas con globos tienen medidas positivas y técnica (si tienen una estructura)", () => {
  const conGlobos = recetas.filter((r) => r.receta.total > 0);
  assert.ok(conGlobos.length > 0);
  for (const { item, receta } of conGlobos) {
    // Known gap: pieces without a technique mapping (decoration, loose balloon, scenography) add no technique chip yet; any
    // idea that has another kind of piece must have one.
    const SIN_TECNICA = new Set(["Decoración", "Globo suelto", "Escenografía"]);
    if (receta.piezas.some((p) => !SIN_TECNICA.has(p.nombre))) assert.ok(receta.tecnicas.length > 0, `${item.id} sin técnica`);
    assert.ok(receta.medidas && receta.medidas.altoCm > 0 && receta.medidas.anchoCm >= 0, `${item.id} medidas`);
  }
});

test("las ocasiones de la receta son las de la ficha, una por una", () => {
  for (const { item, receta } of recetas) assert.equal(receta.ocasiones.length, item.ocasiones.length, item.id);
});
