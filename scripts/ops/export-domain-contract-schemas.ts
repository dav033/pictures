import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DomainContractSchemas } from "../../src/lib/ia/contracts/domain-v1";
import { FORMAS_SIN_MOTOR, formasEstructurasOficiales, geometriaEstructurasOficiales, reglasJsonSchemaEstructuraOficial } from "../../src/lib/plan/estructuras-oficiales";
import { formasPiezaPorOficial, reglasJsonSchemaFormaPieza } from "../../src/lib/plan/formas-pieza";
import { tonosColoresCatalogo } from "../../src/lib/rag/catalog/similitud-color";
import { reglasMezclas } from "../../src/lib/plan/mezclas";
import { reglasGuirnalda } from "../../src/lib/plan/armado-guirnalda";
import { FORMAS_LISTAS_ARCO_ORGANICO } from "../../src/lib/plan/armado-arco-organico";
import { LORA_COLOR_NAMES_EN } from "../../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { HEX_COLORES_V2, PALETA_COLORES_V2 } from "../../src/lib/rag/taxonomy/v2";
import { ACABADO_EN } from "../../src/lib/ia/uzume/mezcla-color-escena";

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
  "catalog-search.v1": "catalog-search.schema.json",
  "catalog-search-result.v1": "catalog-search-result.schema.json",
  "catalog-colors.v1": "catalog-colors-request.schema.json",
  "catalog-colors-result.v1": "catalog-colors-result.schema.json",
  "catalog-recommendations.v1": "catalog-recommendations-request.schema.json",
  "catalog-recommendations-result.v1": "catalog-recommendations-result.schema.json",
  "plan-decoracion.v1": "plan-decoracion.schema.json",
  "plan-resuelto.v1": "plan-resuelto.schema.json",
  "design-material-estimate.v1": "material-estimate.schema.json",
  "quote.v1": "quote.schema.json",
  "plan-resolution.v1": "plan-resolution-request.schema.json",
  "plan-resolution-result.v1": "plan-resolution-result.schema.json",
  "estimar-conteo.v1": "estimar-conteo-request.schema.json",
  "estimar-conteo-result.v1": "estimar-conteo-result.schema.json",
  "plan-guia-escena.v1": "plan-guia-escena-request.schema.json",
  "plan-guia-escena-result.v1": "plan-guia-escena-result.schema.json",
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
    const generated = z.toJSONSchema(entry.schema, {
      target: "draft-7",
      // Cross-field coherence of `estructura_oficial` (tipo, densidad, ubicación) is not
      // expressible in Zod's JSON output; inject the table owned by estructuras-oficiales.ts.
      override: ({ jsonSchema }) => {
        const properties = (jsonSchema as { properties?: Record<string, unknown> }).properties;
        if (jsonSchema.type !== "object" || !properties?.estructura_oficial) return;
        jsonSchema.allOf = [...(jsonSchema.allOf ?? []), ...reglasJsonSchemaEstructuraOficial()];
        // Y la forma elegida contra esa misma oficial (`formas-pieza.ts`), que tampoco se puede expresar en
        // Zod: solo en el objeto que la lleva, que es la estructura del plan y no el candidato de un conteo.
        if (properties.forma) jsonSchema.allOf = [...jsonSchema.allOf, ...reglasJsonSchemaFormaPieza()];
      },
    });
    // Plan resolvers in both languages read the balloon geometry of official
    // structure variants from this one table (estructuras-oficiales.ts), and
    // plan.py reads the mix table, standard diameters, substitution cap and
    // mandatory-size grammar from mezclas.ts through `x-reglas-mezclas`.
    // catalog.py reads the chromatic-distance table from this same search
    // contract to resolve a requested color the snapshot does not stock to
    // the nearest one it does (similitud-color.ts).
    const jsonSchema = entry.id === "plan-decoracion.v1"
      ? {
          $id: entry.id,
          ...generated,
          "x-geometria-estructuras-oficiales": geometriaEstructurasOficiales(),
          // La `forma` de cada estructura oficial, de la misma tabla. plan.py la usa
          // para saber qué piezas no arma ningún motor: una forma `circular` o
          // `libre` no es una forma que un motor de globos produzca, y esas piezas
          // se cuentan con la fórmula (el aro, con su `pi * diametro`).
          "x-formas-estructuras-oficiales": formasEstructurasOficiales(),
          "x-formas-sin-motor": [...FORMAS_SIN_MOTOR],
          // Las formas que el decorador puede elegir para cada oficial (`formas-pieza.ts`, puerto de las
          // `formas` del clasificador). `app/dibujo_estructura.py` las lee para preferir la elegida sobre
          // `FORMA_POR_OFICIAL` sin creerle a una que no es de esa pieza, y `app/plan_edicion.py` para
          // rechazar la edición que la pondría. La tabla de TypeScript sigue siendo la única copia.
          "x-formas-pieza": formasPiezaPorOficial(),
          "x-reglas-mezclas": reglasMezclas(),
          // armado_guirnalda.py reads where a garland may hang or tilt
          // (ADR-0032, decision 27) from armado-guirnalda.ts, the contract's owner.
          "x-reglas-guirnalda": reglasGuirnalda(),
          // patron_color.py names each color of a color pattern in the image
          // prompts with the same ES→EN tables the TypeScript prompts use
          // (ADR-0028): the LoRA caption's color names (palette plus aliases, so
          // "gris" is "gray" in both) and the Gemini scene's finish words.
          "x-colores-en": { ...LORA_COLOR_NAMES_EN },
          // The catalog color vocabulary itself (taxonomy/v2.ts): the photo
          // pattern detection may only answer with these names.
          "x-paleta-colores": [...PALETA_COLORES_V2],
          "x-acabados-en": { ...ACABADO_EN },
          // Las formas listas del arco orgánico (armado-arco-organico.ts). Son los ids que el motor del
          // diseñador publica y que la interfaz y el chat nombran sin copiar ninguna cifra. Viajan por el
          // contrato para que `tests/test_armado_arco_organico.py` pueda comprobar desde Python que la lista
          // de TypeScript no se quedó atrás cuando el motor gana una forma: son las dos únicas copias del
          // vocabulario y no comparten ningún otro artefacto.
          "x-formas-arco-organico": [...FORMAS_LISTAS_ARCO_ORGANICO],
        }
      : entry.id === "plan-guia-escena.v1"
      // app/guia_escena.py pinta un material cuyo color no está en la lámina Sempertex con el tono de la paleta
      // del plan (taxonomy/v2.ts), la misma tabla que ve el cliente: una sola copia, leída por los dos lados.
      ? { $id: entry.id, ...generated, "x-hex-colores": { ...HEX_COLORES_V2 } }
      : entry.id === "catalog-search.v1"
      ? { $id: entry.id, ...generated, "x-tonos-colores-catalogo": tonosColoresCatalogo() }
      : { $id: entry.id, ...generated };
    const target = path.join(outputDirectory, filename);
    const expected = `${JSON.stringify(jsonSchema, null, 2)}\n`;
    const current = await readFile(target, "utf8").catch(() => null);
    const alDia = normalizarFinDeLinea(current) === expected;
    if (checkOnly) {
      if (!alDia) throw new Error(`Contract drift detected: ${target}`);
    } else if (!alDia) {
      // Solo se escribe lo que cambió: reescribir un archivo igual cambia su fin
      // de línea (CRLF del checkout → LF) y git lo da por modificado.
      await writeFile(target, expected, "utf8");
    }
  }
  console.log(`${checkOnly ? "Checked" : "Exported"} ${Object.keys(schemas).length} domain contract schemas in ${outputDirectory}`);
}

void main();
