import { armarEscena, descendientes, type Escena, type EscenaArmada, type NodoArmado } from "../escena";
import type { Encuadre } from "../encuadre-foto";
import { compilarLectura } from "../compilar-lectura";
import type { LecturaFoto } from "../lectura-foto";
import { centroDe } from "../letras";
import type { Vec3 } from "../modulos";
import { camaraNumerica, enCuadro, largoEnPantalla, proyectar, type CamaraNumerica } from "../proyeccion-foto";
import type { Rechazo } from "./motivos";

/**
 * **Revisión de la estructura de una ronda de refinado** (REQ-001 paso 9, P-016), pura y sin red. Los fallos que se vieron en
 * las pruebas reales con la foto 07 (el «LOVE» bajado al piso, el «LOVE» tapado por la guirnalda, la silueta achicada) y los que
 * un modelo puede causar por otros caminos:
 *  - una pieza que colgaba (su parte baja a más de 40 cm del piso) acaba con la parte baja a menos de 15 cm, sea cual sea la
 *    colocación de antes y de después (pared, piso, ancla, sobre otra pieza, techo, libre): se mide la caja de la pieza armada
 *    en el mundo, no el dato de colocación;
 *  - una pieza visible desaparece (se quitó, o quedó sin copias);
 *  - ninguna pieza queda del todo tapada por otra más cercana a la cámara (su caja en pantalla, cubierta por los globos de
 *    una pieza que no es su padre ni su hija);
 *  - el total de globos baja de lo permitido.
 * Quitar piezas o globos solo se permite hasta donde la escena se pasa de lo que dice la lectura de la foto (`Referencia`),
 * que decide el servidor: el reporte del propio modelo («sobran piezas») no abre la puerta.
 */

export const ALTURA_COLGADA_CM = 40;
export const ALTURA_PISO_CM = 15;
export const MAX_REDUCCION_GLOBOS = 0.3;
/** Qué parte de los puntos de una pieza tiene que estar cubierta para decir que no se ve. */
export const FRACCION_TAPADA = 0.85;
/** El globo tapa lo que cae dentro de este tanto de su radio en pantalla (un disco inscrito en la caja del globo). */
const FACTOR_DISCO = 0.9;
const MALLA_PUNTOS = 6;

/** Lo que tendría la escena si se armara fielmente la lectura de la foto: hasta ahí se puede quitar sin que sea un error. */
export type Referencia = { piezas: number; globos: number };

/** La escena que sale de compilar la lectura de la foto, medida: cuántas piezas visibles y cuántos globos tiene. */
export function referenciaDeLectura(lectura: LecturaFoto): Referencia {
  const armada = armarEscena(compilarLectura(lectura).escena);
  return { piezas: piezasVisibles(armada).size, globos: armada.globos.length };
}

type Visible = { nombre: string; bajoCm: number };

/** Las piezas que se ven en la escena armada: con copias y con una caja medible en el mundo (su parte baja es `bajoCm`). */
function piezasVisibles(armada: EscenaArmada): Map<string, Visible> {
  const visibles = new Map<string, Visible>();
  for (const n of armada.porNodo) {
    if (n.copias > 0 && Number.isFinite(n.caja.min.y) && Number.isFinite(n.caja.max.y)) visibles.set(n.id, { nombre: n.nombre, bajoCm: n.caja.min.y });
  }
  return visibles;
}

type Disco = { nodo: string; x: number; y: number; z: number; rCm: number; rPantalla: number };

/** Los puntos del mundo con que se mide si una pieza se ve: el centro de cada globo o, sin globos (foil, escenografía), una malla sobre la cara de su caja. */
function puntosDe(n: NodoArmado): Vec3[] {
  if (n.globos.length) return n.globos.map(centroDe);
  const { min, max } = n.caja;
  if (![min.x, min.y, max.x, max.y, max.z].every(Number.isFinite)) return [];
  const puntos: Vec3[] = [];
  for (let i = 0; i < MALLA_PUNTOS; i++) for (let j = 0; j < MALLA_PUNTOS; j++) {
    puntos.push({ x: min.x + ((max.x - min.x) * (i + 0.5)) / MALLA_PUNTOS, y: min.y + ((max.y - min.y) * (j + 0.5)) / MALLA_PUNTOS, z: max.z });
  }
  return puntos;
}

function discosDe(armada: EscenaArmada, camara: CamaraNumerica): Disco[] {
  const discos: Disco[] = [];
  for (const n of armada.porNodo) for (const g of n.globos) {
    const c = centroDe(g), p = proyectar(camara, c);
    if (p) discos.push({ nodo: n.id, x: p.x, y: p.y, z: c.z, rCm: g.infladoCm / 2, rPantalla: largoEnPantalla(camara, g.infladoCm / 2, p.prof) });
  }
  return discos;
}

/** Las piezas (ids) que no se ven en la captura: casi todos sus puntos quedan bajo un globo más cercano que no es de su familia. */
export function piezasOcultas(escena: Escena, encuadre: Encuadre, armada: EscenaArmada = armarEscena(escena)): Set<string> {
  const camara = camaraNumerica(encuadre, escena.sala);
  const discos = discosDe(armada, camara);
  const ocultas = new Set<string>();
  for (const n of armada.porNodo) {
    if (n.copias === 0) continue;
    // El padre y las hijas de una pieza (una letra sobre la guirnalda) van pegados a ella: no la tapan.
    const familia = new Set([...descendientes(escena, n.id), ...escena.nodos.filter((o) => descendientes(escena, o.id).has(n.id)).map((o) => o.id)]);
    let vistos = 0, tapados = 0;
    for (const punto of puntosDe(n)) {
      const p = proyectar(camara, punto);
      if (!p || !enCuadro(camara, p)) continue;
      vistos++;
      if (discos.some((d) => !familia.has(d.nodo) && d.z - punto.z > d.rCm * 0.5 && Math.hypot(d.x - p.x, d.y - p.y) < d.rPantalla * FACTOR_DISCO)) tapados++;
    }
    if (vistos > 0 && tapados / vistos >= FRACCION_TAPADA) ocultas.add(n.id);
  }
  return ocultas;
}

/** Las piezas que colgaban y la ronda dejó casi en el piso, con la altura de su parte baja en el mundo antes y después. */
export function piezasQueBajaron(antes: EscenaArmada, despues: EscenaArmada): string[] {
  const hoy = piezasVisibles(despues);
  const bajaron: string[] = [];
  for (const [id, v] of piezasVisibles(antes)) {
    const ahora = hoy.get(id);
    if (ahora && v.bajoCm > ALTURA_COLGADA_CM && ahora.bajoCm < ALTURA_PISO_CM) bajaron.push(`${v.nombre} (de ${Math.round(v.bajoCm)} cm a ${Math.round(ahora.bajoCm)} cm)`);
  }
  return bajaron;
}

/** Los nombres de las piezas visibles antes que ya no se ven después. */
export function piezasQuitadas(antes: EscenaArmada, despues: EscenaArmada): string[] {
  const hoy = piezasVisibles(despues);
  return [...piezasVisibles(antes)].filter(([id]) => !hoy.has(id)).map(([, v]) => v.nombre);
}

/** Revisa que la ronda no empeore la estructura; `null` si no hay nada que reprochar. Sin `referencia` no se permite quitar nada. */
export function revisarEstructura(antes: Escena, despues: Escena, encuadre: Encuadre, referencia: Referencia | null = null): Rechazo | null {
  const armadaAntes = armarEscena(antes), armadaDespues = armarEscena(despues);

  const bajaron = piezasQueBajaron(armadaAntes, armadaDespues);
  if (bajaron.length) return { motivo: "pieza_baja", detalle: `bajó al piso ${bajaron.join(", ")}` };

  const quitadas = piezasQuitadas(armadaAntes, armadaDespues);
  const sobrantes = referencia ? Math.max(0, piezasVisibles(armadaAntes).size - referencia.piezas) : 0;
  if (quitadas.length > sobrantes) return { motivo: "pieza_quitada", detalle: `quitó ${quitadas.join(", ")} (${quitadas.length} piezas; sobraban ${sobrantes} respecto a la lectura)` };

  const minimoGlobos = Math.min(armadaAntes.globos.length, referencia?.globos ?? Infinity) * (1 - MAX_REDUCCION_GLOBOS);
  if (armadaDespues.globos.length < minimoGlobos) {
    return { motivo: "menos_globos", detalle: `quedaron ${armadaDespues.globos.length} globos de ${armadaAntes.globos.length} (mínimo permitido ${Math.ceil(minimoGlobos)}; la lectura de la foto da ${referencia?.globos ?? "sin dato"})` };
  }

  const yaOcultas = piezasOcultas(antes, encuadre, armadaAntes);
  const nombres = new Map(despues.nodos.map((n) => [n.id, n.nombre]));
  const tapadas = [...piezasOcultas(despues, encuadre, armadaDespues)].filter((id) => !yaOcultas.has(id));
  if (tapadas.length) return { motivo: "pieza_oculta", detalle: `dejó tapada ${tapadas.map((id) => nombres.get(id) ?? id).join(", ")}` };
  return null;
}
