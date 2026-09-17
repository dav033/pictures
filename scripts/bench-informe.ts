import fs from "node:fs";
import path from "node:path";
import { cargarCorridas, generarInforme } from "./bench/informe";

/**
 * Regenera `reports/bench/informe.html` a partir de las corridas existentes,
 * sin repetir ninguna llamada pagada. Copia además las miniaturas de la última
 * corrida a `reports/bench/img/`, que es donde el HTML las busca.
 *
 *   npx tsx scripts/bench-informe.ts
 */

const RAIZ = "reports/bench";

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
