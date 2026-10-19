import fs from "node:fs";
import path from "node:path";
import { cargarCorridas, generarInforme } from "./informe";

/**
 * Regenera `reports/bench/informe.html` a partir de las corridas existentes,
 * sin repetir ninguna llamada pagada. Copia además las miniaturas de la última
 * corrida a `reports/bench/img/`, que es donde el HTML las busca.
 *
 *   npx tsx scripts/bench/bench-informe.ts
 *   npx tsx scripts/bench/bench-informe.ts --raiz informes/bench
 *
 * La raíz es un argumento porque las corridas viven en dos sitios y no por
 * gusto: `reports/` es el directorio de trabajo del arnés y está ignorado por
 * git, mientras que el snapshot que viaja con el código está en `informes/`
 * (ver `informes/README.md`). Sin el argumento, el informe comprometido no se
 * puede regenerar desde un checkout limpio, que es donde se leyó por primera
 * vez.
 */

function raizDeArgv(): string {
  const indice = process.argv.indexOf("--raiz");
  const valor = indice >= 0 ? process.argv[indice + 1] : undefined;
  if (indice >= 0 && !valor) throw new Error("--raiz necesita una ruta.");
  return valor ?? "reports/bench";
}

const RAIZ = raizDeArgv();

function main(): void {
  const corridas = cargarCorridas(RAIZ);
  if (!corridas.length) throw new Error(`No hay corridas en ${RAIZ}.`);
  const ultima = corridas[corridas.length - 1]!;

  const destino = path.join(RAIZ, "img");
  fs.mkdirSync(destino, { recursive: true });
  const origen = path.join(RAIZ, ultima.meta.fase, "mini");
  for (const archivo of fs.readdirSync(origen)) fs.copyFileSync(path.join(origen, archivo), path.join(destino, archivo));

  fs.writeFileSync(path.join(RAIZ, "informe.html"), generarInforme(corridas));
  console.log(`informe: ${path.join(RAIZ, "informe.html")} · ${corridas.length} corrida(s) · ${fs.readdirSync(destino).length} imagenes`);
}

main();
