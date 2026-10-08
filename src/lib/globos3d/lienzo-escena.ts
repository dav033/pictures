import type { Vec3 } from "./modulos";
import {
  descendientes, idNuevo, marcoDePared, puntoALocal, puntoAlMundo, quitarNodo, vectorALocal, vectorAlMundo,
  type Caja, type Colocacion, type ColocacionSobre, type Escena, type EscenaArmada, type NodoArmado, type NodoEscena, type ParedSala, type Sala,
} from "./escena";
import { armarPieza, type Pieza } from "./piezas";
import { esDePie } from "./halloween";
import { CUELGA_DEL_TECHO_CM } from "./decoraciones-escena";
import { cruz, cuerposDeGlobos, normalDeSuperficie, normalSuavizada, rayoContraCuerpos, superficieMasCercana, unitario } from "./superficie-globos";

/**
 * **La estructura como lienzo**: lo que hace falta para poner una decoración en cualquier punto de una columna, un
 * aro, un arco, una guirnalda o una pared de globos (colocación `sobre`), cogerla y moverla por esa superficie o
 * pasarla a otra, y separar una copia de un reparto en anclas. Lo usan el visor (arrastrar con el ratón, flechas)
 * y las herramientas de la IA (que describen el sitio con altura, lado y corrimiento). Puro: sin React ni three.js.
 */

/** Si se suelta a menos de esto de un ancla de la pieza, se pega a ella (el imán; Alt lo quita). */
export const IMAN_ANCLA_CM = 6;

const ARRIBA: Vec3 = { x: 0, y: 1, z: 0 };
const mas = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const menos = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const escalar = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const largo = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const sinMenosCero = (v: number) => (Object.is(v, -0) ? 0 : v);

/** Sin `deFrente`: la decoración en su espacio propio, mirando a +y (como va en un ancla o sobre otra pieza). */
function plana(pieza: Pieza): Pieza {
  if (pieza.tipo !== "decoracion" || !pieza.deFrente) return pieza;
  const { deFrente: _anterior, ...resto } = pieza;
  void _anterior;
  return resto;
}

/** Cuánto ocupa a lo ancho una pieza apoyada (su radio en el plano de la superficie, cm). */
export function radioLateral(pieza: Pieza): number {
  const { min, max } = armarPieza(plana(pieza)).caja;
  return Math.max(4, Math.abs(min.x), Math.abs(max.x), Math.abs(min.z), Math.abs(max.z));
}

/** Si una pieza armada sirve de lienzo: tiene globos (o escenografía), está puesta y no es una decoración. */
export function aceptaDecoraciones(nodo: NodoEscena, armado: NodoArmado | undefined): boolean {
  if (!armado || !armado.puestas.length || nodo.pieza.tipo === "decoracion") return false;
  return armado.globos.length > 0 || armado.solidos.length > 0;
}

export type SitioEnPieza = { punto: Vec3; normal: Vec3; /** Índice del ancla si el imán la pegó a una. */ ancla: number | null };

/**
 * Un punto de la superficie de una pieza (del mundo, el que dio el rayo del visor o la IA) → el sitio donde se
 * apoya: con imán, el ancla más cercana si está a menos de `IMAN_ANCLA_CM` (su posición y su normal); si no, el
 * punto con la normal de la superficie promediada al tamaño de la decoración (`radioCm`). Sin globos cerca
 * (escenografía), la `normal` que se pase.
 */
export function sitioEnPieza(padre: NodoArmado, puntoMundo: Vec3, opciones: { normal?: Vec3 | null; radioCm?: number; iman?: boolean } = {}): SitioEnPieza {
  if (opciones.iman) {
    let mejor = -1, distancia = IMAN_ANCLA_CM;
    padre.anclas.forEach((a, i) => { const d = largo(menos(a.posicion, puntoMundo)); if (d < distancia) { distancia = d; mejor = i; } });
    const a = padre.anclas[mejor];
    if (a) return { punto: a.posicion, normal: unitario(a.normal), ancla: mejor };
  }
  const radio = opciones.radioCm ?? 10;
  const cuerpos = cuerposDeGlobos(padre.globos);
  const dada = opciones.normal ? unitario(opciones.normal) : null;
  if (!cuerpos.length) return { punto: puntoMundo, normal: dada ?? { x: 0, y: 0, z: 1 }, ancla: null };
  // De partida, la que se dio (la cara tocada, el lado desde el que llega la IA) mirando hacia fuera de los globos;
  // luego, el plano que mejor se ajusta a la superficie bajo la decoración.
  const fuera = normalSuavizada(cuerpos, puntoMundo, radio);
  let inicial = dada ?? fuera ?? { x: 0, y: 0, z: 1 };
  if (dada && fuera && escalar(dada, fuera) < 0) inicial = { x: -dada.x, y: -dada.y, z: -dada.z };
  return { punto: puntoMundo, normal: normalDeSuperficie(cuerpos, puntoMundo, inicial, radio), ancla: null };
}

/** Un sitio del mundo pasado al espacio local de la pieza: la colocación `sobre` (redondeada a 1 mm). */
export function colocacionSobre(padre: NodoArmado, sitio: { punto: Vec3; normal: Vec3 }, giroGrados = 0): ColocacionSobre | null {
  const marco = padre.puestas[0]?.marco;
  if (!marco) return null;
  const p = puntoALocal(marco, sitio.punto), n = unitario(vectorALocal(marco, sitio.normal));
  return {
    en: "sobre", padreId: padre.id,
    puntoCm: { x: sinMenosCero(r1(p.x)), y: sinMenosCero(r1(p.y)), z: sinMenosCero(r1(p.z)) },
    normal: { x: sinMenosCero(r4(n.x)), y: sinMenosCero(r4(n.y)), z: sinMenosCero(r4(n.z)) },
    giroGrados,
  };
}

/** Dónde está (en el mundo) el punto de apoyo de una colocación `sobre` y hacia dónde mira; `null` si el padre no está. */
export function sitioDeSobre(armada: EscenaArmada, c: ColocacionSobre): { punto: Vec3; normal: Vec3; padre: NodoArmado } | null {
  const padre = armada.porNodo.find((n) => n.id === c.padreId);
  const marco = padre?.puestas[0]?.marco;
  if (!padre || !marco) return null;
  return { punto: puntoAlMundo(marco, c.puntoCm), normal: unitario(vectorAlMundo(marco, c.normal)), padre };
}

/** Qué copia de una pieza repetida está en ese punto del mundo (la de caja más cercana). */
export function copiaEn(armado: NodoArmado, punto: Vec3): number {
  let mejor = 0, distancia = Infinity;
  armado.puestas.forEach((p, i) => {
    const fuera = (eje: "x" | "y" | "z") => Math.max(p.caja.min[eje] - punto[eje], 0, punto[eje] - p.caja.max[eje]);
    const d = Math.hypot(fuera("x"), fuera("y"), fuera("z"));
    if (d < distancia - 1e-9) { distancia = d; mejor = i; }
  });
  return mejor;
}

const conColocacion = (escena: Escena, id: string, colocacion: Colocacion): Escena =>
  ({ ...escena, nodos: escena.nodos.map((n) => (n.id === id ? { ...n, colocacion } : n)) });

/**
 * Separa la copia `copia` de un reparto en anclas: pasa a ser un nodo propio `sobre` el mismo padre, en el mismo
 * sitio (el ancla, con su normal y su giro), y el reparto se la salta (`omitir`): quedan N − 1 + 1. Si el nodo
 * tenía una sola copia, ese mismo nodo pasa a `sobre`. Devuelve la escena y el id de la pieza separada.
 */
export function separarCopia(escena: Escena, armada: EscenaArmada, id: string, copia: number): { escena: Escena; id: string } | null {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo) return null;
  const c = nodo.colocacion;
  if (c.en !== "ancla") return { escena, id };
  const armado = armada.porNodo.find((n) => n.id === id);
  const padre = armada.porNodo.find((n) => n.id === c.padreId);
  const puesta = armado?.puestas[copia];
  if (!armado || !padre || !puesta || puesta.ancla === null) return null;
  const ancla = padre.anclas[puesta.ancla];
  if (!ancla) return null;
  const sobre = colocacionSobre(padre, { punto: ancla.posicion, normal: ancla.normal }, c.giroGrados);
  if (!sobre) return null;
  if (armado.puestas.length <= 1) return { escena: conColocacion(escena, id, sobre), id };
  const nuevoId = idNuevo(escena, nodo.id.replace(/-\d+$/, ""));
  const suelta: NodoEscena = { id: nuevoId, nombre: `${nodo.nombre} (suelta)`, pieza: structuredClone(nodo.pieza), colocacion: sobre };
  const reparto: NodoEscena = { ...nodo, colocacion: { ...c, omitir: [...new Set([...(c.omitir ?? []), puesta.ancla])].sort((a, b) => a - b) } };
  const indice = escena.nodos.indexOf(nodo);
  return { escena: { ...escena, nodos: [...escena.nodos.slice(0, indice), reparto, suelta, ...escena.nodos.slice(indice + 1)] }, id: nuevoId };
}

/**
 * Lleva UNA copia de una pieza a otro sitio (`destino`): si venía de un reparto con varias copias, primero se separa
 * (las demás se quedan); si no, se mueve la pieza. `null` si el destino cuelga de la propia pieza (ciclo).
 */
export function moverCopia(escena: Escena, armada: EscenaArmada, id: string, copia: number, destino: Colocacion): { escena: Escena; id: string } | null {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo) return null;
  if ((destino.en === "ancla" || destino.en === "sobre") && descendientes(escena, id).has(destino.padreId)) return null;
  const varias = nodo.colocacion.en === "ancla" && (armada.porNodo.find((n) => n.id === id)?.puestas.length ?? 0) > 1;
  const separada = varias ? separarCopia(escena, armada, id, copia) : { escena, id };
  if (!separada) return null;
  return { escena: conColocacion(separada.escena, separada.id, destino), id: separada.id };
}

/** Quita UNA copia: de un reparto con varias, la salta (`omitir`); si es la única, quita la pieza. */
export function quitarCopia(escena: Escena, armada: EscenaArmada, id: string, copia: number): Escena {
  const nodo = escena.nodos.find((n) => n.id === id);
  const armado = armada.porNodo.find((n) => n.id === id);
  if (!nodo) return escena;
  const c = nodo.colocacion;
  const puesta = armado?.puestas[copia];
  if (c.en === "ancla" && armado && armado.puestas.length > 1 && puesta && puesta.ancla !== null) {
    return conColocacion(escena, id, { ...c, omitir: [...new Set([...(c.omitir ?? []), puesta.ancla])].sort((a, b) => a - b) });
  }
  return quitarNodo(escena, id, armada);
}

/**
 * Desliza una pieza `sobre` otra `delta` cm (del mundo; lo que va hacia fuera de la superficie no cuenta) y la
 * vuelve a apoyar en la superficie de su padre: en una columna da la vuelta, en un arco sigue la curva. Sin
 * superficie donde caer (se salió del borde), no se mueve.
 */
export function deslizarSobre(escena: Escena, armada: EscenaArmada, id: string, delta: Vec3, opciones: { iman?: boolean } = {}): Escena {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo || nodo.colocacion.en !== "sobre") return escena;
  const c = nodo.colocacion;
  const actual = sitioDeSobre(armada, c);
  if (!actual) return escena;
  const { punto: p, normal: n, padre } = actual;
  const d = mas(delta, n, -escalar(delta, n));
  if (largo(d) < 1e-6) return escena;
  const q = mas(p, d);
  const cuerpos = cuerposDeGlobos(padre.globos);
  let punto: Vec3 | null = q;
  if (cuerpos.length) {
    const toque = rayoContraCuerpos(cuerpos, mas(q, n, 60), { x: -n.x, y: -n.y, z: -n.z });
    const cercano = toque ? null : superficieMasCercana(cuerpos, q);
    punto = toque ? toque.punto : cercano && cercano.distancia < 30 ? cercano.punto : null;
  }
  if (!punto) return escena;
  const sitio = sitioEnPieza(padre, punto, { normal: n, radioCm: radioLateral(nodo.pieza), iman: opciones.iman ?? false });
  const colocacion = colocacionSobre(padre, sitio, c.giroGrados);
  if (!colocacion || JSON.stringify(colocacion) === JSON.stringify(c)) return escena;
  return conColocacion(escena, id, colocacion);
}

// ----------------------------------------------------------------------------------------------------------
// Sitio descrito con palabras (la IA): altura, lado o ángulo alrededor y corrimiento
// ----------------------------------------------------------------------------------------------------------

export type LadoPieza = "frente" | "derecha" | "atras" | "izquierda";
export const ANGULO_LADO: Readonly<Record<LadoPieza, number>> = { frente: 0, derecha: 90, atras: 180, izquierda: -90 };

/** El frente de una pieza en el mundo (horizontal) y su derecha vista desde delante. */
function ejesDePieza(padre: NodoArmado): { frente: Vec3; derecha: Vec3 } {
  const marco = padre.puestas[0]?.marco;
  const f = marco ? vectorAlMundo(marco, { x: 0, y: 0, z: 1 }) : { x: 0, y: 0, z: 1 };
  const frente = Math.hypot(f.x, f.z) > 1e-6 ? unitario({ x: f.x, y: 0, z: f.z }) : { x: 0, y: 0, z: 1 };
  return { frente, derecha: cruz(ARRIBA, frente) };
}

export type SitioDescrito = {
  /** Altura desde el piso (cm); por defecto, a media altura de la pieza. */
  alturaCm?: number;
  lado?: LadoPieza;
  /** Grados alrededor de la pieza desde su frente (90 = su derecha vista de frente); manda sobre `lado`. */
  anguloGrados?: number;
  /** Corrimiento a la derecha (vista desde ese lado) desde el centro de la pieza (cm). */
  xCm?: number;
};

/**
 * El punto de la superficie de una pieza que se describe con palabras: un rayo horizontal a esa altura que llega
 * desde ese lado (corrido `xCm`) hasta el primer globo. Error claro (con lo que ocupa la pieza) si por ahí no hay globos.
 */
export function sitioDescrito(padre: NodoArmado, d: SitioDescrito, radioCm = 10): SitioEnPieza | { error: string } {
  const cuerpos = cuerposDeGlobos(padre.globos);
  if (!cuerpos.length) return { error: `«${padre.nombre}» no tiene globos donde apoyar una decoración.` };
  const { frente, derecha } = ejesDePieza(padre);
  const angulo = ((d.anguloGrados ?? ANGULO_LADO[d.lado ?? "frente"]) * Math.PI) / 180;
  const dir = unitario(mas(mas({ x: 0, y: 0, z: 0 }, frente, Math.cos(angulo)), derecha, Math.sin(angulo)));
  const lateral = cruz(ARRIBA, dir);
  const { min, max } = padre.caja;
  const centro = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const altura = d.alturaCm ?? centro.y;
  const lejos = largo(menos(max, min)) + 100;
  const origen = mas(mas({ x: centro.x, y: altura, z: centro.z }, lateral, d.xCm ?? 0), dir, lejos);
  const haciaDentro = { x: -dir.x, y: -dir.y, z: -dir.z };
  // Si cae justo en un hueco entre globos (una malla tiene rombos vacíos), el más cercano en una espiral de hasta 16 cm.
  let toque = rayoContraCuerpos(cuerpos, origen, haciaDentro);
  for (let anillo = 4; !toque && anillo <= 16; anillo += 4) {
    for (let k = 0; k < 8 && !toque; k++) {
      const a = (k / 8) * 2 * Math.PI;
      toque = rayoContraCuerpos(cuerpos, mas(mas(origen, lateral, Math.cos(a) * anillo), ARRIBA, Math.sin(a) * anillo), haciaDentro);
    }
  }
  if (!toque) {
    const ancho = Math.round(Math.abs(escalar(menos(max, min), lateral)) / 2);
    return { error: `A ${Math.round(altura)} cm de altura${d.xCm ? ` y corrida ${Math.round(d.xCm)} cm` : ""} no hay globos de «${padre.nombre}» por ese lado. Ocupa de ${Math.round(min.y)} a ${Math.round(max.y)} cm de alto y unos ±${ancho} cm a los lados de su centro.` };
  }
  return sitioEnPieza(padre, toque.punto, { normal: menos(toque.punto, cuerpos[toque.cuerpo]!.c), radioCm });
}

/** Un sitio `sobre` contado en palabras: altura, ángulo alrededor de la pieza (0 = frente) y corrimiento. */
export function describirSobre(armada: EscenaArmada, c: ColocacionSobre): string {
  const sitio = sitioDeSobre(armada, c);
  if (!sitio) return `sobre «${c.padreId}» (que no está)`;
  const { frente, derecha } = ejesDePieza(sitio.padre);
  const angulo = Math.round((Math.atan2(escalar(sitio.normal, derecha), escalar(sitio.normal, frente)) * 180) / Math.PI);
  const lado = Math.abs(angulo) <= 30 ? "frente" : Math.abs(angulo) >= 150 ? "atrás" : angulo > 0 ? "derecha" : "izquierda";
  const vertical = sitio.normal.y > 0.7 ? ", mirando arriba" : sitio.normal.y < -0.7 ? ", mirando abajo" : "";
  return `sobre «${c.padreId}» a ${Math.round(sitio.punto.y)} cm de altura, lado ${lado} (${angulo}°)${vertical}, giro=${Math.round(c.giroGrados)}°`;
}

// ----------------------------------------------------------------------------------------------------------
// Paredes, piso y techo de la sala (soltar una decoración ahí)
// ----------------------------------------------------------------------------------------------------------

export type SuperficieSala = "piso" | "techo" | ParedSala;

/**
 * Soltar una pieza en un punto de la sala: en una pared, centrada a lo largo en ese punto y con su centro a esa
 * altura (de frente); en el techo, colgada sobre ese punto (cabeza abajo si es una flor); en el piso, ahí. Sin
 * salirse de la sala.
 */
export function colocacionEnSala(sala: Sala, superficie: SuperficieSala, punto: Vec3, pieza: Pieza, caja?: { piso: Caja; frente: Caja }): Colocacion {
  const dentro = (v: number, medio: number) => Math.round(Math.max(-medio, Math.min(medio, v)));
  if (superficie === "piso" || superficie === "techo") {
    const { min, max } = caja?.piso ?? armarPieza(pieza).caja;
    const medioX = Math.max(0, sala.anchoCm / 2 - (max.x - min.x) / 2), medioZ = Math.max(0, sala.fondoCm / 2 - (max.z - min.z) / 2);
    const x = dentro(punto.x, medioX), z = dentro(punto.z, medioZ);
    if (superficie === "piso") return { en: "piso", xCm: x, zCm: z, giroGrados: 0 };
    const volteada = pieza.tipo === "decoracion" && !esDePie(pieza.decoracion);
    return { en: "techo", xCm: x, zCm: z, cuelgaCm: Math.min(CUELGA_DEL_TECHO_CM, Math.max(0, sala.altoCm - 60)), giroGrados: 0, volteada };
  }
  const marco = marcoDePared(sala, superficie);
  const { min, max } = caja?.frente ?? armarPieza(pieza.tipo === "decoracion" ? { ...pieza, deFrente: true } : pieza).caja;
  const alto = max.y - min.y, ancho = max.x - min.x;
  const aLo = escalar(menos(punto, marco.centro), marco.derecha);
  return {
    en: "pared", pared: superficie,
    aLoLargoCm: dentro(aLo, Math.max(0, marco.largoCm / 2 - ancho / 2)),
    alturaCm: Math.round(Math.max(0, Math.min(sala.altoCm - alto, punto.y - alto / 2))),
  };
}
