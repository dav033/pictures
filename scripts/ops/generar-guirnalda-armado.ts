/**
 * Generación REAL en fal.ai (Kagutsuchi, `fal-ai/flux-2/lora`) de guirnaldas
 * con y sin armado (ADR-0032, entrega E5), para ver si el LoRA sigue el
 * soporte y la forma del armado: en la pared, colgada en swags, en U
 * invertida, apoyada en el piso o abrazada a un arco. Es la medición pendiente
 * de SEGUIMIENTO-guirnaldas.md §8 (E7): nadie sabe todavía si el LoRA v007 (ni
 * el v004) aprendió guirnaldas por soporte.
 *
 * Los prompts salen de la misma cadena que `/api/generate` (caption canónico
 * con el vocabulario v007 y el trigger del LoRA elegido), sobre la escena de
 * `scripts/lib/escenas-armado-guirnalda.ts` y las frases reales de Python de
 * `scripts/fixtures/armado-guirnalda-prompt/planes.json`. Cada caso va con su
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
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-guirnalda-armado.ts
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-guirnalda-armado.ts --confirm-spend --max-usd 0.5
 *
 * Opciones: `--artifact-id v004-1000|v007-1000` (por defecto v004-1000, el
 * aprobado), `--escala 0.8`, `--semillas 101` (una por defecto: 5 casos × 2
 * variantes × 1 semilla = 10 imágenes), `--solo <subcadena>` para repetir una
 * celda.
 */
import path from "node:path";
import { preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { frasesDeEstructuras } from "@/lib/ia/uzume/mezcla-color-escena";
import { captionCanonicoGuirnalda, escenaGuirnalda, GUIRNALDA_SINTETICA, planGuirnalda, type GuirnaldaSintetica } from "../lib/escenas-armado-guirnalda";
import { correrExperimento, flag, resolverIdentidadLora, type Celda, type Defaults } from "../lora/exp-fal-lib";

const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));
// La escala de producción la da el slot del registro (`lora_scale`); 0.8 es la de las evaluaciones de v004/v007.
const escala = Number(flag("escala", "0.8"));
if (!Number.isFinite(escala) || escala <= 0 || escala > 2) throw new Error("--escala espera un número entre 0 y 2.");
const semillas = flag("semillas", "101").split(",").map((valor) => Number(valor.trim()));
if (!semillas.length || semillas.some((semilla) => !Number.isInteger(semilla) || semilla < 0)) throw new Error("--semillas espera enteros separados por coma.");

// Vista previa por defecto: sin --confirm-spend el runner imprime y no llama a nadie.
if (!process.argv.includes("--confirm-spend") && !process.argv.includes("--dry-run")) process.argv.push("--dry-run");

const CASOS: Array<{ id: string; plan: string; escena: GuirnaldaSintetica }> = [
  { id: "pared", plan: "pared", escena: {} },
  { id: "colgada-swags", plan: "colgada", escena: {} },
  { id: "u-invertida-espejo", plan: "u-invertida-espejo", escena: {} },
  { id: "piso", plan: "piso", escena: { placement: "piso_frontal" } },
  { id: "sobre-arco", plan: "sobre-arco", escena: {} },
];

const celdas: Celda[] = CASOS.flatMap((caso) => {
  const { plan } = planGuirnalda(caso.plan);
  const escena = escenaGuirnalda(caso.escena);
  const frases = frasesDeEstructuras({
    ...(plan.patrones_color ? { patrones_color: plan.patrones_color.map((patron) => ({ ...patron, estructura_id: GUIRNALDA_SINTETICA })) } : {}),
    armados_guirnalda: (plan.armados_guirnalda ?? []).map((armado) => ({ ...armado, estructura_id: GUIRNALDA_SINTETICA })),
  });
  const frase = frases?.[0]?.prompt_lora;
  if (!frase) throw new Error(`${caso.id}: el plan ${caso.plan} no trae armado de guirnalda`);
  return (["con-armado", "sin-armado"] as const).flatMap((variante) => {
    const compilado = captionCanonicoGuirnalda(escena, variante === "con-armado" ? frases : undefined);
    const reporte = preflightLoraPrompt({ sceneSpec: escena, clauses: compilado.clauses, prompt: compilado.prompt });
    if (!reporte.ok) throw new Error(`${caso.id}/${variante}: el preflight rechaza el caption (${reporte.errors.join("; ")})`);
    const prompt = compilado.prompt;
    return semillas.map((seed) => ({
      id: `${caso.id}-${variante}-seed${seed}`,
      prompt,
      lora: escala,
      seed,
      nota: `${caso.id} ${variante}: ${variante === "con-armado" ? frase : "sin frase de armado"}`,
    }));
  });
});

const defaults: Defaults = { seed: semillas[0]!, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: identidad.url, trigger: identidad.trigger };

console.log(`${CASOS.length} casos × 2 variantes × ${semillas.length} semillas = ${celdas.length} imágenes con ${identidad.artifactId} (${identidad.trigger}).`);
console.log("Criterio de lectura: ¿la guirnalda con armado va sobre el soporte que dice (pared, colgada, piso, abrazada al arco), con la forma que dice (recta, swags, U invertida) y por racimos?\n");

correrExperimento({
  nombre: `guirnalda-armado-${identidad.artifactId}`,
  celdas,
  defaults,
  outDir: path.join("reports", "lora-debug", `guirnalda-armado-${identidad.artifactId}`),
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
