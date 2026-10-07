import { RUTA_DETALLES, escribirDetallesIdeas } from "./detalles-ideas";

/**
 * Regenera `src/lib/biblioteca-sempertex/detalles-ideas.json` (el detalle de cada idea: piezas y globos Sempertex por
 * producto y tamaño) desde `decoraciones.json` y los planes resueltos de `data/biblioteca-real/analisis`. Determinista:
 * sin red, sin Python, sin modelo y sin coste (por eso no pide `--ejecutar`).
 *
 *   npx tsx scripts/biblioteca/precomputar-detalles-ideas.ts           # escribe el archivo
 *   npx tsx scripts/biblioteca/precomputar-detalles-ideas.ts --check   # solo compara; sale con 1 si está desfasado
 *
 * Córrelo cada vez que cambie `decoraciones.json` (lo hace también `construir-biblioteca-real.ts --solo-publicar`).
 */
async function principal(): Promise<void> {
  const comprobar = process.argv.includes("--check");
  const { desfasado, ideas, avisos } = await escribirDetallesIdeas({ comprobar });
  for (const aviso of avisos) console.warn(`aviso: ${aviso}`);
  if (comprobar) {
    if (desfasado) {
      console.error(`detalles-ideas.json está desfasado con decoraciones.json (${ideas} ideas). Regenera: npx tsx scripts/biblioteca/precomputar-detalles-ideas.ts`);
      process.exitCode = 1;
      return;
    }
    console.log(`detalles-ideas.json al día: ${ideas} ideas.`);
    return;
  }
  console.log(desfasado ? `Escrito ${RUTA_DETALLES}: ${ideas} ideas.` : `Sin cambios: ${ideas} ideas.`);
}

void principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
