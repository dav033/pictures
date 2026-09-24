/**
 * Regresiones del camino de color de la foto de referencia (ADR-0024).
 *
 * Cubre lo que antes decidía el azar y ahora decide una regla:
 *  - 2.1  la dominancia medida manda sobre el orden en que el analizador escribió
 *  - 2.5  el gris de una foto se sustituye a plateado Y se le dice al cliente
 *  - 2.7  canonizar es idempotente, que es lo que permite hacerlo en la puerta
 *  - 2.10 una etiqueta ambigua no se resuelve por orden de lista
 *
 *   npx tsx --conditions=react-server scripts/test-color-referencia-fases2.ts
 *
 * Sin red, sin proveedor, sin coste.
 */
import assert from "node:assert/strict";
import { coloresDominantesReferencia, coloresFotoCliente, sustitucionesColorReferencia } from "../src/lib/plan/colores-referencia";
import { colorDeCatalogo } from "../src/lib/plan/colores-catalogo";
import { colorCatalogoMasCercano } from "../src/lib/rag/catalog/similitud-color";

type Caso = { nombre: string; correr: () => void };

const casos: Caso[] = [
  {
    nombre: "2.1 · la medida manda sobre el orden de redacción del analizador",
    correr: () => {
      // El analizador escribió "gold" primero y "red" después; los píxeles dicen
      // que la pieza es 70 % roja. Antes ganaba el orden de redacción.
      const colores = coloresDominantesReferencia({
        observed_colors: ["gold", "red"],
        measured_colors: [
          { color: "rojo", share: 0.7 },
          { color: "dorado", share: 0.2 },
        ],
      });
      assert.deepEqual(colores, ["rojo", "dorado"]);
    },
  },
  {
    nombre: "2.1 · sin medida se mantiene el comportamiento anterior",
    correr: () => {
      assert.deepEqual(coloresDominantesReferencia({ observed_colors: ["gold", "red"] }), ["dorado", "rojo"]);
      // La firma vieja (una lista de etiquetas) sigue sirviendo a sus llamadores.
      assert.deepEqual(coloresDominantesReferencia(["gold", "red"]), ["dorado", "rojo"]);
    },
  },
  {
    nombre: "2.1 · un color medido que el catálogo no vende no llega a lo que se compra",
    correr: () => {
      // `gris` se mide en los píxeles pero no se puede comprar: no entra en
      // `colores_referencia`, que es la lista contra la que se resuelven líneas.
      const colores = coloresDominantesReferencia({
        observed_colors: ["grey"],
        measured_colors: [
          { color: "gris", share: 0.6 },
          { color: "blanco", share: 0.3 },
        ],
      });
      assert.deepEqual(colores, ["blanco"]);
    },
  },
  {
    nombre: "2.5 · el gris de una foto va a plateado, no a negro",
    correr: () => {
      assert.equal(colorCatalogoMasCercano("gris", ["negro", "plateado", "blanco", "dorado"]), "plateado");
    },
  },
  {
    nombre: "2.5 · y el cliente se entera: la sustitución se reporta, no se silencia",
    correr: () => {
      // La decisión de producto es sustituir deliberadamente, no desaparecer el
      // color. Lo segundo es lo que hacía antes.
      const sustituciones = sustitucionesColorReferencia("E1", ["gris"], ["plateado"]);
      assert.equal(sustituciones.length, 1);
      assert.equal(sustituciones[0]?.pedido, "gris");
      assert.equal(sustituciones[0]?.entregado, "plateado");
      assert.match(sustituciones[0]?.motivo ?? "", /gris/);
    },
  },
  {
    nombre: "2.5 · el gris sigue visible en la paleta que se le muestra al cliente",
    correr: () => {
      // Filtrarlo aquí lo haría indistinguible de un color que la foto no tenía.
      const colores = coloresFotoCliente({
        palette: { observed: [], priority: [] },
        elements: [
          {
            approved: true,
            reference_bbox: { x: 0, y: 0, width: 1, height: 1 },
            appearance: {
              observed_colors: ["grey"],
              measured_colors: [
                { color: "gris", share: 0.6 },
                { color: "blanco", share: 0.3 },
              ],
            },
          },
        ],
        // El resto del elemento no participa en esta función.
      } as unknown as Parameters<typeof coloresFotoCliente>[0]);
      assert.deepEqual(colores, ["gris", "blanco"]);
    },
  },
  {
    nombre: "2.7 · canonizar es idempotente, y por eso puede hacerse en la puerta",
    correr: () => {
      for (const crudo of ["rosa", "azul rey", "rosado", "azul", "dorado"]) {
        const una = colorDeCatalogo(crudo);
        assert.equal(colorDeCatalogo(una), una, `no idempotente: ${crudo} -> ${una} -> ${colorDeCatalogo(una)}`);
      }
      assert.equal(colorDeCatalogo("rosa"), "rosado");
    },
  },
  {
    nombre: "2.10 · una etiqueta ambigua no la resuelve el orden de la lista",
    correr: () => {
      // "pink or coral": el analizador dijo que no sabe. Antes se tomaba el
      // primero y la mitad de las veces se compraba el otro.
      const colores = coloresDominantesReferencia({ observed_colors: ["pink or coral"] });
      assert.ok(colores.includes("rosado"), `esperaba rosado en ${JSON.stringify(colores)}`);
      assert.ok(colores.includes("coral"), `esperaba coral en ${JSON.stringify(colores)}`);
    },
  },
  {
    nombre: "2.10 · un tono de dos palabras sigue siendo UN color",
    correr: () => {
      // La regresión que protege el cambio anterior: "mint green" es menta, no
      // menta y verde.
      assert.deepEqual(coloresDominantesReferencia({ observed_colors: ["mint green"] }), ["menta"]);
      assert.deepEqual(coloresDominantesReferencia({ observed_colors: ["white and gold"] }), ["blanco", "dorado"]);
    },
  },
];

let fallos = 0;
for (const caso of casos) {
  try {
    caso.correr();
    console.log(`  ok   ${caso.nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`  FAIL ${caso.nombre}`);
    console.log(`       ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}
console.log(fallos ? `\n${fallos} de ${casos.length} fallan` : `\n[PASS] ${casos.length} casos`);
process.exit(fallos ? 1 : 0);
