import { muebleDeMesa, muebleDeNodo } from "./descripcion-mobiliario";
import { sillasDeMesaNodo, unidadesDeEscenografia } from "./mobiliario-asientos-mesa";
import type { Escena, EscenaArmada, NodoArmado, NodoEscena } from "./escena";
import { fraseDeEscenografia, propsEnIngles } from "./escenografia-ingles";
import { PREFIJO_MOBILIARIO } from "./render-ia";

/**
 * **El mobiliario como protagonista del texto de la foto con IA** (2026-10-09): en la conversación 3d-20261009-103125-92b58a el texto decía
 * «no other furniture, tables», «all plain and empty» y metía las mesas en una cláusula lateral, así que FLUX borró las mesas. Aquí las
 * mesas y las sillas pasan a ser lo principal de la escena, con su cuenta y su disposición («6 mesas numeradas de izquierda a derecha,
 * cada una con 4 sillas repartidas alrededor y un centro de globos encima»), y un centro de mesa se dice «encima de la mesa N», no «en el piso».
 * Puro y sin red.
 */

/** Un centro de globos que va sobre una mesa: su frase en inglés ya armada. */
export type CentroDeMesa = { mesaId: string; frase: string };

/** Hasta dónde de una mesa cuenta una silla suelta como suya (cm más allá de su borde). */
const ALCANCE_SILLA_CM = 110;
const MAX_GRUPOS = 4;

type MuebleArmado = { nodo: NodoEscena; hecho: NodoArmado };
type Mesa = { nodo: NodoEscena; x: number; z: number; radio: number; sillas: number; centros: string[] };

const centroDe = (h: NodoArmado) => ({ x: (h.caja.min.x + h.caja.max.x) / 2, z: (h.caja.min.z + h.caja.max.z) / 2 });

/** Los muebles del catálogo que son mesas o asientos (los que se cuentan como mobiliario) y están puestos. */
function mueblesDeSala(escena: Escena, armada: EscenaArmada): MuebleArmado[] {
  return escena.nodos.flatMap((nodo): MuebleArmado[] => {
    const m = muebleDeNodo(nodo);
    const hecho = armada.porNodo.find((n) => n.id === nodo.id);
    if (!m || !hecho || hecho.copias === 0 || (m.grupo !== "mesa" && m.grupo !== "asiento")) return [];
    return [{ nodo, hecho }];
  });
}

const sillas = (n: number) => `${n} ${n === 1 ? "chair" : "chairs"}`;

/**
 * La frase del mobiliario de la escena, o "" si no hay mesas ni asientos. Empieza con `PREFIJO_MOBILIARIO` (la marca que busca
 * `promptRender3d` para quitar el «no furniture, tables»). `centros` son los adornos que van sobre una mesa.
 */
export function mobiliarioEnIngles(escena: Escena, armada: EscenaArmada, centros: readonly CentroDeMesa[]): string {
  const muebles = mueblesDeSala(escena, armada);
  if (!muebles.length) return "";
  const porFrase = new Map<string, number>();
  for (const { nodo, hecho } of muebles) {
    if (nodo.pieza.tipo !== "escenografia") continue;
    const frase = fraseDeEscenografia(nodo.pieza);
    // Un grupo de sillas cuenta cada silla (24 sillas de 6 mesas son 24, no 6).
    if (frase) porFrase.set(frase, (porFrase.get(frase) ?? 0) + hecho.copias * unidadesDeEscenografia(nodo.pieza));
  }
  const inventario = propsEnIngles(porFrase, [...porFrase.values()].reduce((s, n) => s + n, 0));

  const mesas: Mesa[] = muebles
    .filter(({ nodo }) => muebleDeMesa(nodo) !== null)
    .map(({ nodo, hecho }): Mesa => {
      const { x, z } = centroDe(hecho);
      return { nodo, x, z, radio: Math.max(hecho.caja.max.x - hecho.caja.min.x, hecho.caja.max.z - hecho.caja.min.z) / 2, sillas: sillasDeMesaNodo(escena, nodo).total, centros: centros.filter((c) => c.mesaId === nodo.id).map((c) => c.frase) };
    })
    .sort((a, b) => a.x - b.x || a.z - b.z);

  // Las sillas sueltas son de la mesa más cercana si caen a su alcance.
  for (const { nodo, hecho } of muebles) {
    // Solo las sillas sueltas del catálogo: las de un grupo ya cuentan en su mesa (`sillasDeMesaNodo`).
    const m = muebleDeNodo(nodo);
    if (!m || !m.entrada || !m.esAsiento) continue;
    const { x, z } = centroDe(hecho);
    const cerca = mesas.map((mesa) => ({ mesa, d: Math.hypot(mesa.x - x, mesa.z - z) })).sort((a, b) => a.d - b.d)[0];
    if (cerca && cerca.d <= cerca.mesa.radio + ALCANCE_SILLA_CM) cerca.mesa.sillas += hecho.copias;
  }

  const numeradas = mesas.length > 1 ? `The ${mesas.length} tables are numbered 1 to ${mesas.length} from left to right` : "";
  const firma = (m: Mesa) => `${m.sillas}|${m.centros.join("+")}`;
  const grupos = new Map<string, number[]>();
  mesas.forEach((m, i) => grupos.set(firma(m), [...(grupos.get(firma(m)) ?? []), i + 1]));
  const clausulas = [...grupos.values()].slice(0, MAX_GRUPOS).map((numeros) => {
    const m = mesas[numeros[0]! - 1]!;
    const quien = grupos.size === 1 ? (mesas.length > 1 ? "each table" : "the table") : `table${numeros.length > 1 ? "s" : ""} ${numeros.join(", ")}`;
    const alrededor = m.sillas ? `${sillas(m.sillas)} evenly spaced around it` : "no chairs";
    const encima = m.centros.length ? `, and ${m.centros.map((c) => `a balloon centrepiece standing ON TOP of the table (${c})`).join(" and ")}` : "";
    return `${quien[0]!.toUpperCase()}${quien.slice(1)} has ${alrededor}${encima}`;
  });
  const disposicion = [numeradas, ...clausulas].filter(Boolean).join(". ");
  return `${PREFIJO_MOBILIARIO} ${inventario}, exactly as in the input${disposicion ? `. ${disposicion}` : ""}`;
}
