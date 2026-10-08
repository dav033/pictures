import { armarPieza, type Pieza } from "./piezas";
import type { ColorOrganico } from "./organico";
import { coloresUsados } from "./recolorear";
import {
  FORMATOS_ORGANICOS, coloresDeDato, formatosOrganicosDe, metalizadoMasParecido, nombreColor, referenciaDePedido, resolverColorFlexible, resolverColorOrganico,
} from "./herramientas-escena-colores";

/**
 * **Recolor de piezas** para la IA del taller 3D: «todo a rojo y verde» cambia los colores de cada pieza por los de la
 * paleta pedida respetando su patrón (el color que más globos lleva pasa al primero de la paleta, el segundo al
 * segundo… y si la paleta es más corta se reparte en orden: una espiral de 4 colores con «rojo y verde» queda roja y
 * verde alternada). Sirve para cualquier pieza (trenzas, orgánicos con sus pesos, formas, letras, murales, techo,
 * decoraciones, metalizados —al foil más parecido—); la escenografía no tiene globos y no cambia. Nunca agrega ni
 * quita piezas. Un color que no se fabrica en un formato de la pieza se cambia por el más parecido que sí, con nota.
 */

/** Los colores de una pieza, con sus formatos: por globos (el que más lleva primero) o en el orden en que aparecen. */
export function coloresDePieza(pieza: Pieza, orden: "uso" | "aparicion"): Array<{ codigo: string; formatos: string[]; cantidad: number }> {
  const enDato = coloresDeDato(pieza);
  let usados: Array<{ codigo: string; cantidad: number; formatos: string[] }> = [];
  try { usados = coloresUsados(armarPieza(pieza).materiales); } catch { usados = []; }
  const porCodigo = new Map(usados.map((u) => [u.codigo, u]));
  const salida = (orden === "uso" ? [...usados.map((u) => u.codigo), ...enDato.map((d) => d.codigo)] : [...enDato.map((d) => d.codigo), ...usados.map((u) => u.codigo)])
    .filter((c, i, todos) => todos.indexOf(c) === i);
  return salida.map((codigo) => {
    const u = porCodigo.get(codigo);
    const d = enDato.find((x) => x.codigo === codigo);
    const formatos = [...new Set([...(u?.formatos ?? []), ...(d?.formatos ?? [])])];
    return { codigo, formatos: formatos.length ? formatos : ["R-12"], cantidad: u?.cantidad ?? 0 };
  });
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Formatos de un objeto del dato (el suyo o los de su globo grande y chico). */
function formatosDeObjeto(o: Record<string, unknown>): string[] {
  const propios = typeof o.formatoId === "string" ? [o.formatoId] : [];
  const anidados = ["grande", "chico", "globo"].flatMap((k) => { const v = o[k]; return esObjeto(v) && typeof v.formatoId === "string" ? [v.formatoId] : []; });
  return [...propios, ...anidados];
}

/**
 * Cambia a la vez (sin cadenas: un color nuevo que coincide con uno viejo no se vuelve a cambiar) cada código de
 * `mapa` por el que devuelve `destino(codigoViejo, formatos)` en todo el dato.
 */
function mapearCodigos<T>(valor: T, mapa: ReadonlySet<string>, destino: (viejo: string, formatos: readonly string[]) => string, formatosPorCodigo: ReadonlyMap<string, string[]>): { valor: T; cambios: number } {
  let cambios = 0;
  const cambiar = (c: string, formatos: readonly string[]) => {
    const nuevo = destino(c, formatos.length ? formatos : formatosPorCodigo.get(c) ?? ["R-12"]);
    if (nuevo !== c) cambios += 1;
    return nuevo;
  };
  const recorrer = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(recorrer);
    if (!esObjeto(v)) return v;
    const formatos = formatosDeObjeto(v);
    const salida: Record<string, unknown> = {};
    for (const [clave, x] of Object.entries(v)) {
      if (clave === "codigo" && typeof x === "string" && mapa.has(x)) salida[clave] = cambiar(x, formatos);
      else if ((clave === "codigos" || clave === "colores") && Array.isArray(x) && x.every((c) => typeof c === "string")) salida[clave] = x.map((c: string) => (mapa.has(c) ? cambiar(c, formatos) : c));
      else salida[clave] = recorrer(x);
    }
    return salida;
  };
  return { valor: recorrer(valor) as T, cambios };
}

/** La paleta de un orgánico con cada color cambiado: formatos donde se fabrica el nuevo y pesos sumados si se repite. */
function paletaOrganica(colores: readonly ColorOrganico[], destino: (viejo: string) => string): ColorOrganico[] {
  const salida: ColorOrganico[] = [];
  for (const c of colores) {
    const codigo = destino(c.codigo);
    const posibles = formatosOrganicosDe(codigo);
    const formatos = c.formatos ? c.formatos.filter((f) => posibles.includes(f)) : posibles;
    const usar = formatos.length ? formatos : posibles;
    const previo = salida.find((x) => x.codigo === codigo);
    if (previo) {
      previo.peso += c.peso;
      if (previo.formatos) previo.formatos = [...new Set([...previo.formatos, ...usar])];
      continue;
    }
    const entrada: ColorOrganico = { ...c, codigo };
    delete entrada.formatos;
    // Solo se limita a unos formatos si el color no se fabrica en todos los de la técnica.
    if (usar.length < FORMATOS_ORGANICOS.length) entrada.formatos = usar;
    salida.push(entrada);
  }
  return salida;
}

/**
 * Recolorea una pieza con `pedidoDe(codigoViejo)` → el pedido (nombre o código) que va en lugar de cada color, o
 * `null` si ese color se queda. Devuelve la pieza nueva, cuántos cambios hubo y el «antes → ahora» de cada color.
 */
/** El foil no es látex: un metalizado va al color de foil más parecido al pedido. */
export function recolorearMetalizado(pieza: Extract<Pieza, { tipo: "metalizado" }>, pedido: string | null): { pieza: Pieza; cambios: number; detalle: string[] } {
  const ref = pedido ? referenciaDePedido(pedido) : null;
  if (!ref) return { pieza, cambios: 0, detalle: [] };
  const color = metalizadoMasParecido(ref.codigo);
  if (color === pieza.metalizado.color) return { pieza, cambios: 0, detalle: [] };
  return { pieza: { ...pieza, metalizado: { ...pieza.metalizado, color, producto: null } }, cambios: 1, detalle: [`foil ${pieza.metalizado.color} → ${color}`] };
}

export function recolorearConPedidos(pieza: Pieza, pedidoDe: (viejo: string) => string | null, notas: string[]): { pieza: Pieza; cambios: number; detalle: string[] } {
  if (pieza.tipo === "escenografia" || pieza.tipo === "metalizado") return { pieza, cambios: 0, detalle: [] };
  const usados = coloresDePieza(pieza, "uso");
  const formatosPorCodigo = new Map(usados.map((u) => [u.codigo, u.formatos]));
  const cache = new Map<string, string>();
  const detalle = new Map<string, Set<string>>();
  const destino = (viejo: string, formatos: readonly string[]): string => {
    const pedido = pedidoDe(viejo);
    if (pedido === null) return viejo;
    const clave = `${pedido}|${[...formatos].sort().join(",")}`;
    let nuevo = cache.get(clave);
    if (!nuevo) { nuevo = resolverColorFlexible(pedido, formatos, notas); cache.set(clave, nuevo); }
    const d = detalle.get(viejo) ?? new Set<string>();
    d.add(nuevo);
    detalle.set(viejo, d);
    return nuevo;
  };
  const destinoOrganico = (viejo: string): string => {
    const pedido = pedidoDe(viejo);
    if (pedido === null) return viejo;
    const clave = `${pedido}|organico`;
    let nuevo = cache.get(clave);
    if (!nuevo) { nuevo = resolverColorOrganico(pedido, notas).codigo; cache.set(clave, nuevo); }
    const d = detalle.get(viejo) ?? new Set<string>();
    d.add(nuevo);
    detalle.set(viejo, d);
    return nuevo;
  };
  const mapa = new Set(usados.map((u) => u.codigo).filter((c) => pedidoDe(c) !== null));
  let cambios = 0;
  let nueva: Pieza;
  // La paleta de los orgánicos va aparte (pesos y formatos por color); el resto del dato, por el recorrido común.
  if (pieza.tipo === "organico") {
    const colores = paletaOrganica(pieza.opciones.colores, destinoOrganico);
    const resto = mapearCodigos({ ...pieza, opciones: { ...pieza.opciones, colores: [] } }, mapa, destino, formatosPorCodigo);
    cambios = resto.cambios + pieza.opciones.colores.filter((c) => destinoOrganico(c.codigo) !== c.codigo).length;
    nueva = { ...resto.valor, opciones: { ...resto.valor.opciones, colores } };
    // El generador (el trazo) lleva la misma paleta: si no, al volver a armarlo por sus parámetros volvería el color viejo.
    if (nueva.tipo === "organico" && nueva.generador) nueva = { ...nueva, generador: { ...nueva.generador, trazo: { ...nueva.generador.trazo, colores } } };
  } else if (pieza.tipo === "arco_organico") {
    const colores = paletaOrganica(pieza.arco.colores, destinoOrganico);
    const resto = mapearCodigos({ ...pieza, arco: { ...pieza.arco, colores: [] } }, mapa, destino, formatosPorCodigo);
    cambios = resto.cambios + pieza.arco.colores.filter((c) => destinoOrganico(c.codigo) !== c.codigo).length;
    nueva = { ...resto.valor, arco: { ...resto.valor.arco, colores } };
  } else {
    const hecho = mapearCodigos(pieza, mapa, destino, formatosPorCodigo);
    cambios = hecho.cambios;
    nueva = hecho.valor;
  }
  const lineas = [...detalle.entries()].filter(([viejo, nuevos]) => !(nuevos.size === 1 && nuevos.has(viejo)))
    .map(([viejo, nuevos]) => `${nombreColor(viejo)} → ${[...nuevos].map(nombreColor).join(" / ")}`);
  return { pieza: nueva, cambios, detalle: lineas };
}

/**
 * Recolorea una pieza con una paleta: el color i de la pieza (por globos, o en el orden en que aparecen) pasa al
 * color `i mod n` de la paleta. Así se respeta el patrón: los que alternaban siguen alternando.
 */
export function recolorearConPaleta(pieza: Pieza, paleta: readonly string[], notas: string[], orden: "uso" | "aparicion" = "uso"): { pieza: Pieza; cambios: number; detalle: string[] } {
  if (!paleta.length) return { pieza, cambios: 0, detalle: [] };
  if (pieza.tipo === "metalizado") return recolorearMetalizado(pieza, paleta[0] ?? null);
  const usados = coloresDePieza(pieza, orden).map((u) => u.codigo);
  const indice = new Map(usados.map((c, i) => [c, i]));
  return recolorearConPedidos(pieza, (viejo) => { const i = indice.get(viejo); return i === undefined ? null : paleta[i % paleta.length]!; }, notas);
}
