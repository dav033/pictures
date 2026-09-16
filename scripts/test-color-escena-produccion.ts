/**
 * El color que llega a la escena tiene un solo dueño.
 *
 * El resolutor del plan etiqueta cada línea con `coloresRealesVariante`
 * (src/lib/plan/resolver.ts) y la puerta `verificarCoherenciaPrompt` exige que
 * cada color comprado por una estructura aparezca en los `resolved_colors` de
 * esa estructura en la escena. Pero esos colores no salen del plan: salen de
 * `resolverProductosParaGeneracion` -> `Producto.colores` (la proyección que
 * arma `/api/generate`). Mientras las dos reglas fueron distintas, un plan
 * aprobado con un producto cuyo color de catálogo difiere del color de la
 * línea fallaba cerrado en la ruta de generación:
 *
 *   - vector 19: "Fashion Gris" archivado como plateado (`derived_colors` de la
 *     variante vacío, colores de producto ["plateado"]) -> la línea decía gris,
 *     la escena decía plateado -> "faltan gris";
 *   - vector 25: "Fashion Merlot" sin colores de variante y con DOS colores de
 *     familia -> la proyección devolvía lista vacía -> "faltan burdeos".
 *
 * Esta prueba arma el prompt con la cadena real de producción y comprueba las
 * dos direcciones: que hoy pasa, y que la comprobación DETECTA la regla vieja
 * (control negativo, para que no vuelva a pasar en verde si alguien la
 * reintroduce).
 *
 * Determinista y sin red: catálogo y plan salen de los vectores golden. El plan
 * y su estimado son los **congelados** del bloque `expected` del vector
 * (`planFijadoDeVector`), no el resultado de volver a resolverlo: lo que aquí
 * se comprueba es el color que llega a la escena, no el resolutor que lo
 * produjo, y así la prueba sobrevive al paso 5 del ADR-0023 sin pedir red.
 * Run: npx tsx --conditions=react-server scripts/test-color-escena-produccion.ts
 */
import assert from "node:assert/strict";
import { basename } from "node:path";
import { verificarCoherenciaPrompt } from "@/lib/plan/coherencia";
import { coloresDeProduccionPorVariante, escenaDeVector } from "./lib/escena-de-vector";
import { loadVectors, planFijadoDeVector, type CatalogRow, type GoldenVector } from "./lib/vectores-golden";

/** Los dos vectores cuyo catálogo separa el color de la variante del de la familia. */
const VECTORES_DE_COLOR_DIVERGENTE = ["19-gris-no-es-plateado", "25-color-variante-primero"] as const;

/**
 * La regla que `itemDesdeFila` usaba antes de darle un único dueño al color.
 * Sólo vive aquí, como control negativo: si el prompt de producción volviera a
 * armarse así, la puerta de coherencia tiene que verlo.
 */
/** El mismo plegado que usa `verificarCoherenciaPrompt`: el plan conserva las mayúsculas del cliente. */
function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function coloresReglaAnterior(fila: CatalogRow): string[] {
  const variante = fila.colores_variante.filter(Boolean);
  const producto = fila.colores_producto.filter(Boolean);
  return variante.length ? variante : producto.length === 1 ? producto : [];
}

function coherenciaDelVector(vector: GoldenVector, colores: ReadonlyMap<string, readonly string[]>) {
  const { plan, materialEstimate } = planFijadoDeVector(vector);
  const { prompt, coherencia } = escenaDeVector(plan, materialEstimate, colores);
  return verificarCoherenciaPrompt(prompt, plan, coherencia);
}

async function main(): Promise<void> {
  const vectores = loadVectors();
  assert.ok(vectores.length > 0, "No hay vectores golden que comprobar");
  const vistos = new Set<string>();

  for (const { file, vector } of vectores) {
    const nombre = basename(file, ".json");
    vistos.add(nombre);
    const { plan, materialEstimate } = planFijadoDeVector(vector);
    // Una estructura que no compró nada no tiene producto de catálogo con el
    // que armar la escena; eso lo cubre `plan:test-invariantes` con su omisión.
    if (plan.estructuras.some((estructura) => estructura.lineas.length === 0)) continue;

    const colores = await coloresDeProduccionPorVariante(vector.catalog_rows);
    const { prompt, coherencia: escena } = escenaDeVector(plan, materialEstimate, colores);
    const resultado = verificarCoherenciaPrompt(prompt, plan, escena);
    assert.equal(
      resultado.ok,
      true,
      `${vector.name}: el prompt armado con los colores de producción no es coherente con el plan: ${resultado.errores.join(" | ")}`,
    );

    // Y el enunciado directo: el color con que se etiqueta cada línea tiene que
    // estar en los colores del producto que produce la proyección.
    for (const estructura of plan.estructuras) {
      for (const linea of estructura.lineas) {
        if (!linea.color) continue;
        const deProduccion = colores.get(linea.variant_id) ?? [];
        assert.ok(
          deProduccion.map(plegar).includes(plegar(linea.color)),
          `${vector.name} / ${estructura.estructura_id}: la línea compra ${linea.color} y los colores de producción de ${linea.variant_id} son [${deProduccion.join(", ")}]`,
        );
      }
    }
  }
  console.log(`[PASS] los ${vectores.length} vectores golden arman un prompt coherente con los colores de producción`);

  // Control negativo: los dos vectores que separan el color de la variante del
  // de la familia tienen que FALLAR con la regla anterior. Si no fallan, esta
  // prueba dejó de proteger nada (o el vector perdió el dato que la hacía útil).
  for (const nombre of VECTORES_DE_COLOR_DIVERGENTE) {
    assert.ok(vistos.has(nombre), `falta el vector ${nombre}, que es el que da sentido a esta prueba`);
    const { vector } = vectores.find((candidato) => basename(candidato.file, ".json") === nombre)!;
    const anteriores = new Map(vector.catalog_rows.map((fila) => [fila.variant_id, coloresReglaAnterior(fila)]));
    const resultado = coherenciaDelVector(vector, anteriores);
    assert.equal(resultado.ok, false, `${nombre}: la regla de color anterior tendría que romper la puerta de coherencia y no la rompió`);
    assert.ok(
      resultado.errores.some((error) => error.includes("no son los comprados")),
      `${nombre}: se esperaba un fallo por color faltante en la escena y llegó: ${resultado.errores.join(" | ")}`,
    );
  }
  console.log(`[PASS] la puerta de coherencia detecta la regla de color anterior en ${VECTORES_DE_COLOR_DIVERGENTE.join(" y ")}`);
}

main().catch((error: unknown) => {
  console.error("[FAIL] color de la escena de producción", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
