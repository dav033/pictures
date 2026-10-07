/**
 * La ficha visual de cada material de la cotización (`src/components/guiado/ficha-globo.ts`): qué globo Sempertex
 * es, su familia, color, acabado, tamaño, globos por paquete y foto de catálogo, y cómo se agrupan las variantes
 * del mismo producto en «Tus materiales». Solo presentación: no toca cantidades ni precios. Sin red, sin coste.
 *
 * Run: npx tsx scripts/test/test-ficha-globo.ts
 */
import assert from "node:assert/strict";
import { agruparPorProducto, fichaGlobo, fichasDeCotizacion, fotoMiniatura } from "@/components/guiado/ficha-globo";

const resumen = (nombre: string, extra: Parameters<typeof fichaGlobo>[0] = {}) => {
  const ficha = fichaGlobo({ nombre, ...extra });
  return [ficha.producto, ficha.familia, ficha.acabado, ficha.medida, ficha.unidadesPaquete];
};

// Títulos del catálogo (B2b … — R-N / PAQUETE X N), nombres ya dichos para el cliente y nombres de costeo de la guiada.
assert.deepEqual(resumen("B2b Globo Latex Redondo Reflex Plata — R-5 / PAQUETE X 50"), ["Reflex Plata", "Reflex", "reflex", "5″", 50]);
assert.deepEqual(resumen("B2b Globo Latex Redondo Silk Blanco Nácar — R-12 / PAQUETE X 50"), ["Silk Blanco Nácar", "Silk", "perlado", "12″", 50]);
assert.deepEqual(resumen("Globo pastel mate rosado de 5\"", { unidadesPaquete: 20 }), ["Pastel Mate Rosado", "Pastel Matte", "pastel", "5″", 20]);
assert.deepEqual(resumen("Globo reflex plata de 24\""), ["Reflex Plata", "Reflex", "reflex", "24″", null]);
assert.deepEqual(resumen("Globo de látex 12\" Palo de rosa", { color: "rosado" }), ["Palo De Rosa", null, "estandar", "12″", null]);
assert.deepEqual(resumen("B2b Globo Latex Redondo Crystal Transparente — R-12 / PAQUETE X 50"), ["Crystal Transparente", "Crystal", "cristal", "12″", 50]);
assert.deepEqual(resumen("B2b Globo Latex Tubito Fashion Naranja — T260 / PAQUETE X 50"), ["Tubito Fashion Naranja", "Fashion", "estandar", "Para modelar", 50]);
assert.deepEqual(resumen("B2b Globo Latex Link-O-Loon Fashion Fucsia — LOL 6 / PAQUETE X 50"), ["Link-O-Loon Fashion Fucsia", "Fashion", "estandar", "Link 6″", 50]);
// Fuente única (color-sempertex, probador 2026-10-06): el tono es el de la referencia del catálogo que nombra el producto,
// el mismo de los chips, la tabla y el editor (antes, la paleta de la taxonomía: «Rojo» #d32f2f aquí y #e4002b allá).
assert.equal(fichaGlobo({ nombre: "B2b Globo Latex Redondo Fashion Azul Naval — R-18 / PAQUETE X 25" }).hex, "#1e22aa", "el tono exacto del nombre manda (Fashion Azul Naval del catálogo)");
assert.equal(fichaGlobo({ nombre: "Globo de látex 12\" Rojo", color: "rojo" }).hex, "#e4002b");
assert.equal(fichaGlobo({ nombre: "B2b Globo Latex Redondo Fashion Azul — R-12 / PAQUETE X 50", color: "azul" }).hex, "#62b5e5", "el Azul 040 es azul claro, como en los chips");

// Foto del catálogo a tamaño de miniatura; nada que no sea https.
assert.equal(fotoMiniatura("https://cdn.shopify.com/s/files/1/0825/6100/7911/files/R12_Rojo_-_Red_015.jpg?v=1763045149"), "https://cdn.shopify.com/s/files/1/0825/6100/7911/files/R12_Rojo_-_Red_015.jpg?v=1763045149&width=160");
assert.equal(fotoMiniatura("http://ejemplo.com/a.jpg"), null);
assert.equal(fotoMiniatura("no es una url"), null);

// Las variantes del mismo producto van juntas, de menor a mayor; la baldosa usa la primera foto que haya.
const lineas = [
  { id: "r24", nombre: "Globo reflex plata de 24\"" },
  { id: "p5", nombre: "Globo pastel mate rosado de 5\"" },
  { id: "r5", nombre: "Globo reflex plata de 5\"", foto: "https://cdn.shopify.com/s/files/1/x/R5_Plata.jpg?v=1" },
  { id: "r12", nombre: "Globo reflex plata de 12\"" },
];
const fichas = fichasDeCotizacion(lineas);
const grupos = agruparPorProducto(lineas, (linea) => fichas[linea.id]!);
assert.deepEqual(grupos.map((grupo) => [grupo.ficha.producto, grupo.items.map(({ item }) => item.id)]), [["Reflex Plata", ["r5", "r12", "r24"]], ["Pastel Mate Rosado", ["p5"]]]);
assert.match(grupos[0]!.ficha.foto ?? "", /R5_Plata\.jpg\?v=1&width=160$/);

console.log(`test-ficha-globo: ${grupos.map((grupo) => `${grupo.ficha.producto} (${grupo.items.map(({ ficha }) => ficha.medida).join(", ")})`).join(" · ")}`);
