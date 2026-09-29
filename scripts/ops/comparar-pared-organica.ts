/**
 * Generación REAL en fal.ai para medir el arreglo de `pared_organica`: la misma
 * pared, la misma semilla y el mismo LoRA, cambiando UNA sola variable — el
 * sustantivo que el plan manda al prompt de imagen.
 *
 * - `densa`:   "dense balloon wall installation"  (lo que producía el código
 *              hasta el 2026-09-29 para una pared densa Y orgánica, porque
 *              `case "pared"` no miraba `asimetrica`).
 * - `organica`:"asymmetrical organic balloon wall installation" (`pared_organica`).
 *
 * La escena es la foto del usuario descrita con la gramática del corpus:
 * blush nacarado, dorado cromado y blanco mate, racimos dorados concentrados,
 * flores blancas, letras "Mr & Mrs", pared de ladrillo.
 *
 * El LoRA por defecto es `v004-1000`, el aprobado: `v007-1000` está rechazado
 * y no vale como validación.
 *
 * GASTO. Por defecto es VISTA PREVIA: imprime los dos prompts y el coste
 * ESTIMADO, sin red y sin `FAL_KEY`. Solo gasta con `--confirm-spend --max-usd
 * <tope>`; el runner mide el gasto real contra el saldo de fal y se detiene al
 * alcanzar el tope. Las salidas van fuera del repo.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/comparar-pared-organica.ts
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/comparar-pared-organica.ts --confirm-spend --max-usd 0.15
 *
 * Lectura: ¿el brazo `organica` rompe el muro plano y uniforme del brazo
 * `densa`? ¿Aparecen racimos de tamaños desiguales y un borde vivo, en vez de
 * una rejilla? ¿Conserva los tres colores?
 */
import path from "node:path";
import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "../lora/exp-fal-lib";

const identidad = resolverIdentidadLora(flag("--artifact-id", "v004-1000"));
const escala = Number(flag("--escala", "0.8"));
const semillas = flag("--semillas", "101").split(",").map((valor) => Number(valor.trim())).filter((valor) => Number.isFinite(valor));

/** Lo único que cambia entre brazos: `EstructuraOficial.sustantivoEn`. */
const SUSTANTIVOS = {
  densa: "dense balloon wall installation",
  organica: "asymmetrical organic balloon wall installation",
} as const;

const escenaDe = (sustantivo: string) =>
  `an ${sustantivo} of pearl blush pink, chrome gold and matte white round balloons in R-5 (5-inch), ` +
  `R-9 (9-inch), R-12 (12-inch), R-18 (18-inch) and R-24 (24-inch) sizes, filling a rectangular backdrop ` +
  `frame, with clustered chrome gold balloons gathered at the upper right corner, the lower centre and the ` +
  `lower left corner, white flower accents and gold script letters reading "Mr & Mrs", set against an ` +
  `exposed brick wall on a concrete floor under soft warm indoor lighting.`;

const celdas: Celda[] = (Object.entries(SUSTANTIVOS) as Array<[keyof typeof SUSTANTIVOS, string]>).flatMap(([brazo, sustantivo]) =>
  semillas.map((seed) => ({
    id: `pared-${brazo}-seed${seed}`,
    prompt: escenaDe(sustantivo),
    lora: escala,
    seed,
    nota: `sustantivo de la estructura oficial: "${sustantivo}"`,
  })),
);

const defaults: Defaults = { seed: semillas[0]!, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: identidad.url, trigger: identidad.trigger };

console.log(`2 brazos (densa, organica) × ${semillas.length} semilla(s) = ${celdas.length} imágenes con ${identidad.artifactId} (${identidad.trigger}).`);
console.log('Una sola variable: el sustantivo de la estructura oficial. Lectura: ¿el brazo "organica" rompe el muro plano y uniforme? ¿racimos desiguales y borde vivo? ¿siguen los tres colores?\n');

correrExperimento({
  nombre: `pared-organica-${identidad.artifactId}`,
  celdas,
  defaults,
  outDir: path.join(process.env.TEMP ?? "/tmp", "demo-decoracion-eval", `pared-organica-${identidad.artifactId}`),
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
