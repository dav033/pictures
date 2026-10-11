import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { casosCotizacionUnica, DIRECTORIO_COTIZACION_UNICA } from "../lib/casos-cotizacion-unica";

/**
 * Regenera la fixture compartida de la cotización única (`contracts/domain/v1/golden/cotizacion-unica/`, D-038): la
 * misma lista de materiales tiene que costar lo mismo en TypeScript y en Python. Córrelo cuando cambie la regla de
 * compra (`plan-de-compra.ts` y `presentaciones.py`, siempre juntas), el motor o el cruce:
 *
 *   npx tsx --conditions=react-server scripts/motor/generar-cotizacion-unica.ts
 */
mkdirSync(DIRECTORIO_COTIZACION_UNICA, { recursive: true });
for (const archivo of readdirSync(DIRECTORIO_COTIZACION_UNICA)) if (archivo.endsWith(".json")) rmSync(path.join(DIRECTORIO_COTIZACION_UNICA, archivo));
for (const caso of casosCotizacionUnica()) {
  writeFileSync(path.join(DIRECTORIO_COTIZACION_UNICA, `${caso.caso}.json`), `${JSON.stringify(caso, null, 1)}\n`, "utf8");
  console.log(`escrito ${caso.caso}: ${caso.esperado.total} COP`);
}
