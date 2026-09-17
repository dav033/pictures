import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "./exp-fal-lib";

/**
 * ¿Cuánto del "se ve hecho por una IA" lo causa el REGISTRO del caption, y no
 * el modelo?
 *
 * `LORAGEMINI.MD` §4 midió esto sobre `v007-1000`, que su propia evaluación
 * RECHAZÓ (0/6 en acabado y diámetro). Esta tanda repite la comparación sobre
 * `v004-1000`, que es el único artefacto **approved** del registro
 * (`lora_mode_slots` consultado el 2026-09-17) y por tanto el único que
 * producción puede servir.
 *
 * Y añade la pregunta que el informe dejó abierta: el modo híbrido NECESITA un
 * render aislado sobre blanco para que Gemini lo componga después. ¿Se puede
 * pedir ese aislamiento con la gramática del corpus en vez de con la lista de
 * prohibiciones de `LORA_PRESENTATION_INSTRUCTION`?
 *
 * Una sola variable por celda. Mismo diseño comercial, mismos parámetros que
 * producción (`sempertex-lora.ts:355-366`: 28 pasos, guidance 3.5, escala 0.8).
 *
 *   npx tsx scripts/exp-registro-caption-v004.ts --dry-run
 *   npx tsx scripts/exp-registro-caption-v004.ts --confirm-spend --max-usd 0.60
 */

const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));

/**
 * Salida LITERAL de `scripts/diag-caption-hibrido.ts` (compilador en modo
 * híbrido), sin el trigger, que el runner antepone.
 */
const COMPILADO =
  "two organic balloon columns of matte white link balloons and large and small matte dusty rose pink " +
  "and glossy chrome silver balloons standing apart on the left. set against a plain wall and floor, " +
  "wide photorealistic event photograph, natural depth, grounded supports.";

/** Bloque fijo que el híbrido concatena hoy (`lora-gemini-composition.ts:6`). */
const INSTRUCCION_PRESENTACION =
  " Isolated white-studio presentation: only approved quoted structures. Asymmetry means uneven staggered " +
  "clusters and nonmatching tops, never straight matching towers. Pink must be soft pastel, not hot pink. " +
  "No backdrop, drapes, furniture, tables, chairs, flowers, plants, pedestals or props.";

/**
 * Mismo contenido comercial en la gramática del corpus: declarativa, con la
 * pareja nombrada por su lado real y cerrando con superficie, que es como
 * terminan el 100% de las captions de entrenamiento.
 */
const REGISTRO_VENUE =
  "two organic balloon columns, one standing on the left and one on the right, built from matte Fashion " +
  "dusty rose round latex balloons, high-shine Reflex silver round latex balloons and matte Fashion white " +
  "round latex balloons, in 18-inch, 12-inch and 5-inch, mixed organically rather than graded, alongside a " +
  "round table and a wire stool, set against off-white walls and a light grey tiled floor.";

/** El mismo registro, pero pidiendo el aislamiento que el híbrido necesita. */
const REGISTRO_ESTUDIO =
  "two organic balloon columns, one standing on the left and one on the right, built from matte Fashion " +
  "dusty rose round latex balloons, high-shine Reflex silver round latex balloons and matte Fashion white " +
  "round latex balloons, in 18-inch, 12-inch and 5-inch, mixed organically rather than graded, set against " +
  "a plain white studio backdrop, no floor visible.";

const defaults: Defaults = {
  seed: 101,
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1024,
  alto: 1536,
  loraUrl: identidad.url,
  trigger: identidad.trigger,
};

const celdas: Celda[] = [
  { id: "A-produccion-s101", prompt: `${COMPILADO}${INSTRUCCION_PRESENTACION}`, lora: 0.8, seed: 101, nota: "lo que manda el hibrido hoy" },
  { id: "A-produccion-s202", prompt: `${COMPILADO}${INSTRUCCION_PRESENTACION}`, lora: 0.8, seed: 202, nota: "lo que manda el hibrido hoy" },
  { id: "B-sin-instruccion-s101", prompt: COMPILADO, lora: 0.8, seed: 101, nota: "compilado sin el bloque de prohibiciones" },
  { id: "C-registro-venue-s101", prompt: REGISTRO_VENUE, lora: 0.8, seed: 101, nota: "gramatica del corpus, fondo y props reales" },
  { id: "D-registro-estudio-s101", prompt: REGISTRO_ESTUDIO, lora: 0.8, seed: 101, nota: "gramatica del corpus pidiendo aislamiento" },
  { id: "D-registro-estudio-s202", prompt: REGISTRO_ESTUDIO, lora: 0.8, seed: 202, nota: "gramatica del corpus pidiendo aislamiento" },
];

console.log(`${celdas.length} imagenes contra ${identidad.artifactId} (${identidad.evaluationStatus}), trigger ${identidad.trigger}\n`);

correrExperimento({
  nombre: "registro-caption-v004",
  celdas,
  defaults,
  outDir: "reports/lora-debug/registro-caption-v004",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
