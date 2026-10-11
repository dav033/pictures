/**
 * D-038, «el mismo globo» de las presentaciones del catálogo: la regla de TypeScript (`crosswalk-mismo-globo.ts`) agrupa los paquetes
 * exactamente como `mismo_globo` de Python (`services/ai-api/app/presentaciones.py`) sobre lo que `_candidate` saca de cada fila.
 * Los vectores (`contracts/domain/v1/golden/mismo-globo/vectores.json`) los escribe el CÓDIGO de Python con
 * `scripts/motor/generar-vectores-mismo-globo.py`; aquí cada uno pasa por la lectura de la fila SQL y por la regla, y el grupo tiene que ser
 * el mismo. Sin red, sin base.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-mismo-globo.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { filaCrudaDePresentaciones } from "../../src/lib/globos3d/motor/crosswalk-consulta";
import { presentacionesDelMismoGlobo } from "../../src/lib/globos3d/motor/crosswalk-mismo-globo";

const RAIZ = path.resolve(__dirname, "..", "..");

const FilaDePython = z.object({
  product_id: z.string(), variant_id: z.string(), source_snapshot_id: z.string(), producto_titulo: z.string(), variante_titulo: z.string().nullable(),
  precio: z.number(), unidades_paq: z.number(), disponible: z.boolean(), producto_disponible: z.boolean(), currency: z.string(),
  codigo_tamano: z.string().nullable(), forma: z.string().nullable(), diam_pulg: z.number().nullable(),
  colores_producto: z.unknown(), colores_variante: z.unknown(),
}).passthrough();
const Vectores = z.object({
  vectores: z.array(z.object({ caso: z.string(), que: z.string(), pedida: z.string(), filas: z.array(FilaDePython), esperado: z.array(z.string()) })),
});

/** La fila de Python como la devuelve la consulta de presentaciones (`SQL_PRESENTACIONES`), con `vendible` como lo calcula la base. */
function filaSql(pedida: string, fila: z.infer<typeof FilaDePython>): Record<string, unknown> {
  return {
    pedida, snapshot: fila.source_snapshot_id, product_id: fila.product_id, titulo_producto: fila.producto_titulo, colores_producto: fila.colores_producto,
    variant_id: fila.variant_id, titulo_variante: fila.variante_titulo, codigo_tamano: fila.codigo_tamano, forma: fila.forma, diam_pulg: fila.diam_pulg,
    derived_colors: fila.colores_variante, unidades_paq: fila.unidades_paq, price: fila.precio,
    vendible: fila.disponible && fila.producto_disponible && fila.currency === "COP" && fila.precio > 0 && fila.unidades_paq > 0,
  };
}

const grupo = (pedida: string, filas: ReadonlyArray<Record<string, unknown>>): string[] =>
  presentacionesDelMismoGlobo(filas.flatMap((fila) => filaCrudaDePresentaciones(fila) ?? [])).filter((f) => f.pedida === pedida).map((f) => f.variantId);

function main(): void {
  const { vectores } = Vectores.parse(JSON.parse(readFileSync(path.join(RAIZ, "contracts", "domain", "v1", "golden", "mismo-globo", "vectores.json"), "utf8")));
  assert.ok(vectores.length >= 12, "los vectores de Python están");

  // 1. Cada vector: el mismo grupo que Python.
  for (const vector of vectores) {
    const delTs = grupo(vector.pedida, vector.filas.map((fila) => filaSql(vector.pedida, fila)));
    assert.deepEqual(delTs, vector.esperado, `${vector.caso}: ${vector.que}`);
  }
  console.log(`[PASS] ${vectores.length} vectores sacados del código de Python: TypeScript agrupa los mismos paquetes`);

  // 2. Los dos casos que motivaron la revisión: la ×12 sin colores y la ×50 «dorado» del mismo producto SÍ son el mismo globo; la de otro color, no.
  const dorado = vectores.find((v) => v.caso === "x12-sin-color-y-x50-dorado");
  assert.deepEqual(dorado?.esperado, ["a12", "b50"]);
  const otroColor = vectores.find((v) => v.caso === "color-distinto-no-agrupa");
  assert.deepEqual(otroColor?.esperado, ["a", "b"], "el color distinto queda fuera");
  console.log("[PASS] ×12 con colores NULL y ×50 «dorado» del mismo producto son un solo globo; otro color no");

  // 3. La diferencia a propósito con Python: la variante pedida puede no venderse (una lista curada vieja) y aun así se compra de los paquetes de su globo.
  const sinPedida = vectores.find((v) => v.caso === "paquete-no-vendible-no-cuenta")!;
  const filas = sinPedida.filas.map((fila) => (fila.variant_id === sinPedida.pedida ? { ...fila, disponible: false } : fila));
  assert.deepEqual(grupo(sinPedida.pedida, filas.map((fila) => filaSql(sinPedida.pedida, fila))), ["e"], "la pedida agotada no se compra, pero sus hermanas vendibles sí");
  assert.deepEqual(grupo("sin-esa-variante", filas.map((fila) => filaSql("sin-esa-variante", fila))), [], "una variante que la base no trajo no tiene globo");
  console.log("[PASS] una pedida agotada compra de las presentaciones vendibles de su globo (diferencia a propósito con Python, dicha en el código)");

  // 4. La lectura de la fila SQL tolera lo que la base puede devolver.
  const base = filaSql("a", vectores[0]!.filas[0]!);
  assert.equal(filaCrudaDePresentaciones({ ...base, price: "10000", unidades_paq: "12", diam_pulg: "12.5" })?.precio, 10000, "un numeric llega como texto");
  assert.equal(filaCrudaDePresentaciones({ ...base, diam_pulg: "no es un número" })?.diamPulg, null);
  assert.deepEqual(filaCrudaDePresentaciones({ ...base, derived_colors: '["Rojo","azul"]' })?.coloresVariante, ["Rojo", "azul"], "una lista JSON en texto");
  assert.deepEqual(filaCrudaDePresentaciones({ ...base, derived_colors: "{no json" })?.coloresVariante, []);
  assert.equal(filaCrudaDePresentaciones({ ...base, variant_id: null }), null, "sin variante no hay fila");
  console.log("[PASS] la fila SQL se lee con tolerancia: numéricos en texto, listas JSON y campos faltantes");

  console.log("\ntest-mismo-globo: ok");
}

main();
