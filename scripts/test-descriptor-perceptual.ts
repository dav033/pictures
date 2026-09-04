/**
 * El prompt que ve el modelo de imagen no puede contener nombres comerciales.
 *
 * Run: npx tsx scripts/test-descriptor-perceptual.ts
 *
 * Sin red y sin llamadas pagadas. El modelo no conoce el catálogo de Sempertex:
 * "spring pink" le dice rosa primaveral vivo y "Silk satin" le dice tela, no
 * látex perlado. Medido en reports/lora-debug/color-fidelidad.
 */
import assert from "node:assert/strict";
import { aDescriptorPerceptual } from "../src/lib/lora/descriptor-perceptual";
import { V007_DATASET_PRODUCT_CONCEPTS } from "../src/lib/lora/v007-dataset-product-vocabulary";

let passCount = 0;
function pass(name: string) {
  passCount += 1;
  console.log(`  ok ${passCount}. ${name}`);
}

const PROHIBIDOS = [
  "spring pink",
  "arctic blue",
  "amethyst",
  "cream pearl",
  "pearl white",
  "mint green",
  "aurora green",
  "champagne",
  "green tea",
  "Silk satin",
  "Reflex high-shine",
  "Pastel Dusk muted",
  "Pastel Matte",
  "translucent Crystal",
  "solid Fashion",
];

// El caso verificado contra la foto del producto.
{
  const salida = aDescriptorPerceptual("round latex balloon in spring pink with a Silk satin finish");
  assert.ok(!/spring pink/i.test(salida), `quedó "spring pink" en: ${salida}`);
  assert.ok(!/Silk satin/i.test(salida), `quedó "Silk satin" en: ${salida}`);
  assert.ok(/mauve-pink/i.test(salida), `falta el tono real en: ${salida}`);
  assert.ok(/pearlescent/i.test(salida), `falta el acabado real en: ${salida}`);
  pass("Silk Rosa Primaveral se traduce al color y acabado observables");
}

// Aplicarlo dos veces no puede degradar la frase.
{
  const unaVez = aDescriptorPerceptual("round latex balloon in arctic blue with a Silk satin finish");
  assert.equal(aDescriptorPerceptual(unaVez), unaVez, "la traducción no es idempotente");
  pass("idempotente sobre vocabulario ya corregido");
}

// Los colores que el modelo interpreta bien no se tocan.
{
  const basico = "round latex balloon in white with a solid matte finish";
  assert.equal(aDescriptorPerceptual(basico), basico);
  pass("los colores básicos quedan intactos");
}

// La red de seguridad real: ningún concepto del vocabulario puede filtrar marketing.
{
  const filtrados: string[] = [];
  for (const concepto of V007_DATASET_PRODUCT_CONCEPTS) {
    const salida = aDescriptorPerceptual(concepto.canonical_label);
    for (const termino of PROHIBIDOS) {
      if (new RegExp(`\\b${termino}\\b`, "i").test(salida)) {
        filtrados.push(`${concepto.concept_id}: "${termino}" sobrevive en "${salida}"`);
      }
    }
  }
  assert.deepEqual(filtrados, [], `términos comerciales sin traducir:\n  ${filtrados.join("\n  ")}`);
  pass(`ningún nombre comercial sobrevive en los ${V007_DATASET_PRODUCT_CONCEPTS.length} conceptos del vocabulario`);
}

console.log(`\n${passCount} pruebas ok`);
