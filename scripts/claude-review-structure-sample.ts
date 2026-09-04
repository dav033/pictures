import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const SAMPLE_PATH = path.join(ROOT, "data", "staging", "structure-v001", "review-sample-25.json");
const OUTPUT_PATH = path.join(ROOT, "data", "staging", "structure-v001", "claude-sample-review.json");

type SampleItem = {
  key: string;
  file: string;
  caption: string;
  structureTypes: string[];
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          caption_correct: { type: "boolean" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          issues: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
          suggested_caption: { type: ["string", "null"] },
        },
        required: ["id", "caption_correct", "confidence", "issues", "notes", "suggested_caption"],
      },
    },
  },
  required: ["reviews"],
};

async function main(): Promise<void> {
  const payload = JSON.parse(await readFile(SAMPLE_PATH, "utf8")) as { items: SampleItem[]; datasetId: string };
  if (payload.items.length > 25) throw new Error("La muestra supera el máximo de 25 imágenes");
  const items = payload.items.map((item) => ({
    id: item.key,
    image_path: path.resolve(ROOT, item.file),
    structure_types_from_dataset: item.structureTypes,
    caption: item.caption,
  }));
  const missing = items.filter((item) => !existsSync(item.image_path));
  if (missing.length > 0) throw new Error(`Faltan imágenes de muestra: ${missing.map((item) => item.id).join(", ")}`);
  const prompt = `
Eres auditor visual de captions para un dataset de entrenamiento de un LoRA de estructuras de decoracion con globos.
Abre CADA imagen con la herramienta Read usando image_path y compara la imagen con caption.
Revisa solo si el caption describe correctamente lo visible: estructura, geometria, colores principales, posicion, soporte y entorno.
No marques error solo porque hay objetos secundarios omitidos; marca error si afirma algo que no aparece, omite la estructura principal o asigna una clase equivocada.
El trigger debe ignorarse para la evaluacion. No inventes colores, tamanos ni materiales.
Registra tambien si la foto tiene texto legible, personas o personajes: eso es una alerta de calidad para entrenamiento, no necesariamente un error del caption.
Si hay un error real, escribe una suggested_caption completa en ingles manteniendo exactamente una vez el trigger eventdecor_structure_v1. Si no hay error, suggested_caption debe ser null.
Responde solo JSON valido con el schema indicado. Devuelve exactamente una review por imagen, usando el id exacto.

Muestra:
${JSON.stringify(items, null, 2)}
`;
  const args = [
    "-p", prompt,
    "--model", "sonnet",
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--allowedTools", "Read",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
  ];
  const { stdout, stderr } = await execFileAsync("claude.exe", args, { maxBuffer: 8 * 1024 * 1024 });
  const raw = stdout || stderr;
  const envelope = JSON.parse(raw) as { is_error?: boolean; result?: string };
  if (envelope.is_error) throw new Error(envelope.result || "Claude Code devolvió un error");
  const review = JSON.parse(envelope.result || raw) as { reviews: unknown[] };
  if (review.reviews.length !== items.length) throw new Error(`Claude devolvió ${review.reviews.length} reviews para ${items.length} imágenes`);
  await writeFile(OUTPUT_PATH, JSON.stringify({ datasetId: payload.datasetId, sampleCount: items.length, reviewedBy: "claude-code-vision", reviews: review.reviews }, null, 2), "utf8");
  const wrong = review.reviews.filter((item) => (item as { caption_correct?: boolean }).caption_correct === false).length;
  console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT_PATH), sampleCount: items.length, captionErrors: wrong }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
