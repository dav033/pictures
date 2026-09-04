import path from "node:path";
import { PROMPT_V2, PROMPT_V3, correrExperimento, flag, leerEnv, type Celda, type Defaults, DEFAULT_LORA } from "./exp-fal-lib";

/**
 * PASO 1 — tres preguntas que quedaron abiertas tras el paso 0, en una sola tanda.
 *
 * Contexto del paso 0 (ver HANDOFF-LORA-COMPOSICION.md): con seed 777777,
 * guidance 3.5, 3:2 y prompt v2, el modelo BASE compuso bien (arco real + dos
 * columnas separadas + mesa) y el LoRA a scale 0.8 colapsó la escena en un solo
 * arco sobredimensionado que se sale del encuadre.
 *
 * BLOQUE 1 · Barrido de lora_scale (fase 1b del handoff, nunca ejecutado).
 *   Es el único camino a un arreglo en producción HOY, sin reentrenar. Fija todo
 *   lo demás en la configuración del paso 0 y mueve solo la escala. Los extremos
 *   ya existen: scale 0.0 = celda A y scale 0.8 = celda B del paso 0.
 *   Pregunta: ¿hay una escala donde sobreviva la composición sin perder la textura?
 *
 * BLOQUE 2 · Hipótesis de encuadre.
 *   El colapso del LoRA tiene firma de encuadre: el sujeto se infla más allá de
 *   los bordes y el contexto de sala desaparece. El dataset es 32% cuadrado y 31%
 *   vertical 3:4, con UNA SOLA imagen en 16:9, y la app pide 3:2 horizontal.
 *   Repite la celda B exacta cambiando SOLO el lienzo. Si en 1:1 reaparecen las
 *   columnas, el sesgo de encuadre es la causa dominante y corregirlo pasa a ser
 *   lo primero del recaptioning de la fase 3.
 *
 * BLOQUE 3 · Replicación del hallazgo de prompts.
 *   El paso 0 midió con n=1 seed que el prompt v3 (afinidad 90) compone PEOR en
 *   base que el v2 (afinidad −6). Es el hallazgo que decide si se reescribe el
 *   compilador, así que se replica en dos seeds nuevos antes de actuar.
 *
 * Correr:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/exp-step1-scale-encuadre.ts
 *   ... --dry-run
 */

const SEED = Number(flag("seed", "777777"));
const SEEDS_REPLICA = [424242, 131313];

const defaults: Defaults = {
  seed: SEED,
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl: leerEnv("SEMPERTEX_LORA_URL") ?? DEFAULT_LORA,
};

// Bloque 1 — barrido de escala. 0.0 y 0.8 ya están en reports/lora-debug/step0.
const barridoEscala: Celda[] = [0.3, 0.5, 0.6, 0.7].map((escala) => ({
  id: `E1-scale${String(escala).replace(".", "")}-v2-3x2`,
  prompt: PROMPT_V2,
  lora: escala,
  nota: `barrido lora_scale=${escala}, resto idéntico a la celda B del paso 0`,
}));

// Bloque 2 — mismo LoRA y mismo prompt que la celda B, solo cambia el lienzo.
const encuadre: Celda[] = [
  // El safety checker devolvió un PNG en negro en el primer intento; falso positivo.
  { id: "E2-encuadre-1x1-lora08-v2", prompt: PROMPT_V2, lora: 0.8, ancho: 1024, alto: 1024, safety: false, nota: "celda B en 1:1 (el encuadre más frecuente del dataset, 32%)" },
  { id: "E2-encuadre-2x3-lora08-v2", prompt: PROMPT_V2, lora: 0.8, ancho: 1024, alto: 1536, nota: "celda B en 2:3 vertical (31% del dataset)" },
];

/**
 * El 1:1 con LoRA 0.8 volvió NEGRO dos veces (43 KB), también con el safety
 * checker apagado, y fal no cobró: no es censura, la generación misma se cae.
 * Estas tres celdas aíslan de quién es la culpa antes de sacar conclusiones
 * sobre el encuadre, porque sin el 1:1 el bloque 2 queda a medias.
 */
const encuadre1x1: Celda[] = [
  { id: "E2b-1x1-base-v2", prompt: PROMPT_V2, lora: null, ancho: 1024, alto: 1024, safety: false, nota: "¿el BASE renderiza a 1:1? aísla el LoRA" },
  { id: "E2b-1x1-lora08-seed424242", prompt: PROMPT_V2, lora: 0.8, ancho: 1024, alto: 1024, seed: 424242, safety: false, nota: "¿el negro depende del seed?" },
  { id: "E2b-1x1-lora03-v2", prompt: PROMPT_V2, lora: 0.3, ancho: 1024, alto: 1024, safety: false, nota: "¿baja la escala y renderiza? dosis-respuesta" },
];

/**
 * CONTROL. `E2b-1x1-lora08-seed424242` compuso bien a escala 0.8 — la misma que
 * colapsa a 3:2 — pero cambió aspecto Y seed a la vez respecto de la celda B.
 * Sin este control el hallazgo de encuadre está confundido con el seed.
 *   - 3:2 con el seed 424242 aísla el aspecto contra la MISMA semilla.
 *   - 1:1 con un tercer seed comprueba que el buen resultado no fue suerte.
 */
const controlEncuadre: Celda[] = [
  { id: "E2c-3x2-lora08-seed424242", prompt: PROMPT_V2, lora: 0.8, seed: 424242, safety: false, nota: "control: mismo seed que el 1:1 bueno, solo cambia el aspecto" },
  { id: "E2c-1x1-lora08-seed131313", prompt: PROMPT_V2, lora: 0.8, ancho: 1024, alto: 1024, seed: 131313, safety: false, nota: "réplica del 1:1 bueno en un tercer seed" },
];

// Bloque 3 — base sin LoRA, v2 vs v3, en dos seeds nuevos.
const replicaPrompts: Celda[] = SEEDS_REPLICA.flatMap((seed) => [
  { id: `E3-base-v2-seed${seed}`, prompt: PROMPT_V2, lora: null, seed, nota: "réplica de la celda A del paso 0" },
  { id: `E3-base-v3-seed${seed}`, prompt: PROMPT_V3, lora: null, seed, nota: "réplica de la celda C del paso 0" },
]);

correrExperimento({
  nombre: "step1-scale-encuadre",
  celdas: [...barridoEscala, ...encuadre, ...encuadre1x1, ...controlEncuadre, ...replicaPrompts],
  defaults,
  outDir: path.join(process.cwd(), "reports/lora-debug/step1"),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
