import type { Colocacion } from "./escena";
import type { AcabadoEscenografia } from "./escenografia";
import { muebleDe } from "./mobiliario-catalogo";
import { puestosAlrededor, puestosEnFila } from "./mobiliario-disposicion";
import { opcionesDeMueble, piezaDeMueble } from "./mobiliario-pieza";
import type { MuebleCatalogo } from "./mobiliario-tipos";
import type { ColorLeido, PiezaLeida } from "./lectura-foto";
import type { Pieza } from "./piezas";

/**
 * **Mobiliario leído de una foto** (`compilar-lectura.ts`, pieza «fondo» con el id de una silla, mesa, sofá, aro…): se
 * arma con el mismo generador del catálogo a la medida leída (acotada a un rango razonable de la de catálogo, para que un
 * error de lectura no dé una silla de 3 m), con los colores y el acabado leídos, y se coloca en el piso delante de la pared
 * (o en la pared, el neón). Con `cantidad` > 1 salen en fila a lo ancho de lo leído, o —si es un asiento y la foto trae una
 * mesa— alrededor de ella. Lo que no se pudo respetar queda en las notas.
 */

export type FondoLeido = Extract<PiezaLeida, { tipo: "fondo" }>;
export type NodoMobiliario = { base: string; nombre: string; pieza: Pieza; colocacion: Colocacion };
/** La medida de lo leído, ya en cm de la sala (`muroZ`: dónde está la pared del fondo). */
export type MedidaLeida = { anchoCm: number; altoCm: number; xCm: number; yBaseCm: number; muroZ: number };
/** Una mesa de la foto donde se sientan los asientos leídos: su centro y su caja en el piso. */
export type MesaLeida = { x: number; z: number; anchoCm: number; fondoCm: number };

const r0 = (n: number) => Math.round(n);
const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Las mesas donde se sienta la gente (no la de cóctel, la de centro ni el carrito). */
const MESA_PARA_SENTARSE = /^(mesa_mantel|mesa_redonda|mesa_redonda_mantel|mesa_imperial|mesa_imperial_mantel)$/;

const ACABADO: Readonly<Partial<Record<ColorLeido["acabado"], AcabadoEscenografia>>> = { mate: "mate", brillante: "brillante", perla: "satinado", cromado: "metal" };

/** Medidas finales de un mueble leído: lo leído acotado a 0,5–2,2 veces el catálogo (el ancho, el de catálogo si son varios en fila). */
function medidasDe(m: MuebleCatalogo, medida: MedidaLeida, enFila: boolean, notas: string[]) {
  const b = m.medidas;
  const anchoCm = enFila ? b.anchoCm : r0(entre(medida.anchoCm, b.anchoCm * 0.5, b.anchoCm * 2.2));
  const altoCm = r0(entre(medida.altoCm, b.altoCm * 0.5, b.altoCm * 2.2));
  if (!enFila && anchoCm !== r0(medida.anchoCm)) notas.push(`${m.nombre}: el ancho leído (${r0(medida.anchoCm)} cm) no es razonable; quedó en ${anchoCm} cm.`);
  if (altoCm !== r0(medida.altoCm)) notas.push(`${m.nombre}: el alto leído (${r0(medida.altoCm)} cm) no es razonable; quedó en ${altoCm} cm.`);
  return { anchoCm, fondoCm: r0(b.fondoCm * entre(anchoCm / b.anchoCm, 0.7, 1.5)), altoCm };
}

/** La mesa de sentarse que sale de una pieza leída (con su sitio en el piso), o null si no es una. */
export function mesaLeida(p: FondoLeido, medida: MedidaLeida): MesaLeida | null {
  if (!MESA_PARA_SENTARSE.test(p.id)) return null;
  const m = muebleDe(p.id);
  const z = medida.muroZ + (m?.retiroCm ?? 120);
  if (!m) return { x: medida.xCm, z, anchoCm: medida.anchoCm, fondoCm: 75 };
  const t = medidasDe(m, medida, false, []);
  return { x: medida.xCm, z, anchoCm: t.anchoCm, fondoCm: t.fondoCm };
}

/** Los nodos de un mueble leído, o null si el id no es de mobiliario. */
export function mobiliarioLeido(p: FondoLeido, medida: MedidaLeida, notas: string[], mesa: MesaLeida | null): NodoMobiliario[] | null {
  const mueble = muebleDe(p.id);
  if (!mueble) return null;
  const idBase = p.id.replace(/_/g, "-");
  const cuantos = Math.max(1, p.cantidad ?? 1);
  const pared = mueble.lugar === "pared";
  if (pared && cuantos > 1) notas.push(`${mueble.nombre}: los de pared van de uno en uno; puse solo uno de los ${cuantos} leídos.`);
  const n = pared ? 1 : cuantos;
  const t = medidasDe(mueble, medida, n > 1, notas);
  const colores = p.colores.slice(0, mueble.colores.length).map((c) => c.hex);
  const acabado = p.colores[0] ? ACABADO[p.colores[0].acabado] : undefined;
  const pieza = piezaDeMueble(mueble, opcionesDeMueble(mueble, { ...t, colores, ...(acabado ? { acabado } : {}), ...(mueble.conTexto && p.texto ? { texto: p.texto } : {}) }));
  const nodo = (i: number, colocacion: Colocacion): NodoMobiliario => ({ base: idBase, nombre: n > 1 ? `${mueble.nombre} ${i + 1}` : mueble.nombre, pieza, colocacion });
  if (pared) return [nodo(0, { en: "pared", pared: "fondo", aLoLargoCm: r0(medida.xCm), alturaCm: r0(Math.max(0, medida.yBaseCm)) })];
  if (n > 1 && mueble.asiento && mesa) {
    const puestos = puestosAlrededor({ cx: mesa.x, cz: mesa.z, anchoCm: mesa.anchoCm, fondoCm: mesa.fondoCm, cantidad: n, holguraCm: t.fondoCm / 2 + 8, frenteCm: t.anchoCm });
    if (puestos.length < n) notas.push(`${mueble.nombre}: alrededor de la mesa solo caben ${puestos.length} de ${n}.`);
    return puestos.map((q, i) => nodo(i, { en: "piso", xCm: r0(q.x), zCm: q.z, giroGrados: q.giroGrados }));
  }
  const z = medida.muroZ + (mueble.retiroCm ?? 120);
  const separacionCm = n > 1 ? Math.max(t.anchoCm + 6, (medida.anchoCm - t.anchoCm) / (n - 1)) : 0;
  return puestosEnFila({ cx: medida.xCm, cz: z, cantidad: n, separacionCm }).map((q, i) => nodo(i, { en: "piso", xCm: r0(q.x), zCm: q.z, giroGrados: 0 }));
}
