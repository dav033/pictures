import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

/**
 * Juez con rúbrica fija sobre una tanda de experimento, en UNA SOLA llamada con
 * todas las imágenes, que es lo único que hace comparables sus números: la
 * escala se recalibra con el conjunto que se le presenta, así que sirve para
 * ORDENAR dentro de esta llamada y nunca como métrica absoluta ni para comparar
 * con otra corrida (mismo patrón que `image-qa.ts`).
 *
 * Una llamada PAGADA a Gemini.
 *   npx tsx --env-file=.env.local scripts/diag-juez-registro.ts reports/lora-debug/registro-caption-v004
 */

const dir = process.argv[2];
if (!dir) throw new Error("Pasa el directorio de la tanda.");
const mini = path.join(dir, "mini");

const RUBRICA = `You are judging balloon-decoration renders produced by the same fine-tuned model, from the same commercial design, changing ONLY the wording of the text prompt.

The design in every image: two organic balloon columns in matte dusty rose, matte white and chrome silver, in 18-inch, 12-inch and 5-inch.

Score each image 0-10 on each axis. Use the full range and rank them against each other.

- photorealism: does it read as a photograph of a real installation, or as a 3D/product render?
- finish_separation: are the matte balloons visibly matte AND the chrome balloons visibly mirror-like? Both must be true for a high score.
- size_variation: is there a visible hierarchy of balloon diameters, or are they all similar?
- organic_asymmetry: are the two columns genuinely different from each other with uneven staggered clusters, or are they matching mirrored towers?
- isolation: is the background a clean, empty studio backdrop suitable for compositing the columns onto a different photo later? 10 = pure seamless white, nothing else in frame. 0 = a full room with furniture and floor. This axis is descriptive, NOT a quality judgement.
- commercial_usability: would you show this to a paying customer as a preview of what they are buying?

Also give worst_defect: one short sentence naming the single worst visible problem.

Return JSON only.`;

type Fila = { image: string; photorealism: number; finish_separation: number; size_variation: number; organic_asymmetry: number; isolation: number; commercial_usability: number; worst_defect: string };

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY");
  const archivos = fs.readdirSync(mini).filter((f) => f.endsWith(".jpg")).sort();
  if (!archivos.length) throw new Error(`Sin miniaturas en ${mini}; corre scripts/diag-miniaturas.ts antes.`);

  const partes: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: RUBRICA }];
  for (const archivo of archivos) {
    partes.push({ text: `IMAGE ${archivo.replace(/\.jpg$/, "")}` });
    partes.push({ inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(path.join(mini, archivo)).toString("base64") } });
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const respuesta = await ai.models.generateContent({
    model: process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash",
    contents: [{ role: "user", parts: partes }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: {
          scores: {
            type: "array",
            items: {
              type: "object",
              properties: {
                image: { type: "string" },
                photorealism: { type: "number" },
                finish_separation: { type: "number" },
                size_variation: { type: "number" },
                organic_asymmetry: { type: "number" },
                isolation: { type: "number" },
                commercial_usability: { type: "number" },
                worst_defect: { type: "string" },
              },
              required: ["image", "photorealism", "finish_separation", "size_variation", "organic_asymmetry", "isolation", "commercial_usability", "worst_defect"],
            },
          },
        },
        required: ["scores"],
      },
    },
  });

  const datos = JSON.parse(respuesta.text ?? "{}") as { scores?: Fila[] };
  const filas = datos.scores ?? [];
  console.log("\nORDENA DENTRO DE ESTA LLAMADA. No compares estos numeros con otra corrida.\n");
  console.table(filas.map((f) => ({
    imagen: f.image,
    foto: f.photorealism,
    acabado: f.finish_separation,
    tamano: f.size_variation,
    asimetria: f.organic_asymmetry,
    aislam: f.isolation,
    usable: f.commercial_usability,
  })));
  for (const f of filas) console.log(`  ${f.image.padEnd(26)} ${f.worst_defect}`);

  const salida = path.join(dir, "juez.json");
  fs.writeFileSync(salida, JSON.stringify({ rubrica: RUBRICA, modelo: process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash", filas }, null, 2));
  console.log(`\nDetalle en ${path.relative(process.cwd(), salida)}`);
}

void main();
