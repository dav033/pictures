import type { EscenaArmada } from "../escena";
import { SEPARADOR_FLORES, piezaDeNodo } from "./ids-nodos";
import type { PiezaEspec } from "./espec-cliente-v1";
import type { BomLinea } from "./resultado-motor-v1";

/**
 * La lista de materiales del motor: por pieza y total. Orden fijo (formato por su diámetro y luego código) para que la
 * misma espec dé siempre los mismos bytes. Las flores de globo se cuentan de la espec (`lineasDeFlores`), no de los
 * nodos que se alcanzaron a colgar: los nodos de flor solo sirven para dibujar.
 */
type Linea = { formatoId: string; codigo: string; cantidad: number };

function numeroDeFormato(formatoId: string): [string, number] {
  const m = /^([A-Za-z]+)-?(\d+)$/.exec(formatoId);
  return m ? [m[1]!, Number(m[2])] : [formatoId, 0];
}

function comparar(a: Linea, b: Linea): number {
  const [ta, na] = numeroDeFormato(a.formatoId), [tb, nb] = numeroDeFormato(b.formatoId);
  return ta.localeCompare(tb) || na - nb || a.codigo.localeCompare(b.codigo);
}

export function sumarLineas(...listas: ReadonlyArray<readonly Linea[]>): BomLinea[] {
  const suma = new Map<string, Linea>();
  for (const l of listas.flat()) {
    if (l.cantidad <= 0) continue;
    const clave = `${l.formatoId}|${l.codigo}`;
    const previa = suma.get(clave);
    suma.set(clave, previa ? { ...previa, cantidad: previa.cantidad + l.cantidad } : { formatoId: l.formatoId, codigo: l.codigo, cantidad: l.cantidad });
  }
  return [...suma.values()].sort(comparar);
}

export function bomDeEscena(armada: EscenaArmada, declaradas: readonly PiezaEspec[], flores: Readonly<Record<string, readonly BomLinea[]>>): { porPieza: Record<string, BomLinea[]>; total: BomLinea[] } {
  const porPieza: Record<string, BomLinea[]> = {};
  for (const nodo of armada.porNodo) {
    if (nodo.id.includes(SEPARADOR_FLORES)) continue;
    const id = piezaDeNodo(nodo.id);
    porPieza[id] = sumarLineas(porPieza[id] ?? [], nodo.materiales);
  }
  for (const [id, lineas] of Object.entries(flores)) porPieza[id] = sumarLineas(porPieza[id] ?? [], lineas);
  for (const pieza of declaradas) porPieza[pieza.id] = sumarLineas(pieza.declarada?.materiales ?? []);
  const ordenado = Object.fromEntries(Object.entries(porPieza).sort(([a], [b]) => a.localeCompare(b)));
  return { porPieza: ordenado, total: sumarLineas(...Object.values(ordenado)) };
}
