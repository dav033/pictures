/**
 * Generación REAL en fal.ai (Kagutsuchi, `fal-ai/flux-2/lora`) de bouquets con
 * y sin armado (ADR-0030), para ver si el LoRA sigue el armado: niveles,
 * números al centro o uno por bouquet. Es la medición pendiente de
 * SEGUIMIENTO-bouquets.md §9 ("LoRA v007 y bouquets").
 *
 * Los prompts salen de la misma cadena que `/api/generate` (caption canónico
 * con el vocabulario v007 y el trigger del LoRA elegido), sobre las escenas de
 * `scripts/lib/escenas-armado-bouquet.ts` y las frases reales de Python de
 * `scripts/fixtures/armado-bouquet-prompt/armados.json`. Cada caso va con su
 * control sin armado y la misma semilla: la única diferencia es la frase.
 *
 * GASTO. Por defecto es VISTA PREVIA: imprime los payloads literales y el
 * preflight de cada caption, sin red y sin `FAL_KEY`. Solo gasta con
 * `--confirm-spend --max-usd <tope>` (el runner `scripts/lora/exp-fal-lib.ts`
 * se niega sin ellos y con `CI=true`, mide el gasto real con el saldo de fal
 * antes y después de cada imagen y se detiene al alcanzar el tope). El repo no
 * declara un precio por imagen de fal: el tope es el único límite, y el gasto
 * que reporta es el medido, no una estimación. Por eso falla cerrado: sin saldo
 * legible no genera nada, y si el saldo deja de leerse a mitad, se detiene. Las imágenes y el manifiesto van
 * a `reports/lora-debug/` (ignorado por git); ninguna entra al repositorio.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-bouquet-armado.ts
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-bouquet-armado.ts --confirm-spend --max-usd 0.5
 *
 * Opciones: `--artifact-id v004-1000|v007-1000` (por defecto v004-1000, el
 * aprobado), `--escala 0.8` (la de producción la fija el slot del registro),
 * `--semillas 101,202` (dos por defecto: 2 casos × 2 variantes × 2
 * semillas = 8 imágenes), `--solo <subcadena>` para repetir una celda.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { preflightFluxPrompt } from "@/lib/ia/kagutsuchi/preflight-flux";
import { frasesDeEstructuras } from "@/lib/ia/uzume/mezcla-color-escena";
import { ArmadoBouquetResueltoSchema } from "@/lib/plan/armado-bouquet";
import { BOUQUET_15_LADOS, BOUQUET_80, BOUQUET_SINTETICO, captionCanonico, escenaBouquet, type BouquetSintetico } from "../lib/escenas-armado-bouquet";
import { correrExperimento, flag, resolverIdentidadFlux, type Celda, type Defaults } from "../lib/fal-evaluacion";

const identidad = resolverIdentidadFlux(flag("artifact-id", "v004-1000"));
// La escala de producción la da el slot del registro (`lora_scale`); 0.8 es la de las evaluaciones de v004/v007.
const escala = Number(flag("escala", "0.8"));
if (!Number.isFinite(escala) || escala <= 0 || escala > 2) throw new Error("--escala espera un número entre 0 y 2.");
const semillas = flag("semillas", "101,202").split(",").map((valor) => Number(valor.trim()));
if (!semillas.length || semillas.some((semilla) => !Number.isInteger(semilla) || semilla < 0)) throw new Error("--semillas espera enteros separados por coma.");

// Vista previa por defecto: sin --confirm-spend el runner imprime y no llama a nadie.
if (!process.argv.includes("--confirm-spend") && !process.argv.includes("--dry-run")) process.argv.push("--dry-run");

const armados = z.object({ _comentario: z.string(), armados: z.record(z.string(), ArmadoBouquetResueltoSchema) }).strict()
  .parse(JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "fixtures", "armado-bouquet-prompt", "armados.json"), "utf8"))).armados;

const CASOS: Array<{ id: string; bouquet: BouquetSintetico; armado: string }> = [
  { id: "numeros-centro", bouquet: BOUQUET_80, armado: "numeros-centro" },
  { id: "numeros-lados", bouquet: BOUQUET_15_LADOS, armado: "numeros-lados" },
];

const celdas: Celda[] = CASOS.flatMap((caso) => {
  const armado = armados[caso.armado];
  if (!armado) throw new Error(`armado de fixture desconocido: ${caso.armado}`);
  const escena = escenaBouquet(caso.bouquet);
  const frases = frasesDeEstructuras({ armados_bouquet: [{ ...armado, estructura_id: BOUQUET_SINTETICO }] });
  return (["con-armado", "sin-armado"] as const).flatMap((variante) => {
    const compilado = captionCanonico(escena, variante === "con-armado" ? frases : undefined);
    const reporte = preflightFluxPrompt({ sceneSpec: escena, clauses: compilado.clauses, prompt: compilado.prompt });
    if (!reporte.ok) throw new Error(`${caso.id}/${variante}: el preflight rechaza el caption (${reporte.errors.join("; ")})`);
    const prompt = compilado.prompt;
    return semillas.map((seed) => ({
      id: `${caso.id}-${variante}-seed${seed}`,
      prompt,
      lora: escala,
      seed,
      nota: `${caso.id} ${variante}: ${variante === "con-armado" ? armado.prompt_lora : "sin frase de armado"}`,
    }));
  });
});

const defaults: Defaults = { seed: semillas[0]!, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: identidad.url, trigger: identidad.trigger };

console.log(`${CASOS.length} casos × 2 variantes × ${semillas.length} semillas = ${celdas.length} imágenes con ${identidad.artifactId} (${identidad.trigger}).`);
console.log("Criterio de lectura: ¿el bouquet con armado muestra los niveles, los números donde el armado dice y, con un número a cada lado, dos bouquets?\n");

correrExperimento({
  nombre: `bouquet-armado-${identidad.artifactId}`,
  celdas,
  defaults,
  outDir: path.join("reports", "lora-debug", `bouquet-armado-${identidad.artifactId}`),
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
