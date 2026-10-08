import type { SelectorGlobos } from "./partes-globos";
import type { GloboDecoracion, TuboDecoracion } from "./decoraciones";
import type { MaterialDecoracion } from "./figuras";

/**
 * **Repintes**: reglas de color guardadas en los DATOS de una pieza («los R-24 en azul reflex», «los Link-O-Loon de las
 * hojas en dorado») que `armarPieza` aplica al terminar de armarla, antes de los impresos. Son la última estrategia de
 * `editar_globos` (editar-seleccion.ts) cuando el color no está atado a un objeto de formato en los datos (la paleta de un
 * orgánico reparte sus colores entre todos los tamaños; un mismo color de una trenza va en varias partes): así cambia
 * exactamente lo seleccionado y nada más, y la regla sigue valiendo si la pieza se vuelve a armar o se agranda.
 * Se aplican en orden (una regla ve los colores que dejó la anterior). Los campos se llaman como en el resto del taller
 * (`colores`, `codigo`) para que el recolor de la escena (recolorear.ts) los cambie junto con lo demás.
 */
export type Repinte = { formatos?: string[]; partes?: string[]; colores?: string[]; codigo: string };

const plegar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** «petalos» y «petalo», «flores» y «flor»: la misma palabra en singular o plural. */
const igual = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
const segmentos = (parte: string) => plegar(parte).replace(/_/g, "/").split("/").filter(Boolean);

/**
 * ¿La parte de un globo («copa/hojas», «flor/petalos») es la pedida? Vale si lo pedido aparece como tramo seguido de su
 * ruta: «copa» y «hojas» valen para «copa/hojas»; «copa/hojas» también; «hoja» vale por «hojas».
 */
export function coincideParteFlexible(parte: string | undefined, pedida: string): boolean {
  if (!parte) return false;
  const a = segmentos(parte), p = segmentos(pedida);
  if (!p.length || p.length > a.length) return false;
  for (let i = 0; i + p.length <= a.length; i++) if (p.every((s, j) => igual(a[i + j]!, s))) return true;
  return false;
}

const coincideFormato = (formatoId: string, patron: string) => {
  const p = patron.trim().toUpperCase();
  return p.endsWith("*") ? formatoId.toUpperCase().startsWith(p.slice(0, -1)) : formatoId.toUpperCase() === p;
};

/** Un globo (o tubito) contra un selector, con la parte flexible y, si se sabe, la parte que dicen los datos (`parteRuta`). */
export function coincideFlexible(e: { formatoId: string; codigo: string; parte?: string; parteRuta?: string }, s: SelectorGlobos): boolean {
  if (s.formatos?.length && !s.formatos.some((f) => coincideFormato(e.formatoId, f))) return false;
  if (s.colores?.length && !s.colores.includes(e.codigo)) return false;
  if (s.partes?.length && !s.partes.some((p) => coincideParteFlexible(e.parte, p) || coincideParteFlexible(e.parteRuta, p))) return false;
  return true;
}

const largo = (t: TuboDecoracion) => {
  let l = 0;
  for (let i = 1; i < t.puntos.length; i++) { const a = t.puntos[i - 1]!, b = t.puntos[i]!; l += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }
  return l;
};

type ConGlobos = { globos: GloboDecoracion[]; tubos: TuboDecoracion[]; materiales: MaterialDecoracion[] };

/** Aplica los repintes a una pieza armada: cambia el color de los globos y tubitos que caen en cada regla y sus materiales. */
export function aplicarRepintes<T extends ConGlobos>(armada: T, repintes: readonly Repinte[]): T {
  if (!repintes.length) return armada;
  const globos = armada.globos.map((g) => ({ ...g }));
  const tubos = armada.tubos.map((t) => ({ ...t }));
  for (const r of repintes) {
    for (const g of globos) if (coincideFlexible(g, r)) g.codigo = r.codigo;
    for (const t of tubos) if (!t.papel && coincideFlexible(t, r)) t.codigo = r.codigo;
  }
  // Materiales: un globo es una unidad; los tubitos se cuentan por largo, así que se reparte su cantidad por largo.
  const delta = new Map<string, number>();
  const sumar = (f: string, c: string, n: number) => delta.set(`${f}|${c}`, (delta.get(`${f}|${c}`) ?? 0) + n);
  armada.globos.forEach((g, i) => { const n = globos[i]!; if (n.codigo !== g.codigo) { sumar(g.formatoId, g.codigo, -1); sumar(g.formatoId, n.codigo, 1); } });
  const largoTotal = new Map<string, number>();
  for (const t of armada.tubos) if (!t.papel) largoTotal.set(`${t.formatoId}|${t.codigo}`, (largoTotal.get(`${t.formatoId}|${t.codigo}`) ?? 0) + largo(t));
  const movido = new Map<string, number>();
  armada.tubos.forEach((t, i) => { const n = tubos[i]!; if (!t.papel && n.codigo !== t.codigo) movido.set(`${t.formatoId}|${t.codigo}|${n.codigo}`, (movido.get(`${t.formatoId}|${t.codigo}|${n.codigo}`) ?? 0) + largo(t)); });
  for (const [clave, l] of movido) {
    const [f, de, a] = clave.split("|") as [string, string, string];
    const cantidad = armada.materiales.filter((m) => m.formatoId === f && m.codigo === de).reduce((s, m) => s + m.cantidad, 0);
    const total = largoTotal.get(`${f}|${de}`) ?? 0;
    const n = cantidad > 0 && total > 0 ? Math.min(cantidad, Math.max(1, Math.round((cantidad * l) / total))) : 0;
    sumar(f, de, -n); sumar(f, a, n);
  }
  const materiales: MaterialDecoracion[] = armada.materiales.map((m) => ({ ...m }));
  for (const [clave, n] of delta) {
    if (!n) continue;
    const [f, c] = clave.split("|") as [string, string];
    const m = materiales.find((x) => x.formatoId === f && x.codigo === c);
    if (m) m.cantidad = Math.max(0, m.cantidad + n);
    else if (n > 0) materiales.push({ formatoId: f, codigo: c, cantidad: n });
  }
  return { ...armada, globos, tubos, materiales: materiales.filter((m) => m.cantidad > 0) };
}
