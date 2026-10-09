import { aplicarDiff } from "./aplicar-turno";
import { sonIguales, type DiffEscena } from "./diff-escenas";
import type { Escena } from "./escena";
import { fusionarNodo, MOTIVO_TEXTO, padreDe, salaNormalizada, sanearPadres, type PiezaConservada } from "./fusion-nodos";

/**
 * **Deshacer un turno de la IA** (D-021): revierte SOLO lo que la IA cambió en ese turno, campo a campo, sobre la escena de
 * ahora. Lo que se editó a mano después se respeta: si la IA cambió el alto y el color de una columna y tú la moviste, el alto
 * y el color vuelven y el lugar se queda; si tú cambiaste el color, el alto vuelve y el color se queda (y se dice). Puro:
 * devuelve la escena nueva (la misma, si no había nada que revertir). Una pieza nunca queda colgada de un padre que no está.
 */

export type { PiezaConservada };

export type ResultadoDeshacerTurno = {
  escena: Escena;
  /** Ids de las piezas que volvieron, en todo o en parte (y «sala» si se revirtió). */
  revertidas: string[];
  conservadas: PiezaConservada[];
};

export function deshacerTurno(actual: Escena, diff: DiffEscena): ResultadoDeshacerTurno {
  const revertidas: string[] = [];
  const conservadas: PiezaConservada[] = [];
  const tocadas = new Set<string>();
  const aQuitar = new Set<string>();
  let nodos = [...actual.nodos];
  const hay = (id: string) => nodos.find((n) => n.id === id);

  for (const c of diff.nodos) {
    const ahora = hay(c.id);
    if (c.tipo === "quitada") continue;
    if (!ahora) {
      // La IA la sumó o la cambió y ya no está: nadie la reclama, no se vuelve a poner lo que se quitó a mano.
      if (c.tipo === "cambiada") conservadas.push({ id: c.id, nombre: c.nombre, motivo: "quitada" });
      continue;
    }
    if (c.tipo === "nueva") {
      if (c.despues && sonIguales(ahora, c.despues)) aQuitar.add(c.id);
      else conservadas.push({ id: c.id, nombre: ahora.nombre, motivo: "editada" });
      continue;
    }
    if (!c.antes || !c.despues) continue;
    const r = fusionarNodo(ahora, c.despues, c.antes);
    if (r.cambiados.length) { nodos = nodos.map((n) => (n.id === c.id ? r.nodo : n)); tocadas.add(c.id); revertidas.push(c.id); }
    if (r.conservados.length) conservadas.push({ id: c.id, nombre: ahora.nombre, motivo: "editada", campos: r.conservados });
  }

  // Una pieza que la IA sumó no se quita si algo que se queda cuelga de ella (aunque lo que cuelga también sea de la IA).
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
  if (aQuitar.size) { nodos = nodos.filter((n) => !aQuitar.has(n.id)); revertidas.push(...aQuitar); }

  // Lo que la IA quitó vuelve, en el orden en que estaba, salvo que ya esté de vuelta.
  for (const c of diff.nodos.filter((x) => x.tipo === "quitada" && x.antes).sort((a, b) => a.indice - b.indice)) {
    if (!c.antes || hay(c.id)) continue;
    nodos.splice(Math.min(c.indice, nodos.length), 0, c.antes);
    tocadas.add(c.id); revertidas.push(c.id);
  }

  let sala = actual.sala;
  if (diff.sala) {
    if (sonIguales(actual.sala, diff.sala.despues)) { sala = salaNormalizada(diff.sala.antes); revertidas.push("sala"); }
    else if (!sonIguales(actual.sala, diff.sala.antes)) conservadas.push({ id: "sala", nombre: "Sala", motivo: "sala" });
  }

  nodos = sanearPadres(nodos, actual.nodos, tocadas, conservadas, revertidas);
  if (!revertidas.length) return { escena: actual, revertidas, conservadas };
  return { escena: { ...actual, sala, nodos }, revertidas, conservadas };
}

/** Lo que se le dice a la persona tras deshacer: qué volvió y qué se respetó. */
export function textoDeshacerTurno(r: ResultadoDeshacerTurno, nombreTurno: string): string {
  const volvieron = r.revertidas.length;
  const partes = [volvieron
    ? `Deshice ${nombreTurno}: ${volvieron} ${volvieron === 1 ? "pieza vuelta" : "piezas vueltas"} atrás.`
    : r.conservadas.length ? `No deshice nada en ${nombreTurno}.` : `No había nada que deshacer en ${nombreTurno}.`];
  for (const c of r.conservadas.slice(0, 3)) partes.push(`Conservé «${c.nombre}»${c.campos?.length ? ` (${c.campos.join(", ")})` : ""} como está: ${MOTIVO_TEXTO[c.motivo]}.`);
  if (r.conservadas.length > 3) partes.push(`Conservé otras ${r.conservadas.length - 3} piezas.`);
  return partes.join(" ");
}

/** Qué se puede hacer hoy con un turno, mirando la escena de ahora (no lo que se guardó): lo que los botones y la tarjeta muestran. */
export type EstadoTurnoEnEscena = {
  /** Algo de lo que hizo la IA sigue como lo dejó y se puede revertir. */
  deshacible: boolean;
  /** Se deshizo (con el botón o con Ctrl+Z) y se puede volver a aplicar. */
  rehacible: boolean;
  /** No hay nada que revertir ni que reaplicar: la persona cambió lo mismo a mano. */
  bloqueado: boolean;
};

export function estadoDeTurno(actual: Escena, diff: DiffEscena): EstadoTurnoEnEscena {
  const deshacer = deshacerTurno(actual, diff);
  if (deshacer.revertidas.length) return { deshacible: true, rehacible: false, bloqueado: false };
  const rehacer = aplicarDiff(actual, diff);
  const rehacible = rehacer.escena !== actual;
  return { deshacible: false, rehacible, bloqueado: !rehacible && deshacer.conservadas.length > 0 };
}
