import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "./exp-fal-lib";

/**
 * ¿El rosa saturado viene del descriptor del prompt o de lo que aprendió el LoRA?
 *
 * El vocabulario traduce el nombre comercial ("Rosa Primaveral" -> "spring pink")
 * en vez de describir el color observable del globo, que es un nacarado pálido.
 * Si el control reproduce el rosa chicle y los descriptores perceptuales dan el
 * color real, el arreglo es el vocabulario y no hace falta reentrenar.
 *
 * Corrección de atribución (PLAN-COMPOSICION-RICA-V001.md §1.1): la tanda
 * original mezcló la URL de v004 con el trigger de v007 (vía `--lora <url
 * suelta>`, con fallback a la variable de entorno anónima
 * `SEMPERTEX_LORA_URL` que ya no existe). Ahora la identidad se resuelve
 * como tupla desde `--artifact-id`.
 *
 *   npx tsx scripts/exp-color-fidelidad.ts [--artifact-id v004-1000] [--insecure-tls]
 */

if (process.argv.includes("--insecure-tls")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const SEEDS = [101, 202];
const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));

const escena = (descriptor: string) =>
  `a balloon column, standing to one side, built from 12-inch ${descriptor} round latex balloons, set against a plain wall and floor.`;

const variantes = [
  ["A-control-spring-pink", escena("spring pink with a Silk satin finish")],
  ["B-perceptual", escena("very pale pearlescent pink with a soft nacre sheen")],
  ["C-perceptual-fuerte", escena("extremely pale desaturated silvery mauve-pink with a chrome-like pearl sheen")],
] as const;

const defaults: Defaults = {
  seed: 101,
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl: identidad.url,
  trigger: identidad.trigger,
};

const celdas: Celda[] = variantes.flatMap(([id, prompt]) =>
  SEEDS.map((seed) => ({
    id: `${id}-seed${seed}`,
    prompt,
    lora: 0.8,
    seed,
    safety: false,
    nota: `${id} @ lora_scale 0.8`,
  })),
);

console.log(`${variantes.length} descriptores x ${SEEDS.length} seeds = ${celdas.length} imágenes`);
console.log("Referencia física: Globo Redondo Silk Rosa Primaveral (SKU 20018505) es un nacarado pálido, no un rosa vivo.\n");

correrExperimento({
  nombre: "color-fidelidad-silk-rosa",
  celdas,
  defaults,
  outDir: "reports/lora-debug/color-fidelidad",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
