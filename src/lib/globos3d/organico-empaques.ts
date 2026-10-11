/**
 * Cuántos empaques de verdad se hicieron (no los que salieron de la caché de `organico.ts`), lo que tardaron en total y los últimos con su tamaño
 * (globos de estructura y ms). Armar una pieza orgánica grande bloquea Node segundos: las pruebas de tiempo cuentan los empaques que pide cada
 * herramienta de la IA de escena, y esas herramientas miran los que van desde que empezaron (nunca el total del proceso) para no pasarse
 * (`herramientas-escena-tamanos-busqueda.ts`).
 */
export const EMPAQUES: { hechos: number; ms: number; registro: Array<{ ms: number; globos: number }> } = { hechos: 0, ms: 0, registro: [] };
const MAXIMO_REGISTRO = 64;

/** Anota un empaque que empezó en `inicio` (ms, `performance.now()`), acaba de terminar y colocó `globos` globos de estructura. */
export function anotarEmpaque(inicio: number, globos: number): void {
  const ms = performance.now() - inicio;
  EMPAQUES.hechos += 1;
  EMPAQUES.ms += ms;
  EMPAQUES.registro.push({ ms, globos });
  if (EMPAQUES.registro.length > MAXIMO_REGISTRO) EMPAQUES.registro.shift();
}
