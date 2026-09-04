import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "./exp-fal-lib";

/**
 * ¿Llega el modelo al nivel de las referencias reales de Halloween?
 *
 * Las referencias que trajo el cliente tienen cinco cosas que el pipeline actual
 * no sabe pedir: una figura escultórica de globos (araña con patas y ojos),
 * globos impresos con motivos, props temáticos que no son globos (calabazas
 * talladas, calaveras, velas), anclaje arquitectónico real (la guirnalda enmarca
 * una puerta) y una paleta audaz.
 *
 * Si el modelo las resuelve, el trabajo es de vocabulario, no de entrenamiento.
 *
 * Prompts D/E/F congelados como evidencia (PLAN-COMPOSICION-RICA-V001.md
 * §13, Fase 0): no se retocan aquí, solo se corrige cómo se resuelve la
 * identidad del LoRA que los procesó.
 *
 * Corrección de atribución (PLAN-COMPOSICION-RICA-V001.md §1.1): la tanda
 * original mezcló la URL de v004 con el trigger de v007 (vía `--lora <url
 * suelta>`). Ahora la identidad se resuelve como tupla desde `--artifact-id`.
 *
 *   npx tsx scripts/exp-halloween-referencia.ts [--artifact-id v004-1000] [--insecure-tls]
 */

if (process.argv.includes("--insecure-tls")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const SEEDS = [505, 606];
const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));

const PALETA = "lime green, metallic purple and black round latex balloons in mixed 5-inch to 18-inch sizes";

/** Guirnalda anclada a una puerta + escultura de araña + props, como la referencia. */
const D_PUERTA = `an organic balloon garland framing a house front door, built from ${PALETA}, some of them printed with black bats and white ghosts, with a large balloon spider sculpture perched at the top corner of the garland, its round black body carrying long curved black legs and cartoon eyes, carved lit pumpkins and a standing skeleton figure on the porch below. recognizable house facade at night with real siding, door frame and porch light, wide photorealistic event photograph, natural depth, grounded supports.`;

/** Escena interior de mesa temática, con props y telarañas, como la primera referencia. */
const E_MESA = `an organic balloon garland climbing an interior wall and arching over a dark table, built from ${PALETA}, some printed with black bats, with a large balloon spider sculpture with long curved black legs mounted at the top of the arch, carved lit jack-o-lanterns, a white skull, tall lit candles and a witch hat clustered on the table below, cobwebs stretched across purple draped curtains behind. recognizable indoor room with real wall, floor and warm candlelight, wide photorealistic event photograph, natural depth, grounded supports.`;

/** Control: la misma escena sin escultura ni props, para aislar cuánto aportan. */
const F_CONTROL = `an organic balloon garland framing a house front door, built from ${PALETA}. recognizable house facade at night with real siding, door frame and porch light, wide photorealistic event photograph, natural depth, grounded supports.`;

const variantes = [
  ["D-puerta-escultura", D_PUERTA],
  ["E-mesa-props", E_MESA],
  ["F-control-sin-props", F_CONTROL],
] as const;

const defaults: Defaults = {
  seed: 505,
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

console.log(`Halloween al nivel de las referencias · ${celdas.length} imágenes`);
for (const [id, prompt] of variantes) console.log(`  ${id}: ${prompt.split(/\s+/).length} palabras`);
console.log();

correrExperimento({
  nombre: "halloween-referencia",
  celdas,
  defaults,
  outDir: "reports/lora-debug/halloween-referencia",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
