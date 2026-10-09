import type { Colocacion } from "./escena";
import type { AcabadoEscenografia } from "./escenografia";
import { muebleDe } from "./mobiliario-catalogo";
import { puestosAlrededor, puestosEnFila } from "./mobiliario-disposicion";
import { hexDeColor } from "./mobiliario-colores";
import { conTextoPieza, MAX_TEXTO_MUEBLE, opcionesDeMueble, piezaDeMueble } from "./mobiliario-pieza";
import type { MuebleCatalogo } from "./mobiliario-tipos";
import type { ColorLeido, PiezaLeida } from "./lectura-foto";
import { acabadoRotuloLeido, avisoDeTexto } from "./rotulos";
import type { Pieza } from "./piezas";

/**
 * **Mobiliario leído de una foto** (`compilar-lectura.ts`, pieza «fondo» con el id de una silla, mesa, sofá, aro…): se
 * arma con el mismo generador del catálogo a la medida leída (acotada a un rango razonable de la de catálogo, para que un
 * error de lectura no dé una silla de 3 m), con los colores y el acabado leídos, y se coloca en el piso delante de la pared
 * (o en la pared, el neón). Con `cantidad` > 1 salen en fila a lo ancho de lo leído, o —si es un asiento y la foto trae una
 * mesa— alrededor de ella. Lo que no se pudo respetar queda en las notas.
 */

export type FondoLeido = Extract<PiezaLeida, { tipo: "fondo" }>;

/** El color de las letras de un fondo leído (`colorTexto`: nombre o #hex) o undefined si no vino o no se reconoce (queda dicho). */
export function tintaLeida(p: Pick<FondoLeido, "id" | "colorTexto">, notas: string[]): string | undefined {
  if (!p.colorTexto) return undefined;
  try { return hexDeColor(p.colorTexto, notas); } catch { notas.push(`${p.id.replace(/_/g, " ")}: no reconocí el color del texto «${p.colorTexto}»; usé el que se lee sobre el fondo.`); return undefined; }
}
export type NodoMobiliario = { base: string; nombre: string; pieza: Pieza; colocacion: Colocacion };
/** La medida de lo leído, ya en cm de la sala (`muroZ`: dónde está la pared del fondo). */
export type MedidaLeida = { anchoCm: number; altoCm: number; xCm: number; yBaseCm: number; muroZ: number };
/** Una mesa de la foto donde se sientan los asientos leídos: su centro y su caja en el piso. */
export type MesaLeida = { x: number; z: number; anchoCm: number; fondoCm: number };

const r0 = (n: number) => Math.round(n);
const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Las mesas donde se sienta la gente (no la de cóctel, la de centro, el carrito ni la «mesa con mantel» de postres o de la torta). */
const MESA_PARA_SENTARSE = /^(mesa_redonda|mesa_redonda_mantel|mesa_imperial|mesa_imperial_mantel)$/;

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

/** La mesa donde se sienta un grupo de asientos leído: la más cercana en x de las que se solapan con lo que ocupa el grupo, o null (entonces van en fila). */
function mesaDelGrupo(mesas: readonly MesaLeida[], x: number, anchoCm: number): MesaLeida | null {
  const solapan = mesas.filter((m) => Math.abs(m.x - x) < (m.anchoCm + anchoCm) / 2);
  return solapan.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0] ?? null;
}

/** Los nodos de un mueble leído, o null si el id no es de mobiliario. */
export function mobiliarioLeido(p: FondoLeido, medida: MedidaLeida, notas: string[], mesas: readonly MesaLeida[]): NodoMobiliario[] | null {
  const mueble = muebleDe(p.id);
  if (!mueble) return null;
  const idBase = p.id.replace(/_/g, "-");
  const cuantos = Math.max(1, p.cantidad ?? 1);
  const pared = mueble.lugar === "pared";
  // Lo que flota en el aire (el nombre de acrílico delante de un aro) también va de uno en uno.
  const flota = mueble.flotaCm !== undefined;
  if ((pared || flota) && cuantos > 1) notas.push(`${mueble.nombre}: los ${pared ? "de pared" : "que flotan"} van de uno en uno; puse solo uno de los ${cuantos} leídos.`);
  const n = pared || flota ? 1 : cuantos;
  const t = medidasDe(mueble, medida, n > 1, notas);
  const tinta = tintaLeida(p, notas);
  // El color del texto aparte (colorTexto) es el de las letras del nombre de acrílico (su color 1) o la luz de un neón (su color 2); si la foto
  // no lo dice, los colores leídos. El material del nombre de acrílico sale del acabado de las letras con la misma regla que el de un panel.
  const iTinta = mueble.acabadosPropios ? 0 : mueble.conTexto ? 1 : -1;
  // Cada color del mueble se llena siempre: el de la tinta con colorTexto aunque la foto traiga menos colores (antes el corte por
  // los leídos perdía la luz de un neón leído con un solo color). Con colorTexto y menos colores leídos que los del mueble, los
  // leídos son ambiguos (suelen ser la misma luz): el resto queda con los de catálogo.
  const ambiguos = iTinta >= 0 && Boolean(tinta) && p.colores.length < mueble.coloresDe.length;
  if (ambiguos && p.colores.length) notas.push(`${mueble.nombre}: con el color del texto aparte y solo ${p.colores.length} color(es) leído(s), el resto va con los de catálogo.`);
  // Solo hasta el color de la tinta: lo que la foto no dice queda sin poner (los secundarios siguen al primero, como siempre).
  const largo = Math.min(mueble.coloresDe.length, Math.max(p.colores.length, tinta && iTinta >= 0 ? iTinta + 1 : 0));
  const colores = Array.from({ length: largo }, (_, i) => (i === iTinta && tinta ? tinta : ambiguos ? mueble.colores[i]! : p.colores[i]?.hex ?? mueble.colores[i]!));
  const acabado = mueble.acabadosPropios ? (acabadoRotuloLeido(p.acabadoTexto ?? p.colores[0]?.acabado) === "acrilico_espejo" ? "metal" as const : "mate" as const) : p.colores[0] ? ACABADO[p.colores[0].acabado] : undefined;
  if (p.acabadoTexto && mueble.conTexto && !mueble.acabadosPropios) notas.push(`${mueble.nombre}: el acabado del texto (${p.acabadoTexto}) no aplica a un letrero de luz: lo ignoré.`);
  const sinRotulo = piezaDeMueble(mueble, opcionesDeMueble(mueble, { ...t, colores, ...(acabado ? { acabado } : {}), ...(mueble.conTexto && p.texto ? { texto: p.texto.slice(0, MAX_TEXTO_MUEBLE) } : {}) }));
  // Un marco con un nombre: el texto leído es su rótulo, con el color y el acabado que se leyeron en las letras (sin color, el que se lee sobre la tela).
  const pieza = mueble.rotulable && p.texto && sinRotulo.tipo === "escenografia" ? conTextoPieza(sinRotulo, { texto: p.texto, acabado: acabadoRotuloLeido(p.acabadoTexto), ...(tinta ? { color: tinta } : {}) }) : sinRotulo;
  const avisoTexto = (mueble.conTexto || mueble.rotulable) && p.texto ? avisoDeTexto(p.texto, mueble.lineasTexto ?? (mueble.rotulable ? 3 : 1)) : null;
  if (avisoTexto) notas.push(`${mueble.nombre}: ${avisoTexto}`);
  const nodo = (i: number, colocacion: Colocacion): NodoMobiliario => ({ base: idBase, nombre: n > 1 ? `${mueble.nombre} ${i + 1}` : mueble.nombre, pieza, colocacion });
  if (pared) return [nodo(0, { en: "pared", pared: "fondo", aLoLargoCm: r0(medida.xCm), alturaCm: r0(Math.max(0, medida.yBaseCm)) })];
  // En el aire: a la altura que se lee (si la foto no la da, la de siempre) y delante del aro, a su retiro.
  if (flota) return [nodo(0, { en: "libre", xCm: r0(medida.xCm), yCm: r0(medida.yBaseCm > 20 ? medida.yBaseCm : mueble.flotaCm!), zCm: medida.muroZ + (mueble.retiroCm ?? 120), giroGrados: 0 })];
  const mesa = n > 1 && mueble.asiento ? mesaDelGrupo(mesas, medida.xCm, medida.anchoCm) : null;
  if (mesa) {
    const puestos = puestosAlrededor({ cx: mesa.x, cz: mesa.z, anchoCm: mesa.anchoCm, fondoCm: mesa.fondoCm, cantidad: n, holguraCm: t.fondoCm / 2 + 8, frenteCm: t.anchoCm });
    if (puestos.length < n) notas.push(`${mueble.nombre}: alrededor de la mesa solo caben ${puestos.length} de ${n}.`);
    return puestos.map((q, i) => nodo(i, { en: "piso", xCm: r0(q.x), zCm: q.z, giroGrados: q.giroGrados }));
  }
  const z = medida.muroZ + (mueble.retiroCm ?? 120);
  const separacionCm = n > 1 ? Math.max(t.anchoCm + 6, (medida.anchoCm - t.anchoCm) / (n - 1)) : 0;
  return puestosEnFila({ cx: medida.xCm, cz: z, cantidad: n, separacionCm }).map((q, i) => nodo(i, { en: "piso", xCm: r0(q.x), zCm: q.z, giroGrados: 0 }));
}
