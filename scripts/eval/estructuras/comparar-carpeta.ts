import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compararConCarpeta } from "../../../src/lib/eval/estructuras/analisis-carpeta";
import { leerPrediccionesJsonl } from "../../../src/lib/eval/estructuras/prediccion";

/**
 * CLI: directional comparison of a run against folder classes.
 *   npx tsx scripts/eval/estructuras/comparar-carpeta.ts --corrida <dir con predicciones.jsonl> --etiquetas <archivo.etiquetas-carpeta.json>
 * Writes comparacion-carpeta.json next to the predictions.
 */

const argv = process.argv.slice(2);
const valor = (nombre: string) => { const i = argv.indexOf(nombre); return i >= 0 ? argv[i + 1] : undefined; };
const corrida = valor("--corrida");
const rutaEtiquetas = valor("--etiquetas");
if (!corrida || !rutaEtiquetas) {
  console.error("uso: --corrida <dir> --etiquetas <json>");
  process.exit(1);
}
const lineas = leerPrediccionesJsonl(readFileSync(resolve(corrida, "predicciones.jsonl"), "utf8"));
const { etiquetas } = JSON.parse(readFileSync(rutaEtiquetas, "utf8")) as { etiquetas: Record<string, string> };
const resumen = compararConCarpeta(lineas, etiquetas);
writeFileSync(resolve(corrida, "comparacion-carpeta.json"), `${JSON.stringify(resumen, null, 2)}\n`);
console.log(JSON.stringify({ imagenes: resumen.imagenes, corridas_ok: resumen.corridas_ok, global: resumen.global }, null, 2));
