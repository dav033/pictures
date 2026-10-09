import { armarEscena, type Colocacion, type Escena } from "./escena";
import { insertarEnEscena, type ItemBiblioteca } from "./biblioteca";
import { buscarEnBiblioteca } from "./herramientas-escena-biblioteca";
import { MAX_NODOS } from "./limites-escena";
import { anotarPieza } from "./salon-registro";
import { recolorearConPaleta } from "./herramientas-escena-recolor";
import { coloresReconocidos, enPiso } from "./salon-piezas";
import type { ZonasSalon } from "./salon-zonas";
import { celebracionesDeTexto } from "../taller/taxonomia-celebraciones";

/**
 * **Ideas reales de la biblioteca para el fondo de fotos** (REQ-008): además de la composición, el evento trae de 1 a 3 piezas de la
 * biblioteca (estructuras y conjuntos de una sola pieza principal, de pie en el piso) que coinciden con la temática y la ocasión, puestas
 * a los lados del fondo, ya como piezas normales y editables. Así dos temáticas dan resultados distintos con piezas que otros hicieron
 * de verdad. Es determinista (la misma búsqueda da los mismos items y la semilla del pedido elige cuáles y cuántos). Lo que no cabe
 * en la sala o en el tope de piezas se salta; no se inventa nada si la biblioteca no tiene qué ofrecer.
 */

const OCASION_DE_TIPO: Readonly<Record<string, string>> = {
  boda: "boda", quince: "quince años", cumpleanos: "cumpleaños", bautizo: "bautizo", baby_shower: "baby shower", corporativo: "evento corporativo", graduacion: "graduación", halloween: "halloween",
};
const MAX_IDEAS = 3;
/** Sitio que se deja siempre libre de piezas del usuario y del salón en el tope de piezas. */
const RESERVA_NODOS = 12;

/** Los items que se pueden poner de pie en el piso a un lado del fondo: una pieza o un conjunto, no una escena entera ni algo de pared o techo. */
const deIdea = (item: ItemBiblioteca): Colocacion | null => {
  const c = item.contenido;
  if (item.tipo === "escena" || item.tipo === "utileria") return null;
  const sugerida = c.tipo === "pieza" ? c.sugerida : c.tipo === "conjunto" ? c.conjunto.sugerida : null;
  return sugerida?.en === "piso" ? sugerida : null;
};

/** Con tema, solo lo que coincide con el tema (no se rellena con lo de la ocasión: un safari no lleva un arco de corazones neón); sin tema, lo de la ocasión. */
function candidatas(tipo: string, tematica: string | undefined): ItemBiblioteca[] {
  const ocasion = celebracionesDeTexto(OCASION_DE_TIPO[tipo] ?? "")[0]?.id;
  const busquedas = tematica?.trim() ? [{ texto: tematica, ocasion, limite: 15 }, { texto: tematica, limite: 15 }] : ocasion ? [{ ocasion, limite: 15 }] : [];
  for (const b of busquedas) {
    const items = buscarEnBiblioteca(b).filter((i) => deIdea(i) !== null);
    if (items.length) return items;
  }
  return [];
}

/** Pasa las piezas puestas a la paleta del evento; `null` si alguna no se deja recolorear. */
function recolorearIdea(escena: Escena, ids: readonly string[], paleta: readonly string[]): Escena | null {
  try {
    const notas: string[] = [];
    return { ...escena, nodos: escena.nodos.map((n) => (ids.includes(n.id) ? { ...n, pieza: recolorearConPaleta(n.pieza, paleta, notas, "uso").pieza } : n)) };
  } catch { return null; }
}

/** Pone las ideas de la biblioteca a los lados del fondo de fotos, anotadas en el registro como adornos de esa zona. */
export function ponerIdeasDeBiblioteca(escena: Escena, zonas: ZonasSalon, p: { tipo: string; tematica?: string; semilla: number; colores: readonly string[]; /** Sin mesas detrás del fondo: se puede poner una fila delante cuando a los lados no hay sitio. */ alFrente: boolean }, notas: string[]): Escena {
  const fondo = zonas.fondo;
  const items = candidatas(p.tipo, p.tematica);
  if (!fondo) return escena;
  if (!items.length) { notas.push(p.tematica?.trim() ? `La biblioteca no tiene ideas de «${p.tematica.trim()}» que se pongan de pie: dejé solo la composición del tema.` : "La biblioteca no tiene ideas de esa ocasión para poner de pie."); return escena; }
  const paleta = coloresReconocidos(p.colores, []);
  let puestas = 0;
  const cuantas = Math.min(MAX_IDEAS, 1 + (p.semilla >>> 5) % MAX_IDEAS, items.length);
  const inicio = (p.semilla >>> 11) % Math.min(items.length, 6);
  const elegidas = Array.from({ length: cuantas }, (_, i) => items[(inicio + i) % items.length]!);
  const lado = fondo.anchoCm / 2 + 110 + 170;
  let actual = escena;
  elegidas.forEach((item, i) => {
    if (actual.nodos.length + RESERVA_NODOS >= MAX_NODOS) return;
    const signo = i % 2 === 0 ? -1 : 1, fila = Math.floor(i / 2);
    // A los lados del fondo si caben; si no (una sala angosta) y no hay mesas, en una fila delante, un poco más afuera cada vez.
    const alLado = lado + fila * 140 <= actual.sala.anchoCm / 2 - 60;
    if (!alLado && !p.alFrente) { notas.push(`«${item.nombre}» no cupo a los lados del fondo (la sala es angosta y hay mesas): no la puse.`); return; }
    const x = signo * (alLado ? lado + fila * 140 : Math.min(lado, actual.sala.anchoCm / 2 - 100)), z = fondo.zCm + (alLado ? 70 : 230 + fila * 150);
    const puesta = insertarEnEscena(actual, item, enPiso(fondo.xCm + x, z));
    // Con los colores del evento, no los de la biblioteca (esos globos van a la lista de compra); si no se puede recolorear, no se pone.
    const recoloreada = recolorearIdea(puesta.escena, puesta.ids, paleta);
    if (!recoloreada) { notas.push(`«${item.nombre}» no se pudo pasar a los colores del evento: no la puse.`); return; }
    const caja = armarEscena(recoloreada).porNodo.filter((n) => puesta.ids.includes(n.id) && n.copias > 0);
    if (caja.some((n) => n.caja.max.y > actual.sala.altoCm || n.caja.min.x < -actual.sala.anchoCm / 2 || n.caja.max.x > actual.sala.anchoCm / 2)) { notas.push(`«${item.nombre}» no cabe en la sala: no la puse.`); return; }
    actual = puesta.ids.reduce((e, id) => anotarPieza(e, id, { zona: "fondo_fotos", rol: "adorno" }), recoloreada);
    puestas += 1;
    notas.push(`Idea de la biblioteca: «${item.nombre}» (${item.id}), en los colores del evento.`);
  });
  if (!puestas) notas.push("Ninguna idea de la biblioteca cupo o se pudo pasar a los colores del evento: quedó solo la composición.");
  return actual;
}
