import type { Vec3 } from "./modulos";
import { armarPieza, type AnclaDePieza, type FlorDePieza, type GloboDePieza, type Pieza, type PiezaArmada } from "./piezas";
import type { TuboDecoracion } from "./decoraciones";
import { decoracionEnIngles, type MaterialDecoracion } from "./figuras";
import { esDePie } from "./halloween";
import { sumarMateriales } from "./mezcla";
import type { SolidoEscenografia } from "./escenografia";

/**
 * Una **escena**: varias piezas del taller colocadas en una sala (el arco orgánico con dos columnas y una
 * guirnalda, una pared de globos al fondo, racimos colgados del techo…). Todo es dato (JSON): se guarda, se
 * duplica y se recolorea con `reemplazarColor` como cualquier otra cosa del taller.
 *
 * **La sala** (cm): piso en y = 0, x de −ancho/2 a +ancho/2, z de −fondo/2 a +fondo/2 y techo en y = alto. La
 * pared del fondo está en z = −fondo/2 y mira hacia +z (hacia quien mira la escena); la izquierda en x = −ancho/2
 * (mira a +x) y la derecha en x = +ancho/2 (mira a −x). El frente (z = +fondo/2) queda abierto: por ahí se mira.
 *
 * **Colocación** de cada pieza (que viene en su espacio local: x a lo ancho, y arriba, +z al frente):
 * - `piso`: se apoya en el piso (su caja empieza en y = 0) centrada en (x, z) y girada `giroGrados` sobre y
 *   (0° = de frente, mirando a +z);
 * - `pared`: su espalda pegada a esa pared y su frente hacia el salón; `aLoLargoCm` corre a la derecha de quien
 *   mira la pared desde dentro, desde el centro de la pared, y `alturaCm` es la altura de su borde de abajo;
 * - `techo`: colgada con su borde de arriba `cuelgaCm` por debajo del techo, en (x, z), con su hilo hasta el techo;
 *   `volteada` la pone cabeza abajo (una flor que mira al piso);
 * - `ancla`: colgada de un ancla de otra pieza (como `colocarEn`: su +y local mira hacia la normal del ancla). Con
 *   `cada` > 0 se repite en el ancla `ancla`, `ancla + cada`, `ancla + 2·cada`… (flores a lo largo de una columna).
 * `armarEscena` lo deja todo en coordenadas del mundo, con los materiales sumados y lo de cada pieza por separado.
 */
export type ParedSala = "fondo" | "izquierda" | "derecha";

export type Sala = {
  anchoCm: number;
  fondoCm: number;
  altoCm: number;
  /** Colores (hex) del piso, las paredes y el techo: no son globos. */
  tonos: { piso: string; paredes: string; techo: string };
  mostrar: { piso: boolean; fondo: boolean; laterales: boolean; techo: boolean };
};

export type Colocacion =
  | { en: "piso"; xCm: number; zCm: number; giroGrados: number }
  | { en: "pared"; pared: ParedSala; aLoLargoCm: number; alturaCm: number }
  | { en: "techo"; xCm: number; zCm: number; cuelgaCm: number; giroGrados: number; volteada: boolean }
  | { en: "ancla"; padreId: string; ancla: number; cada: number; giroGrados: number };

export type LugarColocacion = Colocacion["en"];

export type NodoEscena = { id: string; nombre: string; pieza: Pieza; colocacion: Colocacion };

export type Escena = { sala: Sala; nodos: NodoEscena[] };

/** Un volumen vertical de la escena (hilos de lo que cuelga del techo). */
export type CilindroDeEscena = { base: Vec3; radioCm: number; altoCm: number; hex: string; /** De qué pieza es (el hilo se mueve con ella). */ nodo?: string };

export type Caja = { min: Vec3; max: Vec3 };

export type NodoArmado = {
  id: string;
  nombre: string;
  /** Cuántas veces se puso (más de 1 si se repite en varias anclas). */
  copias: number;
  globos: GloboDePieza[];
  tubos: TuboDecoracion[];
  flores: FlorDePieza[];
  /** Escenografía (paneles, mesas, tapete) en el mundo. */
  solidos: SolidoEscenografia[];
  /** Anclas en el mundo (las de todas sus copias): ahí se cuelgan otras piezas. */
  anclas: AnclaDePieza[];
  materiales: MaterialDecoracion[];
  caja: Caja;
  /** Por qué no se pudo poner (padre que no existe, ciclo…); vacío si quedó bien. */
  avisos: string[];
};

export type EscenaArmada = {
  globos: GloboDePieza[];
  tubos: TuboDecoracion[];
  flores: FlorDePieza[];
  solidos: SolidoEscenografia[];
  cilindros: CilindroDeEscena[];
  sala: Sala;
  materiales: MaterialDecoracion[];
  porNodo: NodoArmado[];
  avisos: string[];
};

export const NOMBRE_PARED: Readonly<Record<ParedSala, string>> = { fondo: "Pared del fondo", izquierda: "Pared izquierda", derecha: "Pared derecha" };

export const SALA_INICIAL: Sala = {
  anchoCm: 600, fondoCm: 500, altoCm: 320,
  tonos: { piso: "#d8cbbb", paredes: "#f1ece6", techo: "#fbfaf8" },
  mostrar: { piso: true, fondo: true, laterales: true, techo: true },
};

// ----------------------------------------------------------------------------------------------------------
// Transformaciones: v ↦ M·v + t (M de 3×3 por filas)
// ----------------------------------------------------------------------------------------------------------

type Matriz = readonly [number, number, number, number, number, number, number, number, number];
type Transformacion = { m: Matriz; t: Vec3 };

const IDENTIDAD: Matriz = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const rad = (g: number) => (g * Math.PI) / 180;

const girar = (m: Matriz, v: Vec3): Vec3 => ({ x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z });
const mover = (tr: Transformacion, p: Vec3): Vec3 => { const q = girar(tr.m, p); return { x: q.x + tr.t.x, y: q.y + tr.t.y, z: q.z + tr.t.z }; };
const multiplicar = (a: Matriz, b: Matriz): Matriz => {
  const c = (i: number, j: number) => a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return [c(0, 0), c(0, 1), c(0, 2), c(1, 0), c(1, 1), c(1, 2), c(2, 0), c(2, 1), c(2, 2)];
};

/** Giro sobre y: con 90°, el frente (+z) pasa a mirar a +x. */
function giroY(grados: number): Matriz {
  const c = Math.cos(rad(grados)), s = Math.sin(rad(grados));
  const r = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return [r(c), 0, r(s), 0, 1, 0, r(-s), 0, r(c)];
}
/** Media vuelta sobre x: cabeza abajo. */
const VOLTEO: Matriz = [1, 0, 0, 0, -1, 0, 0, 0, -1];

const normalizar = (v: Vec3): Vec3 => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };

/**
 * El marco de un ancla, igual que `colocarEn` de `decoraciones.ts`: y local = normal; x local horizontal (o a lo
 * largo de x si la normal es vertical) y `giroGrados` sobre la normal.
 */
function marcoDeAncla(ancla: AnclaDePieza, giroGrados: number): Transformacion {
  const n = normalizar(ancla.normal);
  const auxiliar: Vec3 = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const xL = normalizar({ x: auxiliar.y * n.z - auxiliar.z * n.y, y: auxiliar.z * n.x - auxiliar.x * n.z, z: auxiliar.x * n.y - auxiliar.y * n.x });
  const zL = { x: n.y * xL.z - n.z * xL.y, y: n.z * xL.x - n.x * xL.z, z: n.x * xL.y - n.y * xL.x };
  const c = Math.cos(rad(giroGrados)), s = Math.sin(rad(giroGrados));
  // Primero el giro sobre y local (x' = x·c − z·s, z' = x·s + z·c), luego las columnas del marco (xL, n, zL).
  const marco: Matriz = [xL.x, n.x, zL.x, xL.y, n.y, zL.y, xL.z, n.z, zL.z];
  return { m: multiplicar(marco, [c, 0, -s, 0, 1, 0, s, 0, c]), t: ancla.posicion };
}

function esquinas(c: Caja): Vec3[] {
  const salida: Vec3[] = [];
  for (const x of [c.min.x, c.max.x]) for (const y of [c.min.y, c.max.y]) for (const z of [c.min.z, c.max.z]) salida.push({ x, y, z });
  return salida;
}

function cajaDePuntos(puntos: readonly Vec3[]): Caja {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of puntos) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
  }
  return Number.isFinite(min.x) ? { min, max } : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
}

/** La caja de una pieza tras moverla (la caja de sus esquinas movidas: exacta con giros de 90°). */
function cajaMovida(caja: Caja, tr: Transformacion): Caja {
  return cajaDePuntos(esquinas(caja).map((p) => mover(tr, p)));
}

/** Centro de la pared, su normal hacia el salón y su «derecha» vista desde dentro. */
export function marcoDePared(sala: Sala, pared: ParedSala): { centro: Vec3; normal: Vec3; derecha: Vec3; largoCm: number; giroGrados: number } {
  if (pared === "izquierda") return { centro: { x: -sala.anchoCm / 2, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, derecha: { x: 0, y: 0, z: -1 }, largoCm: sala.fondoCm, giroGrados: 90 };
  if (pared === "derecha") return { centro: { x: sala.anchoCm / 2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, derecha: { x: 0, y: 0, z: 1 }, largoCm: sala.fondoCm, giroGrados: -90 };
  return { centro: { x: 0, y: 0, z: -sala.fondoCm / 2 }, normal: { x: 0, y: 0, z: 1 }, derecha: { x: 1, y: 0, z: 0 }, largoCm: sala.anchoCm, giroGrados: 0 };
}

/**
 * Lleva la pieza (por su caja local) a su sitio en la sala. Se corre primero al origen por el punto que la apoya
 * (centro de la base, de la espalda o de la cara de arriba) y luego se gira y se traslada.
 */
function transformacionDe(colocacion: Exclude<Colocacion, { en: "ancla" }>, caja: Caja, sala: Sala): Transformacion {
  const cx = (caja.min.x + caja.max.x) / 2, cz = (caja.min.z + caja.max.z) / 2;
  const componer = (previa: Matriz, apoyo: Vec3, giro: Matriz, destino: Vec3): Transformacion => {
    // v ↦ giro·(previa·v − apoyo) + destino
    const m = multiplicar(giro, previa);
    const a = girar(giro, apoyo);
    return { m, t: { x: destino.x - a.x, y: destino.y - a.y, z: destino.z - a.z } };
  };
  if (colocacion.en === "piso") {
    return componer(IDENTIDAD, { x: cx, y: caja.min.y, z: cz }, giroY(colocacion.giroGrados), { x: colocacion.xCm, y: 0, z: colocacion.zCm });
  }
  if (colocacion.en === "pared") {
    const marco = marcoDePared(sala, colocacion.pared);
    const destino = {
      x: marco.centro.x + marco.derecha.x * colocacion.aLoLargoCm,
      y: colocacion.alturaCm,
      z: marco.centro.z + marco.derecha.z * colocacion.aLoLargoCm,
    };
    return componer(IDENTIDAD, { x: cx, y: caja.min.y, z: caja.min.z }, giroY(marco.giroGrados), destino);
  }
  const previa = colocacion.volteada ? VOLTEO : IDENTIDAD;
  const volteada = cajaDePuntos(esquinas(caja).map((p) => girar(previa, p)));
  const apoyo = { x: (volteada.min.x + volteada.max.x) / 2, y: volteada.max.y, z: (volteada.min.z + volteada.max.z) / 2 };
  return componer(previa, apoyo, giroY(colocacion.giroGrados), { x: colocacion.xCm, y: sala.altoCm - colocacion.cuelgaCm, z: colocacion.zCm });
}

function aplicar(armada: PiezaArmada, tr: Transformacion) {
  return {
    globos: armada.globos.map((g): GloboDePieza => ({
      ...g, nudo: mover(tr, g.nudo), direccion: girar(tr.m, g.direccion), ...(g.frente ? { frente: girar(tr.m, g.frente) } : {}),
    })),
    tubos: armada.tubos.map((t): TuboDecoracion => ({ ...t, puntos: t.puntos.map((p) => mover(tr, p)) })),
    flores: armada.flores.map((f): FlorDePieza => ({ ...f, posicion: mover(tr, f.posicion), normal: girar(tr.m, f.normal) })),
    solidos: (armada.solidos ?? []).map((x): SolidoEscenografia => ({ ...x, origen: mover(tr, x.origen), ejeX: girar(tr.m, x.ejeX), ejeY: girar(tr.m, x.ejeY), ejeZ: girar(tr.m, x.ejeZ) })),
    anclas: armada.anclas.map((a): AnclaDePieza => ({ posicion: mover(tr, a.posicion), normal: girar(tr.m, a.normal) })),
    caja: cajaMovida(armada.caja, tr),
  };
}

/** Las anclas que usa una colocación en un ancla: la elegida y, con `cada`, las que siguen de `cada` en `cada`. */
export function anclasElegidas(total: number, ancla: number, cada: number): number[] {
  if (total <= 0) return [];
  const inicio = Math.min(total - 1, Math.max(0, Math.round(ancla)));
  const paso = Math.round(cada);
  if (paso <= 0) return [inicio];
  const salida: number[] = [];
  for (let i = inicio; i < total; i += paso) salida.push(i);
  return salida;
}

const MAX_CACHE = 48;
const HILO = { radioCm: 0.25, hex: "#d9d9de" };

/**
 * Arma la escena en coordenadas del mundo. Determinista: la misma escena da siempre lo mismo. `cache` (opcional)
 * guarda las piezas ya armadas por su JSON, para no rehacer un arco orgánico al mover otra pieza.
 */
/**
 * Una decoración se orienta según dónde va, no según cómo quedó guardada: en una pared siempre de frente (mirando
 * al salón); colgada de un ancla, en su espacio propio (+y), que `colocarEn` gira hacia fuera del ancla. Así no
 * se queda mirando al techo al cambiarla por otra predefinida o al pasarla a una pared.
 */
function orientada(nodo: NodoEscena): Pieza {
  const { pieza, colocacion } = nodo;
  if (pieza.tipo !== "decoracion") return pieza;
  // Las de Halloween que van de pie (calabazas, árbol, ramo, fantasma) quedan derechas en el piso y del techo.
  const deFrente = colocacion.en === "pared" ? true : colocacion.en === "ancla" ? false : Boolean(pieza.deFrente) || esDePie(pieza.decoracion);
  if (deFrente === Boolean(pieza.deFrente)) return pieza;
  const { deFrente: _anterior, ...resto } = pieza;
  void _anterior;
  return deFrente ? { ...resto, deFrente: true } : resto;
}

export function armarEscena(escena: Escena, cache?: Map<string, PiezaArmada>): EscenaArmada {
  const piezaArmada = (pieza: Pieza): PiezaArmada => {
    if (!cache) return armarPieza(pieza);
    const clave = JSON.stringify(pieza);
    const guardada = cache.get(clave);
    if (guardada) return guardada;
    const nueva = armarPieza(pieza);
    cache.set(clave, nueva);
    while (cache.size > MAX_CACHE) { const primera = cache.keys().next().value; if (primera === undefined) break; cache.delete(primera); }
    return nueva;
  };
  const porId = new Map(escena.nodos.map((n) => [n.id, n]));
  const hechos = new Map<string, NodoArmado>();
  const enCurso = new Set<string>();
  const cilindrosPorNodo = new Map<string, CilindroDeEscena[]>();

  const vacio = (nodo: NodoEscena, aviso: string): NodoArmado => ({
    id: nodo.id, nombre: nodo.nombre, copias: 0, globos: [], tubos: [], flores: [], solidos: [], anclas: [], materiales: [], caja: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, avisos: [aviso],
  });

  const armarNodo = (nodo: NodoEscena): NodoArmado => {
    const listo = hechos.get(nodo.id);
    if (listo) return listo;
    if (enCurso.has(nodo.id)) return vacio(nodo, `«${nodo.nombre}» cuelga de sí misma (por otra pieza): no se puso.`);
    enCurso.add(nodo.id);
    let resultado: NodoArmado;
    try {
      const armada = piezaArmada(orientada(nodo));
      const c = nodo.colocacion;
      if (c.en === "ancla") {
        const padre = porId.get(c.padreId);
        if (!padre || padre.id === nodo.id) resultado = vacio(nodo, `«${nodo.nombre}» va colgada de una pieza que ya no está: elige otra o ponla en el piso.`);
        else {
          const delPadre = armarNodo(padre);
          const indices = anclasElegidas(delPadre.anclas.length, c.ancla, c.cada);
          if (!indices.length) resultado = vacio(nodo, `«${padre.nombre}» no tiene anclas donde colgar «${nodo.nombre}».`);
          else {
            const copias = indices.map((i) => aplicar(armada, marcoDeAncla(delPadre.anclas[i]!, c.giroGrados)));
            resultado = {
              id: nodo.id, nombre: nodo.nombre, copias: copias.length,
              globos: copias.flatMap((x) => x.globos), tubos: copias.flatMap((x) => x.tubos), flores: copias.flatMap((x) => x.flores), solidos: copias.flatMap((x) => x.solidos), anclas: copias.flatMap((x) => x.anclas),
              materiales: sumarMateriales(...copias.map(() => armada.materiales)),
              caja: cajaDePuntos(copias.flatMap((x) => [x.caja.min, x.caja.max])),
              avisos: [],
            };
          }
        }
      } else {
        const puesta = aplicar(armada, transformacionDe(c, armada.caja, escena.sala));
        resultado = { id: nodo.id, nombre: nodo.nombre, copias: 1, ...puesta, materiales: sumarMateriales(armada.materiales), avisos: [] };
        if (c.en === "techo" && c.cuelgaCm > 0) {
          const arriba = puesta.caja.max.y;
          cilindrosPorNodo.set(nodo.id, [{ base: { x: c.xCm, y: arriba, z: c.zCm }, radioCm: HILO.radioCm, altoCm: Math.max(0, escena.sala.altoCm - arriba), hex: HILO.hex, nodo: nodo.id }]);
        }
      }
    } catch (error) {
      resultado = vacio(nodo, `«${nodo.nombre}» no se pudo armar: ${error instanceof Error ? error.message : String(error)}`);
    }
    enCurso.delete(nodo.id);
    hechos.set(nodo.id, resultado);
    return resultado;
  };

  const porNodo = escena.nodos.map(armarNodo);
  return {
    globos: porNodo.flatMap((n) => n.globos),
    tubos: porNodo.flatMap((n) => n.tubos),
    flores: porNodo.flatMap((n) => n.flores),
    solidos: porNodo.flatMap((n) => n.solidos),
    cilindros: escena.nodos.flatMap((n) => cilindrosPorNodo.get(n.id) ?? []),
    sala: escena.sala,
    materiales: sumarMateriales(...porNodo.map((n) => n.materiales)),
    porNodo,
    avisos: porNodo.flatMap((n) => n.avisos),
  };
}

/** Los ids de un nodo y de todo lo que cuelga de él (para no colgar una pieza de su propia hija). */
export function descendientes(escena: Escena, id: string): Set<string> {
  const salida = new Set<string>([id]);
  let crecio = true;
  while (crecio) {
    crecio = false;
    for (const n of escena.nodos) {
      if (n.colocacion.en === "ancla" && salida.has(n.colocacion.padreId) && !salida.has(n.id)) { salida.add(n.id); crecio = true; }
    }
  }
  return salida;
}

/** Un id nuevo que no choca con los de la escena: «columna-2», «columna-3»… */
export function idNuevo(escena: Escena, base: string): string {
  const usados = new Set(escena.nodos.map((n) => n.id));
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) if (!usados.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Copia un nodo (y lo corre un poco para que se vea que hay dos); lo que colgaba del original no se copia. */
export function duplicarNodo(escena: Escena, id: string): Escena {
  const original = escena.nodos.find((n) => n.id === id);
  if (!original) return escena;
  const c = original.colocacion;
  const corrida: Colocacion = c.en === "piso" ? { ...c, xCm: c.xCm + 60 }
    : c.en === "pared" ? { ...c, aLoLargoCm: c.aLoLargoCm + 60 }
      : c.en === "techo" ? { ...c, xCm: c.xCm + 60 }
        : { ...c, ancla: c.ancla + 1 };
  const copia: NodoEscena = { id: idNuevo(escena, original.id.replace(/-\d+$/, "")), nombre: `${original.nombre} (copia)`, pieza: structuredClone(original.pieza), colocacion: corrida };
  const indice = escena.nodos.indexOf(original);
  return { ...escena, nodos: [...escena.nodos.slice(0, indice + 1), copia, ...escena.nodos.slice(indice + 1)] };
}

/** Quita un nodo; lo que colgaba de él pasa al piso donde estaba, para no perderlo. */
export function quitarNodo(escena: Escena, id: string, armada?: EscenaArmada): Escena {
  const nodos = escena.nodos.filter((n) => n.id !== id).map((n): NodoEscena => {
    if (n.colocacion.en !== "ancla" || n.colocacion.padreId !== id) return n;
    const caja = armada?.porNodo.find((x) => x.id === n.id)?.caja;
    return { ...n, colocacion: { en: "piso", xCm: caja ? Math.round((caja.min.x + caja.max.x) / 2) : 0, zCm: caja ? Math.round((caja.min.z + caja.max.z) / 2) : 0, giroGrados: 0 } };
  });
  return { ...escena, nodos };
}

// ----------------------------------------------------------------------------------------------------------
// Descripción en inglés (para la foto con IA)
// ----------------------------------------------------------------------------------------------------------

const metrosEn = (cm: number) => `${(cm / 100).toFixed(1).replace(/\.0$/, "")} m`;

/** Qué es la pieza, en inglés y corto, con sus medidas. */
export function piezaEnIngles(pieza: Pieza, caja: Caja): string {
  const alto = metrosEn(caja.max.y - caja.min.y), ancho = metrosEn(Math.max(caja.max.x - caja.min.x, caja.max.z - caja.min.z));
  switch (pieza.tipo) {
    case "columna": return `a classic balloon column ${alto} tall`;
    case "arco": return `a classic quartet balloon arch ${ancho} wide and ${alto} tall`;
    case "arco_organico": return `an organic balloon arch of mixed-size balloons ${ancho} wide and ${alto} tall`;
    case "guirnalda": return pieza.guirnalda.caidaCm > 0 && !pieza.guirnalda.recorrido ? `a draped classic balloon garland ${ancho} long` : `a classic balloon garland ${ancho} long`;
    case "pared_malla": return `a flat Link-O-Loon balloon wall ${ancho} wide and ${alto} tall`;
    case "pared_trenzas": return `a balloon wall of vertical quartet braids ${ancho} wide and ${alto} tall`;
    case "organico": return `an organic balloon piece of mixed-size balloons ${alto} tall`;
    case "escenografia": return `party props (backdrop panels, tables or rug) ${ancho} wide`;
    case "decoracion": return decoracionEnIngles(pieza.decoracion);
  }
}

const LUGAR_EN: Readonly<Record<ParedSala, string>> = { fondo: "on the back wall", izquierda: "on the left wall", derecha: "on the right wall" };

/**
 * La escena contada en inglés: cada pieza con dónde está (a la izquierda, al centro, colgada del techo…), las
 * copias juntas («two classic balloon columns…»). Sin colores: los pone `descripcionRender3d`.
 */
export function escenaEnIngles(escena: Escena, armada: EscenaArmada): string {
  const frases: string[] = [];
  const vistos = new Map<string, { frase: string; cantidad: number; lugares: string[] }>();
  for (const nodo of escena.nodos) {
    const hecho = armada.porNodo.find((n) => n.id === nodo.id);
    if (!hecho || hecho.copias === 0) continue;
    const c = nodo.colocacion;
    const x = (hecho.caja.min.x + hecho.caja.max.x) / 2;
    const lado = x < -escena.sala.anchoCm * 0.12 ? "on the left" : x > escena.sala.anchoCm * 0.12 ? "on the right" : "in the center";
    const lugar = c.en === "piso" ? `standing ${lado}` : c.en === "pared" ? LUGAR_EN[c.pared] : c.en === "techo" ? "hanging from the ceiling" : `attached to the ${escena.nodos.find((n) => n.id === c.padreId)?.pieza.tipo.replace("_", " ") ?? "structure"}`;
    const frase = piezaEnIngles(nodo.pieza, hecho.caja);
    const clave = `${nodo.pieza.tipo}|${frase}|${c.en}`;
    const previo = vistos.get(clave);
    if (previo) { previo.cantidad += hecho.copias; previo.lugares.push(lugar); }
    else vistos.set(clave, { frase, cantidad: hecho.copias, lugares: [lugar] });
  }
  for (const { frase, cantidad, lugares } of vistos.values()) {
    const unicos = [...new Set(lugares)];
    const lugar = unicos.length > 1 && unicos.every((l) => l.startsWith("standing")) ? "one at each side" : unicos.join(" and ");
    frases.push(cantidad > 1 ? `${cantidad} × ${frase.replace(/^an? /, "")} (${lugar})` : `${frase} ${lugar}`);
  }
  const paredes = [escena.sala.mostrar.fondo ? "a back wall" : "", escena.sala.mostrar.techo ? "a ceiling" : ""].filter(Boolean).join(" and ");
  return `A balloon decoration set in a room${paredes ? ` with ${paredes}` : ""}: ${frases.join("; ")}`;
}

// ----------------------------------------------------------------------------------------------------------
// Mover a mano (arrastrar en el visor y teclado): imán, límites de la sala, giro e historial
// ----------------------------------------------------------------------------------------------------------

/** Paso del imán: lo movido cae en múltiplos de 5 cm (Alt lo quita). */
export const PASO_IMAN_CM = 5;

/** Al múltiplo de `paso` más cercano; sin imán, a un milímetro (para que el JSON no lleve decimales largos). */
export function imanar(valor: number, iman: boolean, paso = PASO_IMAN_CM): number {
  return iman ? Math.round(valor / paso) * paso : Math.round(valor * 10) / 10;
}

/** `valor` dentro de [min, max]; si no cabe (la pieza es más grande que la sala), al centro del rango. */
function limitar(valor: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, valor));
}

export type OpcionesMover = {
  /** La escena armada: da el tamaño de cada pieza para que no se salga de la sala (sin ella, solo su centro). */
  armada?: EscenaArmada;
  /** Imán a `PASO_IMAN_CM` en lo que se mueve (por defecto, sí). */
  iman?: boolean;
};

/**
 * Mueve una pieza `delta` (cm, en el mundo) sobre su superficie: en el piso y en el techo, en (x, z) —y en el
 * techo, `delta.y` la sube o la baja—; en una pared, a lo largo de ella y en altura (lo que se aleja de la pared
 * no cuenta). Lo colgado de un ancla no se mueve así (ver `pasarDeAncla`). Cada coordenada que cambia cae en el
 * imán y luego dentro de la sala: la caja de la pieza no pasa de las paredes, el piso ni el techo.
 */
export function moverNodo(escena: Escena, id: string, delta: Vec3, opciones: OpcionesMover = {}): Escena {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo || nodo.colocacion.en === "ancla") return escena;
  const { sala } = escena;
  const iman = opciones.iman ?? true;
  const caja = opciones.armada?.porNodo.find((n) => n.id === id && n.copias > 0)?.caja;
  const medio = (eje: "x" | "y" | "z") => (caja ? (caja.max[eje] - caja.min[eje]) / 2 : 0);
  const alto = caja ? caja.max.y - caja.min.y : 0;
  const nuevo = (actual: number, d: number, min: number, max: number) => (Math.abs(d) < 1e-9 ? actual : limitar(imanar(actual + d, iman), min, max));
  const c = nodo.colocacion;
  let colocacion: Colocacion;
  if (c.en === "pared") {
    const marco = marcoDePared(sala, c.pared);
    const aLo = delta.x * marco.derecha.x + delta.z * marco.derecha.z;
    const medioLargo = c.pared === "fondo" ? medio("x") : medio("z");
    colocacion = {
      ...c,
      aLoLargoCm: nuevo(c.aLoLargoCm, aLo, -marco.largoCm / 2 + medioLargo, marco.largoCm / 2 - medioLargo),
      alturaCm: nuevo(c.alturaCm, delta.y, 0, sala.altoCm - alto),
    };
  } else {
    const x = nuevo(c.xCm, delta.x, -sala.anchoCm / 2 + medio("x"), sala.anchoCm / 2 - medio("x"));
    const z = nuevo(c.zCm, delta.z, -sala.fondoCm / 2 + medio("z"), sala.fondoCm / 2 - medio("z"));
    colocacion = c.en === "piso" ? { ...c, xCm: x, zCm: z } : { ...c, xCm: x, zCm: z, cuelgaCm: nuevo(c.cuelgaCm, -delta.y, 0, sala.altoCm - alto) };
  }
  if (JSON.stringify(colocacion) === JSON.stringify(c)) return escena;
  return { ...escena, nodos: escena.nodos.map((n) => (n.id === id ? { ...n, colocacion } : n)) };
}

/** Gira una pieza `grados` sobre sí misma (piso, techo o ancla), dejando el giro en (−180°, 180°]. En una pared no gira. */
export function girarNodo(escena: Escena, id: string, grados: number): Escena {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo || nodo.colocacion.en === "pared" || grados === 0) return escena;
  let giro = Math.round((nodo.colocacion.giroGrados + grados) * 10) / 10;
  while (giro > 180) giro -= 360;
  while (giro <= -180) giro += 360;
  const colocacion: Colocacion = { ...nodo.colocacion, giroGrados: giro };
  return { ...escena, nodos: escena.nodos.map((n) => (n.id === id ? { ...n, colocacion } : n)) };
}

/** Lo colgado de un ancla pasa a la ancla `paso` más allá (o más acá), sin salirse de las que tiene su pieza. */
export function pasarDeAncla(escena: Escena, id: string, paso: number, armada?: EscenaArmada): Escena {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo || nodo.colocacion.en !== "ancla") return escena;
  const c = nodo.colocacion;
  const total = armada?.porNodo.find((n) => n.id === c.padreId)?.anclas.length;
  const ancla = Math.max(0, Math.min(total ? total - 1 : Infinity, Math.round(c.ancla) + Math.round(paso)));
  if (ancla === c.ancla) return escena;
  return { ...escena, nodos: escena.nodos.map((n) => (n.id === id ? { ...n, colocacion: { ...c, ancla } } : n)) };
}

/**
 * Cuánto se corre una pieza en el mundo (cm) al pasar de una colocación a otra, si solo se trasladó (mismo lugar,
 * misma pared, mismo giro y volteo); `null` si cambió algo más. Sirve para mover lo dibujado mientras se arrastra
 * sin rearmar nada.
 */
export function desplazamientoEntre(sala: Sala, antes: Colocacion, despues: Colocacion): Vec3 | null {
  if (antes.en === "piso" && despues.en === "piso" && antes.giroGrados === despues.giroGrados) {
    return { x: despues.xCm - antes.xCm, y: 0, z: despues.zCm - antes.zCm };
  }
  if (antes.en === "techo" && despues.en === "techo" && antes.giroGrados === despues.giroGrados && antes.volteada === despues.volteada) {
    return { x: despues.xCm - antes.xCm, y: antes.cuelgaCm - despues.cuelgaCm, z: despues.zCm - antes.zCm };
  }
  if (antes.en === "pared" && despues.en === "pared" && antes.pared === despues.pared) {
    const { derecha } = marcoDePared(sala, antes.pared);
    const d = despues.aLoLargoCm - antes.aLoLargoCm;
    return { x: derecha.x * d, y: despues.alturaCm - antes.alturaCm, z: derecha.z * d };
  }
  return null;
}

/** Deshacer y rehacer de la escena: lo de antes, lo de ahora y lo deshecho (para rehacer). */
export type HistorialEscena = { pasado: Escena[]; presente: Escena; futuro: Escena[] };

export const MAX_HISTORIAL = 50;

export function historialNuevo(escena: Escena): HistorialEscena {
  return { pasado: [], presente: escena, futuro: [] };
}

/** Un cambio nuevo: lo de ahora pasa al pasado (hasta `max` pasos) y lo deshecho ya no se puede rehacer. */
export function historialCambiar(h: HistorialEscena, escena: Escena, max = MAX_HISTORIAL): HistorialEscena {
  if (escena === h.presente) return h;
  return { pasado: [...h.pasado, h.presente].slice(-max), presente: escena, futuro: [] };
}

/** Cambia lo de ahora sin guardar un paso (los pasos seguidos de un deslizador cuentan como uno). */
export function historialReemplazar(h: HistorialEscena, escena: Escena): HistorialEscena {
  return escena === h.presente ? h : { ...h, presente: escena, futuro: [] };
}

export function historialDeshacer(h: HistorialEscena): HistorialEscena {
  const anterior = h.pasado[h.pasado.length - 1];
  return anterior ? { pasado: h.pasado.slice(0, -1), presente: anterior, futuro: [h.presente, ...h.futuro] } : h;
}

export function historialRehacer(h: HistorialEscena): HistorialEscena {
  const siguiente = h.futuro[0];
  return siguiente ? { pasado: [...h.pasado, h.presente], presente: siguiente, futuro: h.futuro.slice(1) } : h;
}
