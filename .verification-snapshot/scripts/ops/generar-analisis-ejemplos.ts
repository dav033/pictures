/**
 * Regenerates `src/lib/ia/amaterasu/analisis-ejemplos.json`: the reviewed analysis of
 * every gallery photo, made with the production recognizer variant. Calls the real
 * analysis (Gemini) directly, the same way `/api/references/analyze` does, so review
 * the boxes before committing (see `analisisFijoDeEjemplo`).
 *
 * Uso: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-analisis-ejemplos.ts [--solo ejemplo-01,ejemplo-07]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "../../src/lib/referencias-ejemplo/manifiesto";

const argumento = (nombre: string) => {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
};
const SOLO = new Set((argumento("--solo") ?? "").split(",").filter(Boolean));
const SALIDA = path.join(process.cwd(), "src", "lib", "ia", "amaterasu", "analisis-ejemplos.json");

async function main(): Promise<void> {
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  // Not an evaluation, but the same guard: these calls stay out of the production telemetry series.
  delete process.env.DATABASE_URL;
  await import("../../src/lib/ia/nucleo/telemetria-llamadas");
  const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
  configurarPersistenciaTelemetria(undefined);

  const { ANALISIS_EJEMPLOS, sha256Base64 } = await import("../../src/lib/ia/amaterasu/analisis-ejemplos");
  const { analizarReferenciasV2, ANALYSIS_PARSER_VERSION } = await import("../../src/lib/ia/amaterasu/analizar-referencias-v2");
  const { VARIANTE_PRODUCCION } = await import("../../src/lib/ia/referencia/reference-structure");
  const { chatDe } = await import("../../src/lib/ia/nucleo/registro");
  const { cuerpoExito, referenciasEtiquetadas } = await import("../../src/app/api/references/analyze/analisis-http");
  type AnalisisEjemplo = (typeof ANALISIS_EJEMPLOS)["ejemplos"][number];

  const chat = await chatDe("gemini");
  const vigentes = ANALISIS_EJEMPLOS.parser_version === ANALYSIS_PARSER_VERSION && ANALISIS_EJEMPLOS.variante === VARIANTE_PRODUCCION;
  const previos = vigentes ? ANALISIS_EJEMPLOS.ejemplos : [];
  const ejemplos: AnalisisEjemplo[] = [];
  for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
    const base64 = readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", foto.archivo)).toString("base64");
    const sha256 = sha256Base64(base64);
    const previo = previos.find((item) => item.id === foto.id && item.sha256 === sha256);
    if (previo && SOLO.size > 0 && !SOLO.has(foto.id)) {
      ejemplos.push(previo);
      continue;
    }
    const referencias = referenciasEtiquetadas([{ base64, mime: "image/jpeg", ancho: foto.ancho, alto: foto.alto, originalAncho: foto.ancho, originalAlto: foto.alto }]);
    const analisis = await analizarReferenciasV2(chat, referencias, [], "perceptual", { superficie: "scripts/ops/generar-analisis-ejemplos" }, undefined, { forzarNuevoAnalisis: true });
    const { blueprint, tieneEstructurasDeGlobos, tieneElementos, metadata } = cuerpoExito(analisis, referencias, "generar-analisis-ejemplos", "gemini") as Pick<AnalisisEjemplo["resultado"], "blueprint" | "tieneEstructurasDeGlobos" | "tieneElementos" | "metadata">;
    ejemplos.push({ id: foto.id, sha256, resultado: { blueprint, tieneEstructurasDeGlobos, tieneElementos, metadata: { ...metadata, cached: false, cache_key: `analisis-fijo:${foto.id}` } } });
    console.log(`${foto.id}: ${blueprint.elements.length} elementos, globos=${tieneEstructurasDeGlobos}`);
  }
  writeFileSync(SALIDA, `${JSON.stringify({ parser_version: ANALYSIS_PARSER_VERSION, variante: VARIANTE_PRODUCCION, ejemplos }, null, 1)}\n`);
  console.log(`Escrito ${SALIDA}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
