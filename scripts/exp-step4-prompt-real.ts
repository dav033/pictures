import path from "node:path";
import { correrExperimento, flag, leerEnv, type Celda, type Defaults, DEFAULT_LORA } from "./exp-fal-lib";

/**
 * PASO 4 — validar los BYTES EXACTOS que emite producción.
 *
 * Los pasos 0 a 3 midieron un string tomado de la salida de demostración del
 * prototipo. `scripts/exp-prompt-produccion-xv.ts` recorrió la cadena real
 * (`resolverPlan` -> `planBlueprint` -> `buildApprovedSceneSpec` ->
 * `compileLoraCaption`) sobre un plan XV de cuatro estructuras y mostró que lo
 * que sale hacia fal difiere en tres palabras decorativas: producción NO emite
 * `quinceañera celebration atmosphere`. El esqueleto composicional es idéntico.
 *
 * Tres palabras no deberían mover nada, pero "no debería" no es una medición, y
 * la recomendación de bajar el default a 0,3 se apoya en esto. Así que se corre
 * el string literal de producción en los dos brazos y los mismos 6 seeds.
 *
 * El prompt va SIN el prefijo del trigger: `payloadDe` lo antepone solo.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/exp-step4-prompt-real.ts
 */

/** Copiado literal de la salida de `exp-prompt-produccion-xv.ts`, sin el trigger. */
export const PROMPT_PRODUCCION =
  "a grand organic balloon arch in pink and rose gold centered around the stage photo area, " +
  "two balloon columns, matching one another, one standing on the left and one on the right, " +
  "flanking the main arch, with a low coordinated balloon centerpiece placed on the main table " +
  "beneath the main arch. wide photorealistic event photograph, natural depth, believable floor " +
  "contact and supports.";

const SEEDS = [101, 202, 303, 404, 505, 606];

const defaults: Defaults = {
  seed: Number(flag("seed", "777777")),
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl: leerEnv("SEMPERTEX_LORA_URL") ?? DEFAULT_LORA,
};

const celdas: Celda[] = [0.3, 0.8].flatMap((escala) =>
  SEEDS.map((seed) => ({
    id: `R-real${String(escala).replace(".", "")}-seed${seed}`,
    prompt: PROMPT_PRODUCCION,
    lora: escala,
    seed,
    safety: false,
    nota: `prompt literal de producción, lora_scale ${escala}`,
  })),
);

correrExperimento({
  nombre: "step4-prompt-real",
  celdas,
  defaults,
  outDir: path.join(process.cwd(), "reports/lora-debug/step4"),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
