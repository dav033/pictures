import { planBlueprint } from "@/lib/plan/blueprint";
import { buildApprovedSceneSpec } from "@/lib/ia/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { buildVisualContext } from "@/lib/ia/visual-context";
import { compileLoraCaption } from "@/lib/ia/lora-caption-compiler";
import { preflightLoraPrompt } from "@/lib/ia/lora-prompt-preflight";
import { planFijado } from "./lib/planes-fijados";
import { PROMPT_V2 } from "./exp-fal-lib";

/**
 * ¿Qué manda REALMENTE la app para la escena XV multi-estructura?
 *
 * Los pasos 0 a 3 validaron un STRING de prompt contra fal, tomado de la salida
 * de demostración de `proto-lora-caption-v3.ts`. Eso no prueba que el camino de
 * producción emita ese texto. Este script recorre la cadena real — plan
 * resuelto -> `planBlueprint` -> `buildApprovedSceneSpec` -> `compileLoraCaption`
 * — sobre un plan XV de cuatro estructuras (arco central, dos columnas
 * laterales y centro de mesa) e imprime:
 *
 *   - el prompt v2 que saldría hacia fal.ai
 *   - el resultado del preflight, que puede bloquear la generación
 *   - el diff contra el string que efectivamente se teó.
 *
 * El plan resuelto es un fixture congelado (`scripts/lib/planes-fijados.ts`):
 * el paso 5 del ADR-0023 deja a Python como único dueño del conteo y retira el
 * resolutor TypeScript. Lo que este script inspecciona es el prompt, no el
 * conteo. No llama a fal.ai ni gasta un centavo.
 */

const rows = [
  { product_id: "P-GLOBOS", variant_id: "V-R-12-ROSADO", sku: "SKU-R-12-ROSADO", producto_titulo: "Globo rosado", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rosado"], colores_variante: ["rosado"], descripcion: "Globo látex rosado R-12." },
  { product_id: "P-GLOBOS", variant_id: "V-R-12-ORO-ROSA", sku: "SKU-R-12-ORO-ROSA", producto_titulo: "Globo oro rosa", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["dorado rosa"], colores_variante: ["dorado rosa"], descripcion: "Globo látex metalizado oro rosa R-12." },
  { product_id: "P-GLOBOS", variant_id: "V-R-5-ORO-ROSA", sku: "SKU-R-5-ORO-ROSA", producto_titulo: "Globo oro rosa", variante_titulo: "R-5", precio: 6000, unidades_paq: 100, disponible: true, producto_disponible: true, codigo_tamano: "R-5", forma: "redondo", diam_pulg: 5, colores_producto: ["dorado rosa"], colores_variante: ["dorado rosa"], descripcion: "Globo látex metalizado oro rosa R-5." },
];

function main(): void {
  const { plan: resultado, materialEstimate } = planFijado("xv-produccion-cuatro-estructuras");
  console.log(`sin_cobertura: ${resultado.sin_cobertura.length}`);

  const blueprint = planBlueprint(resultado);
  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const targetBoxes = Object.fromEntries(Object.entries(cajas).map(([id, layout]) => [id, layout.bbox]));
  const catalogProducts = Object.fromEntries(
    blueprint.elements
      .filter((element) => element.source_type === "catalog_backed")
      .map((element) => [
        element.element_id,
        (element.model_decision?.bill_of_materials ?? []).map((linea) => {
          const row = rows.find((c) => c.variant_id === linea.catalog_product_id || c.product_id === linea.catalog_product_id);
          return { id: linea.catalog_product_id, name: row?.producto_titulo ?? linea.catalog_product_id, description: row?.descripcion ?? "", category: "balloon", colors: row?.colores_variante, share: linea.share, role: linea.role };
        }),
      ]),
  );

  const sceneSpec = buildApprovedSceneSpec({
    blueprint, aspectRatio: "3:2", targetBoxes, catalogProducts, materialEstimate,
    generationMode: "text_to_image", createdBy: "server_default",
    planHash: resultado.plan_hash, catalogOnly: true,
  });
  console.log(`estructuras en el SceneSpec: ${sceneSpec.elements.length}`);

  const visualContext = buildVisualContext({ brief: { tipo_evento: "quinceañera" } });
  const compilation = compileLoraCaption({ sceneSpec, visualContext });
  const preflight = preflightLoraPrompt({ sceneSpec, clauses: compilation.clauses, prompt: compilation.prompt });

  const linea = "=".repeat(78);
  console.log(`\n${linea}\nPROMPT v2 QUE SALE HOY DE PRODUCCIÓN (${compilation.prompt.length} chars)\n${linea}`);
  console.log(compilation.prompt);
  console.log(`\n${linea}\nPREFLIGHT: ${preflight.ok ? "PASA" : "BLOQUEA"}\n${linea}`);
  if (!preflight.ok) preflight.errors.forEach((e) => console.log(`  - ${e}`));

  console.log(`\n${linea}\nCONTRA EL STRING QUE SE TESTEÓ EN fal.ai\n${linea}`);
  const iguales = compilation.prompt.trim() === PROMPT_V2.trim();
  console.log(`¿idénticos?: ${iguales ? "SÍ" : "NO"}`);
  if (!iguales) {
    const enProd = new Set(compilation.prompt.toLowerCase().match(/[a-záéíóúñ-]+/g) ?? []);
    const enTest = new Set(PROMPT_V2.toLowerCase().match(/[a-záéíóúñ-]+/g) ?? []);
    console.log(`  solo en producción: ${[...enProd].filter((w) => !enTest.has(w)).join(", ") || "—"}`);
    console.log(`  solo en el test   : ${[...enTest].filter((w) => !enProd.has(w)).join(", ") || "—"}`);
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
