/**
 * Cobertura de colores del motor 3D de la vista guiada (REQ-007, fase 1). Sin coste.
 * - cada palabra de `COLORES_PROPUESTA_V2` y cada alias de la taxonomía resuelve a códigos que existen en la lámina;
 * - «verde salvia» (que el resolvedor del Taller no encuentra) resuelve al Eucalipto, el «sage green» de la lámina;
 * - cada material de las 28 ideas guardadas resuelve, por el título de su producto, al tono que se compra
 *   (y los que la tabla de palabras escogió a mano quedan en la línea Fashion/Reflex que usa la tienda);
 * - los pesos de una pieza suman 1 y ningún color queda fuera de la lámina.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { ALIAS_COLORES_V2, COLORES_PROPUESTA_V2, TONOS_CLAROS_V2, TONOS_V2 } from "../../src/lib/rag/taxonomy/v2";
import { coloresDeMaterial, coloresDePalabra, coloresDePalabras, normalizarPesos, PALABRAS_REVISADAS } from "../../src/lib/globos3d/motor/colores-espec";
import { resolverProductoDeIdeas } from "../../src/lib/globos3d/motor/productos-ideas";

const existe = (codigo: string) => assert.ok(referenciaPorCodigo(codigo), `el código ${codigo} no está en la lámina Sempertex`);

// 1. La paleta del cliente y los tonos claros.
for (const palabra of COLORES_PROPUESTA_V2) {
  const colores = coloresDePalabra(palabra);
  assert.ok(colores.length >= 1, `«${palabra}» no resuelve`);
  colores.forEach((c) => existe(c.codigo));
}
assert.equal(coloresDePalabra("multicolor").length, 4, "multicolor son cuatro colores a partes iguales");
assert.deepEqual(coloresDePalabra("dorado").map((c) => c.codigo), ["970"], "dorado es el Reflex Dorado de la tienda, no el primero de la lámina");
assert.deepEqual(coloresDePalabra("Celeste").map((c) => c.codigo), ["640"]);
assert.deepEqual(coloresDePalabra("rosa pastel").map((c) => c.codigo), ["609"]);

// 2. «verde salvia» y las demás palabras que la paleta no tiene.
assert.deepEqual(coloresDePalabra("verde salvia").map((c) => c.codigo), ["027"]);
assert.deepEqual(coloresDePalabra("Verde  Salvia").map((c) => c.codigo), ["027"], "mayúsculas y espacios dobles");
assert.deepEqual(coloresDePalabra("azul rey").map((c) => c.codigo), ["041"]);
assert.deepEqual(coloresDePalabra("azul marino").map((c) => c.codigo), ["044"]);
assert.deepEqual(coloresDePalabra("tornasol imposible"), [], "lo que no se reconoce no se inventa");
PALABRAS_REVISADAS.forEach((palabra) => assert.ok(coloresDePalabra(palabra).length >= 1, `la palabra revisada «${palabra}» no resuelve`));

// 3. Cada alias de la taxonomía (lo que el cliente escribe) lleva a un código que existe.
let alias = 0;
for (const item of [...ALIAS_COLORES_V2, ...TONOS_CLAROS_V2.map((tono) => ({ value: tono, aliases: TONOS_V2[tono].aliases }))]) {
  for (const a of item.aliases) {
    const colores = coloresDePalabra(a);
    assert.ok(colores.length >= 1, `el alias «${a}» de «${item.value}» no resuelve`);
    colores.forEach((c) => existe(c.codigo));
    alias += 1;
  }
}

// 4. Los materiales de las 28 ideas: título del producto → el tono que se compra.
const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "..", "..", "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
let materiales = 0;
for (const [ideaId, idea] of Object.entries(planes.ideas)) {
  for (const estructura of idea.plan.estructuras) {
    for (const material of estructura.materiales) {
      const producto = resolverProductoDeIdeas({ product_id: material.product_id, ...(material.variant_id ? { variant_id: material.variant_id } : {}) });
      const colores = coloresDeMaterial({ titulo: producto?.titulo, color: material.color ?? producto?.color, acabado: material.acabado ?? producto?.acabado });
      assert.ok(colores.length >= 1, `${ideaId}/${estructura.estructura_id}: el material ${material.product_id} (${material.color}) no resuelve`);
      colores.forEach((c) => existe(c.codigo));
      materiales += 1;
    }
    for (const sobreescritura of estructura.variant_overrides ?? []) assert.ok(coloresDePalabra(sobreescritura.color ?? "").length >= 1, `${ideaId}: el color de un cambio de variante no resuelve`);
    for (const parte of [estructura.flores?.petalo, estructura.flores?.centro]) if (parte?.color) assert.ok(coloresDePalabra(parte.color).length >= 1, `${ideaId}: el color de las flores no resuelve`);
  }
  for (const palabra of idea.plan.concepto.paleta) assert.ok(coloresDePalabra(palabra).length >= 1, `${ideaId}: la paleta «${palabra}» no resuelve`);
}
// El título manda sobre la familia: «azul» a secas es la 040, pero «Fashion Azul Rey» es la 041.
assert.deepEqual(coloresDeMaterial({ titulo: "B2b Globo Latex Redondo Fashion Azul Rey", color: "azul", acabado: "fashion" }).map((c) => c.codigo), ["041"]);
assert.deepEqual(coloresDeMaterial({ titulo: "B2b Globo Latex Redondo Fashion Transparente", color: "transparente", acabado: "fashion" }).map((c) => c.codigo), ["390"]);
assert.deepEqual(coloresDeMaterial({ color: "dorado", acabado: "reflex" }).map((c) => c.codigo), ["970"]);
assert.deepEqual(coloresDeMaterial({ color: "plateado" }).map((c) => c.codigo), ["981"]);

// 5. Los pesos.
const pesos = normalizarPesos([0.5, 0.3, 0.1, 0.1]);
assert.ok(Math.abs(pesos.reduce((s, p) => s + p, 0) - 1) < 1e-9, "los pesos suman 1");
const aviso: string[] = [];
const siete = coloresDePalabras(["rojo", "azul", "verde", "amarillo", "naranja", "rosado", "blanco"], 6, aviso);
assert.equal(siete.length, 6);
assert.ok(aviso.some((a) => a.includes("hasta 6 colores")), "se dice lo que se dejó fuera");
assert.ok(Math.abs(siete.reduce((s, c) => s + c.peso, 0) - 1) < 1e-9);

console.log(`test-motor-guiada-colores: ok (${COLORES_PROPUESTA_V2.length} palabras, ${alias} alias, ${materiales} materiales de ideas)`);
