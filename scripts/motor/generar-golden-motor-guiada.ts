import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIRECTORIO_DORADO, registroDe, todosLosCasos } from "../lib/casos-motor-guiada";

/**
 * Regenera las fixtures doradas del motor 3D de la vista guiada (`contracts/domain/v1/golden/motor-guiada/`): por cada
 * una de las 28 ideas y de las 18 estructuras oficiales, las cantidades por (formato, código), el total y la caja.
 * Córrelo cuando el motor cambie a propósito Y `VERSION_MOTOR` suba:
 *
 *   npx tsx --conditions=react-server scripts/motor/generar-golden-motor-guiada.ts
 */
mkdirSync(DIRECTORIO_DORADO, { recursive: true });
for (const archivo of readdirSync(DIRECTORIO_DORADO)) if (archivo.endsWith(".json")) rmSync(path.join(DIRECTORIO_DORADO, archivo));
for (const caso of todosLosCasos()) {
  writeFileSync(path.join(DIRECTORIO_DORADO, `${caso.id}.json`), `${JSON.stringify(registroDe(caso), null, 1)}\n`, "utf8");
  console.log(`escrito ${caso.id}`);
}
