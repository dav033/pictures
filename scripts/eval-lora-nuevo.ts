import path from "node:path";
import { PROMPT_V2, correrExperimento, flag, type Celda, type Defaults } from "./exp-fal-lib";

if (process.argv.includes("--insecure-tls")) {
  // Solo para esta máquina: el proxy corporativo rompe la verificación de Node.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/**
 * Evalúa un LoRA recién entrenado contra el criterio de aceptación fijado en
 * `data/staging/recaption-v004/entrenamiento.config.json`.
 *
 * Corre las escalas que importan — 0,8 y 1,0 — y NO 0,3: a esa escala el LoRA
 * está mayormente apagado y cualquier checkpoint parece bueno. El v2 da 6/6 a
 * 0,3 y 1/6 a 0,8; evaluar a 0,3 es hacer trampa.
 *
 * Mismos 6 seeds, mismo prompt y mismos hiperparámetros que el panel del v2, así
 * los resultados son comparables contra:
 *   base sin LoRA 6/6 · v2 a 0,8 = 1/6 · v2 a 0,3 = 6/6
 *
 *   $env:NODE_OPTIONS="--use-system-ca"
 *   npx tsx scripts/eval-lora-nuevo.ts --lora <url> --etiqueta v004-1000
 *
 * Criterio para promover: >=5/6 a escala 0,8.
 */

const SEEDS = [101, 202, 303, 404, 505, 606];
const ESCALAS = [0.8, 1.0];

const loraUrl = flag("lora", "");
const etiqueta = flag("etiqueta", "nuevo");
if (!loraUrl.startsWith("http")) {
  console.error("Falta --lora <url del safetensors>. Sale de reports/lora-debug/entrenamiento-v004.json");
  process.exit(1);
}

const defaults: Defaults = {
  seed: 777777,
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl,
  trigger: "eventdecor_style_v3",
};

const celdas: Celda[] = ESCALAS.flatMap((escala) =>
  SEEDS.map((seed) => ({
    id: `${etiqueta}-scale${String(escala).replace(".", "")}-seed${seed}`,
    prompt: PROMPT_V2,
    lora: escala,
    seed,
    safety: false,
    nota: `${etiqueta} @ lora_scale ${escala}`,
  })),
);

console.log(`evaluando ${etiqueta}\n  lora: ${loraUrl}\n  ${ESCALAS.length} escalas x ${SEEDS.length} seeds = ${celdas.length} imagenes`);
console.log(`  criterio: >=5/6 a escala 0,8 con arco 3D que cierra + dos columnas separadas + mesa en cuadro\n`);

correrExperimento({
  nombre: `eval-${etiqueta}`,
  celdas,
  defaults,
  outDir: path.join(process.cwd(), `reports/lora-debug/eval-${etiqueta}`),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
