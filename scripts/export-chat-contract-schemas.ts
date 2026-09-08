import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ChatErrorEventV1Schema,
  ChatFinishEventV1Schema,
  ChatRequestV1Schema,
  ChatSseEventV1Schema,
  ChatTextEventV1Schema,
  ChatToolEventV1Schema,
  ChatTranscriptV1Schema,
  ErrorEnvelopeV1Schema,
  ToolCallV1Schema,
} from "../src/lib/ia/contracts/chat-v1";

const outputDirectory = path.join(process.cwd(), "contracts", "chat", "v1");

/**
 * La comparación de drift normaliza CRLF a LF. Con `core.autocrlf=true` git
 * materializa estos archivos con CRLF en Windows, mientras el blob versionado y
 * lo que escribe este script son LF: comparar en crudo reportaba drift después
 * de cualquier checkout sin que el contrato hubiera cambiado.
 */
function normalizarFinDeLinea(texto: string | null): string | null {
  return texto === null ? null : texto.replace(/\r\n/g, "\n");
}
const checkOnly = process.argv.includes("--check");
const schemas = {
  "request.schema.json": ChatRequestV1Schema,
  "sse-event.schema.json": ChatSseEventV1Schema,
  "sse-text-event.schema.json": ChatTextEventV1Schema,
  "sse-tool-event.schema.json": ChatToolEventV1Schema,
  "sse-finish-event.schema.json": ChatFinishEventV1Schema,
  "sse-error-event.schema.json": ChatErrorEventV1Schema,
  "transcript.schema.json": ChatTranscriptV1Schema,
  "tool-call.schema.json": ToolCallV1Schema,
  "error.schema.json": ErrorEnvelopeV1Schema,
} as const;

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  for (const [filename, schema] of Object.entries(schemas)) {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
    const target = path.join(outputDirectory, filename);
    const expected = `${JSON.stringify(jsonSchema, null, 2)}\n`;
    if (checkOnly) {
      const current = await readFile(target, "utf8").catch(() => null);
      if (normalizarFinDeLinea(current) !== expected) {
        throw new Error(`Contract drift detected: ${target}`);
      }
    } else {
      await writeFile(target, expected, "utf8");
    }
  }

  console.log(`${checkOnly ? "Checked" : "Exported"} ${Object.keys(schemas).length} chat contract schemas in ${outputDirectory}`);
}

void main();
