import fs from "node:fs";
import path from "node:path";

/**
 * ¿A cuántos planes reales les aplica el fallo bilateral del caption?
 *
 * `scripts/diag-bilateral.ts` demuestra que cuando la pareja de laterales es
 * también la cláusula focal, `resolveRelations` la descarta con `continue`
 * (`lora-caption-compiler.ts:750`), el caption dice que las dos están "on the
 * left" y el preflight falla `relaciones bilaterales 0/1`, así que
 * `/api/generate` lanza LORA_PREFLIGHT_FAILED (`route.ts:1148`).
 *
 * Esto cuenta cuántos de los 24 planes congelados del repositorio tienen esa
 * forma: estructuras laterales izquierda+derecha y ninguna estructura no
 * lateral que pueda actuar de foco.
 *
 * Sin red ni llamadas pagadas.
 *   npx tsx scripts/diag-planes-bilaterales.ts
 */

const DIR = path.join(process.cwd(), "scripts/fixtures/planes-fijados");
const LATERALES = new Set(["lateral_izquierdo", "lateral_derecho"]);

type Estructura = { estructura_id?: string; tipo?: string; ubicacion?: string; rol_escena?: string; repeticiones?: number };

let enRiesgo = 0;
let conFoco = 0;
let sinLaterales = 0;
const filas: string[] = [];

for (const archivo of fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const datos = JSON.parse(fs.readFileSync(path.join(DIR, archivo), "utf8")) as { plan_resuelto?: { plan?: { estructuras?: Estructura[] } } };
  const estructuras = datos.plan_resuelto?.plan?.estructuras ?? [];
  if (!estructuras.length) continue;
  const izquierda = estructuras.filter((e) => e.ubicacion === "lateral_izquierdo");
  const derecha = estructuras.filter((e) => e.ubicacion === "lateral_derecho");
  const noLaterales = estructuras.filter((e) => e.ubicacion && !LATERALES.has(e.ubicacion));
  const ubicaciones = [...new Set(estructuras.map((e) => e.ubicacion ?? "?"))].join("+");

  if (!izquierda.length || !derecha.length) {
    sinLaterales += 1;
    filas.push(`  ok    ${archivo.padEnd(42)} ${ubicaciones}`);
    continue;
  }
  if (noLaterales.length) {
    conFoco += 1;
    filas.push(`  ok    ${archivo.padEnd(42)} ${ubicaciones}  (hay foco no lateral)`);
    continue;
  }
  // `expectedBilateralPairs` (lora-prompt-preflight.ts:67-81) solo espera la
  // pareja cuando los dos lados comparten tipo y rol: un semiarco frente a una
  // columna son dos piezas distintas, no un espejo, y no exige "flanking".
  const parejaReal = izquierda.some((i) => derecha.some((d) => d.tipo === i.tipo && d.rol_escena === i.rol_escena));
  if (!parejaReal) {
    sinLaterales += 1;
    filas.push(`  ok    ${archivo.padEnd(42)} ${ubicaciones}  (lados de tipo/rol distinto: no es pareja)`);
    continue;
  }
  enRiesgo += 1;
  filas.push(`  RIESGO ${archivo.padEnd(41)} ${ubicaciones}  <-- pareja lateral del mismo tipo, sin foco`);
}

console.log(filas.join("\n"));
console.log(`\nplanes congelados analizados: ${enRiesgo + conFoco + sinLaterales}`);
console.log(`  en riesgo de LORA_PREFLIGHT_FAILED (pareja lateral sin foco): ${enRiesgo}`);
console.log(`  con foco no lateral (la pareja recibe "flanking"):            ${conFoco}`);
console.log(`  sin pareja lateral:                                          ${sinLaterales}`);
