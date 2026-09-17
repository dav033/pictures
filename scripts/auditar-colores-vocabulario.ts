import { PRODUCT_VOCABULARY } from "../src/lib/lora/product-vocabulary-data";
import { PALETA_COLORES_V2 } from "../src/lib/rag/taxonomy/v2";
import { clasificarColores } from "../src/lib/rag/taxonomy/v2";

/**
 * ¿Qué colores del catálogo puede nombrar el vocabulario LoRA?
 *
 * Corrige una medición previa que solo miró las entradas escritas a mano de
 * `product-vocabulary-data.ts` (27) e ignoró las que aporta el catálogo y el
 * dataset v007. El vocabulario efectivo es la lista completa exportada por
 * `PRODUCT_VOCABULARY`.
 *
 * Un color sin ningún concepto activo hace que un elemento del plan que lo use
 * salga como `unresolved_products`, y `route.ts:1086` lo convierte en
 * LORA_PRODUCT_VOCABULARY_FAILED: la petición no produce imagen.
 *
 * Sin red ni llamadas pagadas.
 *   npx tsx scripts/auditar-colores-vocabulario.ts
 */

const activos = PRODUCT_VOCABULARY.filter((c) => c.status === "active");
const cubiertos = new Map<string, number>();

for (const concepto of activos) {
  const color = concepto.visual?.color;
  if (!color) continue;
  // El color del concepto está en inglés; se pliega al vocabulario del catálogo
  // por la misma taxonomía que usa el resto del sistema.
  const clasificacion = clasificarColores(color);
  const canonico = clasificacion.status === "unknown" ? undefined : clasificacion.values.find((v) => v !== "multicolor");
  if (canonico) cubiertos.set(canonico, (cubiertos.get(canonico) ?? 0) + 1);
}

console.log(`conceptos en PRODUCT_VOCABULARY: ${PRODUCT_VOCABULARY.length} (activos: ${activos.length})`);
console.log(`colores del catalogo: ${PALETA_COLORES_V2.length}\n`);

const sin: string[] = [];
for (const color of PALETA_COLORES_V2) {
  const n = cubiertos.get(color) ?? 0;
  if (n === 0) sin.push(color);
  else console.log(`  ${color.padEnd(14)} ${n} concepto(s)`);
}
console.log(`\nSIN NINGUN CONCEPTO ACTIVO (${sin.length}): ${sin.join(", ") || "-"}`);
