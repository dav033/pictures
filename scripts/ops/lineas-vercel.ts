/**
 * Lo que `vercel logs --json` devuelve, leído sin perder nada (2026-10-09): `verVercel` solo miraba `message` de cada entrada y se
 * saltaba el arreglo `logs[]` donde Vercel pone las líneas que la función escribió en stdout (las de `registro/servidor.ts`), así que
 * los registros de producción de una conversación salían vacíos. Aquí: cada entrada (una línea JSON, o un arreglo / un objeto con
 * `logs`) y todos sus mensajes, el propio y los de `logs[]` (aunque anidados). Puro: sin red ni Vercel.
 */

export type EntradaVercel = { cruda: string; objeto: Record<string, unknown>; mensajes: string[] };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const CLAVES_MENSAJE = ["message", "text", "msg", "log"] as const;
const MAX_PROFUNDIDAD = 4;

function parsear(texto: string): unknown {
  try { return JSON.parse(texto); } catch { return undefined; }
}

/** Los mensajes de una entrada: el suyo y los de cada elemento de `logs[]` (que puede ser un texto o un objeto con su propio `logs[]`). */
export function mensajesDe(objeto: Record<string, unknown>, profundidad = 0): string[] {
  const salida: string[] = [];
  for (const clave of CLAVES_MENSAJE) { if (typeof objeto[clave] === "string") { salida.push(objeto[clave] as string); break; } }
  if (!salida.length && esObjeto(objeto.payload) && typeof objeto.payload.text === "string") salida.push(objeto.payload.text);
  if (Array.isArray(objeto.logs) && profundidad < MAX_PROFUNDIDAD) {
    for (const item of objeto.logs) {
      if (typeof item === "string") salida.push(item);
      else if (esObjeto(item)) salida.push(...mensajesDe(item, profundidad + 1));
    }
  }
  return salida.filter((m) => m.length > 0);
}

/** Las entradas de la salida de `vercel logs --json`: una por línea (NDJSON), o las de un arreglo / un objeto con `logs` de entradas. */
export function entradasDeVercel(stdout: string): EntradaVercel[] {
  const entrada = (objeto: Record<string, unknown>, cruda?: string): EntradaVercel => ({ cruda: cruda ?? JSON.stringify(objeto), objeto, mensajes: mensajesDe(objeto) });
  const todo = stdout.trim();
  if (todo.startsWith("[")) {
    const arreglo = parsear(todo);
    return Array.isArray(arreglo) ? arreglo.filter(esObjeto).map((o) => entrada(o)) : [];
  }
  const salida: EntradaVercel[] = [];
  for (const linea of stdout.split("\n")) {
    if (!linea.trim()) continue;
    const objeto = parsear(linea);
    if (esObjeto(objeto)) salida.push(entrada(objeto, linea));
  }
  return salida;
}

/** Las líneas propias del servidor (`{"ts":…}` de `registro/servidor.ts`) entre los mensajes de una entrada (un mensaje puede traer varias). */
export const lineasPropias = (mensajes: readonly string[]): string[] =>
  mensajes.flatMap((m) => m.split("\n")).filter((linea) => linea.trim().startsWith("{\"ts\""));
