import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "./exp-fal-lib";

/**
 * ¿El techo compositivo está en el prompt o en el modelo?
 *
 * Los prompts de producción describen inventario ("un arco de X, una columna de
 * Y a la derecha") con cuatro fórmulas de posición. Nunca describen diseño:
 * forma, densidad, asimetría, cascadas, jerarquía visual o capas.
 *
 * Riesgo conocido: los captions de entrenamiento tienen mediana de 54 palabras,
 * así que un prompt de 150+ queda fuera de la distribución del LoRA y puede
 * degradar la imagen en vez de enriquecerla. Eso es justamente lo que se mide.
 *
 * Prompt C congelado como evidencia (PLAN-COMPOSICION-RICA-V001.md §13, Fase
 * 0): no se retoca aquí, solo se corrige cómo se resuelve la identidad del
 * LoRA que lo procesó.
 *
 * Corrección de atribución (PLAN-COMPOSICION-RICA-V001.md §1.1): la tanda
 * original mezcló la URL de v004 con el trigger de v007 (vía `--lora <url
 * suelta>`). Ahora la identidad se resuelve como tupla desde `--artifact-id`.
 *
 *   npx tsx scripts/exp-riqueza-composicion.ts [--artifact-id v004-1000] [--insecure-tls]
 */

if (process.argv.includes("--insecure-tls")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const SEEDS = [101, 202];
const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));

const ESCENARIO = "revelación de género en salón de eventos, mismo inventario de globos";

/** El prompt real que produjo la escena que el usuario considera pobre. */
const A_PRODUCCION =
  "an organic balloon arch round latex balloon in blue with a muted dusty matte finish (5-inch) installed against the rear wall, a balloon column round latex balloon in very pale pink with a soft pearlescent finish (12-inch) standing on the right side, a balloon column round latex balloon in very pale icy blue with a soft pearlescent finish (12-inch) standing on the left side, with a decorative accessory round latex balloon in black with a solid matte finish and a printed pattern (36-inch) centered around the stage photo area. recognizable indoor event hall with real walls, ceiling, floor, architectural depth, and event lighting, wide photorealistic event photograph, natural depth, grounded supports.";

/** Mismo inventario, pero descrito como diseño: forma, densidad, asimetría, capas. */
const B_DISENO =
  "an asymmetric organic balloon installation: a sweeping garland arch that starts as a dense cluster low on the left, thins as it climbs across the top, and cascades down the right in staggered clusters, built from pale blue and very pale pink round latex balloons mixed from 5-inch to 18-inch, a 36-inch black balloon suspended at the visual center, two balloon columns of deliberately different heights flanking the arch, and a few floating balloon clusters at ceiling height. recognizable indoor event hall with real walls, ceiling, floor, architectural depth, and event lighting, wide photorealistic event photograph, natural depth, grounded supports.";

/** Una escenografía ambiciosa de otro tipo, para ver si el modelo sabe salir del arco. */
const C_AMBICIOSA =
  "a layered event scenography: a suspended ceiling installation of balloon clusters descending at staggered heights over the floor, a tall backdrop panel behind wrapped in an organic balloon garland that spills onto the floor on one side only, a sculpted balloon arrangement framing a low dessert table in the foreground, and a scattered balloon trail leading the eye from the table to the backdrop, in pale blue and very pale pink round latex balloons at mixed sizes. recognizable indoor event hall with real walls, ceiling, floor, architectural depth, and event lighting, wide photorealistic event photograph, natural depth, grounded supports.";

const variantes = [
  ["A-produccion", A_PRODUCCION],
  ["B-diseno", B_DISENO],
  ["C-ambiciosa", C_AMBICIOSA],
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
    nota: `${id} · ${prompt.split(/\s+/).length} palabras`,
  })),
);

console.log(`${ESCENARIO}\n${variantes.length} niveles de riqueza x ${SEEDS.length} seeds = ${celdas.length} imágenes`);
for (const [id, prompt] of variantes) console.log(`  ${id}: ${prompt.split(/\s+/).length} palabras`);
console.log();

correrExperimento({
  nombre: "riqueza-composicion",
  celdas,
  defaults,
  outDir: "reports/lora-debug/riqueza-composicion",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
