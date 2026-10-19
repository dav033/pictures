import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dentroDe } from "../../../src/lib/eval/estructuras/cli-reconocimiento";
import { etiquetasCarpeta, importarRegistro, leerCsv, seleccionEstratificada, suiteDesdeManual } from "../../../src/lib/eval/estructuras/suite-manual";

/**
 * CLI: builds the dev-seed-v0 suite from the manual folder. Preview by default;
 * `--escribir` saves the suite. The suite holds only hashes, relative paths and
 * permission flags; no author, page URL or image leaves the private folder.
 *
 *   npx tsx scripts/eval/estructuras/suite-desde-manual.ts --raiz C:\Users\davidt\Downloads\estructuras-manual [--maximo 60] [--escribir]
 */

function main(): void {
  const argv = process.argv.slice(2);
  const valor = (nombre: string) => { const i = argv.indexOf(nombre); return i >= 0 ? argv[i + 1] : undefined; };
  const raiz = valor("--raiz");
  if (!raiz) throw new Error("--raiz es obligatorio");
  if (dentroDe(process.cwd(), raiz)) throw new Error("--raiz debe quedar fuera del repositorio: ninguna imagen entra al repo");
  const maximo = Number(valor("--maximo") ?? 60);
  if (!Number.isInteger(maximo) || maximo < 1 || maximo > 500) throw new Error("--maximo debe ser un entero 1-500");
  const salida = valor("--salida") ?? "datasets/estructuras/manifests/dev-seed-v0.suite.json";
  if (!dentroDe(process.cwd(), salida)) throw new Error("--salida debe quedar dentro del repositorio");
  const suiteId = valor("--suite-id") ?? "dev-seed-v0";
  // Owner-approved exception id for rows without permission (internal evaluation only).
  const idExcepcion = valor("--excepcion");
  const excepcion = idExcepcion ? { id: idExcepcion, aprobadaEn: new Date().toISOString().slice(0, 10), registro: "docs/planes/estructuras-2026-09/ejecucion/fase-a/REVISION-HUMANA.md" } : undefined;

  const registro = resolve(raiz, "_registro.csv");
  if (!existsSync(registro)) throw new Error(`no existe ${registro}`);
  const filas = leerCsv(readFileSync(registro, "utf8"));
  const resultado = importarRegistro(filas, raiz, (ruta) => (existsSync(ruta) ? readFileSync(ruta) : null), excepcion);
  const elegidas = seleccionEstratificada(resultado.aceptadas, maximo);

  const motivos = resultado.excluidas.reduce<Record<string, number>>((acumulado, { motivo }) => ({ ...acumulado, [motivo]: (acumulado[motivo] ?? 0) + 1 }), {});
  console.log(`[suite-manual] filas=${filas.length} aceptadas=${resultado.aceptadas.length} elegidas=${elegidas.length} excluidas=${resultado.excluidas.length}`);
  console.log(`[suite-manual] por clase: ${JSON.stringify(resultado.por_clase)}`);
  console.log(`[suite-manual] por familia: ${JSON.stringify(resultado.por_familia)}`);
  console.log(`[suite-manual] exclusiones: ${JSON.stringify(motivos)}`);
  if (elegidas.length < 10) console.log("[suite-manual] aviso: dev-seed-v0 pide al menos 10 imágenes con permiso (Plan A §A0.4a)");

  if (!argv.includes("--escribir")) {
    console.log("[suite-manual] vista previa: agrega --escribir para guardar la suite");
    return;
  }
  if (elegidas.length === 0) throw new Error("no hay imágenes con permiso: no se escribe una suite vacía");
  const suite = suiteDesdeManual(elegidas, suiteId, excepcion);
  mkdirSync(dirname(resolve(salida)), { recursive: true });
  writeFileSync(resolve(salida), `${JSON.stringify(suite, null, 2)}\n`);
  const rutaEtiquetas = resolve(dirname(resolve(salida)), `${suiteId}.etiquetas-carpeta.json`);
  writeFileSync(rutaEtiquetas, `${JSON.stringify({ nota: "Clase de la carpeta elegida por una persona al capturar; pista de curación, no verdad terreno revisada.", etiquetas: etiquetasCarpeta(elegidas) }, null, 2)}\n`);
  console.log(`[suite-manual] escrita ${salida} y ${rutaEtiquetas}`);
}

try {
  main();
} catch (error) {
  console.error(`[suite-manual] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
