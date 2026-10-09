/**
 * **Avisos para el usuario que salen de una herramienta que SÍ funcionó** (2026-10-09): «Pediste 10 mesas pero solo caben 6», «se quedó sin sillas»,
 * «su centro ya no cabe… lo quité» eran notas dentro del resumen que el modelo podía callar. Una herramienta las marca con `avisar` (el texto va
 * también a las notas del resumen, como siempre) y devuelve `avisosDe(notas)` junto a su resultado; la ruta junta los de todo el turno y el servidor
 * agrega «Aviso: …» a la respuesta final de los que el texto no menciona (`conHonestidad`). Sin regex sobre el resumen: un aviso es un dato.
 *
 * `palabras` son las que, de aparecer en la respuesta, dan el aviso por dicho (en minúsculas, sin tilde no hace falta: se comparan sin mayúsculas).
 */

export type AvisoUsuario = { texto: string; palabras: readonly string[] };

const registro = new WeakMap<readonly string[], AvisoUsuario[]>();

/** Agrega `texto` a las notas del resumen y lo anota como aviso para el usuario. */
export function avisar(notas: string[], texto: string, ...palabras: string[]): void {
  notas.push(texto);
  const lista = registro.get(notas) ?? [];
  lista.push({ texto, palabras });
  registro.set(notas, lista);
}

/** Los avisos anotados en estas notas (sin repetir). */
export function avisosDe(notas: readonly string[]): AvisoUsuario[] {
  const vistos = new Set<string>();
  return (registro.get(notas) ?? []).filter((a) => !vistos.has(a.texto) && vistos.add(a.texto));
}

/** ¿La respuesta ya menciona el aviso? Por sus palabras clave o por un id/nombre entre «» o comillas que el aviso nombra. */
export function avisoDicho(respuesta: string, aviso: AvisoUsuario): boolean {
  const r = respuesta.toLowerCase();
  return aviso.palabras.some((p) => p !== "" && r.includes(p.toLowerCase()));
}
