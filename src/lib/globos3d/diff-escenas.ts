import { armarEscena, type Colocacion, type Escena, type NodoArmado, type NodoEscena, type Sala } from "./escena";
import { inventarioDe } from "./partes-globos";
import type { PiezaArmada } from "./piezas";

/**
 * **Qué cambió entre dos escenas** (REQ IA-panel, D-021): la comparación por id de pieza que alimenta las tarjetas de turno
 * del panel de la IA. Dice qué piezas se sumaron, se quitaron o cambiaron, con el detalle campo a campo (medida, color,
 * sitio, globos por formato) y los totales de globos. Cada cambio guarda la pieza de antes y la de después: son los datos
 * que `deshacer-turno.ts` necesita para revertir SOLO lo que tocó la IA sin tirar lo que se hizo a mano después. Puro, sin red.
 */

export type ClaseCampo = "medida" | "color" | "sitio" | "globos" | "ajuste";
export type CampoCambiado = { clase: ClaseCampo; etiqueta: string; antes: string; despues: string };

export type CambioNodo = {
  id: string;
  nombre: string;
  tipo: "nueva" | "quitada" | "cambiada";
  campos: CampoCambiado[];
  globosAntes: number;
  globosDespues: number;
  antes: NodoEscena | null;
  despues: NodoEscena | null;
  /** Dónde estaba en la lista de piezas de la escena de antes (para devolverla a su sitio al deshacer). */
  indice: number;
};

export type CambioSala = { campos: CampoCambiado[]; antes: Sala; despues: Sala };

export type DiffEscena = {
  nodos: CambioNodo[];
  sala: CambioSala | null;
  globosAntes: number;
  globosDespues: number;
  piezasAntes: number;
  piezasDespues: number;
};

/** Cuántos campos de una pieza cambiada se detallan antes de resumir el resto («+3 ajustes»). */
const MAX_CAMPOS = 4;

/** JSON con las llaves ordenadas: dos piezas iguales comparan igual aunque una se haya armado con otro orden. */
export function jsonEstable(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(",")}]`;
  if (typeof valor === "object" && valor !== null) {
    const o = valor as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonEstable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(valor) ?? "null";
}

export const sonIguales = (a: unknown, b: unknown): boolean => a === b || jsonEstable(a) === jsonEstable(b);

const ETIQUETAS: Readonly<Record<string, string>> = {
  anchoCm: "ancho", altoCm: "alto", alturaCm: "alto", grosorCm: "grosor", infladoCm: "inflado", fondoCm: "fondo", caidaCm: "caída",
  radioBaseCm: "radio de la base", radioPuntaCm: "radio de la punta", inclinacionCm: "inclinación", formatoId: "formato", codigo: "color",
  colores: "colores", pesos: "proporción de colores", tamanos: "tamaños", patron: "patrón", semilla: "variante", densidad: "densidad",
  giroGrados: "giro", xCm: "x", zCm: "z", yCm: "y", aLoLargoCm: "a lo largo", cuelgaCm: "cuelga", pared: "pared", en: "lugar", nombre: "nombre",
};

const etiquetaDe = (llave: string) => ETIQUETAS[llave] ?? llave.replace(/Cm$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

function claseDe(llave: string): ClaseCampo {
  if (/color|codigo|hex|peso/i.test(llave)) return "color";
  if (/Cm$|ancho|alto|alt[ou]ra|grosor/.test(llave) && llave !== "giroGrados") return "medida";
  return "ajuste";
}

const numero = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Los cm como la gente los dice: «35 cm» o «1,8 m» desde el metro. */
export function medidaTexto(cm: number): string {
  return Math.abs(cm) >= 100 ? `${numero(cm / 100)} m` : `${numero(cm)} cm`;
}

function valorTexto(llave: string, v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return /Cm$/.test(llave) ? medidaTexto(v) : llave === "giroGrados" ? `${numero(v)}°` : numero(v);
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => valorTexto(llave, x)).join(", ") || "—";
  if (typeof v === "object" && "codigo" in v) {
    const { codigo, peso } = v as { codigo: unknown; peso?: unknown };
    return `${String(codigo)}${typeof peso === "number" ? ` ${numero(peso)} %` : ""}`;
  }
  const texto = jsonEstable(v);
  return texto.length > 40 ? `${texto.slice(0, 39)}…` : texto;
}

/** Los valores que no se recorren más adentro: listas y colores con peso se comparan enteros. */
const esHoja = (v: unknown): boolean => typeof v !== "object" || v === null || Array.isArray(v) || "codigo" in v;

function camposDe(antes: unknown, despues: unknown, llave: string, clase: (llave: string) => ClaseCampo, salida: CampoCambiado[]): void {
  if (sonIguales(antes, despues)) return;
  if (esHoja(antes) || esHoja(despues) || antes === undefined || despues === undefined) {
    salida.push({ clase: clase(llave), etiqueta: etiquetaDe(llave), antes: valorTexto(llave, antes), despues: valorTexto(llave, despues) });
    return;
  }
  const a = antes as Record<string, unknown>, d = despues as Record<string, unknown>;
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(d)])]) camposDe(a[k], d[k], k, clase, salida);
}

/** Los campos que cambiaron en la pieza, el sitio y el nombre de una pieza que sigue en la escena. */
function camposDeNodo(antes: NodoEscena, despues: NodoEscena, formatos: CampoCambiado[]): CampoCambiado[] {
  const campos: CampoCambiado[] = [];
  if (antes.nombre !== despues.nombre) campos.push({ clase: "ajuste", etiqueta: "nombre", antes: antes.nombre, despues: despues.nombre });
  if (antes.pieza.tipo !== despues.pieza.tipo) campos.push({ clase: "ajuste", etiqueta: "tipo", antes: antes.pieza.tipo, despues: despues.pieza.tipo });
  else camposDe(antes.pieza, despues.pieza, "pieza", claseDe, campos);
  if (antes.colocacion.en !== despues.colocacion.en) campos.push({ clase: "sitio", etiqueta: "lugar", antes: antes.colocacion.en, despues: despues.colocacion.en });
  else camposDe(antes.colocacion as Colocacion, despues.colocacion as Colocacion, "colocacion", () => "sitio", campos);
  // Primero lo que se pidió (medida, color, sitio); detrás, cuántos globos de cada formato resultaron.
  return [...campos, ...formatos];
}

function porFormato(n: Pick<NodoArmado, "globos" | "tubos"> | undefined): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of n ? inventarioDe(n) : []) mapa.set(l.formatoId, (mapa.get(l.formatoId) ?? 0) + l.cantidad);
  return mapa;
}

/** «R-24: 6 → 14»: una línea por formato cuyo número cambió. */
function camposDeFormatos(antes: NodoArmado | undefined, despues: NodoArmado | undefined): CampoCambiado[] {
  const a = porFormato(antes), d = porFormato(despues);
  return [...new Set([...a.keys(), ...d.keys()])].filter((f) => (a.get(f) ?? 0) !== (d.get(f) ?? 0))
    .map((f) => ({ clase: "globos" as const, etiqueta: f, antes: String(a.get(f) ?? 0), despues: String(d.get(f) ?? 0) }));
}

function camposDeSala(antes: Sala, despues: Sala): CampoCambiado[] {
  const campos: CampoCambiado[] = [];
  camposDe(antes, despues, "sala", (k) => (/Cm$/.test(k) ? "medida" : /tono|piso|paredes|techo/.test(k) ? "color" : "ajuste"), campos);
  return campos;
}

export type OpcionesDiff = {
  /** Las piezas ya armadas por su JSON (el taller tiene la suya): sin esto cada comparación arma de nuevo lo que cambió. */
  cache?: Map<string, PiezaArmada>;
};

/** Qué cambió de `antes` a `despues`, por id de pieza. Vacío (`nodos: []`, `sala: null`) si son la misma escena. */
export function diffEscenas(antes: Escena, despues: Escena, opciones: OpcionesDiff = {}): DiffEscena {
  const cache = opciones.cache ?? new Map<string, PiezaArmada>();
  const armadaAntes = armarEscena(antes, cache), armadaDespues = armarEscena(despues, cache);
  const hecho = (a: typeof armadaAntes, id: string) => a.porNodo.find((n) => n.id === id);
  const previos = new Map(antes.nodos.map((n, i) => [n.id, { nodo: n, indice: i }]));
  const ahora = new Map(despues.nodos.map((n) => [n.id, n]));
  const nodos: CambioNodo[] = [];

  for (const n of despues.nodos) {
    const previo = previos.get(n.id);
    const hn = hecho(armadaDespues, n.id);
    if (!previo) {
      nodos.push({ id: n.id, nombre: n.nombre, tipo: "nueva", campos: [], globosAntes: 0, globosDespues: hn?.globos.length ?? 0, antes: null, despues: n, indice: -1 });
      continue;
    }
    if (sonIguales(previo.nodo, n)) continue;
    const ha = hecho(armadaAntes, n.id);
    nodos.push({
      id: n.id, nombre: n.nombre, tipo: "cambiada", campos: camposDeNodo(previo.nodo, n, camposDeFormatos(ha, hn)),
      globosAntes: ha?.globos.length ?? 0, globosDespues: hn?.globos.length ?? 0, antes: previo.nodo, despues: n, indice: previo.indice,
    });
  }
  for (const [id, { nodo, indice }] of previos) {
    if (ahora.has(id)) continue;
    nodos.push({ id, nombre: nodo.nombre, tipo: "quitada", campos: [], globosAntes: hecho(armadaAntes, id)?.globos.length ?? 0, globosDespues: 0, antes: nodo, despues: null, indice });
  }

  const sala: CambioSala | null = sonIguales(antes.sala, despues.sala) ? null : { campos: camposDeSala(antes.sala, despues.sala), antes: antes.sala, despues: despues.sala };
  return { nodos, sala, globosAntes: armadaAntes.globos.length, globosDespues: armadaDespues.globos.length, piezasAntes: antes.nodos.length, piezasDespues: despues.nodos.length };
}

export const diffVacio = (d: DiffEscena): boolean => d.nodos.length === 0 && d.sala === null;

/** «+8 globos», «−12 globos», «igual de globos». */
export function textoGlobos(delta: number): string {
  if (delta === 0) return "mismos globos";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} globo${Math.abs(delta) === 1 ? "" : "s"}`;
}

export const deltaGlobos = (d: DiffEscena): number => d.globosDespues - d.globosAntes;

/** Una línea de la lista de cambios: el signo (+ − ~), la pieza y su detalle. */
export type LineaDiff = { id: string | null; signo: "+" | "−" | "~"; titulo: string; detalle: string };

export function lineasDeDiff(d: DiffEscena): LineaDiff[] {
  const lineas: LineaDiff[] = [];
  for (const c of d.nodos) {
    if (c.tipo === "nueva") lineas.push({ id: c.id, signo: "+", titulo: c.nombre, detalle: c.globosDespues ? `${c.globosDespues} globos` : "" });
    else if (c.tipo === "quitada") lineas.push({ id: c.id, signo: "−", titulo: c.nombre, detalle: c.globosAntes ? `${c.globosAntes} globos` : "" });
    else {
      const visibles = c.campos.slice(0, MAX_CAMPOS);
      for (const campo of visibles) lineas.push({ id: c.id, signo: "~", titulo: c.nombre, detalle: campo.clase === "globos" ? `${campo.etiqueta}: ${campo.antes} → ${campo.despues} globos` : `${campo.etiqueta} ${campo.antes} → ${campo.despues}` });
      if (c.campos.length > visibles.length) lineas.push({ id: c.id, signo: "~", titulo: c.nombre, detalle: `+${c.campos.length - visibles.length} ajustes más` });
      if (!c.campos.length) lineas.push({ id: c.id, signo: "~", titulo: c.nombre, detalle: "ajustes" });
    }
  }
  if (d.sala) lineas.push({ id: null, signo: "~", titulo: "Sala", detalle: d.sala.campos.slice(0, 2).map((c) => `${c.etiqueta} ${c.antes} → ${c.despues}`).join("; ") || "ajustes" });
  return lineas;
}

/** Las piezas que el diff marca en el visor: nuevas y cambiadas (las quitadas ya no están). */
export const idsParaResaltar = (d: DiffEscena): { id: string; nueva: boolean }[] =>
  d.nodos.filter((c) => c.tipo !== "quitada").map((c) => ({ id: c.id, nueva: c.tipo === "nueva" }));
