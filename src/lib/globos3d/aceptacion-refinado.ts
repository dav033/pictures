import { armarEscena, descendientes, type Escena, type EscenaArmada, type NodoArmado, type NodoEscena } from "./escena";
import type { Encuadre } from "./encuadre-foto";
import { centroDe } from "./letras";
import type { Vec3 } from "./modulos";
import { camaraNumerica, enCuadro, largoEnPantalla, proyectar, type CamaraNumerica } from "./proyeccion-foto";

/**
 * **Criterio de aceptación de una ronda de refinado** (REQ-001 paso 9, P-016). Una ronda solo se queda si de verdad
 * mejora: la escena de después se parece más a la foto que la de antes (la similitud entre imágenes la calcula el
 * servidor con embeddings, ver `/api/escena-ia/similitud`) Y la estructura no empeoró. La estructura se revisa aquí,
 * puro y sin red, con la cámara de la foto:
 *  - ninguna pieza que colgaba de la pared (a más de 40 cm) acaba a menos de 15 cm del piso;
 *  - ninguna pieza queda del todo tapada por otra más cercana a la cámara (su caja en pantalla, cubierta por los globos de
 *    una pieza que no es su padre ni su hija);
 *  - el total de globos no baja más de 30 %, salvo que la propia ronda reporte piezas sobrantes.
 * Los tres casos son los fallos que se vieron en las pruebas reales con la foto 07: el «LOVE» bajado al piso, el «LOVE»
 * tapado por la guirnalda y la silueta achicada.
 */

export const MARGEN_MEJORA = 0.01;
export const ALTURA_COLGADA_CM = 40;
export const ALTURA_PISO_CM = 15;
export const MAX_REDUCCION_GLOBOS = 0.3;
/** Qué parte de los puntos de una pieza tiene que estar cubierta para decir que no se ve. */
export const FRACCION_TAPADA = 0.85;
/** El globo tapa lo que cae dentro de este tanto de su radio en pantalla (un disco inscrito en la caja del globo). */
const FACTOR_DISCO = 0.9;
const MALLA_PUNTOS = 6;

export type MotivoRechazo = "no_mejora" | "pieza_baja" | "pieza_oculta" | "menos_globos" | "sin_comparacion";
export type Rechazo = { motivo: MotivoRechazo; detalle: string };
export type Similitud = { antes: number; despues: number };
export type Veredicto = { aceptada: true; similitud: Similitud } | { aceptada: false; rechazo: Rechazo; similitud: Similitud | null };

/** La altura (cm) a la que cuelga una pieza puesta en la pared o en el aire; `null` si no cuelga (piso, techo, de otra pieza). */
export function alturaColgada(n: NodoEscena): number | null {
  const c = n.colocacion;
  if (c.en === "pared") return c.alturaCm;
  if (c.en === "libre") return c.yCm;
  return null;
}

/** Las piezas que colgaban de la pared y la ronda dejó casi en el piso. */
export function piezasQueBajaron(antes: Escena, despues: Escena): string[] {
  const hoy = new Map(despues.nodos.map((n) => [n.id, n]));
  const bajaron: string[] = [];
  for (const n of antes.nodos) {
    const antesCm = alturaColgada(n), ahora = hoy.get(n.id);
    const despuesCm = ahora ? alturaColgada(ahora) : null;
    if (antesCm !== null && despuesCm !== null && antesCm > ALTURA_COLGADA_CM && despuesCm < ALTURA_PISO_CM) bajaron.push(`${n.nombre} (de ${Math.round(antesCm)} cm a ${Math.round(despuesCm)} cm)`);
  }
  return bajaron;
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

export type OpcionesEstructura = {
  /** La ronda dijo que sobran piezas: bajar el total de globos es lo que se pidió. */
  permiteReducir?: boolean;
};

/** Revisa que la ronda no empeore la estructura; `null` si no hay nada que reprochar. */
export function revisarEstructura(antes: Escena, despues: Escena, encuadre: Encuadre, opciones: OpcionesEstructura = {}): Rechazo | null {
  const bajaron = piezasQueBajaron(antes, despues);
  if (bajaron.length) return { motivo: "pieza_baja", detalle: `bajó al piso ${bajaron.join(", ")}` };

  const armadaAntes = armarEscena(antes), armadaDespues = armarEscena(despues);
  if (!opciones.permiteReducir && armadaAntes.globos.length > 0) {
    const reduccion = 1 - armadaDespues.globos.length / armadaAntes.globos.length;
    if (reduccion > MAX_REDUCCION_GLOBOS) return { motivo: "menos_globos", detalle: `quitó ${Math.round(reduccion * 100)} % de los globos (de ${armadaAntes.globos.length} a ${armadaDespues.globos.length})` };
  }

  const yaOcultas = piezasOcultas(antes, encuadre, armadaAntes);
  const nombres = new Map(despues.nodos.map((n) => [n.id, n.nombre]));
  const tapadas = [...piezasOcultas(despues, encuadre, armadaDespues)].filter((id) => !yaOcultas.has(id));
  if (tapadas.length) return { motivo: "pieza_oculta", detalle: `dejó tapada ${tapadas.map((id) => nombres.get(id) ?? id).join(", ")}` };
  return null;
}

/** La decisión: la estructura no empeoró y la escena de después se parece a la foto más que la de antes (por al menos `MARGEN_MEJORA`). */
export function decidirAceptacion(similitud: Similitud | null, estructura: Rechazo | null): Veredicto {
  if (estructura) return { aceptada: false, rechazo: estructura, similitud };
  if (!similitud) return { aceptada: false, rechazo: { motivo: "sin_comparacion", detalle: "no se pudo comparar la imagen con la foto" }, similitud };
  const mejora = similitud.despues - similitud.antes;
  if (mejora < MARGEN_MEJORA) {
    return { aceptada: false, rechazo: { motivo: "no_mejora", detalle: `se parece ${mejora >= 0 ? "apenas más" : "menos"} a la foto: ${similitud.antes.toFixed(3)} → ${similitud.despues.toFixed(3)}` }, similitud };
  }
  return { aceptada: true, similitud };
}

/** El coseno de dos vectores (los de gemini-embedding-2 ya vienen normalizados, pero no se asume). */
export function coseno(a: readonly number[], b: readonly number[]): number {
  let punto = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { punto += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? punto / Math.sqrt(na * nb) : 0;
}
