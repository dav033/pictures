import path from "node:path";
import { PROMPT_V2, correrExperimento, flag, leerEnv, type Celda, type Defaults, DEFAULT_LORA } from "./exp-fal-lib";

/**
 * PASO 2 — de la anécdota a la TASA.
 *
 * Por qué existe: el paso 0 concluyó "el LoRA destruye la composición" a partir
 * de UNA celda (seed 777777). El control `E2c-3x2-lora08-seed424242` mostró que
 * con la misma configuración de producción y otro seed la escena compone bien.
 * El LoRA no falla siempre: falla con alta varianza. Una tasa medida es lo único
 * que puede sostener una decisión de reentrenar (US$8-12) o de bajar la escala
 * en producción.
 *
 * Tres brazos sobre EL MISMO conjunto de seeds, todo lo demás fijo en la
 * configuración de producción (prompt v2, 3:2, guidance 3.5, 28 pasos):
 *
 *   base    · sin LoRA          — techo composicional del modelo
 *   lora08  · escala 0.8        — lo que corre hoy en producción
 *   lora03  · escala 0.3        — la escala candidata del barrido del paso 1
 *
 * Criterio de éxito por imagen, fijado ANTES de mirar (evita mover el arco):
 *   1. el arco es un arco 3D que cierra, no un portal rectangular ni un blob
 *   2. hay DOS columnas separadas, distinguibles de las patas del arco
 *   3. existe la mesa y la escena entra en el cuadro con contexto de sala
 *
 * `safety: false` en todas: el checker de fal devuelve PNG en negro ante falsos
 * positivos y eso contaría como fallo composicional sin serlo. Producción lo
 * tiene encendido.
 *
 * Correr:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/exp-step2-panel-seeds.ts
 *   ... --dry-run
 */

const SEEDS = [101, 202, 303, 404, 505, 606];

const BRAZOS: Array<{ nombre: string; lora: number | null }> = [
  { nombre: "base", lora: null },
  { nombre: "lora08", lora: 0.8 },
  { nombre: "lora03", lora: 0.3 },
];

const defaults: Defaults = {
  seed: Number(flag("seed", "777777")),
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl: leerEnv("SEMPERTEX_LORA_URL") ?? DEFAULT_LORA,
};

const celdas: Celda[] = BRAZOS.flatMap((brazo) =>
  SEEDS.map((seed) => ({
    id: `P-${brazo.nombre}-seed${seed}`,
    prompt: PROMPT_V2,
    lora: brazo.lora,
    seed,
    safety: false,
    nota: `brazo ${brazo.nombre}, seed ${seed}`,
  })),
);

correrExperimento({
  nombre: "step2-panel-seeds",
  celdas,
  defaults,
  outDir: path.join(process.cwd(), "reports/lora-debug/step2"),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
