import path from "node:path";
import { PROMPT_V2, correrExperimento, flag, leerEnv, type Celda, type Defaults, DEFAULT_LORA } from "./exp-fal-lib";

/**
 * PASO 3 — el control que faltaba en el panel del paso 2.
 *
 * En el paso 2 el brazo `base` salió SIN el token `eventdecor_style_v2` y los
 * brazos con LoRA CON él, porque el runner ataba el trigger a la presencia del
 * LoRA (que es como corre producción). Eso deja la comparación base-contra-LoRA
 * con dos variables movidas a la vez: los pesos y la cadena del trigger.
 *
 * Lo que NO estaba confundido, y es lo que sostiene la recomendación de bajar la
 * escala: `lora03` contra `lora08` comparten prompt, trigger y seeds, y difieren
 * solo en `scale`. Ese contraste sigue en pie sin tocar.
 *
 * Lo que sí hay que medir es este brazo:
 *
 *   base + trigger · sin pesos de LoRA, con el token en el prompt
 *
 * Si da 6/6 como el base pelado, el trigger es inocuo y el techo del paso 2 vale.
 * Si baja, parte del efecto que le atribuí al LoRA es de la cadena del trigger,
 * un token fuera de vocabulario que el VLM tiene que interpretar igual.
 *
 * Mismos 6 seeds, mismo criterio, todo lo demás igual al paso 2.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/exp-step3-control-trigger.ts
 */

const SEEDS = [101, 202, 303, 404, 505, 606];

const defaults: Defaults = {
  seed: Number(flag("seed", "777777")),
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl: leerEnv("SEMPERTEX_LORA_URL") ?? DEFAULT_LORA,
};

const celdas: Celda[] = SEEDS.map((seed) => ({
  id: `T-basetrigger-seed${seed}`,
  prompt: PROMPT_V2,
  lora: null,
  trigger: true,
  seed,
  safety: false,
  nota: "sin pesos de LoRA pero con el token eventdecor_style_v2 en el prompt",
}));

correrExperimento({
  nombre: "step3-control-trigger",
  celdas,
  defaults,
  outDir: path.join(process.cwd(), "reports/lora-debug/step3"),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
