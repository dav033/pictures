/**
 * Generación REAL en fal.ai (Kagutsuchi) para decidir si se enciende
 * `GUIA_ESTRUCTURA_V1` (ADR-0033): la misma escena con y sin la guía plana de
 * la estructura como primera imagen de `/edit`.
 *
 * Dos planes (`scripts/lib/escenas-guia-estructura.ts`): la guirnalda en pared
 * del caso del usuario (`pared-arqueada-desnivel`, la que salió como un arco
 * con patas) y un arco con patrón de flores. Tres semillas fijas y dos brazos
 * (`sin`, `con`): 12 imágenes con `v007-1000` (slot `training_2`). Qué cambia
 * entre brazos y por qué es una sola variable: `scripts/lib/corrida-guia-estructura.ts`.
 *
 * GASTO. Por defecto es VISTA PREVIA: imprime las peticiones (las imágenes de
 * entrada resumidas, nunca su base64), los dos prompts de cada caso y el coste
 * ESTIMADO, sin red y sin `FAL_KEY`. Solo gasta con `--confirm-spend
 * --max-usd <tope>`; el runner (`scripts/lora/exp-fal-lib.ts`) se niega sin
 * ellos y con `CI=true`, mide el gasto real con el saldo de fal y se detiene
 * al alcanzar el tope. Las salidas van FUERA del repo (por defecto
 * `<tmp>/demo-decoracion-eval/guia-estructura-<artifact>`; `--out <carpeta>`).
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-guia-estructura.ts
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-guia-estructura.ts --confirm-spend --max-usd 0.9
 *
 * Opciones: `--artifact-id v007-1000|v004-1000`, `--escala 0.8`, `--semillas
 * 101,202,303`, `--out <carpeta fuera del repo>`, `--solo <subcadena>`.
 *
 * Cierre (tras gastar): `medidas.json` (IoU de silueta y presencia de cada
 * color de cada imagen contra su guía, `scripts/lib/medir-guia.ts`) y
 * `hoja-comparativa.png` (guía | sin | con, una fila por caso y semilla).
 * Lectura: ¿el brazo `con` sigue la silueta de la guía (sin patas en la
 * guirnalda de pared) y conserva los colores? ¿Devuelve una foto o el dibujo
 * retocado? ¿Pinta la carta?
 */
import { flag, correrExperimento, resolverIdentidadLora, type Defaults } from "../lora/exp-fal-lib";
import { cerrarCorridaGuia, directorioSalida, prepararCorridaGuia } from "../lib/corrida-guia-estructura";

async function main(): Promise<void> {
  const identidad = resolverIdentidadLora(flag("artifact-id", "v007-1000"));
  const escala = Number(flag("escala", "0.8"));
  if (!Number.isFinite(escala) || escala <= 0 || escala > 2) throw new Error("--escala espera un número entre 0 y 2.");
  const semillas = flag("semillas", "101,202,303").split(",").map((valor) => Number(valor.trim()));
  if (!semillas.length || semillas.some((semilla) => !Number.isInteger(semilla) || semilla < 0)) throw new Error("--semillas espera enteros separados por coma.");
  // Vista previa por defecto: sin --confirm-spend el runner imprime y no llama a nadie.
  if (!process.argv.includes("--confirm-spend") && !process.argv.includes("--dry-run")) process.argv.push("--dry-run");
  const outDir = directorioSalida(flag("out", ""), identidad.artifactId);

  const { celdas, guias } = await prepararCorridaGuia({ escala, semillas });
  for (const guia of guias) {
    console.log(`\n== ${guia.caso} (guía ${guia.guia.bytes} bytes, sha256 ${guia.guia.sha256.slice(0, 12)}, colores ${guia.guia.colores.join(" ")}, ${guia.conCarta ? "con carta" : "sin carta: no cabía"})`);
    console.log(`sin (${guia.promptSin.length}): ${guia.promptSin}`);
    console.log(`con (${guia.promptCon.length}): ${guia.promptCon}`);
  }
  console.log(`\n${guias.length} planes × 2 brazos × ${semillas.length} semillas = ${celdas.length} imágenes con ${identidad.artifactId} (${identidad.trigger}). Salida: ${outDir}\n`);

  const defaults: Defaults = { seed: semillas[0]!, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: identidad.url, trigger: identidad.trigger };
  const manifiesto = await correrExperimento({ nombre: `guia-estructura-${identidad.artifactId}`, celdas, defaults, outDir });
  if (process.argv.includes("--dry-run")) return;
  const { hoja } = await cerrarCorridaGuia(manifiesto, outDir, guias);
  console.log(hoja ? `hoja comparativa en ${hoja}` : "ninguna imagen salió bien: no hay hoja comparativa");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
