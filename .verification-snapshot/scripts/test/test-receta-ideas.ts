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

test("las ideas con globos tienen medidas positivas", () => {
  const conGlobos = recetas.filter((r) => r.receta.total > 0);
  assert.ok(conGlobos.length > 0);
  for (const { item, receta } of conGlobos) assert.ok(receta.medidas && receta.medidas.altoCm > 0 && receta.medidas.anchoCm >= 0, `${item.id} medidas`);
});

// The workshop glossary has no technique term for scenography (panels, tables, props), so `recetaDeIdea` gives it no chip on
// purpose. The only exempt ideas are the prop-only ones: no balloons and every piece is scenography.
const EXENTAS = new Set([
  "utileria:banderin_halloween", "utileria:guirnalda_recortes", "utileria:banderola_fiesta", "utileria:platos_halloween",
  "utileria:plato_de_pie", "utileria:vasos", "utileria:servilletas", "utileria:cubiertos", "utileria:bandeja", "utileria:mantel",
  "utileria:velas", "utileria:topper", "utileria:calabaza_dulces", "utileria:bolsa_dulces", "utileria:gorritos",
  "utileria:letrero_calabaza", "utileria:caja_regalo",
]);

test("cada idea tiene al menos una etiqueta de técnica, salvo las exentas enumeradas (solo utilería, sin globos)", () => {
  const sinTecnica = recetas.filter((r) => r.receta.tecnicas.length === 0).map((r) => r.item.id);
  assert.deepEqual(new Set(sinTecnica), EXENTAS);
  for (const { item, receta } of recetas) {
    if (!EXENTAS.has(item.id)) continue;
    assert.equal(receta.total, 0, `${item.id} exenta pero tiene globos`);
    assert.ok(receta.piezas.every((p) => p.nombre === "Escenografía"), `${item.id} exenta pero tiene otras piezas`);
  }
});

test("decoraciones y globos sueltos solos dicen su clase, sin inventar cómo se arman", () => {
  const de = (id: string) => recetas.find((r) => r.item.id === id)!.receta.tecnicas;
  assert.deepEqual(de("idea:estrella-navidena"), ["Decoración de globos"]);
  assert.ok(de("idea:rizos-alegres").includes("Globos sueltos"));
});

test("las ocasiones de la receta son las de la ficha, una por una", () => {
  for (const { item, receta } of recetas) assert.equal(receta.ocasiones.length, item.ocasiones.length, item.id);
});
