import { IDEAS_SEMPERTEX } from "./ideas-sempertex";
import { urlDeIdea } from "./ideas-sempertex/tipos";
import { perezoso } from "./perezoso";
import type { Vec3 } from "./modulos";
import {
  SALA_INICIAL, armarEscena, descendientes, idNuevo, puntoALocal, puntoAlMundo,
  type Colocacion, type Escena, type EscenaArmada, type MarcoPieza, type NodoArmado, type NodoEscena, type Sala,
} from "./escena";
import { armarPieza, type Pieza, type PiezaArmada } from "./piezas";
import type { MaterialDecoracion } from "./figuras";
import { DECORACIONES_PREDEFINIDAS } from "./figuras";
import { esDePie, esHalloween } from "./halloween";
import { sumarMateriales } from "./mezcla";
import { centroCuerpo } from "./geometria";
import { formatoPorId } from "./formatos";
import { ESCENAS_HALLOWEEN, ESCENAS_PREDEFINIDAS } from "./escenas-presets";
import { CATALOGO_DECORACIONES } from "./catalogo-fotos";
import { UTILERIA_LISTA } from "./utileria-escenas";
import { CATALOGO_UTILERIA, urlTienda } from "./utileria-catalogo";
import { impresoPorUrl } from "./impresos-catalogo";
import { metalizadoPorUrl } from "./metalizados";
import { productosDeFiesta, type ProductoEnLista } from "./utileria";
import { productoDeGlobo, type ProductoDeGlobo } from "./productos-tienda";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { BASES_ORGANICAS, conjuntoDeBase, descripcionBase, piezaDeBase, tituloFuenteBase } from "./bases-organicas";

/**
 * **La biblioteca** del taller: todo lo que se puede reutilizar, cada cosa por separado y encontrable.
 *
 * - `escena`: una escena completa (sala + piezas), tal como se ve en la foto de la idea.
 * - `conjunto`: UNA estructura con todas sus decoraciones (lo que cuelga de sus anclas, lo que va sobre ella y lo que
 *   va pegado a sus globos), autocontenido: la raíz normalizada en el origen y cada decoración en relación con ella.
 *   Es lo que se busca cuando «me gusta esa columna con sus flores».
 * - `estructura`: una estructura sola (columna, arco, pared, orgánico…), sin decoraciones.
 * - `decoracion`: una decoración pequeña (flor, moño, ojo, araña…) o un globo suelto.
 * - `utileria`: utilería de fiesta (banderín, platos, vasos…) con su producto de la tienda.
 *
 * Las de fábrica salen del código (`BIBLIOTECA_FABRICA`: escenas predefinidas, catálogo Celebra, decoraciones
 * predefinidas —con las de Halloween— y utilería) y de **indexar** cada escena: sus conjuntos, estructuras,
 * decoraciones y utilería salen como items derivados que apuntan a la escena de donde vienen, sin duplicados. La
 * biblioteca propia del usuario (lo que guarda desde la pestaña Escena) son items iguales que la página guarda aparte.
 *
 * `productosDe` da la lista exacta de compra de cualquier item: globos (formato, código, nombre oficial, cantidad y
 * el producto de la tienda), globos impresos y metalizados (su producto exacto, por sección), utilería (producto de la
 * tienda) y escenografía (no es producto). Todo puro: sin React
 * ni three.js; las fotos de las ideas son urls públicas (nada de imágenes en el repo).
 */

// ----------------------------------------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------------------------------------

export type TipoItem = "escena" | "conjunto" | "estructura" | "decoracion" | "utileria";

export const TIPOS_ITEM: ReadonlyArray<{ id: TipoItem; nombre: string; plural: string }> = [
  { id: "escena", nombre: "Escena", plural: "Escenas" },
  { id: "conjunto", nombre: "Estructura con decoraciones", plural: "Estructuras con decoraciones" },
  { id: "estructura", nombre: "Estructura", plural: "Estructuras" },
  { id: "decoracion", nombre: "Decoración", plural: "Decoraciones" },
  { id: "utileria", nombre: "Utilería", plural: "Utilería" },
];

/** Etiquetas de ocasión (un item puede tener varias). Las ideas nuevas usan estas mismas palabras. */
export const OCASIONES: readonly string[] = [
  "halloween", "amor", "navidad", "cumpleaños", "infantil", "baby shower", "boda", "grado", "quince años", "bautizo y comunión", "día de la madre", "año nuevo", "general",
];

/**
 * De dónde viene: una idea de sempertex.com, una revista Celebra, una referencia web (foto de un decorador o fabricante
 * digitalizada como base orgánica, con su sitio y enlace) o algo propio. Solo urls públicas (https).
 */
export type FuenteItem = { tipo: "idea-sempertex" | "celebra" | "referencia-web" | "propio"; titulo: string; url?: string; fotoUrl?: string };

/**
 * Una decoración pegada a la estructura sin ser hija de un ancla (los ojos sobre un racimo, la calabaza en el hueco de
 * un arco): su origen en el espacio LOCAL de la estructura (`puntoCm`) y su giro sobre la vertical relativo al de ella.
 * Al ponerla en una escena pasa a `libre` en el mundo, donde caiga la estructura.
 */
export type ColocacionRelativa = { en: "relativa"; puntoCm: Vec3; giroGrados: number };

export type NodoConjunto = { id: string; nombre: string; pieza: Pieza; colocacion: Colocacion | ColocacionRelativa };

/**
 * Una estructura con sus decoraciones, autocontenida. `raiz` va normalizada en el origen (en el piso: x = z = 0 y sin
 * giro; en una pared: la del fondo, centrada, a su altura; del techo: x = z = 0 a su caída). Los `hijos` cuelgan de
 * ella (ancla/sobre, con `padreId` del conjunto) o van relativos a ella. `sugerida`: dónde estaba en su escena (por
 * defecto, ahí se pone al añadirla). `sala`: la de su escena, para verla sola.
 */
export type Conjunto = { raiz: NodoEscena; hijos: NodoConjunto[]; sugerida: Colocacion; sala: Sala };

export type ContenidoItem =
  | { tipo: "escena"; escena: Escena }
  | { tipo: "conjunto"; conjunto: Conjunto }
  | { tipo: "pieza"; pieza: Pieza; nombre: string; sugerida: Colocacion };

/** Dónde aparece un item: la escena de la biblioteca, su nombre y las piezas de esa escena que lo forman. */
export type OrigenItem = { itemId: string; nombre: string; nodoIds: string[] };

export type ItemBiblioteca = {
  id: string;
  tipo: TipoItem;
  nombre: string;
  descripcion: string;
  ocasiones: string[];
  fuente?: FuenteItem;
  contenido: ContenidoItem;
  /** Escenas de la biblioteca que lo contienen (lo derivado y lo de fábrica que coincide con algo derivado). */
  apareceEn?: OrigenItem[];
  /** Sale de indexar una escena (no se escribió a mano). */
  derivado?: boolean;
  /** Lo guardó el usuario (biblioteca propia, en su navegador). */
  propio?: boolean;
};

// ----------------------------------------------------------------------------------------------------------
// Qué es cada pieza
// ----------------------------------------------------------------------------------------------------------

export type ClasePieza = "estructura" | "decoracion" | "utileria" | "escenografia";

/** Estructura de globos, decoración (o globo suelto), utilería de fiesta o escenografía (no es producto). */
export function clasePieza(p: Pieza): ClasePieza {
  if (p.tipo === "decoracion" || p.tipo === "globo") return "decoracion";
  if (p.tipo === "escenografia") return p.utileria ? "utileria" : "escenografia";
  return "estructura";
}

const BASE_ID: Readonly<Record<Pieza["tipo"], string>> = {
  columna: "columna", arco: "arco", pared_malla: "pared", pared_trenzas: "pared-trenzas", organico: "organico", decoracion: "decoracion",
  arco_organico: "arco-organico", guirnalda: "guirnalda", escenografia: "escenografia", globo: "globo",
  forma: "forma", letras: "letras", metalizado: "metalizado", mural: "mural", techo: "techo", arbol_globos: "arbol",
};

/** Base de id legible para una pieza nueva en una escena («columna», «arco-organico», «decoracion»…). */
export const baseIdDe = (p: Pieza): string => (p.tipo === "escenografia" && p.utileria ? `utileria-${p.utileria.replace(/_/g, "-")}` : BASE_ID[p.tipo]);

// ----------------------------------------------------------------------------------------------------------
// Claves de contenido (para no repetir) y huella (para la miniatura)
// ----------------------------------------------------------------------------------------------------------

/** Redondea los números de un JSON (para que el ruido de la coma flotante no haga distinto lo igual). */
function redondear(v: unknown, decimales = 3): unknown {
  const f = 10 ** decimales;
  if (typeof v === "number") return Math.round(v * f) / f + 0;
  if (Array.isArray(v)) return v.map((x) => redondear(x, decimales));
  if (v && typeof v === "object") {
    const salida: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) salida[k] = redondear((v as Record<string, unknown>)[k], decimales);
    return salida;
  }
  return v;
}

/** Quita lo que solo orienta (hacia dónde mira un ojo, el giro de una araña o de los pétalos): no cambia qué es. */
function sinOrientacion(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sinOrientacion);
  if (v && typeof v === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "giroGrados" && k !== "miradaGrados") salida[k] = sinOrientacion(x);
    return salida;
  }
  return v;
}

/**
 * Qué es una pieza, como texto: dos piezas con la misma clave son la misma cosa. En una decoración no cuenta cómo
 * está orientada (`deFrente`, el giro, hacia dónde mira): 14 ojos con venas mirando a lados distintos son 2 ojos (el
 * R-9 y el R-5), no 14.
 */
export function clavePieza(p: Pieza): string {
  if (p.tipo === "decoracion") return JSON.stringify(redondear(sinOrientacion({ tipo: p.tipo, decoracion: p.decoracion })));
  return JSON.stringify(redondear(p));
}

/** Qué es un conjunto: su estructura y sus decoraciones con sus colocaciones (sin nombres ni dónde estaba). */
export function claveConjunto(c: Conjunto): string {
  return JSON.stringify(redondear({ raiz: { pieza: c.raiz.pieza, colocacion: c.raiz.colocacion }, hijos: c.hijos.map((h) => ({ id: h.id, pieza: h.pieza, colocacion: h.colocacion })) }));
}

/** Claves ya calculadas, por el objeto del contenido (los items se copian, pero comparten su contenido). */
const CLAVES = new WeakMap<ContenidoItem, string>();

/** Qué es un item, como texto (el contenido no se modifica: la clave se guarda por el objeto). */
export function claveContenido(c: ContenidoItem): string {
  const guardada = CLAVES.get(c);
  if (guardada !== undefined) return guardada;
  const clave = c.tipo === "pieza" ? `pieza:${clavePieza(c.pieza)}` : c.tipo === "conjunto" ? `conjunto:${claveConjunto(c.conjunto)}` : `escena:${JSON.stringify(redondear(c.escena))}`;
  CLAVES.set(c, clave);
  return clave;
}

/** Huella corta del contenido (djb2 en base 36): cambia si cambia el contenido. Para guardar la miniatura. */
export function huellaItem(item: ItemBiblioteca): string {
  let delContenido = HUELLAS.get(item.contenido);
  if (delContenido === undefined) { delContenido = huellaDeClave(claveContenido(item.contenido)); HUELLAS.set(item.contenido, delContenido); }
  return huellaConId(item.id, delContenido);
}

const HUELLAS = new WeakMap<ContenidoItem, string>();

/** La parte de la huella que sale del contenido, a partir de su clave (`claveContenido`). */
export const huellaDeClave = (clave: string): string => djb2(clave);

/** La huella de un item (lo mismo que `huellaItem`) a partir de su id y de la huella de su contenido. */
export const huellaConId = (id: string, huellaContenido: string): string => `${djb2(id)}${huellaContenido}`;

/**
 * Firma corta de una clave, para comparar contenidos sin mandar la clave entera (la de una escena pesa cientos de kB):
 * djb2 y FNV-1a (dos sumas de 32 bits) más el largo; que dos claves distintas choquen es casi imposible.
 */
export function firmaDeClave(clave: string): string {
  let fnv = 0x811c9dc5;
  for (let i = 0; i < clave.length; i++) { fnv ^= clave.charCodeAt(i); fnv = Math.imul(fnv, 0x01000193) >>> 0; }
  return `${djb2(clave)}.${fnv.toString(36)}.${clave.length.toString(36)}`;
}

function djb2(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ----------------------------------------------------------------------------------------------------------
// Marcos: lo que se puede pasar a coordenadas de la estructura sin cambiar cómo se arma
// ----------------------------------------------------------------------------------------------------------

/** El giro sobre la vertical de un marco, si el marco es solo eso (sin volteo ni inclinación); `null` si no. */
function giroPuro(m: MarcoPieza["m"]): number | null {
  const e = 1e-6;
  if (Math.abs(m[4] - 1) > e || Math.abs(m[1]) > e || Math.abs(m[3]) > e || Math.abs(m[5]) > e || Math.abs(m[7]) > e) return null;
  return (Math.atan2(m[2], m[0]) * 180) / Math.PI;
}

const normalizarGiro = (g: number) => {
  let x = Math.round(g * 1000) / 1000;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x + 0;
};

/**
 * ¿Se puede poner esta decoración `libre` (origen y giro) sin que cambie nada? Sí si está suelta en el piso, una pared,
 * el techo o libre, su marco es solo un giro sobre la vertical y queda de frente igual que quedaría libre (las de
 * pared y libre siempre; en el piso o del techo, solo las que van de pie).
 */
function sueltaEquivalente(nodo: NodoEscena, hecho: NodoArmado | undefined): { punto: Vec3; giro: number } | null {
  const c = nodo.colocacion;
  if (c.en === "ancla" || c.en === "sobre") return null;
  const marco = hecho?.puestas[0]?.marco;
  if (!marco || hecho.copias !== 1) return null;
  const giro = giroPuro(marco.m);
  if (giro === null) return null;
  if (nodo.pieza.tipo === "decoracion" && (c.en === "piso" || c.en === "techo") && !(nodo.pieza.deFrente || esDePie(nodo.pieza.decoracion))) return null;
  return { punto: marco.t, giro };
}

// ----------------------------------------------------------------------------------------------------------
// Qué decoraciones van pegadas a qué estructura
// ----------------------------------------------------------------------------------------------------------

/** Una decoración suelta va con la estructura si alguno de sus globos o tramos queda a ≤ 4 cm de un globo de ella. */
export const CONTACTO_CM = 4;

type Bola = { c: Vec3; r: number };

function bolasDe(n: Pick<NodoArmado, "globos" | "tubos">): Bola[] {
  const bolas: Bola[] = n.globos.map((g) => {
    const l = centroCuerpo("redondo", g.infladoCm) + g.cuelloExtraCm;
    return { c: { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l }, r: g.infladoCm / 2 };
  });
  for (const t of n.tubos) {
    const pts = t.cerrado && t.puntos.length ? [...t.puntos, t.puntos[0]!] : t.puntos;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const pasos = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 3));
      for (let k = 0; k <= pasos; k++) bolas.push({ c: { x: a.x + ((b.x - a.x) * k) / pasos, y: a.y + ((b.y - a.y) * k) / pasos, z: a.z + ((b.z - a.z) * k) / pasos }, r: t.grosorCm / 2 });
    }
  }
  return bolas;
}

/** La distancia entre superficies más corta de dos grupos de bolas (con un descarte por cajas). */
function distanciaEntre(a: readonly Bola[], b: readonly Bola[], tope: number): number {
  if (!a.length || !b.length) return Infinity;
  const caja = (bs: readonly Bola[]) => bs.reduce((k, x) => ({
    min: { x: Math.min(k.min.x, x.c.x - x.r), y: Math.min(k.min.y, x.c.y - x.r), z: Math.min(k.min.z, x.c.z - x.r) },
    max: { x: Math.max(k.max.x, x.c.x + x.r), y: Math.max(k.max.y, x.c.y + x.r), z: Math.max(k.max.z, x.c.z + x.r) },
  }), { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } });
  const ka = caja(a), kb = caja(b);
  if (ka.min.x > kb.max.x + tope || kb.min.x > ka.max.x + tope || ka.min.y > kb.max.y + tope || kb.min.y > ka.max.y + tope || ka.min.z > kb.max.z + tope || kb.min.z > ka.max.z + tope) return Infinity;
  let mejor = Infinity;
  for (const x of a) {
    if (x.c.x + x.r < kb.min.x - tope || x.c.x - x.r > kb.max.x + tope || x.c.y + x.r < kb.min.y - tope || x.c.y - x.r > kb.max.y + tope || x.c.z + x.r < kb.min.z - tope || x.c.z - x.r > kb.max.z + tope) continue;
    for (const y of b) {
      const d = Math.hypot(x.c.x - y.c.x, x.c.y - y.c.y, x.c.z - y.c.z) - x.r - y.r;
      if (d < mejor) mejor = d;
    }
  }
  return mejor;
}

/**
 * Las decoraciones sueltas (no colgadas de un ancla) que van pegadas a una estructura de globos: la estructura más
 * cercana con contacto (≤ `CONTACTO_CM`). Lo apoyado en la escenografía (la calabaza sobre la mesa, la mano en el
 * panel del marco) no es de ninguna estructura. Devuelve id de la decoración → id de su estructura.
 */
export function decoracionesPegadas(escena: Escena, armada: EscenaArmada): Map<string, string> {
  const hechos = new Map(armada.porNodo.map((n) => [n.id, n]));
  const estructuras = escena.nodos.filter((n) => clasePieza(n.pieza) === "estructura" && (hechos.get(n.id)?.copias ?? 0) > 0)
    .map((n) => ({ id: n.id, bolas: bolasDe(hechos.get(n.id)!) }));
  const salida = new Map<string, string>();
  for (const nodo of escena.nodos) {
    if (clasePieza(nodo.pieza) !== "decoracion" || !sueltaEquivalente(nodo, hechos.get(nodo.id))) continue;
    const bolas = bolasDe(hechos.get(nodo.id)!);
    let mejor: { id: string; d: number } | null = null;
    for (const e of estructuras) {
      const d = distanciaEntre(bolas, e.bolas, CONTACTO_CM);
      if (d <= CONTACTO_CM && (!mejor || d < mejor.d)) mejor = { id: e.id, d };
    }
    if (mejor) salida.set(nodo.id, mejor.id);
  }
  return salida;
}

/** Los ids de un conjunto en el orden de la escena: la raíz, lo que cuelga de ella y lo que va pegado (y lo de eso). */
export function miembrosDeConjunto(escena: Escena, nodoId: string, armada: EscenaArmada, pegadas = decoracionesPegadas(escena, armada)): string[] {
  const dentro = descendientes(escena, nodoId);
  for (const [deco, estructura] of pegadas) if (estructura === nodoId) for (const id of descendientes(escena, deco)) dentro.add(id);
  return [nodoId, ...escena.nodos.map((n) => n.id).filter((id) => id !== nodoId && dentro.has(id))];
}

// ----------------------------------------------------------------------------------------------------------
// Extraer un conjunto y volver a ponerlo
// ----------------------------------------------------------------------------------------------------------

/** La colocación de la raíz en el origen (ver `Conjunto`). */
function colocacionNormalizada(nodo: NodoEscena): Colocacion {
  const c = nodo.colocacion;
  if (c.en === "piso") return { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
  if (c.en === "pared") return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: c.alturaCm };
  if (c.en === "techo") return { en: "techo", xCm: 0, zCm: 0, cuelgaCm: c.cuelgaCm, giroGrados: 0, volteada: c.volteada };
  if (c.en === "libre") return { en: "libre", xCm: 0, yCm: c.yCm, zCm: 0, giroGrados: 0 };
  // Colgada de otra pieza que no viene: una decoración, de frente en la pared; lo demás, en el piso.
  return clasePieza(nodo.pieza) === "decoracion" ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 100 } : { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
}

export type OpcionesExtraer = {
  /** La escena ya armada (si no, se arma). */
  armada?: EscenaArmada;
  /** Contar también las decoraciones sueltas pegadas a sus globos (por defecto, sí). */
  pegadas?: boolean;
};

/**
 * El nodo y todo lo suyo como un conjunto autocontenido: lo que cuelga de él (ancla/sobre, a cualquier profundidad) y
 * las decoraciones sueltas pegadas a sus globos (ver `decoracionesPegadas`), con ids nuevos y estables («estructura»,
 * «hijo-1», «hijo-2»… en el orden de la escena), la raíz en el origen y las sueltas relativas a ella. `null` si el nodo
 * no está. Extraer dos veces (o de la misma escena con otros ids) da exactamente lo mismo.
 */
export function extraerConjunto(escena: Escena, nodoId: string, opciones: OpcionesExtraer = {}): Conjunto | null {
  const raiz = escena.nodos.find((n) => n.id === nodoId);
  if (!raiz) return null;
  const armada = opciones.armada ?? armarEscena(escena);
  const hechos = new Map(armada.porNodo.map((n) => [n.id, n]));
  const pegadas = opciones.pegadas === false ? new Map<string, string>() : decoracionesPegadas(escena, armada);
  const ids = miembrosDeConjunto(escena, nodoId, armada, pegadas);
  const nuevoId = new Map(ids.map((id, i) => [id, i === 0 ? "estructura" : `hijo-${i}`]));
  const marcoRaiz = hechos.get(nodoId)?.puestas[0]?.marco;
  const giroRaiz = marcoRaiz ? giroPuro(marcoRaiz.m) : null;
  const hijos: NodoConjunto[] = [];
  for (const id of ids.slice(1)) {
    const nodo = escena.nodos.find((n) => n.id === id)!;
    const c = nodo.colocacion;
    let colocacion: NodoConjunto["colocacion"];
    if ((c.en === "ancla" || c.en === "sobre") && nuevoId.has(c.padreId)) colocacion = { ...structuredClone(c), padreId: nuevoId.get(c.padreId)! };
    else {
      const suelta = sueltaEquivalente(nodo, hechos.get(id));
      // Sin marco de la raíz (cabeza abajo) o sin equivalente suelto no se puede llevar con ella: se queda fuera.
      if (!suelta || !marcoRaiz || giroRaiz === null) continue;
      const p = puntoALocal(marcoRaiz, suelta.punto);
      colocacion = { en: "relativa", puntoCm: { x: Math.round(p.x * 1000) / 1000 + 0, y: Math.round(p.y * 1000) / 1000 + 0, z: Math.round(p.z * 1000) / 1000 + 0 }, giroGrados: normalizarGiro(suelta.giro - giroRaiz) };
    }
    hijos.push({ id: nuevoId.get(id)!, nombre: nodo.nombre, pieza: structuredClone(nodo.pieza), colocacion });
  }
  // Lo que colgaba de algo que se quedó fuera, también fuera (hasta que no quede nada colgando del aire).
  for (let cambio = true; cambio;) {
    cambio = false;
    const presentes = new Set(["estructura", ...hijos.map((h) => h.id)]);
    for (let i = hijos.length - 1; i >= 0; i--) {
      const c = hijos[i]!.colocacion;
      if ((c.en === "ancla" || c.en === "sobre") && !presentes.has(c.padreId)) { hijos.splice(i, 1); cambio = true; }
    }
  }
  const sugerida: Colocacion = raiz.colocacion.en === "ancla" || raiz.colocacion.en === "sobre" ? colocacionNormalizada(raiz) : structuredClone(raiz.colocacion);
  return {
    raiz: { id: "estructura", nombre: raiz.nombre, pieza: structuredClone(raiz.pieza), colocacion: colocacionNormalizada(raiz) },
    hijos, sugerida, sala: structuredClone(escena.sala),
  };
}

/** `colocacion` dentro de la sala (lo que va en el piso, una pared o el techo no se sale de su superficie). */
export function dentroDeSala(c: Colocacion, sala: Sala): Colocacion {
  const lim = (v: number, max: number) => Math.max(-max, Math.min(max, v));
  if (c.en === "piso") return { ...c, xCm: lim(c.xCm, sala.anchoCm / 2), zCm: lim(c.zCm, sala.fondoCm / 2) };
  if (c.en === "techo") return { ...c, xCm: lim(c.xCm, sala.anchoCm / 2), zCm: lim(c.zCm, sala.fondoCm / 2), cuelgaCm: Math.max(0, Math.min(sala.altoCm, c.cuelgaCm)) };
  if (c.en === "pared") return { ...c, aLoLargoCm: lim(c.aLoLargoCm, (c.pared === "fondo" ? sala.anchoCm : sala.fondoCm) / 2), alturaCm: Math.max(0, Math.min(sala.altoCm, c.alturaCm)) };
  if (c.en === "libre") return { ...c, xCm: lim(c.xCm, sala.anchoCm / 2), yCm: Math.max(0, Math.min(sala.altoCm, c.yCm)), zCm: lim(c.zCm, sala.fondoCm / 2) };
  return c;
}

/**
 * Los nodos de un conjunto puestos en una escena: la raíz en `donde` (o donde estaba), ids nuevos que no chocan con los
 * de `escena`, lo colgado con su padre nuevo y lo relativo pasado a `libre` en el mundo (con el marco de la raíz ya
 * puesta en esa sala).
 */
function nodosDeConjunto(escena: Escena, conjunto: Conjunto, donde: Colocacion): NodoEscena[] {
  let usados: Escena = escena;
  const nuevoId = new Map<string, string>();
  const reservar = (idConjunto: string, pieza: Pieza) => {
    const id = idNuevo(usados, baseIdDe(pieza));
    nuevoId.set(idConjunto, id);
    usados = { ...usados, nodos: [...usados.nodos, { id, nombre: "", pieza, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
    return id;
  };
  const raiz: NodoEscena = { ...structuredClone(conjunto.raiz), id: reservar(conjunto.raiz.id, conjunto.raiz.pieza), colocacion: structuredClone(donde) };
  for (const h of conjunto.hijos) reservar(h.id, h.pieza);
  const necesitaMarco = conjunto.hijos.some((h) => h.colocacion.en === "relativa");
  const marco = necesitaMarco ? armarEscena({ sala: escena.sala, nodos: [raiz] }).porNodo[0]?.puestas[0]?.marco : undefined;
  const giroRaiz = marco ? giroPuro(marco.m) ?? 0 : 0;
  const salida: NodoEscena[] = [raiz];
  for (const h of conjunto.hijos) {
    const c = h.colocacion;
    let colocacion: Colocacion;
    if (c.en === "relativa") {
      if (!marco) continue;
      const p = puntoAlMundo(marco, c.puntoCm);
      colocacion = { en: "libre", xCm: p.x, yCm: p.y, zCm: p.z, giroGrados: normalizarGiro(giroRaiz + c.giroGrados) };
    } else if (c.en === "ancla" || c.en === "sobre") colocacion = { ...structuredClone(c), padreId: nuevoId.get(c.padreId) ?? c.padreId };
    else colocacion = structuredClone(c);
    salida.push({ id: nuevoId.get(h.id)!, nombre: h.nombre, pieza: structuredClone(h.pieza), colocacion });
  }
  return salida;
}

/** Un conjunto solo, en su sala (o en otra), con la raíz en `donde` (por defecto, en el origen). */
export function escenaDeConjunto(conjunto: Conjunto, opciones: { sala?: Sala; donde?: Colocacion } = {}): Escena {
  const sala = structuredClone(opciones.sala ?? conjunto.sala);
  return { sala, nodos: nodosDeConjunto({ sala, nodos: [] }, conjunto, opciones.donde ?? conjunto.raiz.colocacion) };
}

/** Dónde se pone por defecto lo de un item al añadirlo a otra escena: donde estaba en la suya, dentro de la sala. */
export function dondeSugerido(item: ItemBiblioteca, sala: Sala): Colocacion | null {
  const c = item.contenido;
  if (c.tipo === "conjunto") return dentroDeSala(c.conjunto.sugerida, sala);
  if (c.tipo === "pieza") return dentroDeSala(c.sugerida, sala);
  return null;
}

/**
 * Añade un item a una escena conservando su armado interno: un conjunto con sus decoraciones (colgadas de la raíz y
 * las pegadas en su sitio respecto de ella), una pieza sola, o todas las piezas de una escena (con sus colocaciones).
 * `donde` es la colocación de la raíz (o de la pieza); sin ella, donde estaba en su escena. Los ids nuevos no chocan
 * con los de la escena. La escena de entrada no cambia.
 */
export function insertarEnEscena(escena: Escena, item: ItemBiblioteca, donde?: Colocacion): { escena: Escena; ids: string[]; raizId: string | null } {
  const c = item.contenido;
  let nuevos: NodoEscena[];
  if (c.tipo === "conjunto") nuevos = nodosDeConjunto(escena, c.conjunto, donde ?? dentroDeSala(c.conjunto.sugerida, escena.sala));
  else if (c.tipo === "pieza") nuevos = [{ id: idNuevo(escena, baseIdDe(c.pieza)), nombre: c.nombre, pieza: structuredClone(c.pieza), colocacion: structuredClone(donde ?? dentroDeSala(c.sugerida, escena.sala)) }];
  else {
    // Una escena entera: cada pieza con su colocación, los ids renombrados y lo colgado con su padre nuevo.
    let usados: Escena = escena;
    const nuevoId = new Map<string, string>();
    for (const n of c.escena.nodos) {
      const id = idNuevo(usados, baseIdDe(n.pieza));
      nuevoId.set(n.id, id);
      usados = { ...usados, nodos: [...usados.nodos, { ...n, id }] };
    }
    nuevos = c.escena.nodos.map((n) => {
      const col = structuredClone(n.colocacion);
      return { id: nuevoId.get(n.id)!, nombre: n.nombre, pieza: structuredClone(n.pieza), colocacion: col.en === "ancla" || col.en === "sobre" ? { ...col, padreId: nuevoId.get(col.padreId) ?? col.padreId } : col };
    });
  }
  return { escena: { ...escena, nodos: [...escena.nodos, ...nuevos] }, ids: nuevos.map((n) => n.id), raizId: nuevos[0]?.id ?? null };
}

/** La sala para ver sola una pieza: la de partida, sin paredes laterales ni techo. */
const SALA_PIEZA: Sala = { ...SALA_INICIAL, tonos: { ...SALA_INICIAL.tonos }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } };

/** Lo que se ve de un item, como escena: la suya, el conjunto solo en su sala o la pieza sola donde va. */
export function escenaDeItem(item: ItemBiblioteca): Escena {
  const c = item.contenido;
  if (c.tipo === "escena") return structuredClone(c.escena);
  if (c.tipo === "conjunto") return escenaDeConjunto(c.conjunto, { sala: { ...c.conjunto.sala, mostrar: { ...c.conjunto.sala.mostrar, laterales: false, techo: false } } });
  const sala = structuredClone(SALA_PIEZA);
  const suelta: Colocacion = c.sugerida.en === "ancla" || c.sugerida.en === "sobre" ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 100 } : c.sugerida;
  // Sola, centrada: lo de piso y techo al centro, lo de pared en el centro de la del fondo.
  const centrada: Colocacion = suelta.en === "piso" ? { ...suelta, xCm: 0, zCm: 0 } : suelta.en === "techo" ? { ...suelta, xCm: 0, zCm: 0 } : suelta.en === "pared" ? { ...suelta, pared: "fondo", aLoLargoCm: 0 } : { ...suelta, xCm: 0, zCm: 0 };
  return { sala, nodos: [{ id: baseIdDe(c.pieza), nombre: c.nombre, pieza: structuredClone(c.pieza), colocacion: dentroDeSala(centrada, sala) }] };
}

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

/** Un globo de la lista de compra: cuántos, de qué formato y color, su nombre oficial y su producto en la tienda. */
export type LineaGlobo = {
  formatoId: string;
  /** «Redondo 12"». */
  formato: string;
  codigo: string;
  /** «Reflex Dorado». */
  color: string;
  /** «R-12 Reflex Dorado 970»: así se pide. */
  nombreOficial: string;
  cantidad: number;
  /** Los tubitos se cuentan por largo (~137 cm útiles por T-260). */
  porLargo: boolean;
  producto: ProductoDeGlobo;
  /** Cuántos de estos globos van impresos: se compran como el impreso de la tienda (ver `tienda`), no como el liso. */
  impresos?: number;
};

/**
 * Un globo impreso o un metalizado de la tienda (lo que no es un globo liso): nombre exacto, url de la tienda, cuántos,
 * su sección («impresos» o «metalizados»), qué es (formato y caras, o «foil») y en qué piezas va.
 */
export type LineaTienda = { seccion: "impresos" | "metalizados"; nombre: string; url: string; cantidad: number; detalle: string; piezas: string[] };

/** Lo que va en la foto y no se compra en la tienda como producto: escenografía, papel y follaje. */
export type LineaEscenografia = { nombre: string; clase: "escenografia" | "papel" | "follaje"; cantidad: number; piezas: string[] };

export type ProductosDeItem = { globos: LineaGlobo[]; totalGlobos: number; tienda: LineaTienda[]; utileria: ProductoEnLista[]; escenografia: LineaEscenografia[] };

const CARAS_IMPRESO: Readonly<Record<string, string>> = { infinity: "impreso alrededor (Infinity®)", "2 caras": "impreso por las 2 caras", "1 cara": "impreso por 1 cara" };

/** Qué es un producto de la tienda que no es un globo liso (para la columna «qué es»). */
function detalleTienda(url: string, seccion: LineaTienda["seccion"]): string {
  const impreso = impresoPorUrl(url);
  if (impreso) return `${impreso.formatoId} · ${CARAS_IMPRESO[impreso.caras] ?? impreso.caras}`;
  const metalizado = metalizadoPorUrl(url);
  if (metalizado?.metalizado) return `Metalizado (foil) de ${metalizado.metalizado.pulgadas}" · no es látex`;
  return seccion === "metalizados" ? "Metalizado (foil) · no es látex" : "Globo impreso";
}

const ORDEN_TIPO: Readonly<Record<string, number>> = { redondo: 0, link: 1, tubito: 2, corazon: 3 };

/** La lista de globos (de unos materiales), ordenada por formato y por cantidad. */
export function lineasDeGlobos(materiales: readonly MaterialDecoracion[]): LineaGlobo[] {
  return sumarMateriales(materiales).filter((m) => m.cantidad > 0).map((m): LineaGlobo => {
    const formato = formatoPorId(m.formatoId);
    const ref = referenciaPorCodigo(m.codigo);
    const color = ref?.nombreCompleto ?? m.codigo;
    return {
      formatoId: m.formatoId, formato: formato?.nombre ?? m.formatoId, codigo: m.codigo, color, nombreOficial: `${m.formatoId} ${color} ${m.codigo}`,
      cantidad: m.cantidad, porLargo: formato?.tipo === "tubito", producto: productoDeGlobo(m.formatoId, m.codigo),
    };
  }).sort((a, b) => {
    const fa = formatoPorId(a.formatoId), fb = formatoPorId(b.formatoId);
    return (ORDEN_TIPO[fa?.tipo ?? ""] ?? 9) - (ORDEN_TIPO[fb?.tipo ?? ""] ?? 9) || (fb?.diametroMaxCm ?? 0) - (fa?.diametroMaxCm ?? 0) || b.cantidad - a.cantidad || a.codigo.localeCompare(b.codigo);
  });
}

/**
 * La lista exacta de productos de un item: los globos (formato + código + nombre oficial + cantidad y el producto de la
 * tienda), la utilería (producto de la tienda, o genérico) y aparte lo que no es producto (escenografía, papel, flores
 * artificiales). `armada`: la de `escenaDeItem(item)` si ya se tiene.
 */
export function productosDe(item: ItemBiblioteca, armada?: EscenaArmada, cache?: Map<string, PiezaArmada>): ProductosDeItem {
  const escena = escenaDeItem(item);
  const hecha = armada ?? armarEscena(escena, cache);
  const globos = lineasDeGlobos(hecha.materiales);
  const escenografia = new Map<string, LineaEscenografia>();
  const sumar = (nombre: string, clase: LineaEscenografia["clase"], cantidad: number, pieza: string) => {
    const k = `${clase}|${nombre}`;
    const previo = escenografia.get(k);
    if (previo) { previo.cantidad += cantidad; if (!previo.piezas.includes(pieza)) previo.piezas.push(pieza); }
    else escenografia.set(k, { nombre, clase, cantidad, piezas: [pieza] });
  };
  // Globos impresos y metalizados: el producto exacto de la tienda de cada pieza, por las veces que quedó puesta.
  const tienda = new Map<string, LineaTienda>();
  const impresosPorGlobo = new Map<string, number>();
  for (const nodo of escena.nodos) {
    const hecho = hecha.porNodo.find((n) => n.id === nodo.id);
    if (!hecho || hecho.copias === 0) continue;
    if (nodo.pieza.tipo !== "metalizado" && !nodo.pieza.impresos?.length) continue;
    const pieza = cache?.get(JSON.stringify(nodo.pieza)) ?? armarPieza(nodo.pieza);
    const seccion: LineaTienda["seccion"] = nodo.pieza.tipo === "metalizado" ? "metalizados" : "impresos";
    for (const p of pieza.productos ?? []) {
      const url = urlTienda(p.url);
      const previo = tienda.get(url);
      if (previo) { previo.cantidad += p.cantidad * hecho.copias; if (!previo.piezas.includes(nodo.nombre)) previo.piezas.push(nodo.nombre); }
      else tienda.set(url, { seccion, nombre: p.nombre, url, cantidad: p.cantidad * hecho.copias, detalle: detalleTienda(p.url, seccion), piezas: [nodo.nombre] });
    }
    for (const g of pieza.globos) {
      if (!g.estampado?.impreso) continue;
      const k = `${g.formatoId}|${g.codigo}`;
      impresosPorGlobo.set(k, (impresosPorGlobo.get(k) ?? 0) + hecho.copias);
    }
  }
  for (const linea of globos) {
    const n = impresosPorGlobo.get(`${linea.formatoId}|${linea.codigo}`);
    if (n) linea.impresos = Math.min(n, linea.cantidad);
  }
  for (const nodo of escena.nodos) {
    const hecho = hecha.porNodo.find((n) => n.id === nodo.id);
    if (!hecho || hecho.copias === 0) continue;
    // Lo oculto (amarres internos) no se ve ni se compra: no va en la lista.
    if (nodo.pieza.tipo === "escenografia" && !nodo.pieza.productos?.length && !nodo.pieza.elementos.every((e) => e.oculto)) sumar(nodo.nombre.replace(/\s*\(.*\)$/, ""), "escenografia", hecho.copias, nodo.nombre);
    if (nodo.pieza.tipo === "decoracion" && hecho.materiales.length === 0 && hecho.tubos.some((t) => t.papel)) sumar(nombreGenerico(nodo.nombre), "papel", hecho.copias, nodo.nombre);
    if (hecho.flores.length) sumar("Flores artificiales (follaje)", "follaje", hecho.flores.length, nodo.nombre);
    // El relleno de un globo burbuja (confeti, plumas) es papel: no es producto de la tienda.
    if (nodo.pieza.tipo === "decoracion" && nodo.pieza.decoracion.tipo === "burbuja" && nodo.pieza.decoracion.propiedades.relleno) {
      sumar(nodo.pieza.decoracion.propiedades.relleno.tipo === "confeti" ? "Confeti (relleno del globo burbuja)" : "Plumas (relleno del globo burbuja)", "papel", hecho.copias, nodo.nombre);
    }
  }
  const ordenTienda = (a: LineaTienda, b: LineaTienda) => a.seccion.localeCompare(b.seccion) || b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es");
  return { globos, totalGlobos: globos.reduce((s, g) => s + g.cantidad, 0), tienda: [...tienda.values()].sort(ordenTienda), utileria: productosDeFiesta(escena, hecha), escenografia: [...escenografia.values()] };
}

// ----------------------------------------------------------------------------------------------------------
// Resumen (para la tarjeta y los filtros)
// ----------------------------------------------------------------------------------------------------------

export type ResumenItem = {
  globos: number;
  /** Códigos de color de los globos, del más usado al menos. */
  colores: string[];
  /** «R-12|970»: los globos que usa (formato y código). */
  productos: string[];
  piezas: number;
};

export function resumenDe(item: ItemBiblioteca, armada: EscenaArmada): ResumenItem {
  const porColor = new Map<string, number>();
  for (const m of armada.materiales) porColor.set(m.codigo, (porColor.get(m.codigo) ?? 0) + m.cantidad);
  return {
    globos: armada.materiales.reduce((s, m) => s + m.cantidad, 0),
    colores: [...porColor.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c),
    productos: [...new Set(armada.materiales.filter((m) => m.cantidad > 0).map((m) => `${m.formatoId}|${m.codigo}`))].sort(),
    piezas: armada.porNodo.length,
  };
}

export type FiltroBiblioteca = { tipo?: TipoItem | null; ocasion?: string | null; color?: string | null; producto?: string | null; texto?: string };

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Los items que cumplen el filtro: tipo, ocasión, color (código), producto («R-12|970») y texto (en el nombre, la
 * descripción, la fuente, las ocasiones y los nombres de sus colores, sin tildes). Sin resumen (todavía sin armar),
 * un filtro de color o producto no lo deja pasar.
 */
export function filtrarBiblioteca(items: readonly ItemBiblioteca[], resumenes: ReadonlyMap<string, ResumenItem>, f: FiltroBiblioteca): ItemBiblioteca[] {
  const palabras = plano(f.texto ?? "").split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (f.tipo && item.tipo !== f.tipo) return false;
    if (f.ocasion && !item.ocasiones.includes(f.ocasion)) return false;
    const r = resumenes.get(item.id);
    if (f.color && !r?.colores.includes(f.color)) return false;
    if (f.producto && !r?.productos.includes(f.producto)) return false;
    if (!palabras.length) return true;
    const texto = plano([item.nombre, item.descripcion, item.fuente?.titulo ?? "", ...item.ocasiones, ...(r?.productos ?? []).map((p) => {
      const [formatoId, codigo] = p.split("|");
      return `${formatoId} ${referenciaPorCodigo(codigo ?? "")?.nombreCompleto ?? ""} ${codigo}`;
    })].join(" "));
    return palabras.every((p) => texto.includes(p));
  });
}

// ----------------------------------------------------------------------------------------------------------
// Indexar una escena
// ----------------------------------------------------------------------------------------------------------

/** «Ojo con venas 3» → «Ojo con venas»; «Ojos saltones (arriba a la izquierda)» → «Ojos saltones». */
export function nombreGenerico(nombre: string): string {
  return nombre.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+\d+$/, "").trim() || nombre;
}

const cuenta = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Lo que contiene una escena, como items derivados: cada estructura de globos con sus decoraciones (`conjunto`; sin
 * decoraciones, `estructura`), cada decoración y cada pieza de utilería (`decoracion`, `utileria`), sin repetir lo que
 * es igual (ver `clavePieza`). Cada uno dice de qué escena sale y qué piezas de ella lo forman. Lo que está colgado de
 * otra pieza o pegado a una estructura sale dentro de su conjunto y, además, solo como decoración.
 */
export function indexarEscena(item: ItemBiblioteca, armada?: EscenaArmada, cache?: Map<string, PiezaArmada>): ItemBiblioteca[] {
  if (item.contenido.tipo !== "escena") return [];
  const escena = item.contenido.escena;
  const hecha = armada ?? armarEscena(escena, cache);
  const pegadas = decoracionesPegadas(escena, hecha);
  const porClave = new Map<string, ItemBiblioteca>();
  const origen = (nodoIds: string[]): OrigenItem => ({ itemId: item.id, nombre: item.nombre, nodoIds });
  const anotar = (clave: string, crear: () => ItemBiblioteca, nodoIds: string[]) => {
    const previo = porClave.get(clave);
    if (previo) { previo.apareceEn![0]!.nodoIds.push(...nodoIds); return; }
    porClave.set(clave, { ...crear(), apareceEn: [origen(nodoIds)], derivado: true, ocasiones: [...item.ocasiones], ...(item.fuente ? { fuente: { ...item.fuente } } : {}) });
  };
  for (const nodo of escena.nodos) {
    const clase = clasePieza(nodo.pieza);
    if (clase === "estructura" || clase === "escenografia") {
      const conjunto = extraerConjunto(escena, nodo.id, { armada: hecha });
      if (!conjunto) continue;
      // La escenografía (una escalera, un panel, una mesa) solo es conjunto si lleva globos colgados: «la escalera con
      // sus ramos» se puede sacar sola; sin nada colgado no es item.
      // Si la escenografía cuelga a su vez de otra pieza (la varilla oculta de una columna), ya va dentro del conjunto
      // de esa pieza: no se repite como conjunto propio.
      if (clase === "escenografia" && (nodo.colocacion.en === "ancla" || nodo.colocacion.en === "sobre" || !conjunto.hijos.some((h) => clasePieza(h.pieza) !== "escenografia"))) continue;
      const ids = miembrosDeConjunto(escena, nodo.id, hecha, pegadas);
      if (conjunto.hijos.length === 0) {
        anotar(`pieza:${clavePieza(nodo.pieza)}`, () => ({
          id: `${item.id}~${nodo.id}`, tipo: "estructura", nombre: nodo.nombre, descripcion: `${nodo.nombre}, de la escena «${item.nombre}».`,
          ocasiones: [], contenido: { tipo: "pieza", pieza: structuredClone(nodo.pieza), nombre: nodo.nombre, sugerida: structuredClone(conjunto.sugerida) },
        }), [nodo.id]);
      } else {
        const nombres = new Map<string, number>();
        for (const h of conjunto.hijos) nombres.set(nombreGenerico(h.nombre), (nombres.get(nombreGenerico(h.nombre)) ?? 0) + 1);
        const lista = [...nombres.entries()].map(([n, k]) => (k > 1 ? `${k} × ${n}` : n)).join(", ");
        anotar(`conjunto:${claveConjunto(conjunto)}`, () => ({
          id: `${item.id}~${nodo.id}`, tipo: "conjunto", nombre: `${nodo.nombre} con sus decoraciones`,
          descripcion: `${nodo.nombre} con ${cuenta(conjunto.hijos.length, "decoración", "decoraciones")} (${lista}), de la escena «${item.nombre}».`,
          ocasiones: [], contenido: { tipo: "conjunto", conjunto },
        }), ids);
      }
      continue;
    }
    const hecho = hecha.porNodo.find((n) => n.id === nodo.id);
    if (!hecho || hecho.copias === 0) continue;
    const marco = hecho.puestas[0]?.marco;
    // La colocación sugerida de una decoración suelta: la suya; si cuelga de otra pieza, de frente en la pared.
    const sugerida: Colocacion = nodo.colocacion.en === "ancla" || nodo.colocacion.en === "sobre"
      ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: marco ? Math.max(0, Math.round(hecho.caja.min.y)) : 100 }
      : structuredClone(nodo.colocacion);
    const nombre = nombreGenerico(nodo.nombre);
    anotar(`pieza:${clavePieza(nodo.pieza)}`, () => ({
      id: `${item.id}~${nodo.id}`, tipo: clase === "utileria" ? "utileria" : "decoracion", nombre,
      descripcion: `${nombre}, de la escena «${item.nombre}».`, ocasiones: [],
      contenido: { tipo: "pieza", pieza: structuredClone(nodo.pieza), nombre, sugerida },
    }), [nodo.id]);
  }
  return nombrarSinRepetir([...porClave.values()], escena, hecha);
}

/** Las palabras del principio que comparten varios nombres («Columna izquierda», «Columna derecha» → «Columna»). */
function nombreComun(nombres: readonly string[]): string {
  const partes = nombres.map((n) => nombreGenerico(n).split(/\s+/));
  const salida: string[] = [];
  for (let i = 0; partes.every((p) => p[i] !== undefined && p[i] === partes[0]![i]); i++) salida.push(partes[0]![i]!);
  return salida.join(" ");
}

/**
 * Nombres que se distinguen: lo que sale de varias piezas toma lo que comparten sus nombres («Columna», «Tira»); si dos
 * items de la escena se llamarían igual (cuatro fantasmas de tamaños distintos), cada uno lleva el nombre completo de
 * su pieza («Fantasma (rama izquierda)») y, si aún chocan, un número.
 */
function nombrarSinRepetir(items: ItemBiblioteca[], escena: Escena, hecha: EscenaArmada): ItemBiblioteca[] {
  const nombreDe = (id: string) => escena.nodos.find((n) => n.id === id)?.nombre ?? id;
  const metros = (cm: number) => `${(Math.round(cm / 10) / 10).toLocaleString("es-CO")} m`;
  /** «de 1,4 m» de alto (o de ancho, si es más ancha que alta), por su caja armada. */
  const medida = (id: string) => {
    const caja = hecha.porNodo.find((n) => n.id === id)?.caja;
    if (!caja) return "";
    const alto = caja.max.y - caja.min.y, ancho = Math.max(caja.max.x - caja.min.x, caja.max.z - caja.min.z);
    return alto >= ancho ? `de ${metros(alto)} de alto` : `de ${metros(ancho)} de ancho`;
  };
  for (const i of items) {
    const ids = i.apareceEn?.[0]?.nodoIds ?? [];
    if (i.tipo === "estructura") i.nombre = (ids.length > 1 ? nombreComun(ids.map(nombreDe)) : nombreGenerico(i.nombre)) || i.nombre;
  }
  const veces = new Map<string, number>();
  for (const i of items) veces.set(i.nombre, (veces.get(i.nombre) ?? 0) + 1);
  for (const i of items) {
    if ((veces.get(i.nombre) ?? 0) < 2) continue;
    const primero = i.apareceEn?.[0]?.nodoIds[0] ?? "";
    // Estructuras iguales de nombre: por su medida («Tira de 1,1 m de alto»); decoraciones: por su pieza.
    i.nombre = i.tipo === "estructura" ? `${i.nombre} ${medida(primero)}`.trim() : i.tipo === "conjunto" ? i.nombre : nombreDe(primero);
  }
  const usados = new Map<string, number>();
  for (const i of items) {
    const k = (usados.get(i.nombre) ?? 0) + 1;
    usados.set(i.nombre, k);
    if (k > 1) i.nombre = `${i.nombre} (${k})`;
  }
  return items;
}

/**
 * La biblioteca entera: los items de base y lo que sale de indexar cada escena, sin duplicados. Si algo derivado es igual
 * a un item que ya está (una decoración predefinida usada en una escena), no se repite: ese item suma la escena a
 * `apareceEn`. `indices`: el índice de cada escena ya calculado (id de la escena → derivados), para no rearmarlas.
 * `clave`: qué es cada item (por defecto `claveContenido`, que arma su contenido); la pestaña Biblioteca pasa las
 * claves que ya calculó fuera del hilo de la página para no armar nada aquí.
 */
export function unirBiblioteca(
  base: readonly ItemBiblioteca[],
  indices: ReadonlyMap<string, readonly ItemBiblioteca[]>,
  clave: (item: ItemBiblioteca) => string = (item) => claveContenido(item.contenido),
): ItemBiblioteca[] {
  const salida: ItemBiblioteca[] = [];
  const porClave = new Map<string, ItemBiblioteca>();
  /** Mete un item; si ya hay uno igual, ese suma sus escenas y ocasiones (gana el primero: el de mejor fuente). */
  const meter = (i: ItemBiblioteca) => {
    const k = clave(i);
    const previo = porClave.get(k);
    if (!previo) {
      // Copia sin evaluar getters: el contenido de lo de fábrica sigue perezoso.
      const copia = copiarItem(i, { ocasiones: [...i.ocasiones], ...(i.apareceEn ? { apareceEn: i.apareceEn.map((o) => ({ ...o, nodoIds: [...o.nodoIds] })) } : {}) });
      porClave.set(k, copia);
      salida.push(copia);
      return;
    }
    for (const o of i.apareceEn ?? []) {
      const ya = previo.apareceEn?.find((x) => x.itemId === o.itemId);
      if (ya) ya.nodoIds.push(...o.nodoIds.filter((n) => !ya.nodoIds.includes(n)));
      else previo.apareceEn = [...(previo.apareceEn ?? []), { ...o, nodoIds: [...o.nodoIds] }];
    }
    for (const oc of i.ocasiones) if (!previo.ocasiones.includes(oc)) previo.ocasiones.push(oc);
  };
  for (const i of base) meter(i);
  for (const escena of base) for (const d of indices.get(escena.id) ?? []) meter(d);
  return salida;
}

/** Los items que salen de una escena (sus conjuntos, estructuras, decoraciones y utilería), en el orden de la biblioteca. */
export function contenidoDeEscena(biblioteca: readonly ItemBiblioteca[], escenaId: string): ItemBiblioteca[] {
  return biblioteca.filter((i) => i.id !== escenaId && i.apareceEn?.some((o) => o.itemId === escenaId));
}

// ----------------------------------------------------------------------------------------------------------
// Crear items (lo que se digitaliza y lo que guarda el usuario)
// ----------------------------------------------------------------------------------------------------------

/** Solo urls públicas: https y nada de imágenes embebidas (data:, blob:). */
export function urlPublica(url: string | undefined): boolean {
  if (!url) return true;
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

export function fuenteValida(f: FuenteItem | undefined): boolean {
  return !f || (f.titulo.trim().length > 0 && urlPublica(f.url) && urlPublica(f.fotoUrl));
}

/** Una escena digitalizada (una idea de sempertex.com, una foto, una propia) como item de la biblioteca. */
export function itemDeEscena(o: { id: string; nombre: string; descripcion?: string; ocasiones: string[]; fuente?: FuenteItem; escena: Escena }): ItemBiblioteca {
  if (!fuenteValida(o.fuente)) throw new Error(`La fuente de «${o.nombre}» no es válida: título y solo urls https públicas.`);
  return { id: o.id, tipo: "escena", nombre: o.nombre, descripcion: o.descripcion ?? "", ocasiones: [...o.ocasiones], ...(o.fuente ? { fuente: { ...o.fuente } } : {}), contenido: { tipo: "escena", escena: structuredClone(o.escena) } };
}

/** El tipo de item de una pieza sola: estructura (también la escenografía), decoración o utilería. */
export function tipoDePieza(pieza: Pieza): Exclude<TipoItem, "escena" | "conjunto"> {
  const clase = clasePieza(pieza);
  return clase === "utileria" ? "utileria" : clase === "decoracion" ? "decoracion" : "estructura";
}

/** El contenido de una pieza sola (copiada), con dónde va por defecto si no se dice: la decoración en la pared. */
function contenidoDePieza(pieza: Pieza, nombre: string, sugerida?: Colocacion): ContenidoItem {
  const donde: Colocacion = sugerida ?? (tipoDePieza(pieza) === "decoracion" ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 120 } : { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 });
  return { tipo: "pieza", pieza: structuredClone(pieza), nombre, sugerida: donde };
}

/** Una pieza sola como item: estructura, decoración o utilería según lo que es (la escenografía no es item). */
export function itemDePieza(o: { id: string; nombre: string; descripcion?: string; ocasiones: string[]; fuente?: FuenteItem; pieza: Pieza; sugerida?: Colocacion }): ItemBiblioteca {
  return {
    id: o.id, tipo: tipoDePieza(o.pieza), nombre: o.nombre, descripcion: o.descripcion ?? "", ocasiones: [...o.ocasiones], ...(o.fuente ? { fuente: { ...o.fuente } } : {}),
    contenido: contenidoDePieza(o.pieza, o.nombre, o.sugerida),
  };
}

/**
 * Copia un item con algunos campos cambiados SIN evaluar sus getters: los items de fábrica son perezosos (su
 * contenido se arma al pedirlo) y un `{ ...item }` los armaría todos. Los campos cambiados quedan como datos.
 */
export function copiarItem(item: ItemBiblioteca, cambios: Partial<ItemBiblioteca> = {}): ItemBiblioteca {
  const copia = Object.defineProperties({}, Object.getOwnPropertyDescriptors(item)) as ItemBiblioteca;
  for (const [campo, valor] of Object.entries(cambios)) Object.defineProperty(copia, campo, { value: valor, writable: true, enumerable: true, configurable: true });
  return copia;
}

/**
 * Un item perezoso (los de fábrica): lo fijo (id, tipo, nombre, ocasiones, fuente) se lee sin armar nada; el
 * contenido —y la descripción, si es una función— se calcula la primera vez que se pide y queda memorizado. `fijo`
 * puede llevar getters (se copian sin evaluarlos).
 */
export function itemPerezoso(fijo: Omit<ItemBiblioteca, "contenido" | "descripcion">, descripcion: string | (() => string), contenido: () => ContenidoItem): ItemBiblioteca {
  if (!fuenteValida(fijo.fuente)) throw new Error(`La fuente de «${fijo.nombre}» no es válida: título y solo urls https públicas.`);
  const item = Object.defineProperties({}, Object.getOwnPropertyDescriptors(fijo)) as ItemBiblioteca;
  const laDescripcion = typeof descripcion === "string" ? () => descripcion : perezoso(descripcion);
  return Object.defineProperties(item, {
    descripcion: { get: laDescripcion, enumerable: true, configurable: true },
    contenido: { get: perezoso(contenido), enumerable: true, configurable: true },
  });
}

/**
 * Lo que se guarda desde la pestaña Escena al elegir una pieza: la estructura con sus decoraciones (`conjunto`; sin
 * decoraciones, `estructura`), o la decoración / utilería sola. `null` si el nodo no está o es escenografía.
 */
export function itemDeNodo(escena: Escena, nodoId: string, o: { id: string; nombre?: string; ocasiones?: string[]; armada?: EscenaArmada }): ItemBiblioteca | null {
  const nodo = escena.nodos.find((n) => n.id === nodoId);
  if (!nodo) return null;
  const clase = clasePieza(nodo.pieza);
  if (clase === "escenografia") return null;
  const nombre = o.nombre?.trim() || nodo.nombre;
  const fuente: FuenteItem = { tipo: "propio", titulo: "Guardado desde la pestaña Escena" };
  if (clase === "estructura") {
    const conjunto = extraerConjunto(escena, nodoId, { armada: o.armada });
    if (!conjunto) return null;
    if (conjunto.hijos.length === 0) return { ...itemDePieza({ id: o.id, nombre, ocasiones: o.ocasiones ?? [], fuente, pieza: nodo.pieza, sugerida: conjunto.sugerida }), propio: true };
    return { id: o.id, tipo: "conjunto", nombre, descripcion: `${nodo.nombre} con ${cuenta(conjunto.hijos.length, "decoración", "decoraciones")}.`, ocasiones: [...(o.ocasiones ?? [])], fuente, contenido: { tipo: "conjunto", conjunto }, propio: true };
  }
  const hecho = (o.armada ?? armarEscena(escena)).porNodo.find((n) => n.id === nodoId);
  const sugerida: Colocacion = nodo.colocacion.en === "ancla" || nodo.colocacion.en === "sobre"
    ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: hecho ? Math.max(0, Math.round(hecho.caja.min.y)) : 100 }
    : nodo.colocacion;
  return { ...itemDePieza({ id: o.id, nombre, ocasiones: o.ocasiones ?? [], fuente, pieza: nodo.pieza, sugerida }), propio: true };
}

/**
 * Lee un item guardado (JSON de la biblioteca propia): comprueba lo esencial y que tipo y contenido casen. Lo que no
 * cuadra se descarta (`null`) en vez de romper la página.
 */
export function validarItem(dato: unknown): ItemBiblioteca | null {
  if (!dato || typeof dato !== "object") return null;
  const x = dato as Partial<ItemBiblioteca>;
  if (typeof x.id !== "string" || !x.id || typeof x.nombre !== "string" || !TIPOS_ITEM.some((t) => t.id === x.tipo)) return null;
  if (!Array.isArray(x.ocasiones) || !x.ocasiones.every((o) => typeof o === "string")) return null;
  const c = x.contenido;
  if (!c || typeof c !== "object") return null;
  const casa = (c.tipo === "escena" && x.tipo === "escena" && Array.isArray(c.escena?.nodos) && typeof c.escena?.sala === "object")
    || (c.tipo === "conjunto" && x.tipo === "conjunto" && typeof c.conjunto?.raiz?.pieza === "object" && Array.isArray(c.conjunto?.hijos))
    || (c.tipo === "pieza" && (x.tipo === "estructura" || x.tipo === "decoracion" || x.tipo === "utileria") && typeof c.pieza === "object" && typeof c.sugerida === "object");
  if (!casa || !fuenteValida(x.fuente)) return null;
  return { id: x.id, tipo: x.tipo!, nombre: x.nombre, descripcion: typeof x.descripcion === "string" ? x.descripcion : "", ocasiones: [...x.ocasiones], ...(x.fuente ? { fuente: x.fuente } : {}), contenido: c, propio: true };
}

// ----------------------------------------------------------------------------------------------------------
// La biblioteca de fábrica: lo que ya existe en el código
// ----------------------------------------------------------------------------------------------------------

/** Las ocasiones de un producto de utilería, por la temática que le da la tienda. */
function ocasionesDeTematica(tematica: string): string[] {
  const t = plano(tematica);
  const salida: string[] = [];
  if (t.includes("halloween")) salida.push("halloween");
  if (t.includes("cumple")) salida.push("cumpleaños");
  if (t.includes("navidad")) salida.push("navidad");
  if (t.includes("amor")) salida.push("amor");
  if (t.includes("infantil")) salida.push("infantil");
  if (t.includes("ano nuevo")) salida.push("año nuevo");
  return salida.length ? salida : ["general"];
}

const FUENTE_TALLER: FuenteItem = { tipo: "propio", titulo: "Escena de partida del taller" };
const FUENTE_HALLOWEEN: FuenteItem = { tipo: "propio", titulo: "Foto de Halloween del dueño (2026-10-07)" };

/** Ocasiones de las decoraciones del catálogo Celebra (por lo que dice la revista de cada una). */
const OCASIONES_CELEBRA: Readonly<Record<string, string[]>> = {
  columna_bloques_pirata: ["infantil", "cumpleaños"],
  flor_corazones_c27: ["amor"],
};

/**
 * Lo de fábrica, PEREZOSO: nada se arma ni se copia al construir la lista (id, tipo, nombre, ocasiones, fuente y foto
 * salen de los datos); el contenido de cada item se arma la primera vez que se pide (al abrirlo, al indexarlo o al
 * resumirlo). Importar la biblioteca no puede tardar (ver `scripts/test/test-carga-3d.ts`).
 */
function construirFabrica(): ItemBiblioteca[] {
  const items: ItemBiblioteca[] = [];
  const halloween = new Set(ESCENAS_HALLOWEEN.map((p) => p.id));
  for (const p of ESCENAS_PREDEFINIDAS) {
    items.push(itemPerezoso({
      id: `escena:${p.id}`, tipo: "escena", nombre: p.nombre,
      ocasiones: halloween.has(p.id) ? ["halloween"] : ["general"], fuente: { ...(halloween.has(p.id) ? FUENTE_HALLOWEEN : FUENTE_TALLER) },
    }, p.descripcion, () => ({ tipo: "escena", escena: structuredClone(p.escena) })));
  }
  for (const d of CATALOGO_DECORACIONES) {
    const sugerida: Colocacion | undefined = d.pieza.tipo === "pared_malla" || d.pieza.tipo === "pared_trenzas" ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } : undefined;
    items.push(itemPerezoso({
      id: `celebra:${d.id}`, tipo: tipoDePieza(d.pieza), nombre: d.nombre, ocasiones: [...(OCASIONES_CELEBRA[d.id] ?? ["general"])],
      fuente: { tipo: "celebra", titulo: `${d.fuente} · foto ${d.fotoId}` },
    }, d.descripcion, () => contenidoDePieza(d.pieza, d.nombre, sugerida)));
  }
  for (const d of DECORACIONES_PREDEFINIDAS) {
    const esDeHalloween = esHalloween(d.decoracion);
    const pieza: Pieza = { tipo: "decoracion", decoracion: d.decoracion };
    items.push(itemPerezoso({
      id: `decoracion:${d.id}`, tipo: tipoDePieza(pieza), nombre: d.nombre,
      ocasiones: esDeHalloween ? ["halloween"] : d.decoracion.tipo === "flor_corazones" ? ["amor"] : ["general"],
      fuente: esDeHalloween ? { ...FUENTE_HALLOWEEN } : { tipo: "propio", titulo: "Decoración predefinida del taller" },
    }, d.descripcion, () => contenidoDePieza(pieza, d.nombre)));
  }
  for (const u of UTILERIA_LISTA) {
    // La pieza se crea al pedirla (o al leer sus ocasiones, que salen de la temática de sus productos en la tienda).
    const pieza = perezoso(() => u.crear());
    const ocasiones = perezoso(() => {
      const p = pieza();
      const tematicas = (p.tipo === "escenografia" ? p.productos ?? [] : []).map((x) => CATALOGO_UTILERIA.find((c) => c.url === x.url)?.tematica ?? "");
      const salida = [...new Set(tematicas.flatMap(ocasionesDeTematica))];
      return salida.length ? salida : ["general"];
    });
    const sugerida: Colocacion = u.donde === "colgar" ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 180 } : u.donde === "mesa" ? { en: "libre", xCm: 0, yCm: 75, zCm: 0, giroGrados: 0 } : { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
    items.push(itemPerezoso({
      // Toda la lista es utilería de fiesta (escenografía con producto): `test-biblioteca` comprueba que el tipo casa.
      id: `utileria:${u.id}`, tipo: "utileria", nombre: u.nombre, get ocasiones() { return ocasiones(); },
      fuente: { tipo: "propio", titulo: "Utilería del taller (producto de la tienda Sempertex)" },
    }, u.descripcion, () => contenidoDePieza(pieza(), u.nombre, sugerida)));
  }
  for (const idea of IDEAS_SEMPERTEX) {
    const fuente: FuenteItem = { tipo: "idea-sempertex", titulo: `Sempertex · Ideas de fiesta · ${idea.nombre}`, url: urlDeIdea(idea.slug), fotoUrl: idea.fotoUrl };
    // `clase` dice qué es sin armarla; el contenido (la escena o la pieza de la idea, copiada) se arma al pedirlo.
    items.push(itemPerezoso({ id: idea.id, tipo: idea.clase, nombre: idea.nombre, ocasiones: [...idea.ocasiones], fuente }, () => idea.nota, () => {
      const c = idea.contenido;
      return c.tipo === "escena" ? { tipo: "escena", escena: structuredClone(c.escena) } : contenidoDePieza(c.pieza, idea.nombre, c.sugerida);
    }));
  }
  // Bases orgánicas de fotos de internet: estructura sola o con lo que lleva (flores colgadas, remate, marco).
  for (const b of BASES_ORGANICAS) {
    const fuente: FuenteItem = { tipo: "referencia-web", titulo: tituloFuenteBase(b), url: b.fuente.urlPagina, ...(b.fuente.urlImagen ? { fotoUrl: b.fuente.urlImagen } : {}) };
    const conjunto = conjuntoDeBase(b);
    items.push(conjunto
      ? { id: b.id, tipo: "conjunto", nombre: b.nombre, descripcion: descripcionBase(b), ocasiones: [...b.ocasiones], fuente, contenido: { tipo: "conjunto", conjunto } }
      : itemDePieza({ id: b.id, nombre: b.nombre, descripcion: descripcionBase(b), ocasiones: b.ocasiones, fuente, pieza: piezaDeBase(b) }));
  }
  return items;
}

/** Lo de fábrica, sin indexar (no arma nada al importarse): escenas, catálogo Celebra, decoraciones predefinidas, utilería e ideas. */
export const BIBLIOTECA_FABRICA: readonly ItemBiblioteca[] = construirFabrica();

/** La biblioteca de fábrica con lo indexado de cada escena (arma las escenas: unos segundos). */
export function bibliotecaCompleta(base: readonly ItemBiblioteca[] = BIBLIOTECA_FABRICA, cache?: Map<string, PiezaArmada>): ItemBiblioteca[] {
  const indices = new Map<string, ItemBiblioteca[]>();
  for (const item of base) if (item.contenido.tipo === "escena") indices.set(item.id, indexarEscena(item, undefined, cache));
  return unirBiblioteca(base, indices);
}
