import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DomainContractSchemas } from "../src/lib/ia/contracts/domain-v1";

const outputDirectory = path.join(process.cwd(), "contracts", "domain", "v1");
const checkOnly = process.argv.includes("--check");

/**
 * La comparación de drift normaliza CRLF a LF. Con `core.autocrlf=true` git
 * materializa estos archivos con CRLF en Windows, mientras el blob versionado y
 * lo que escribe este script son LF: comparar en crudo reportaba drift después
 * de cualquier checkout sin que el contrato hubiera cambiado.
 */
function normalizarFinDeLinea(texto: string | null): string | null {
  return texto === null ? null : texto.replace(/\r\n/g, "\n");
}
const filenames: Record<string, string> = {
  "catalog-product.v1": "catalog-product.schema.json",
  "catalog-variant.v1": "catalog-variant.schema.json",
  "catalog-selection.v1": "catalog-selection.schema.json",
  "catalog-selection-request.v1": "catalog-selection-request.schema.json",
  "catalog-selection-result.v1": "catalog-selection-result.schema.json",
  "plan-decoracion.v1": "plan-decoracion.schema.json",
  "plan-resuelto.v1": "plan-resuelto.schema.json",
  "design-material-estimate.v1": "material-estimate.schema.json",
  "quote.v1": "quote.schema.json",
  "reference-blueprint.v2": "reference-blueprint.schema.json",
  "scene-spec.v1": "scene-spec.schema.json",
  "lora-selection.v1": "lora-selection.schema.json",
  "product-vocabulary.v1": "product-vocabulary.schema.json",
  "prop-catalogo.v1": "prop-catalogo.schema.json",
  "happie-recommendation-request.v1": "happie-recommendation-request.schema.json",
  "happie-recommendation-response.v1": "happie-recommendation-response.schema.json",
  "happie-package-response.v1": "happie-package-response.schema.json",
  "happie-description-request.v1": "happie-description-request.schema.json",
  "happie-structured-recommendation-request.v1": "happie-structured-recommendation-request.schema.json",
  "happie-conversation-request.v1": "happie-conversation-request.schema.json",
  "happie-conversation-response.v1": "happie-conversation-response.schema.json",
  "happie-error.v1": "happie-error.schema.json",
  "operational-context.v1": "operational-context.schema.json",
  "internal-request-signature.v1": "internal-request-signature.schema.json",
  "backend-selection.v1": "backend-selection.schema.json",
};

const schemas: Record<string, { id: string; schema: z.ZodType }> = Object.fromEntries(
  Object.entries(DomainContractSchemas).map(([id, schema]) => [filenames[id] ?? `${id}.schema.json`, { id, schema }]),
);

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  for (const [filename, entry] of Object.entries(schemas)) {
    const generated = z.toJSONSchema(entry.schema, { target: "draft-7" });
    const jsonSchema = { $id: entry.id, ...generated };
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
  console.log(`${checkOnly ? "Checked" : "Exported"} ${Object.keys(schemas).length} domain contract schemas in ${outputDirectory}`);
}

void main();
