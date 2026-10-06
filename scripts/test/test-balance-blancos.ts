/**
 * Balance de blancos antes de medir el color (2026-10-06): CASE-002 tiene luz lila y la plata clara se medía como
 * rosa pastel o como Fashion Gris según la sombra. Determinista y sin red.
 * Run: npx tsx --conditions=react-server scripts/test/test-balance-blancos.ts
 */
import assert from "node:assert/strict";
import { cajasBlancas, corregirBlancos, equilibrarMuestra, gananciasDeBlancos } from "@/lib/plan/balance-blancos";
import type { MuestraPixeles } from "@/lib/plan/dominancia-color";

/** Una foto de 40×20: la mitad izquierda es la «cortina» (rgb dado), la derecha un globo plata con el mismo tinte. */
function foto(cortina: [number, number, number], globo: [number, number, number]): MuestraPixeles {
  const ancho = 40, alto = 20;
  const rgb = new Uint8Array(ancho * alto * 3);
  for (let y = 0; y < alto; y += 1) for (let x = 0; x < ancho; x += 1) {
    const i = (y * ancho + x) * 3;
    const c = x < 20 ? cortina : globo;
    rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
  }
  return { ancho, alto, rgb };
}

const elemento = (observados: string[], categoria = "curtain") => ({
  approved: true, category: categoria, source_image_id: "REF_01",
  reference_bbox: { x: 0, y: 0, width: 0.5, height: 1 },
  appearance: { observed_colors: observados },
});

// Solo cuenta lo que el analizador vio SOLO blanco, que no es un globo y es de esa foto.
assert.equal(cajasBlancas([elemento(["white", "off-white"])], "REF_01").length, 1);
assert.equal(cajasBlancas([elemento(["white", "pastel pink"])], "REF_01").length, 0, "blanco con otro color: no sirve de referencia");
assert.equal(cajasBlancas([elemento(["white"], "balloon_structure")], "REF_01").length, 0, "un globo blanco no es la luz");
assert.equal(cajasBlancas([elemento(["white"])], "REF_02").length, 0, "de otra foto");

// Luz lila: la cortina blanca mide (211,195,227). La corrección la vuelve gris y la plata deja de ser lila.
const lila = foto([211, 195, 227], [186, 179, 199]);
const g = gananciasDeBlancos(lila, cajasBlancas([elemento(["white"])], "REF_01"));
assert.ok(g, "con tinte, hay corrección");
const corregida = corregirBlancos(lila, g);
const px = (m: MuestraPixeles, x: number) => [m.rgb[x * 3]!, m.rgb[x * 3 + 1]!, m.rgb[x * 3 + 2]!];
const [r, gr, b] = px(corregida, 0);
assert.ok(Math.max(r, gr, b) - Math.min(r, gr, b) <= 2, `la cortina queda gris: ${r},${gr},${b}`);
const plata = px(corregida, 30);
assert.ok(Math.abs(plata[2]! - plata[1]!) < Math.abs(199 - 179), "la plata pierde el tinte lila");
assert.ok(Math.abs((r + gr + b) / 3 - (211 + 195 + 227) / 3) < 2, "la luminosidad se conserva");

// Luz blanca: nada que corregir, la misma muestra.
const blanca = foto([230, 230, 232], [180, 180, 182]);
const sinCambio = equilibrarMuestra(blanca, [elemento(["white"])], "REF_01");
assert.equal(sinCambio.ganancias, null);
assert.equal(sinCambio.muestra, blanca);

// Sin blanco en la foto: la misma muestra.
assert.equal(equilibrarMuestra(lila, [elemento(["pink"])], "REF_01").muestra, lila);

// Un «blanco» con un tinte absurdo (era una pared rosa leída como blanca): no se corrige.
assert.equal(gananciasDeBlancos(foto([240, 120, 150], [200, 200, 200]), cajasBlancas([elemento(["white"])], "REF_01")), null);

// Un blanco oscuro (en sombra) no sirve de referencia.
assert.equal(gananciasDeBlancos(foto([90, 80, 100], [60, 60, 60]), cajasBlancas([elemento(["white"])], "REF_01")), null);

console.log("test-balance-blancos: OK");
