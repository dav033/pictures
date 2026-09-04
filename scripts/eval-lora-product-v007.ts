import { correrExperimento, flag, type Celda, type Defaults } from "./exp-fal-lib";

if (process.argv.includes("--insecure-tls")) {
  // Solo para esta máquina: el proxy corporativo rompe la verificación de Node.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const SEEDS = [101, 202, 303, 404, 505, 606];
const loraUrl = flag("lora", "");
const etiqueta = flag("etiqueta", "v007-product");
if (!loraUrl.startsWith("http")) throw new Error("Falta --lora <url del safetensors>.");

const pares = [
  ["acabado-a", "a balloon column, standing to one side, built from 12-inch high-shine Reflex gold round latex balloons, set against a plain wall and floor."],
  ["acabado-b", "a balloon column, standing to one side, built from 12-inch matte Fashion gold round latex balloons, set against a plain wall and floor."],
  ["color-a", "a balloon column, standing to one side, built from 12-inch high-shine Reflex rose gold round latex balloons, set against a plain wall and floor."],
  ["color-b", "a balloon column, standing to one side, built from 12-inch high-shine Reflex gold round latex balloons, set against a plain wall and floor."],
  ["diametro-a", "a balloon garland, grounded across the front, built from matte Fashion white round latex balloons, all at a single 5-inch size, set against a plain wall and floor."],
  ["diametro-b", "a balloon garland, grounded across the front, built from matte Fashion white round latex balloons, all at a single 24-inch size, set against a plain wall and floor."],
] as const;

const defaults: Defaults = {
  seed: 777777,
  guidance: Number(flag("guidance", "3.5")),
  ancho: 1536,
  alto: 1024,
  loraUrl,
  trigger: "eventdecor_style_v3",
};

const celdas: Celda[] = pares.flatMap(([id, prompt]) =>
  SEEDS.map((seed) => ({
    id: `${id}-seed${seed}`,
    prompt,
    lora: 0.8,
    seed,
    safety: false,
    nota: `${id} @ lora_scale 0.8`,
  })),
);

console.log(`${pares.length / 2} pares de fidelidad x ${SEEDS.length} seeds x 2 = ${celdas.length} imágenes`);
console.log("Criterios: acabado Reflex/Fashion, color rose gold/gold, diámetro 5/24 pulgadas. Todo a escala 0.8.\n");

correrExperimento({
  nombre: `eval-${etiqueta}-producto`,
  celdas,
  defaults,
  outDir: `reports/lora-debug/eval-${etiqueta}-producto`,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
