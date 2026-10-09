import { sonIguales, type CambioNodo, type DiffEscena } from "./diff-escenas";
import type { Escena, NodoEscena } from "./escena";
import { fusionarNodo, padreDe, salaNormalizada, sanearPadres, type PiezaConservada } from "./fusion-nodos";

/**
 * **Aplicar (o rehacer) el turno de la IA sobre la escena de ahora** (D-021): la IA trabaja sobre la escena que le mandaron
 * (`antes`) y contesta unos segundos después. Si en ese rato la persona cambió algo a mano, la escena de ahora ya no es
 * `antes`: en vez de pisarla con la respuesta, se aplica solo lo que la persona no tocó (campo a campo) y se dice qué se
 * conservó. Es la misma regla de `deshacer-turno.ts` al revés, y sirve también para rehacer un turno deshecho. Puro.
 */

export type ResultadoAplicarTurno = {
  escena: Escena;
  conservadas: PiezaConservada[];
  /** El mismo turno; si una pieza nueva de la IA chocaba en id con una de la persona, ya va con el id nuevo. */
  diff: DiffEscena;
};

function conPadre<T extends NodoEscena>(n: T, padreId: string): T {
  return "padreId" in n.colocacion ? { ...n, colocacion: { ...n.colocacion, padreId } } : n;
}
const libre = (id: string, usados: Set<string>): string => {
  for (let i = 2; ; i++) { const candidato = `${id}-ia${i > 2 ? i : ""}`; if (!usados.has(candidato)) { usados.add(candidato); return candidato; } }
};

/** Las piezas nuevas de la IA cuyo id ya usa otra pieza de la persona toman un id libre (y lo que cuelga de ellas, el nuevo padre). */
function sinChoques(actual: Escena, diff: DiffEscena, soloDistintas: boolean): DiffEscena {
  const usados = new Set([...actual.nodos.map((n) => n.id), ...diff.nodos.map((c) => c.id)]);
  const nuevos = new Map<string, string>();
  for (const c of diff.nodos) {
    const ahora = c.tipo === "nueva" ? actual.nodos.find((n) => n.id === c.id) : undefined;
    // Al rehacer, una pieza del mismo tipo y nombre con ese id es la de la IA (la persona la movió o la editó); si es otra cosa (un id
    // que quedó libre y que la persona volvió a usar), la de la IA toma un id libre.
    const esLaDeLaIA = soloDistintas && ahora && c.despues && ahora.pieza.tipo === c.despues.pieza.tipo && ahora.nombre === c.despues.nombre;
    if (ahora && c.despues && !sonIguales(ahora, c.despues) && !esLaDeLaIA) nuevos.set(c.id, libre(c.id, usados));
  }
  if (!nuevos.size) return diff;
  const cambiar = (n: NodoEscena | null, esNueva: boolean): NodoEscena | null => {
    if (!n) return n;
    const padre = padreDe(n);
    const base = padre && nuevos.has(padre) ? conPadre(n, nuevos.get(padre)!) : n;
    return esNueva && nuevos.has(base.id) ? { ...base, id: nuevos.get(base.id)! } : base;
  };
  return { ...diff, nodos: diff.nodos.map((c): CambioNodo => ({ ...c, id: c.tipo === "nueva" ? nuevos.get(c.id) ?? c.id : c.id, despues: cambiar(c.despues, c.tipo === "nueva") })) };
}

/**
 * `renombrar`: la primera vez que se aplica la respuesta (la persona pudo crear, mientras la IA contestaba, una pieza con el mismo id)
 * cualquier pieza distinta con el id de una nueva la hace tomar un id libre. Al rehacer o al mirar el estado de un turno, una pieza del
 * mismo tipo y nombre con ese id es la de la IA (que la persona movió o editó): se cuenta como conservada, nunca se duplica.
 */
export function aplicarDiff(actual: Escena, original: DiffEscena, renombrar = false): ResultadoAplicarTurno {
  const diff = sinChoques(actual, original, !renombrar);
  const conservadas: PiezaConservada[] = [];
  const aplicadas: string[] = [];
  const tocadas = new Set<string>();
  const aQuitar = new Set<string>();
  let nodos = [...actual.nodos];
  const hay = (id: string) => nodos.find((n) => n.id === id);

  for (const c of diff.nodos) {
    const ahora = hay(c.id);
    if (c.tipo === "nueva") {
      if (!c.despues) continue;
      if (ahora) {
        if (!sonIguales(ahora, c.despues)) conservadas.push({ id: c.id, nombre: ahora.nombre, motivo: "editada" });
        continue;
      }
      nodos.push(c.despues);
      tocadas.add(c.id); aplicadas.push(c.id);
      continue;
    }
    if (!ahora) { if (c.tipo === "cambiada") conservadas.push({ id: c.id, nombre: c.nombre, motivo: "quitada" }); continue; }
    if (c.tipo === "quitada") {
      if (c.antes && sonIguales(ahora, c.antes)) aQuitar.add(c.id);
      else conservadas.push({ id: c.id, nombre: ahora.nombre, motivo: "editada" });
      continue;
    }
    if (!c.antes || !c.despues) continue;
    const r = fusionarNodo(ahora, c.antes, c.despues);
    if (r.cambiados.length) { nodos = nodos.map((n) => (n.id === c.id ? r.nodo : n)); tocadas.add(c.id); aplicadas.push(c.id); }
    if (r.conservados.length) conservadas.push({ id: c.id, nombre: ahora.nombre, motivo: "editada", campos: r.conservados });
  }

  // Lo que la IA quitó no se quita si la persona colgó algo de ello mientras tanto.
  for (let seguir = true; seguir;) {
    seguir = false;
    for (const n of nodos) {
      const padre = padreDe(n);
      if (padre && aQuitar.has(padre) && !aQuitar.has(n.id)) {
        aQuitar.delete(padre); seguir = true;
        conservadas.push({ id: padre, nombre: hay(padre)?.nombre ?? padre, motivo: "en_uso" });
        break;
      }
    }
  }
  if (aQuitar.size) { nodos = nodos.filter((n) => !aQuitar.has(n.id)); aplicadas.push(...aQuitar); }

  let sala = actual.sala;
  if (diff.sala) {
    if (sonIguales(actual.sala, diff.sala.antes)) { sala = salaNormalizada(diff.sala.despues); aplicadas.push("sala"); }
    else if (!sonIguales(actual.sala, diff.sala.despues)) conservadas.push({ id: "sala", nombre: "Sala", motivo: "sala" });
  }

  nodos = sanearPadres(nodos, actual.nodos, tocadas, conservadas, aplicadas);
  return { escena: aplicadas.length ? { ...actual, sala, nodos } : actual, conservadas, diff };
}

/** La respuesta de la IA sobre la escena de ahora: tal cual si no cambió nada mientras contestaba; si no, solo lo que la persona no tocó. */
export function aplicarTurno(actual: Escena, antes: Escena, despues: Escena, diff: DiffEscena): ResultadoAplicarTurno {
  if (actual === antes || sonIguales(actual, antes)) return { escena: despues, conservadas: [], diff };
  return aplicarDiff(actual, diff, true);
}

/** Lo que se le dice a la persona cuando trabajó a mano mientras la IA contestaba. */
export function textoAplicarTurno(conservadas: readonly PiezaConservada[]): string | null {
  if (!conservadas.length) return null;
  const nombres = conservadas.slice(0, 3).map((c) => `«${c.nombre}»${c.campos?.length ? ` (${c.campos.join(", ")})` : ""}`).join(", ");
  return `Mientras trabajaba cambiaste ${nombres}${conservadas.length > 3 ? ` y otras ${conservadas.length - 3}` : ""}: conservé lo tuyo y no apliqué ahí lo de la IA.`;
}
