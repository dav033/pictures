import fs from "node:fs";
import path from "node:path";

/**
 * Mide qué tan "dentro de la distribución" de los 154 captions de
 * entrenamiento está un prompt candidato, SIN llamar a fal.ai.
 *
 * Motivación: la auditoría del 2026-08-28 encontró que el prompt que arma la
 * app usa vocabulario que aparece en 0% de los captions de entrenamiento
 * ("stage photo area", "photorealistic event photograph", "natural depth",
 * "believable floor contact"), y omite el vocabulario que domina el dataset
 * ("matte" 82%, cláusula de iluminación 75%, "chrome" 44%, tamaños 36%).
 * El LoRA recibe un prompt mayormente ajeno y cae en sus priors (clusters
 * dorados, globos de número, arreglos florales) => formas amorfas.
 *
 * Este script convierte esa intuición en un número reproducible para poder
 * iterar el compilador offline antes de gastar crédito.
 */

const DATASET = path.join(process.cwd(), "data/processed/export-general-2026-08-27.json");
const TRIGGER = /^eventdecor_style_v2,\s*/i;

type Entrada = { texto: string };

function cargarCaptions(): string[] {
  const raw = JSON.parse(fs.readFileSync(DATASET, "utf8")) as { entradas: Entrada[] };
  return raw.entradas.map((entrada) => entrada.texto.replace(TRIGGER, "").toLowerCase());
}

const STOPWORDS = new Set(["a", "an", "the", "of", "and", "with", "in", "on", "at", "to", "for", "by", "from", "into", "under", "over", "is", "are"]);

function tokens(text: string): string[] {
  return text.toLowerCase().replace(TRIGGER, "").match(/[a-z][a-z-]+/g) ?? [];
}

function bigrams(list: string[]): string[] {
  return list.slice(0, -1).map((word, index) => `${word} ${list[index + 1]}`);
}

/** Rasgos que dominan el dataset y que un prompt en-distribución debería traer. */
const RASGOS_ESPERADOS: Array<{ nombre: string; cobertura: number; test: (prompt: string) => boolean }> = [
  { nombre: "acabado mate/brillante/cromado", cobertura: 0.82, test: (p) => /\b(matte|glossy|chrome|metallic|pearl|satin)\b/i.test(p) },
  { nombre: "cláusula de iluminación de cierre", cobertura: 0.75, test: (p) => /\blighting\b/i.test(p) },
  { nombre: "superficie del lugar (pared/piso/techo)", cobertura: 0.55, test: (p) => /\b(wall|floor|ceiling|backdrop panel)\b/i.test(p) },
  { nombre: "tamaño relativo de globo (large/small)", cobertura: 0.45, test: (p) => /\b(large|small|oversized|mixed sizes|varying sizes|in two sizes)\b/i.test(p) },
  { nombre: "conector espacial del dataset", cobertura: 0.60, test: (p) => /\b(beside|accented with|framing|flanking|above|along|between|mounted on|cascading|anchoring)\b/i.test(p) },
  { nombre: "sustantivo de estructura conocido", cobertura: 0.95, test: (p) => /\b(garland|arch|column|cluster|backdrop|centerpiece|wall|bouquet|frame)\b/i.test(p) },
  { nombre: "'organic' (apertura dominante)", cobertura: 0.35, test: (p) => /\borganic\b/i.test(p) },
  { nombre: "objeto de contexto (mesa/torta/letrero)", cobertura: 0.47, test: (p) => /\b(table|cake|sign|number|pedestal|poster)\b/i.test(p) },
];

/** Frases que el compilador emite hoy y que NO existen en el entrenamiento. */
const FRASES_PROHIBIDAS = [
  "stage photo area", "photorealistic", "event photograph", "natural depth",
  "believable floor contact", "celebration atmosphere", "venue entrance",
  "main table", "guest tables", "matching one another", "one standing on the left",
  "physical floor supports", "wide photorealistic",
];

export type AffinityReport = {
  prompt: string;
  longitud: number;
  unigramaEnDistribucion: number;
  bigramaEnDistribucion: number;
  rasgosCubiertos: Array<{ nombre: string; cobertura: number; presente: boolean }>;
  frasesFueraDeDistribucion: string[];
  tokensDesconocidos: string[];
  score: number;
};

export function medirAfinidad(prompt: string, captions: string[]): AffinityReport {
  const vocabulario = new Set(captions.flatMap((caption) => tokens(caption)));
  const vocabBigramas = new Set(captions.flatMap((caption) => bigrams(tokens(caption))));

  const propios = tokens(prompt).filter((word) => !STOPWORDS.has(word));
  const propiosBigramas = bigrams(tokens(prompt));

  const conocidos = propios.filter((word) => vocabulario.has(word));
  const conocidosBi = propiosBigramas.filter((pair) => vocabBigramas.has(pair));
  const desconocidos = [...new Set(propios.filter((word) => !vocabulario.has(word)))];

  const rasgos = RASGOS_ESPERADOS.map((rasgo) => ({ nombre: rasgo.nombre, cobertura: rasgo.cobertura, presente: rasgo.test(prompt) }));
  const prohibidas = FRASES_PROHIBIDAS.filter((frase) => prompt.toLowerCase().includes(frase));

  const unigrama = propios.length ? conocidos.length / propios.length : 0;
  const bigrama = propiosBigramas.length ? conocidosBi.length / propiosBigramas.length : 0;
  // Los rasgos se ponderan por qué tan dominantes son en el dataset: omitir
  // uno presente en el 82% de los captions duele más que omitir uno del 35%.
  const pesoTotal = RASGOS_ESPERADOS.reduce((suma, rasgo) => suma + rasgo.cobertura, 0);
  const pesoCubierto = rasgos.filter((rasgo) => rasgo.presente).reduce((suma, rasgo) => suma + rasgo.cobertura, 0);
  const cobertura = pesoCubierto / pesoTotal;

  const score = Math.round(100 * (0.25 * unigrama + 0.30 * bigrama + 0.45 * cobertura) - 6 * prohibidas.length);

  return {
    prompt,
    longitud: prompt.length,
    unigramaEnDistribucion: Math.round(unigrama * 100),
    bigramaEnDistribucion: Math.round(bigrama * 100),
    rasgosCubiertos: rasgos,
    frasesFueraDeDistribucion: prohibidas,
    tokensDesconocidos: desconocidos,
    score,
  };
}

function imprimir(titulo: string, reporte: AffinityReport): void {
  console.log(`\n${"=".repeat(78)}\n${titulo}  —  SCORE ${reporte.score}/100   (${reporte.longitud} chars)\n${"=".repeat(78)}`);
  console.log(reporte.prompt);
  console.log(`\n  unigramas en distribución: ${reporte.unigramaEnDistribucion}%   bigramas: ${reporte.bigramaEnDistribucion}%`);
  console.log("  rasgos del dataset:");
  for (const rasgo of reporte.rasgosCubiertos) {
    console.log(`    ${rasgo.presente ? "OK  " : "FALTA"} ${String(Math.round(rasgo.cobertura * 100)).padStart(3)}% del dataset — ${rasgo.nombre}`);
  }
  if (reporte.frasesFueraDeDistribucion.length) console.log(`  FRASES 0% EN ENTRENAMIENTO: ${reporte.frasesFueraDeDistribucion.join(" | ")}`);
  if (reporte.tokensDesconocidos.length) console.log(`  tokens nunca vistos: ${reporte.tokensDesconocidos.slice(0, 18).join(", ")}`);
}

function main(): void {
  const captions = cargarCaptions();
  console.log(`Dataset de referencia: ${captions.length} captions de entrenamiento (LoRA v2).`);

  const entrada = process.argv.slice(2).join(" ").trim();
  if (entrada) {
    imprimir("PROMPT SUMINISTRADO", medirAfinidad(entrada, captions));
    return;
  }

  // Línea base: promedio de afinidad de los propios captions de entrenamiento
  // consigo mismos — es el techo realista al que puede aspirar un prompt.
  const auto = captions.map((caption) => medirAfinidad(caption, captions).score);
  const media = Math.round(auto.reduce((suma, valor) => suma + valor, 0) / auto.length);
  console.log(`Techo de referencia (captions reales medidos contra el dataset): score medio ${media}/100\n`);

  imprimir(
    "ACTUAL — compilador v2 (caso XV años)",
    medirAfinidad(
      "a grand organic balloon arch in pink and rose gold centered around the stage photo area, two balloon columns, matching one another, one standing on the left and one on the right, flanking the main arch, with a low coordinated balloon centerpiece placed on the main table beneath the main arch. quinceañera celebration atmosphere, wide photorealistic event photograph, natural depth, believable floor contact and supports.",
      captions,
    ),
  );

  imprimir(
    "ACTUAL — compilador v1 legado (caso cumpleaños)",
    medirAfinidad(
      "a balanced, grand, oversized balloon arch mixing red and gold in organic clusters, framing the entrance, set up for a birthday party, birthday celebration atmosphere, wide photorealistic event photograph, natural depth, physical floor supports.",
      captions,
    ),
  );

  // Propuesta: mismo contenido semántico, reescrito con la gramática real del
  // dataset (apertura "organic balloon X of <tamaño+acabado+color>", conector
  // del dataset, cierre superficie + iluminación).
  imprimir(
    "PROPUESTA v3 — misma escena, gramática del dataset",
    medirAfinidad(
      "an organic balloon arch of large matte pink and glossy rose gold chrome round balloons accented with small pastel pink matte filler balloons, flanked by two tall matching balloon columns in the same matte pink and glossy rose gold chrome, beside a round main table holding a low balloon centerpiece of small rose gold chrome balloons, set against a plain event-hall wall and tiled floor under soft warm indoor lighting.",
      captions,
    ),
  );
}

main();
