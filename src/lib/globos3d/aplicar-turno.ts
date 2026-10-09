import type { PiezaConservada } from "./deshacer-turno";
import { sonIguales, type DiffEscena } from "./diff-escenas";
import type { Escena } from "./escena";

/**
 * **Aplicar el turno de la IA a la escena de ahora** (D-021): la IA trabaja sobre la escena que le mandaron (`antes`) y
 * contesta unos segundos después. Si en ese rato la persona movió o cambió algo a mano, la escena de ahora ya no es `antes`:
 * en vez de pisarla con la respuesta, se aplica solo lo que la IA tocó y cada pieza editada a mano se conserva como está
 * (y se dice). Es la misma regla de `deshacer-turno.ts` al revés. Puro.
 */

export type ResultadoAplicarTurno = { escena: Escena; conservadas: PiezaConservada[] };

export function aplicarTurno(actual: Escena, antes: Escena, despues: Escena, diff: DiffEscena): ResultadoAplicarTurno {
  if (actual === antes || sonIguales(actual, antes)) return { escena: despues, conservadas: [] };
  const conservadas: PiezaConservada[] = [];
  let nodos = [...actual.nodos];
  const ahora = (id: string) => nodos.find((n) => n.id === id);

  for (const c of diff.nodos) {
    const hay = ahora(c.id);
    if (c.tipo === "nueva") {
      if (hay) conservadas.push({ id: c.id, nombre: hay.nombre, motivo: "editada" });
      else if (c.despues) nodos.push(c.despues);
      continue;
    }
    if (!hay) { if (c.tipo === "cambiada") conservadas.push({ id: c.id, nombre: c.nombre, motivo: "quitada" }); continue; }
    if (!c.antes || !sonIguales(hay, c.antes)) { conservadas.push({ id: c.id, nombre: hay.nombre, motivo: "editada" }); continue; }
    const nuevo = c.despues;
    nodos = nuevo ? nodos.map((n) => (n.id === c.id ? nuevo : n)) : nodos.filter((n) => n.id !== c.id);
  }

  let sala = actual.sala;
  if (diff.sala) {
    if (sonIguales(actual.sala, diff.sala.antes)) sala = diff.sala.despues;
    else conservadas.push({ id: "sala", nombre: "Sala", motivo: "sala" });
  }
  return { escena: { ...actual, sala, nodos }, conservadas };
}

/** Lo que se le dice a la persona cuando trabajó a mano mientras la IA contestaba. */
export function textoAplicarTurno(conservadas: readonly PiezaConservada[]): string | null {
  if (!conservadas.length) return null;
  const nombres = conservadas.slice(0, 3).map((c) => `«${c.nombre}»`).join(", ");
  return `Mientras trabajaba cambiaste ${nombres}${conservadas.length > 3 ? ` y otras ${conservadas.length - 3}` : ""}: conservé lo tuyo y no apliqué ahí lo de la IA.`;
}
