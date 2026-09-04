import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "./exp-fal-lib";

/**
 * Halloween en jardín de noche: el caso más lejano al material de entrenamiento.
 *
 * El LoRA se entrenó sobre todo con eventos de interior con luz diurna o de
 * estudio. Esta escena cambia temática, entorno y luz a la vez, así que sirve
 * para ver dónde está el techo real del modelo con los tres niveles de
 * prompting que se compararon en exp-riqueza-composicion.
 *
 * Corrección de atribución (PLAN-COMPOSICION-RICA-V001.md §1.1): la tanda
 * original de esta corrida mezcló la URL de v004 con el trigger de v007 (vía
 * `--lora <url suelta>`). Ahora la identidad se resuelve como tupla desde
 * `--artifact-id` para que eso no pueda volver a pasar.
 *
 *   npx tsx scripts/exp-halloween-jardin.ts [--artifact-id v004-1000] [--insecure-tls]
 */

if (process.argv.includes("--insecure-tls")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const SEEDS = [303, 404];
const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));

const ENTORNO =
  "recognizable outdoor garden at night with real trees, lawn, wooden fence, and warm string lighting overhead, wide photorealistic event photograph, natural depth, grounded supports.";

/** Como lo arma la app hoy: inventario y cuatro fórmulas de posición. */
const A_PRODUCCION = `an organic balloon arch round latex balloon in black with a solid matte finish (5-inch) installed against the rear wall, a balloon column round latex balloon in deep orange with a solid matte finish (12-inch) standing on the right side, a balloon column round latex balloon in black with a solid matte finish (12-inch) standing on the left side, with a decorative accessory round latex balloon in deep purple with a solid matte finish (36-inch) centered around the stage photo area. ${ENTORNO}`;

/** Mismo inventario, descrito como diseño. */
const B_DISENO = `an asymmetric organic balloon installation for a Halloween party: a garland arch that starts as a dense black cluster low on the left, thins as it climbs, and breaks into deep orange and deep purple clusters cascading down the right, built from round latex balloons mixed from 5-inch to 18-inch, a 36-inch deep purple balloon suspended off-center, two balloon columns of deliberately different heights, and scattered balloon clusters floating at tree height. ${ENTORNO}`;

/** Escenografía por capas, sin arco como pieza principal. */
const C_AMBICIOSA = `a layered Halloween garden scenography: clusters of black and deep orange balloons suspended from the tree branches at staggered heights, a dark backdrop panel framed by an organic balloon garland that spills onto the grass on one side only, a sculpted balloon arrangement wrapping a low candy table with carved pumpkins and dark drapery, and a trail of balloons leading across the lawn toward the backdrop, in black, deep orange and deep purple round latex balloons at mixed sizes. ${ENTORNO}`;

const variantes = [
  ["A-produccion", A_PRODUCCION],
  ["B-diseno", B_DISENO],
  ["C-ambiciosa", C_AMBICIOSA],
] as const;

const defaults: Defaults = {
  seed: 303,
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
    nota: `${id} · ${prompt.split(/\s+/).length} palabras`,
  })),
);

console.log(`Halloween en jardín de noche · ${celdas.length} imágenes`);
for (const [id, prompt] of variantes) console.log(`  ${id}: ${prompt.split(/\s+/).length} palabras`);
console.log();

correrExperimento({
  nombre: "halloween-jardin",
  celdas,
  defaults,
  outDir: "reports/lora-debug/halloween-jardin",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
