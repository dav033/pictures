/**
 * Regenerates `src/lib/ia/amaterasu/analisis-ejemplos.json`: the reviewed analysis of
 * every gallery photo. Runs the real analysis (Gemini) against a running app,
 * so review the boxes before committing (see `analisisFijoDeEjemplo`).
 *
 * Uso: APP_PASSWORD=… npx tsx scripts/generar-analisis-ejemplos.ts [--base http://localhost:3010] [--solo ejemplo-01,ejemplo-07]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ANALISIS_EJEMPLOS, sha256Base64, type AnalisisEjemplo, type ArchivoAnalisisEjemplos } from "../src/lib/ia/amaterasu/analisis-ejemplos";
import { ANALYSIS_PARSER_VERSION } from "../src/lib/ia/amaterasu/analizar-referencias-v2";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "../src/lib/referencias-ejemplo/manifiesto";

const argumento = (nombre: string) => {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
};
const BASE = argumento("--base") ?? "http://localhost:3010";
const SOLO = new Set((argumento("--solo") ?? "").split(",").filter(Boolean));
const SALIDA = path.join(process.cwd(), "src", "lib", "ia", "analisis-ejemplos.json");

async function cookie(): Promise<string> {
  const respuesta = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ password: process.env.APP_PASSWORD }), redirect: "manual" });
  const [primera] = respuesta.headers.getSetCookie();
  if (!primera) throw new Error(`Login sin cookie (HTTP ${respuesta.status}).`);
  return primera.split(";")[0]!;
}

async function main(): Promise<void> {
  const sesion = await cookie();
  const previos = ANALISIS_EJEMPLOS.parser_version === ANALYSIS_PARSER_VERSION ? ANALISIS_EJEMPLOS.ejemplos : [];
  const ejemplos: AnalisisEjemplo[] = [];
  for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
    const base64 = readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", foto.archivo)).toString("base64");
    const sha256 = sha256Base64(base64);
    const previo = previos.find((item) => item.id === foto.id && item.sha256 === sha256);
    if (previo && SOLO.size > 0 && !SOLO.has(foto.id)) {
      ejemplos.push(previo);
      continue;
    }
    const respuesta = await fetch(`${BASE}/api/references/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, Cookie: sesion },
      body: JSON.stringify({ images: [{ base64, mime: "image/jpeg", ancho: foto.ancho, alto: foto.alto, originalAncho: foto.ancho, originalAlto: foto.alto }], sin_cache: true }),
    });
    if (!respuesta.ok) throw new Error(`${foto.id}: HTTP ${respuesta.status} ${await respuesta.text()}`);
    const { blueprint, tieneEstructurasDeGlobos, tieneElementos, metadata } = await respuesta.json();
    ejemplos.push({ id: foto.id, sha256, resultado: { blueprint, tieneEstructurasDeGlobos, tieneElementos, metadata: { ...metadata, cached: false, cache_key: `analisis-fijo:${foto.id}` } } });
    console.log(`${foto.id}: ${blueprint.elements.length} elementos, globos=${tieneEstructurasDeGlobos}`);
  }
  const archivo: ArchivoAnalisisEjemplos = { parser_version: ANALYSIS_PARSER_VERSION, ejemplos };
  writeFileSync(SALIDA, `${JSON.stringify(archivo, null, 1)}\n`);
  console.log(`Escrito ${SALIDA}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
