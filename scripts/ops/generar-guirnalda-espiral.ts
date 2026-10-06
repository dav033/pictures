/**
 * Generación REAL en fal.ai (Kagutsuchi, `fal-ai/flux-2/lora`) para medir el
 * arreglo del 2026-09-28: una guirnalda en pared con espiral de cuartetos
 * salía con cintas retorcidas cruzando la pieza (SEGUIMIENTO-guirnaldas.md §8,
 * "El armado no llegaba bien a la imagen").
 *
 * UNA SOLA VARIABLE: la frase LoRA del patrón detrás del armado.
 * - `antes`: la de `main` 94ad16b, literal: "wrapped in a spiral of pink, white
 *   and gold stripes winding along its length".
 * - `despues`: la que escribe hoy `patron_color.py` para una guirnalda por
 *   partes: "every cluster holding two pink, one white and one gold balloon".
 * Todo lo demás es idéntico: el plan real de Python `pared-espiral-tres-colores`
 * (`scripts/fixtures/armado-guirnalda-prompt/planes.json`: pared, recta,
 * cuartetos, relleno, espiral rosado, blanco, rosado, dorado), la misma frase
 * del armado, la misma escena (guirnalda de látex rosado y blanco Fashion y
 * dorado Reflex), el caption canónico de `/api/generate` sin foto del espacio
 * (el camino de la imagen del usuario: `motor_imagen_previsto = fal`), el
 * LoRA, la escala, el guidance y las semillas.
 *
 * GASTO. Por defecto es VISTA PREVIA: imprime los payloads literales y el
 * preflight de cada caption, sin red y sin `FAL_KEY`. Solo gasta con
 * `--confirm-spend --max-usd <tope>`; el runner (`scripts/lora/exp-fal-lib.ts`)
 * se niega sin ellos y con `CI=true`, mide el gasto real con el saldo de fal y
 * se detiene al alcanzar el tope. Las imágenes y el manifiesto van a
 * `reports/lora-debug/` (ignorado por git).
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-guirnalda-espiral.ts
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-guirnalda-espiral.ts --confirm-spend --max-usd 0.8
 *
 * Opciones: `--artifact-id v007-1000|v004-1000` (por defecto v007-1000, el slot
 * `training_2` con el que se generó la imagen del usuario), `--escala 0.8`,
 * `--semillas 101,202,303` (2 variantes × 3 semillas = 6 imágenes), `--solo
 * <subcadena>` para repetir una celda.
 *
 * Lectura: ¿hay cintas, serpentinas o bandas cruzando la guirnalda? ¿Se ven
 * racimos de globos rosados, blancos y dorados? ¿Va plana contra la pared?
 */
import path from "node:path";
import type { SceneSpec } from "@/lib/ia/escena/scene-spec";
import { preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { frasesDeEstructuras } from "@/lib/ia/uzume/mezcla-color-escena";
import { captionCanonicoGuirnalda, escenaGuirnalda, GUIRNALDA_SINTETICA, planGuirnalda, PRODUCTOS_GUIRNALDA } from "../lib/escenas-armado-guirnalda";
import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "../lib/fal-evaluacion";

/** La frase del patrón que `patron_color.py` escribía en `main` 94ad16b para este plan. */
const PATRON_ANTES = "wrapped in a spiral of pink, white and gold stripes winding along its length";

const identidad = resolverIdentidadLora(flag("artifact-id", "v007-1000"));
const escala = Number(flag("escala", "0.8"));
if (!Number.isFinite(escala) || escala <= 0 || escala > 2) throw new Error("--escala espera un número entre 0 y 2.");
const semillas = flag("semillas", "101,202,303").split(",").map((valor) => Number(valor.trim()));
if (!semillas.length || semillas.some((semilla) => !Number.isInteger(semilla) || semilla < 0)) throw new Error("--semillas espera enteros separados por coma.");

// Vista previa por defecto: sin --confirm-spend el runner imprime y no llama a nadie.
if (!process.argv.includes("--confirm-spend") && !process.argv.includes("--dry-run")) process.argv.push("--dry-run");

const { plan } = planGuirnalda("pared-espiral-tres-colores");
const patron = plan.patrones_color?.[0];
const armado = plan.armados_guirnalda?.[0];
if (!patron || !armado) throw new Error("el plan pared-espiral-tres-colores perdió su patrón o su armado");

/**
 * La guirnalda sintética sola (como en la foto del usuario, sin el arco de la
 * escena de pruebas) y con los tres materiales del plan: rosado, blanco, dorado.
 */
function escena(): SceneSpec {
  const base = escenaGuirnalda();
  const productos = [PRODUCTOS_GUIRNALDA.rosadoFashion, PRODUCTOS_GUIRNALDA.blancoFashion, PRODUCTOS_GUIRNALDA.doradoReflex];
  return {
    ...base,
    elements: base.elements
      .filter((element) => element.element_id === GUIRNALDA_SINTETICA)
      .map((element) => ({ ...element, catalog_product_ids: productos, resolved_colors: ["rosado", "blanco", "dorado"] })),
  };
}

const VARIANTES = { antes: PATRON_ANTES, despues: patron.prompt_lora } as const;

const celdas: Celda[] = (Object.entries(VARIANTES) as Array<[keyof typeof VARIANTES, string]>).flatMap(([variante, fraseDelPatron]) => {
  const frases = frasesDeEstructuras({
    patrones_color: [{ ...patron, estructura_id: GUIRNALDA_SINTETICA, prompt_lora: fraseDelPatron }],
    armados_guirnalda: [{ ...armado, estructura_id: GUIRNALDA_SINTETICA }],
  });
  const laEscena = escena();
  const compilado = captionCanonicoGuirnalda(laEscena, frases);
  const reporte = preflightLoraPrompt({ sceneSpec: laEscena, clauses: compilado.clauses, prompt: compilado.prompt });
  if (!reporte.ok) throw new Error(`${variante}: el preflight rechaza el caption (${reporte.errors.join("; ")})`);
  const prompt = compilado.prompt;
  return semillas.map((seed) => ({
    id: `espiral-${variante}-seed${seed}`,
    prompt,
    lora: escala,
    seed,
    nota: `patrón ${variante}: ${fraseDelPatron}`,
  }));
});

const defaults: Defaults = { seed: semillas[0]!, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: identidad.url, trigger: identidad.trigger };

console.log(`2 variantes (antes, despues) × ${semillas.length} semillas = ${celdas.length} imágenes con ${identidad.artifactId} (${identidad.trigger}).`);
console.log("Una sola variable: la frase del patrón detrás del armado. Lectura: ¿cintas o bandas cruzando la guirnalda? ¿racimos de globos rosados, blancos y dorados? ¿plana contra la pared?\n");

correrExperimento({
  nombre: `guirnalda-espiral-${identidad.artifactId}`,
  celdas,
  defaults,
  outDir: path.join("reports", "lora-debug", `guirnalda-espiral-${identidad.artifactId}`),
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
