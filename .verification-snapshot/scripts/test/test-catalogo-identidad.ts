/**
 * Identidad byte a byte de lo que el orden del catálogo alimenta (REQ-013, AC-4, riesgo R-3): el orden de `FONDOS_CATALOGO` entra
 * en el `z.enum` de `agregar_mobiliario`, en el de la lectura de fotos y en el prompt de Gemini, así que separar el catálogo en
 * repositorios no puede mover ni un byte de
 * - las declaraciones de herramientas de la IA de escena (`DECLARACIONES_ESCENA`),
 * - el esquema de la lectura de fotos tal como se manda a Gemini (`esquemaLecturaParaGemini`),
 * - el prompt de la lectura de fotos (`construirPromptLectura`) y, aparte, su lista de fondos,
 * - el orden de los ids del catálogo.
 * La foto (`dorado/identidad-catalogo.json`) se sacó de b4433bc9 antes de los repositorios. Sin coste: ninguna IA ni red.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-identidad.ts
 *   ... test-catalogo-identidad.ts --escribir     (solo si el cambio del prompt o de las declaraciones es lo que se quería)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { DECLARACIONES_ESCENA } from "../../src/lib/globos3d/herramientas-escena";
import { esquemaLecturaParaGemini } from "../../src/lib/globos3d/leer-foto-ia";
import { descripcionConColores } from "../../src/lib/globos3d/mobiliario-tipos";
import { construirPromptLectura } from "../../src/lib/globos3d/prompt-lectura-foto";

type Huellas = Record<string, string>;

const RUTA = new URL("./dorado/identidad-catalogo.json", import.meta.url);
const sha = (texto: string) => createHash("sha256").update(texto).digest("hex");

function huellas(): Huellas {
  return {
    declaracionesEscena: sha(JSON.stringify(DECLARACIONES_ESCENA)),
    esquemaLecturaGemini: sha(JSON.stringify(esquemaLecturaParaGemini())),
    promptLectura: sha(construirPromptLectura()),
    fondosDelPrompt: sha(FONDOS_CATALOGO.map((f) => `${f.id}: ${descripcionConColores(f)}`).join(" ")),
    ordenIdsFondos: sha(FONDOS_CATALOGO.map((f) => f.id).join("\n")),
  };
}

if (process.argv.includes("--escribir")) {
  writeFileSync(RUTA, `${JSON.stringify(huellas(), null, 2)}\n`);
  console.log(`escritas las huellas en ${RUTA.pathname}`);
} else {
  const guardadas = JSON.parse(readFileSync(RUTA, "utf8")) as Huellas;
  const actuales = huellas();
  const distintas = Object.keys({ ...guardadas, ...actuales }).filter((k) => guardadas[k] !== actuales[k]);
  assert.deepEqual(distintas, [], `cambió lo que el modelo recibe: ${distintas.join(", ")}`);
  console.log(`test-catalogo-identidad: ok (${Object.keys(actuales).length} huellas iguales)`);
}
