import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "./exp-fal-lib";

/**
 * ¿El color correcto lo aporta el LoRA o el modelo base?
 *
 * El descriptor perceptual da el color real del producto, pero los captions de
 * entrenamiento nombran "spring pink" siempre dentro de listas de 4-6 globos
 * rosados que el propio anotador declaró indistinguibles. Si base y LoRA
 * producen el mismo color, la fidelidad cromática no vino del entrenamiento.
 *
 * Corrección de atribución (PLAN-COMPOSICION-RICA-V001.md §1.1): la tanda
 * original mezcló la URL de v004 con el trigger de v007 (vía `--lora <url
 * suelta>`) y la celda "lora-*" se documentó como v007 sin serlo. Ahora la
 * identidad se resuelve como tupla desde `--artifact-id`.
 *
 *   npx tsx scripts/exp-color-base-vs-lora.ts [--artifact-id v004-1000] [--insecure-tls]
 */

if (process.argv.includes("--insecure-tls")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const SEEDS = [101, 202];
const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));

const DESCRIPTOR = "extremely pale desaturated silvery mauve-pink with a chrome-like pearl sheen";
const escena = `a balloon column, standing to one side, built from 12-inch ${DESCRIPTOR} round latex balloons, set against a plain wall and floor.`;

const defaults: Defaults = {
  seed: 101,
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl: identidad.url,
  trigger: identidad.trigger,
};

const celdas: Celda[] = SEEDS.flatMap((seed) => [
  { id: `base-seed${seed}`, prompt: escena, lora: 0, seed, safety: false, nota: "sin LoRA" },
  { id: `lora-seed${seed}`, prompt: escena, lora: 0.8, seed, safety: false, nota: `${identidad.artifactId} @ 0.8` },
]);

console.log(`base vs LoRA con el mismo descriptor perceptual x ${SEEDS.length} seeds = ${celdas.length} imágenes\n`);

correrExperimento({
  nombre: "color-base-vs-lora",
  celdas,
  defaults,
  outDir: "reports/lora-debug/color-fidelidad",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
