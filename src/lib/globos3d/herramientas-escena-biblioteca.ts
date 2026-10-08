import { BIBLIOTECA_FABRICA, TIPOS_ITEM, indexarEscena, unirBiblioteca, type ItemBiblioteca, type TipoItem } from "./biblioteca";
import type { Pieza, PiezaArmada, TipoPieza } from "./piezas";
import { coloresDeDato, nombreColor, plegar } from "./herramientas-escena-colores";
import { NOMBRE_TIPO } from "./herramientas-escena-estructuras";

/**
 * **La biblioteca para la IA del taller 3D**: buscar por texto, tipo, ocasión, colores o tipo de pieza entre lo de
 * fábrica (escenas, ideas Sempertex, catálogo Celebra, decoraciones, utilería) y lo que sale de indexar cada escena
 * (sus estructuras con decoraciones, estructuras solas, decoraciones), y traer un item por su id para ponerlo en la
 * escena como base. Indexar las 300+ escenas tarda (~16 s): aquí solo se indexan las que pueden coincidir con la
 * búsqueda, y lo indexado queda en memoria del servidor. Puro y sin red.
 */

const DERIVADOS = new Map<string, ItemBiblioteca[]>();
const CACHE_ARMADO = new Map<string, PiezaArmada>();
const POR_ID = new Map(BIBLIOTECA_FABRICA.map((i) => [i.id, i]));
const ESCENAS = BIBLIOTECA_FABRICA.filter((i) => i.contenido.tipo === "escena");
/** Escenas que se indexan como mucho en una búsqueda (cada una tarda de 50 a 400 ms la primera vez). */
const MAX_ESCENAS_POR_BUSQUEDA = 12;

function derivadosDe(escena: ItemBiblioteca): ItemBiblioteca[] {
  let lista = DERIVADOS.get(escena.id);
  if (!lista) {
    try { lista = indexarEscena(escena, undefined, CACHE_ARMADO); } catch { lista = []; }
    DERIVADOS.set(escena.id, lista);
    if (CACHE_ARMADO.size > 400) CACHE_ARMADO.clear();
  }
  return lista;
}

/** Un item por su id (de fábrica o derivado de una escena: «idea:x~columna»), o `null`. */
export function itemDeBiblioteca(id: string): ItemBiblioteca | null {
  const directo = POR_ID.get(id);
  if (directo) return directo;
  const escena = POR_ID.get(id.split("~")[0] ?? "");
  if (!escena || escena.contenido.tipo !== "escena") return null;
  return derivadosDe(escena).find((i) => i.id === id) ?? null;
}

// ----------------------------------------------------------------------------------------------------------
// Texto
// ----------------------------------------------------------------------------------------------------------

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "con", "y", "en", "para", "que", "sus", "su", "biblioteca", "item", "items", "algo", "tipo"]);

/** La raíz de una palabra para comparar sin plurales ni género («columnas orgánicas» ~ «columna orgánica»). */
function raiz(palabra: string): string {
  let p = palabra;
  if (p.length > 4 && p.endsWith("es")) p = p.slice(0, -2);
  else if (p.length > 3 && p.endsWith("s")) p = p.slice(0, -1);
  if (p.length > 4 && /[ao]$/.test(p)) p = p.slice(0, -1);
  return p;
}

const raices = (texto: string) => [...new Set(plegar(texto).split(/[^a-z0-9ñ]+/).filter((p) => p && !VACIAS.has(p)).map(raiz))];

const tiposDe = (item: ItemBiblioteca): TipoPieza[] => {
  const c = item.contenido;
  if (c.tipo === "pieza") return [c.pieza.tipo];
  if (c.tipo === "conjunto") return [c.conjunto.raiz.pieza.tipo];
  return [...new Set(c.escena.nodos.map((n) => n.pieza.tipo))];
};

const codigosDe = (item: ItemBiblioteca): string[] => coloresDeDato(item.contenido).map((c) => c.codigo);

const TEXTOS = new WeakMap<ItemBiblioteca, { nombre: string; todo: string }>();
function textoDe(item: ItemBiblioteca): { nombre: string; todo: string } {
  let t = TEXTOS.get(item);
  if (!t) {
    const nombreTipo = TIPOS_ITEM.find((x) => x.id === item.tipo)?.nombre ?? item.tipo;
    const piezas = item.contenido.tipo === "escena" ? item.contenido.escena.nodos.map((n) => n.nombre) : [];
    t = {
      nombre: plegar(item.nombre),
      todo: plegar([item.nombre, item.descripcion, item.fuente?.titulo ?? "", nombreTipo, ...item.ocasiones, ...tiposDe(item).map((x) => NOMBRE_TIPO[x]), ...piezas, ...codigosDe(item).slice(0, 10).map(nombreColor)].join(" ")),
    };
    TEXTOS.set(item, t);
  }
  return t;
}

// ----------------------------------------------------------------------------------------------------------
// Buscar
// ----------------------------------------------------------------------------------------------------------

export type FiltroIA = {
  texto?: string;
  tipo?: TipoItem;
  ocasion?: string;
  /** Por cada color pedido, los códigos que le sirven (basta uno de cada grupo). */
  colores?: string[][];
  tipoPieza?: TipoPieza;
  limite?: number;
};

const ORDEN_TIPO: Readonly<Record<TipoItem, number>> = { estructura: 0, conjunto: 1, escena: 2, decoracion: 3, utileria: 4 };

/** Las escenas que vale la pena indexar para esta búsqueda (por su texto y el de sus piezas). */
function escenasCandidatas(palabras: readonly string[], tipoPieza: TipoPieza | undefined): ItemBiblioteca[] {
  const puntuadas = ESCENAS.flatMap((e) => {
    if (e.contenido.tipo !== "escena") return [];
    const nodos = e.contenido.escena.nodos;
    if (tipoPieza && !nodos.some((n) => n.pieza.tipo === tipoPieza)) return [];
    const { nombre, todo } = textoDe(e);
    // Lo que coincide en el nombre de la escena pesa más (de ahí salen los nombres de sus estructuras).
    const puntos = palabras.filter((p) => todo.includes(p)).length + 2 * palabras.filter((p) => nombre.includes(p)).length;
    return palabras.length && !puntos ? [] : [{ e, puntos }];
  });
  return puntuadas.sort((a, b) => b.puntos - a.puntos).slice(0, MAX_ESCENAS_POR_BUSQUEDA).map((x) => x.e);
}

/** Busca en la biblioteca: lo mejor primero (el texto en el nombre pesa más), hasta `limite`. */
export function buscarEnBiblioteca(f: FiltroIA): ItemBiblioteca[] {
  const palabras = raices(f.texto ?? "");
  const indices = new Map<string, ItemBiblioteca[]>();
  const quiereDerivados = !f.tipo || f.tipo === "conjunto" || f.tipo === "estructura" || f.tipo === "decoracion" || f.tipo === "utileria";
  if (quiereDerivados && (palabras.length || f.tipoPieza || f.colores?.length)) for (const e of escenasCandidatas(palabras, f.tipoPieza)) indices.set(e.id, derivadosDe(e));
  const todos = unirBiblioteca(BIBLIOTECA_FABRICA, indices);
  const necesarias = Math.ceil(palabras.length * 0.6);
  const puntuados = todos.flatMap((item) => {
    if (f.tipo && item.tipo !== f.tipo) return [];
    if (f.ocasion && !item.ocasiones.includes(f.ocasion)) return [];
    if (f.tipoPieza && !tiposDe(item).includes(f.tipoPieza)) return [];
    if (f.colores?.length) {
      const propios = new Set(codigosDe(item));
      if (!f.colores.every((grupo) => grupo.some((c) => propios.has(c)))) return [];
    }
    const t = textoDe(item);
    let puntos = 0, halladas = 0;
    for (const p of palabras) {
      if (t.nombre.includes(p)) { puntos += 3; halladas += 1; } else if (t.todo.includes(p)) { puntos += 1; halladas += 1; }
    }
    if (palabras.length && halladas < Math.max(1, necesarias)) return [];
    return [{ item, puntos }];
  });
  puntuados.sort((a, b) => b.puntos - a.puntos || ORDEN_TIPO[a.item.tipo] - ORDEN_TIPO[b.item.tipo] || a.item.nombre.localeCompare(b.item.nombre));
  return puntuados.slice(0, Math.max(1, Math.min(15, f.limite ?? 8))).map((x) => x.item);
}

const corto = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Qué hay en una pieza, en pocas palabras. */
const deQue = (p: Pieza) => NOMBRE_TIPO[p.tipo];

/** Una línea por item: id, tipo, nombre, qué es, colores y ocasiones (lo que la IA necesita para elegir). */
export function describirItem(item: ItemBiblioteca): string {
  const c = item.contenido;
  const detalle = c.tipo === "pieza" ? deQue(c.pieza)
    : c.tipo === "conjunto" ? `${deQue(c.conjunto.raiz.pieza)} con ${c.conjunto.hijos.length} decoraciones`
      : `${c.escena.nodos.length} piezas: ${[...new Set(c.escena.nodos.map((n) => deQue(n.pieza)))].slice(0, 4).join(", ")}`;
  const colores = codigosDe(item).slice(0, 4).map(nombreColor).join(", ");
  const tipo = TIPOS_ITEM.find((x) => x.id === item.tipo)?.nombre ?? item.tipo;
  return `- ${item.id} · ${tipo} · «${item.nombre}» · ${detalle}${colores ? ` · colores: ${colores}` : ""} · ${item.ocasiones.join(", ")}${item.descripcion ? ` · ${corto(item.descripcion, 110)}` : ""}`;
}
