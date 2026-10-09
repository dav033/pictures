import { sonIguales, type DiffEscena } from "./diff-escenas";
import type { Escena, NodoEscena } from "./escena";

/**
 * **Deshacer un turno de la IA** (D-021): revierte SOLO las piezas que la IA tocó en ese turno, sobre la escena de ahora.
 * Lo que se editó a mano después se respeta: si una pieza que la IA cambió ya no está como la dejó la IA, se conserva la
 * versión manual y se dice cuál. Así «Deshacer turno» no borra trabajo (el viejo «Deshacer lo de la IA» volvía a la
 * escena entera de antes del pedido). Puro: devuelve la escena nueva (la misma, si no había nada que revertir).
 */

export type PiezaConservada = { id: string; nombre: string; motivo: "editada" | "quitada" | "en_uso" | "sala" };

export type ResultadoDeshacerTurno = {
  escena: Escena;
  /** Ids de las piezas que volvieron a como estaban (y «sala» si se revirtió). */
  revertidas: string[];
  conservadas: PiezaConservada[];
};

const MOTIVO_TEXTO: Readonly<Record<PiezaConservada["motivo"], string>> = {
  editada: "la editaste a mano después",
  quitada: "la quitaste a mano después",
  en_uso: "algo que pusiste después depende de ella",
  sala: "cambiaste la sala después",
};

export function deshacerTurno(actual: Escena, diff: DiffEscena): ResultadoDeshacerTurno {
  const revertidas: string[] = [];
  const conservadas: PiezaConservada[] = [];
  let nodos = [...actual.nodos];
  const hay = (id: string) => nodos.find((n) => n.id === id);
  const idsNuevas = new Set(diff.nodos.filter((c) => c.tipo === "nueva").map((c) => c.id));

  for (const c of diff.nodos) {
    const ahora = hay(c.id);
    if (c.tipo === "quitada") continue;
    if (!ahora) {
      // La IA la sumó o la cambió y ya no está: nadie la reclama, no se vuelve a poner lo que se quitó a mano.
      if (c.tipo === "cambiada") conservadas.push({ id: c.id, nombre: c.nombre, motivo: "quitada" });
      continue;
    }
    if (!c.despues || !sonIguales(ahora, c.despues)) { conservadas.push({ id: c.id, nombre: ahora.nombre, motivo: "editada" }); continue; }
    if (c.tipo === "nueva") {
      const dependen = nodos.some((n) => n.id !== c.id && !idsNuevas.has(n.id) && "padreId" in n.colocacion && n.colocacion.padreId === c.id);
      if (dependen) { conservadas.push({ id: c.id, nombre: ahora.nombre, motivo: "en_uso" }); continue; }
      nodos = nodos.filter((n) => n.id !== c.id);
    } else if (c.antes) {
      const volver: NodoEscena = c.antes;
      nodos = nodos.map((n) => (n.id === c.id ? volver : n));
    }
    revertidas.push(c.id);
  }

  // Lo que la IA quitó vuelve, en el orden en que estaba, salvo que ya esté de vuelta.
  for (const c of [...diff.nodos].filter((x) => x.tipo === "quitada" && x.antes).sort((a, b) => a.indice - b.indice)) {
    if (!c.antes || hay(c.id)) continue;
    nodos.splice(Math.min(c.indice, nodos.length), 0, c.antes);
    revertidas.push(c.id);
  }

  let sala = actual.sala;
  if (diff.sala) {
    if (sonIguales(actual.sala, diff.sala.despues)) { sala = diff.sala.antes; revertidas.push("sala"); }
    else conservadas.push({ id: "sala", nombre: "Sala", motivo: "sala" });
  }

  if (!revertidas.length) return { escena: actual, revertidas, conservadas };
  return { escena: { ...actual, sala, nodos }, revertidas, conservadas };
}

/** Lo que se le dice a la persona tras deshacer: qué volvió y qué se respetó. */
export function textoDeshacerTurno(r: ResultadoDeshacerTurno, nombreTurno: string): string {
  const volvieron = r.revertidas.length;
  const partes = [volvieron
    ? `Deshice ${nombreTurno}: ${volvieron} ${volvieron === 1 ? "cambio vuelto" : "cambios vueltos"} atrás.`
    : `No había nada que deshacer de ${nombreTurno}.`];
  for (const c of r.conservadas.slice(0, 3)) partes.push(`Conservé «${c.nombre}» como está: ${MOTIVO_TEXTO[c.motivo]}.`);
  if (r.conservadas.length > 3) partes.push(`Conservé otras ${r.conservadas.length - 3} piezas editadas por ti.`);
  return partes.join(" ");
}
