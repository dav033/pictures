import type { Vec3 } from "./modulos";
import {
  armarEscena, duplicarNodo, idNuevo, puntoALocal, puntoAlMundo, quitarNodo, vectorALocal, vectorAlMundo,
  type Colocacion, type Escena, type EscenaArmada, type MarcoPieza, type NodoEscena,
} from "./escena";
import { clasePieza, decoracionesPegadas, escenaDeConjunto, extraerConjunto, insertarEnEscena, miembrosDeConjunto, type ItemBiblioteca } from "./biblioteca";
import type { PiezaArmada } from "./piezas";

/**
 * **Editor solitario** de una estructura de la escena (menú contextual → «Editar»): la escena se cambia por una vista
 * con SOLO esa pieza y sus decoraciones (el conjunto de `extraerConjunto`: lo que cuelga de ella, lo que va sobre ella
 * y lo pegado a sus globos), con la raíz en el origen. Al terminar, `aplicarSolitario` devuelve lo editado a la escena:
 * la raíz en su MISMO sitio y colocación, cada decoración en su nodo (mismo id) y lo suelto llevado del marco de la
 * raíz en el editor al de la raíz en la escena. Lo que no se tocó en el editor queda exactamente como estaba.
 *
 * También lo puro del menú: cuántas decoraciones tiene una pieza, quitarla con o sin ellas, duplicarla con ellas y qué
 * estructura sostiene a una decoración. Todo puro (sin React ni three.js).
 */

/** Lo abierto en el editor solitario. */
export type Solitario = {
  /** El id (en la escena) de la estructura que se edita. */
  raizId: string;
  nombre: string;
  /** Los ids de la escena que entraron al editor: la raíz y sus decoraciones (los ids se conservan). */
  miembros: string[];
  /** La vista solitaria tal como se abrió (para saber qué no se tocó). */
  escena: Escena;
};

/** Lo que dice el menú de una pieza: cuántas decoraciones lleva y, si es una decoración colgada, quién la sostiene. */
export type InfoMenuPieza = { decoraciones: string[]; sostiene: { id: string; nombre: string } | null };

const redondo = (v: number) => Math.round(v * 1000) / 1000 + 0;
const normalizarGiro = (g: number) => {
  let x = redondo(g);
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x + 0;
};

/** Las decoraciones de una pieza (lo que cuelga de ella, lo que va sobre ella y lo pegado a sus globos), sin ella. */
export function decoracionesDe(escena: Escena, id: string, armada: EscenaArmada, pegadas = decoracionesPegadas(escena, armada)): string[] {
  if (!escena.nodos.some((n) => n.id === id)) return [];
  return miembrosDeConjunto(escena, id, armada, pegadas).slice(1);
}

/**
 * La estructura que sostiene a una decoración: de la que cuelga o sobre la que va (subiendo por lo que cuelga de otra
 * decoración) o a cuyos globos va pegada. `null` si no es una decoración o va suelta.
 */
export function estructuraQueSostiene(escena: Escena, id: string, armada: EscenaArmada, pegadas?: Map<string, string>): string | null {
  const porId = new Map(escena.nodos.map((n) => [n.id, n]));
  const nodo = porId.get(id);
  if (!nodo || clasePieza(nodo.pieza) === "estructura") return null;
  let actual: NodoEscena = nodo;
  const vistos = new Set<string>([id]);
  for (;;) {
    const c = actual.colocacion;
    if (c.en !== "ancla" && c.en !== "sobre") break;
    const padre = porId.get(c.padreId);
    if (!padre || vistos.has(padre.id)) return null;
    if (clasePieza(padre.pieza) === "estructura") return padre.id;
    vistos.add(padre.id);
    actual = padre;
  }
  return (pegadas ?? decoracionesPegadas(escena, armada)).get(actual.id) ?? null;
}

/** Lo del menú de una pieza, en una sola pasada (las decoraciones pegadas se miden una vez). */
export function infoMenuPieza(escena: Escena, id: string, armada: EscenaArmada): InfoMenuPieza {
  const pegadas = decoracionesPegadas(escena, armada);
  const sostieneId = estructuraQueSostiene(escena, id, armada, pegadas);
  const sostiene = sostieneId ? escena.nodos.find((n) => n.id === sostieneId) : undefined;
  return { decoraciones: decoracionesDe(escena, id, armada, pegadas), sostiene: sostiene ? { id: sostiene.id, nombre: sostiene.nombre } : null };
}

/** Quita una pieza: con sus decoraciones (todo su conjunto) o sola (lo que colgaba de ella pasa al piso, como `quitarNodo`). */
export function eliminarPieza(escena: Escena, id: string, opciones: { conDecoraciones: boolean; armada: EscenaArmada }): Escena {
  if (!escena.nodos.some((n) => n.id === id)) return escena;
  if (!opciones.conDecoraciones) return quitarNodo(escena, id, opciones.armada);
  const fuera = new Set([id, ...decoracionesDe(escena, id, opciones.armada)]);
  return { ...escena, nodos: escena.nodos.filter((n) => !fuera.has(n.id)) };
}

/** La colocación corrida de una copia (como `duplicarNodo`): 60 cm a un lado para que se vea que hay dos. */
function corrida(c: Colocacion): Colocacion {
  if (c.en === "piso" || c.en === "techo" || c.en === "libre") return { ...c, xCm: c.xCm + 60 };
  if (c.en === "pared") return { ...c, aLoLargoCm: c.aLoLargoCm + 60 };
  return c;
}

/**
 * Duplica una pieza. Una estructura con decoraciones se copia CON ellas (todo su conjunto, 60 cm a un lado); lo demás
 * como `duplicarNodo` (lo colgado pasa a la ancla siguiente). Devuelve la escena y el id de la copia.
 */
export function duplicarPieza(escena: Escena, id: string, armada: EscenaArmada, cache?: Map<string, PiezaArmada>): { escena: Escena; id: string | null } {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo) return { escena, id: null };
  const colgada = nodo.colocacion.en === "ancla" || nodo.colocacion.en === "sobre";
  const decoraciones = colgada ? [] : decoracionesDe(escena, id, armada);
  if (!decoraciones.length) {
    const nueva = duplicarNodo(escena, id);
    return { escena: nueva, id: nueva.nodos.find((n) => !escena.nodos.some((x) => x.id === n.id))?.id ?? null };
  }
  const conjunto = extraerConjunto(escena, id, { armada });
  if (!conjunto) return { escena, id: null };
  const item: ItemBiblioteca = {
    id: `copia-${id}`, tipo: "conjunto", nombre: nodo.nombre, descripcion: "", ocasiones: [],
    contenido: { tipo: "conjunto", conjunto: { ...conjunto, raiz: { ...conjunto.raiz, nombre: `${nodo.nombre} (copia)` } } },
  };
  const r = insertarEnEscena(escena, item, corrida(nodo.colocacion), cache);
  return { escena: r.escena, id: r.raizId };
}

/**
 * Abre el editor solitario de una pieza: su conjunto solo (ids de la escena), la raíz en el origen, en la misma sala
 * sin paredes laterales ni techo. `null` si la pieza no está.
 */
export function abrirSolitario(escena: Escena, id: string, armada: EscenaArmada, cache?: Map<string, PiezaArmada>): Solitario | null {
  const conjunto = extraerConjunto(escena, id, { armada, conservarIds: true });
  if (!conjunto) return null;
  const sala = { ...structuredClone(escena.sala), mostrar: { ...escena.sala.mostrar, laterales: false, techo: false } };
  const vista = escenaDeConjunto(conjunto, { sala, conservarIds: true, cache });
  return { raizId: id, nombre: conjunto.raiz.nombre, miembros: vista.nodos.map((n) => n.id), escena: vista };
}

/** El marco con que queda puesta la raíz en una escena (la raíz colgada de otra pieza necesita la escena entera). */
function marcoDeRaiz(escena: Escena, raiz: NodoEscena, cache?: Map<string, PiezaArmada>): MarcoPieza | null {
  const c = raiz.colocacion;
  const sola: Escena = c.en === "ancla" || c.en === "sobre"
    ? { ...escena, nodos: escena.nodos.map((n) => (n.id === raiz.id ? raiz : n)) }
    : { sala: escena.sala, nodos: [raiz] };
  return armarEscena(sola, cache).porNodo.find((n) => n.id === raiz.id)?.puestas[0]?.marco ?? null;
}

/**
 * Devuelve lo editado en el editor solitario a la escena, como UN cambio:
 * - la raíz conserva su id, su sitio y su colocación; toma la pieza y el nombre editados;
 * - cada decoración que siguió en el editor vuelve a su nodo (mismo id); si no se tocó, queda idéntica; si se movió,
 *   lo colgado (ancla/sobre) va con su padre y lo suelto (libre, piso, techo) pasa del marco de la raíz en el editor al
 *   de la raíz en la escena (con su giro); lo de una pared sigue a la raíz si ella va en una pared;
 * - las que se quitaron en el editor se quitan; las nuevas (duplicadas, añadidas) entran con ids que no chocan;
 * - lo que no entró al editor no cambia.
 * Si la raíz ya no está en la escena, la escena queda igual.
 */
export function aplicarSolitario(escena: Escena, solitario: Solitario, editada: Escena, cache?: Map<string, PiezaArmada>): Escena {
  const raizId = solitario.raizId;
  const raizOriginal = escena.nodos.find((n) => n.id === raizId);
  const raizEditada = editada.nodos.find((n) => n.id === raizId);
  if (!raizOriginal || !raizEditada) return escena;
  const raiz: NodoEscena = { ...raizOriginal, nombre: raizEditada.nombre, pieza: raizEditada.pieza };
  const iniciales = new Map(solitario.escena.nodos.map((n) => [n.id, JSON.stringify(n)]));
  const miembros = new Set(solitario.miembros);
  const sinTocar = (n: NodoEscena) => miembros.has(n.id) && iniciales.get(n.id) === JSON.stringify(n);

  // Del mundo del editor al de la escena: p ↦ marcoEscena(marcoEditor⁻¹(p)); el giro es el de esa composición.
  const hijos = editada.nodos.filter((n) => n.id !== raizId);
  const sueltos = hijos.some((n) => !sinTocar(n) && n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre");
  let llevar = (p: Vec3): Vec3 => p;
  let giroDelta = 0;
  if (sueltos) {
    const deEditor = marcoDeRaiz(editada, raizEditada, cache);
    const deEscena = marcoDeRaiz(escena, raiz, cache);
    if (deEditor && deEscena) {
      llevar = (p) => puntoAlMundo(deEscena, puntoALocal(deEditor, p));
      const x = vectorAlMundo(deEscena, vectorALocal(deEditor, { x: 1, y: 0, z: 0 }));
      giroDelta = (Math.atan2(-x.z, x.x) * 180) / Math.PI;
    }
  }
  const rc = raizOriginal.colocacion;

  // Ids: los que vienen de la escena se conservan; los nuevos, sin chocar con nada de la escena.
  const ids = new Map<string, string>([[raizId, raizId]]);
  let usados: Escena = escena;
  for (const n of hijos) {
    if (miembros.has(n.id)) { ids.set(n.id, n.id); continue; }
    const id = idNuevo(usados, n.id.replace(/-\d+$/, ""));
    ids.set(n.id, id);
    usados = { ...usados, nodos: [...usados.nodos, { ...n, id }] };
  }

  const convertir = (n: NodoEscena): NodoEscena => {
    const c = n.colocacion;
    let colocacion: Colocacion;
    if (c.en === "ancla" || c.en === "sobre") colocacion = { ...c, padreId: ids.get(c.padreId) ?? c.padreId };
    else if (c.en === "libre") {
      const p = llevar({ x: c.xCm, y: c.yCm, z: c.zCm });
      colocacion = { ...c, xCm: redondo(p.x), yCm: redondo(p.y), zCm: redondo(p.z), giroGrados: normalizarGiro(c.giroGrados + giroDelta) };
    } else if (c.en === "piso" || c.en === "techo") {
      const p = llevar({ x: c.xCm, y: 0, z: c.zCm });
      colocacion = { ...c, xCm: redondo(p.x), zCm: redondo(p.z), giroGrados: normalizarGiro(c.giroGrados + giroDelta) };
    } else colocacion = rc.en === "pared" && c.pared === "fondo" ? { ...c, pared: rc.pared, aLoLargoCm: redondo(c.aLoLargoCm + rc.aLoLargoCm) } : c;
    return { ...n, id: ids.get(n.id) ?? n.id, colocacion };
  };

  const editados = new Map(hijos.map((n) => [n.id, n]));
  const nodos: NodoEscena[] = [];
  for (const n of escena.nodos) {
    if (n.id === raizId) { nodos.push(raiz); continue; }
    if (!miembros.has(n.id)) { nodos.push(n); continue; }
    const e = editados.get(n.id);
    if (!e) continue;
    nodos.push(sinTocar(e) ? n : convertir(e));
  }
  for (const n of hijos) if (!miembros.has(n.id)) nodos.push(convertir(n));
  return { ...escena, nodos };
}

/** ¿Cambió algo en el editor solitario? (para no guardar un paso vacío al pulsar «Listo»). */
export function solitarioCambio(solitario: Solitario, editada: Escena): boolean {
  return JSON.stringify(solitario.escena.nodos) !== JSON.stringify(editada.nodos);
}
