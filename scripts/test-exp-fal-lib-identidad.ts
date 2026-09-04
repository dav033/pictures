import assert from "node:assert/strict";
import {
  LORA_IDENTIDADES_CONOCIDAS,
  resolverIdentidadLora,
  verificarIdentidadCoherente,
  type Defaults,
} from "./exp-fal-lib";

/**
 * Fase 0 de PLAN-COMPOSICION-RICA-V001.md exige: "Un test falla ante
 * cualquier combinación URL/trigger/dataset incorrecta." Este script cubre
 * exactamente el bug que produjo los manifiestos cruzados de
 * "halloween-jardin", "halloween-referencia", "riqueza-composicion",
 * "color-base-vs-lora" y "color-fidelidad-silk-rosa": la URL de v004 viajando
 * junto al trigger de v007.
 *
 * No abre red ni requiere FAL_KEY.
 *
 *   npx tsx scripts/test-exp-fal-lib-identidad.ts
 */

const v004 = LORA_IDENTIDADES_CONOCIDAS["v004-1000"]!;
const v007 = LORA_IDENTIDADES_CONOCIDAS["v007-1000"]!;

// 1. La combinación real (URL de v004 + trigger de v007) debe fallar: es
//    exactamente la que produjeron los experimentos recientes.
assert.throws(
  () => verificarIdentidadCoherente({ seed: 0, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: v004.url, trigger: v007.trigger }),
  /IDENTIDAD_LORA_CRUZADA/,
  "una URL de v004 con el trigger de v007 debe fallar",
);

// 2. La combinación inversa (URL de v007 + trigger de v004) también debe fallar.
assert.throws(
  () => verificarIdentidadCoherente({ seed: 0, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: v007.url, trigger: v004.trigger }),
  /IDENTIDAD_LORA_CRUZADA/,
  "una URL de v007 con el trigger de v004 debe fallar",
);

// 3. Cada combinación correcta y autocontenida debe pasar sin lanzar.
assert.doesNotThrow(() => verificarIdentidadCoherente({ seed: 0, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: v004.url, trigger: v004.trigger }));
assert.doesNotThrow(() => verificarIdentidadCoherente({ seed: 0, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: v007.url, trigger: v007.trigger }));

// 4. Una URL desconocida (checkpoint todavía no registrado, como en
//    eval-lora-nuevo.ts) no debe fallar solo por no estar en la tabla: el
//    guardián protege contra identidad cruzada conocida, no contra
//    experimentación legítima con checkpoints nuevos.
assert.doesNotThrow(() => verificarIdentidadCoherente({ seed: 0, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: "https://v3b.fal.media/files/b/checkpoint-nuevo/weights.safetensors", trigger: "eventdecor_style_v9" } satisfies Defaults));

// 5. `resolverIdentidadLora` rechaza cualquier artifact-id fuera del registro
//    conocido: no se acepta una URL/trigger sueltos por fuera de la tupla.
assert.throws(() => resolverIdentidadLora("url-cualquiera"), /no está en el registro conocido/);
assert.throws(() => resolverIdentidadLora(v004.url), /no está en el registro conocido/);

// 6. Cada identidad conocida se resuelve completa (dataset incluido) y sin
//    mezclar campos entre corridas.
const resuelta = resolverIdentidadLora("v004-1000");
assert.equal(resuelta.url, v004.url);
assert.equal(resuelta.trigger, v004.trigger);
assert.equal(resuelta.datasetId, "lora-dataset-v004-154");
assert.notEqual(resuelta.datasetId, v007.datasetId);

console.log("test-exp-fal-lib-identidad: OK — el guardián de identidad LoRA bloquea toda combinación URL/trigger cruzada conocida.");
