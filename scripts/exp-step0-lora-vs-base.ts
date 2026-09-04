import path from "node:path";
import { PROMPT_V2, PROMPT_V3, correrExperimento, flag, leerEnv, type Celda, type Defaults, DEFAULT_LORA } from "./exp-fal-lib";

/**
 * PASO 0 del HANDOFF-LORA-COMPOSICION.md — el experimento que decide todo.
 * Ya ejecutado el 2026-08-28; los resultados están en el handoff y las imágenes
 * y payloads en `reports/lora-debug/step0/`. Se conserva para poder reproducirlo.
 *
 * Pregunta: ¿FLUX.2 base compone la escena XV multi-estructura (arco central +
 * 2 columnas + centro de mesa), o el LoRA Sempertex v2 está destruyendo el
 * control composicional nativo del VLM?
 *
 * Diseño 2x2, mismo seed, mismo endpoint, mismos hiperparámetros:
 *
 *                 prompt v2 (afinidad −6)   prompt v3 (afinidad 90)
 *   sin LoRA                A                         C
 *   con LoRA                B                         D
 *
 * A vs B aísla el LoRA. B vs D aísla el prompt. B reproduce la configuración de
 * producción que falla — esta vez con el payload literal guardado en disco, que
 * es justamente lo que faltó en las sesiones anteriores.
 *
 * Resultado: A compuso bien y B colapsó. El LoRA es el problema.
 *
 * Correr:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/exp-step0-lora-vs-base.ts
 *   ... --dry-run
 */

const defaults: Defaults = {
  seed: Number(flag("seed", "777777")),
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl: leerEnv("SEMPERTEX_LORA_URL") ?? DEFAULT_LORA,
};

const escala = Number(flag("scale", leerEnv("SEMPERTEX_LORA_SCALE") ?? "0.8"));

const celdas: Celda[] = [
  { id: `A-base-v2-seed${defaults.seed}`, prompt: PROMPT_V2, lora: null, nota: "base, prompt de producción" },
  { id: `B-lora-v2-seed${defaults.seed}`, prompt: PROMPT_V2, lora: escala, nota: "configuración de producción que falla" },
  { id: `C-base-v3-seed${defaults.seed}`, prompt: PROMPT_V3, lora: null, nota: "base, prompt del prototipo v3" },
  { id: `D-lora-v3-seed${defaults.seed}`, prompt: PROMPT_V3, lora: escala, nota: "LoRA + prototipo v3" },
];

correrExperimento({
  nombre: "step0-lora-vs-base",
  celdas,
  defaults,
  outDir: path.join(process.cwd(), "reports/lora-debug/step0"),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
