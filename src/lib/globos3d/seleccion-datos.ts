import { coloresDelFormato, formatoPorId } from "./formatos";
import { SIN_PARTE, type LineaInventario } from "./partes-globos";
import { armarPieza, type Pieza, type PiezaArmada } from "./piezas";

/**
 * **Los datos de una pieza vistos como globos** (para `editar-seleccion.ts`): dónde está cada color en el JSON de la
 * pieza y qué globos armados salen de él.
 * - `recorrerDatos`: las **ranuras de color** (cada `codigo`, y cada código de las listas `codigos`/`colores`) y los
 *   **objetos de formato** (todo objeto con `formatoId`: `ParteGlobo`, el tronco, las hojas, la pieza clásica entera),
 *   cada uno con su ruta, los formatos que lo rodean y su **parte por la ruta** (`decoracion.propiedades.corona` →
 *   «corona», `arbol.copa.hojas` → «copa/hojas»; la tabla de claves está en `CLAVES`).
 * - `etiquetar`: arma la pieza y, con una **sonda** (cada ranura toma un color distinto que no usa la pieza, se vuelve a
 *   armar y se mira qué globo salió de qué color), sabe de qué ranura sale cada globo y su parte por la ruta. Así se
 *   apunta a «la corona» aunque el armador no ponga `parte`, y se sabe si un color de los datos lo comparten globos de
 *   dentro y de fuera de una selección (entonces no se puede cambiar solo en los datos).
 */

export type Ruta = ReadonlyArray<string | number>;

export type Ranura = {
  id: number;
  /** Ruta del código (la del `codigo`, o la de la lista más el índice). */
  ruta: Ruta;
  codigo: string;
  /** Formatos en que va ese color (el del objeto, o los de su globo/grande/chico, o los del objeto de arriba). */
  formatos: string[];
  /** Parte por la ruta («corona», «copa/hojas»; `general` si la ruta no dice nada). */
  parte: string;
};

export type ObjetoFormato = { ruta: Ruta; formatoId: string; parte: string; codigos: string[] };

export type ElementoEtiquetado = { formatoId: string; codigo: string; infladoCm: number; tubito: boolean; parte: string; parteRuta?: string; ranura?: number };

export type Etiquetado = { armada: PiezaArmada; elementos: ElementoEtiquetado[]; sonda: boolean };

/**
 * Claves de la ruta → parte. `null`: la clave no es una parte (contenedores, listas de colores, el globo de una técnica);
 * lo que no está en la tabla vale con su propio nombre (petalos, corona, centro, tronco, copa, base, remate, union…).
 */
const CLAVES: Readonly<Record<string, string | null>> = {
  opciones: null, propiedades: null, decoracion: null, arbol: null, letras: null, mural: null, techo: null, guirnalda: null, arco: null,
  metalizado: null, matriz: null, colores: null, codigos: null, codigo: null, globo: null, tecnica: null, elementos: null, generador: null,
  trazo: null, forma: null, tubito: null, abanico: null, contorno: null, valor: null, pieza: null, segmentos: null, cuerpo: "cuerpo",
  acento: "acentos", hojas: "hojas", cocos: "cocos", frutas: "frutas", flecos: "flecos", racimo: "racimo", encima: "encima",
  aplicaciones: "aplicaciones", grande: "grande", chico: "chico",
};
/** Claves cuyo objeto va en un formato fijo aunque no lo diga (la pareja de unión de una malla es R-5). */
const FORMATO_DE_CLAVE: Readonly<Record<string, string>> = { union: "R-5" };
/** Claves que no se recorren: lo que no es la pieza (reglas de repinte, impresos). */
const SALTAR = new Set(["repintes", "impresos"]);

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esCodigo = (v: unknown): v is string => typeof v === "string" && /^\d{3}$/.test(v);
const plegar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function parteDeRuta(ruta: Ruta): string {
  const partes = ruta.filter((k): k is string => typeof k === "string").flatMap((k) => {
    const m = CLAVES[k];
    if (m === null) return [];
    return [m ?? plegar(k)];
  });
  return partes.length ? partes.join("/") : SIN_PARTE;
}

/** Formatos que rodean un objeto: el suyo, los de sus hijos globo/grande/chico/tecnica, o los del objeto de arriba. */
function formatosCercanos(cadena: ReadonlyArray<{ clave: string | number | null; objeto: Record<string, unknown> }>): string[] {
  const ultima = cadena[cadena.length - 1];
  if (ultima && typeof ultima.clave === "string" && FORMATO_DE_CLAVE[ultima.clave]) return [FORMATO_DE_CLAVE[ultima.clave]!];
  for (let i = cadena.length - 1; i >= 0; i--) {
    const o = cadena[i]!.objeto;
    const propios = [o.formatoId, ...["globo", "grande", "chico", "tecnica"].map((k) => (esObjeto(o[k]) ? (o[k] as Record<string, unknown>).formatoId : undefined))]
      .filter((f): f is string => typeof f === "string" && !!formatoPorId(f));
    if (propios.length) return [...new Set(propios)];
  }
  return [];
}

/** Las ranuras de color y los objetos de formato de cualquier dato del taller (una pieza, sus opciones). */
export function recorrerDatos(raiz: unknown): { ranuras: Ranura[]; objetos: ObjetoFormato[] } {
  const ranuras: Ranura[] = [];
  const objetos: ObjetoFormato[] = [];
  const recorrer = (v: unknown, ruta: (string | number)[], cadena: Array<{ clave: string | number | null; objeto: Record<string, unknown> }>) => {
    if (Array.isArray(v)) { v.forEach((x, i) => recorrer(x, [...ruta, i], cadena)); return; }
    if (!esObjeto(v)) return;
    const aqui = [...cadena, { clave: ruta[ruta.length - 1] ?? null, objeto: v }];
    const formatos = formatosCercanos(aqui);
    const parte = parteDeRuta(ruta);
    const propios: string[] = [];
    for (const [clave, x] of Object.entries(v)) {
      if (SALTAR.has(clave)) continue;
      if (clave === "codigo" && esCodigo(x)) {
        ranuras.push({ id: ranuras.length, ruta: [...ruta, clave], codigo: x, formatos, parte });
        propios.push(x);
      } else if ((clave === "codigos" || clave === "colores") && Array.isArray(x) && x.every((c) => typeof c === "string")) {
        x.forEach((c, i) => { if (esCodigo(c)) { ranuras.push({ id: ranuras.length, ruta: [...ruta, clave, i], codigo: c, formatos, parte }); propios.push(c); } });
      } else {
        recorrer(x, [...ruta, clave], aqui);
      }
    }
    if (typeof v.formatoId === "string" && formatoPorId(v.formatoId)) objetos.push({ ruta, formatoId: v.formatoId, parte, codigos: propios });
  };
  recorrer(raiz, [], []);
  return { ranuras, objetos };
}

/** Lee lo que hay en una ruta. */
export function leer(raiz: unknown, ruta: Ruta): unknown {
  let v: unknown = raiz;
  for (const k of ruta) {
    if (Array.isArray(v) && typeof k === "number") v = v[k];
    else if (esObjeto(v) && typeof k === "string") v = v[k];
    else return undefined;
  }
  return v;
}

/** Copia del dato con el valor de una ruta cambiado (`undefined` en un índice lo saca de la lista). */
export function conValor<T>(raiz: T, ruta: Ruta, valor: unknown): T {
  const poner = (v: unknown, i: number): unknown => {
    if (i === ruta.length) return valor;
    const k = ruta[i]!;
    if (Array.isArray(v) && typeof k === "number") {
      if (i === ruta.length - 1 && valor === undefined) return v.filter((_, j) => j !== k);
      return v.map((x, j) => (j === k ? poner(x, i + 1) : x));
    }
    if (esObjeto(v) && typeof k === "string") return { ...v, [k]: poner(v[k], i + 1) };
    throw new Error(`Ruta inválida en los datos: ${ruta.join(".")}`);
  };
  return poner(raiz, 0) as T;
}

// ----------------------------------------------------------------------------------------------------------
// Etiquetar: qué globo sale de qué ranura (sonda de colores)
// ----------------------------------------------------------------------------------------------------------

const MAX_TANDAS = 4;

/** Los globos y tubitos (sin los de papel) de una pieza armada, en orden: primero los globos, luego los tubitos. */
export function elementosDe(armada: Pick<PiezaArmada, "globos" | "tubos">): ElementoEtiquetado[] {
  return [
    ...armada.globos.map((g) => ({ formatoId: g.formatoId, codigo: g.codigo, infladoCm: g.infladoCm, tubito: formatoPorId(g.formatoId)?.tipo === "tubito", parte: g.parte ?? SIN_PARTE })),
    ...armada.tubos.filter((t) => !t.papel).map((t) => ({ formatoId: t.formatoId, codigo: t.codigo, infladoCm: t.grosorCm, tubito: true, parte: t.parte ?? SIN_PARTE })),
  ];
}

export function sinRepintes(pieza: Pieza): Pieza {
  if (!pieza.repintes) return pieza;
  const { repintes: _fuera, ...resto } = pieza;
  return resto as Pieza;
}

const mismaForma = (a: readonly ElementoEtiquetado[], b: readonly ElementoEtiquetado[]) => a.length === b.length && a.every((e, i) => e.formatoId === b[i]!.formatoId);

/**
 * Arma la pieza y etiqueta cada globo con su ranura y su parte por la ruta. Lo orgánico no se sondea (sus partes ya las
 * pone el motor por tramo y su color sale de la paleta). Si la sonda no se puede (el armador cambia con los colores, o
 * no hay colores libres), `sonda` es false y solo quedan las partes que puso el armador.
 */
export function etiquetar(pieza: Pieza, armada: PiezaArmada = armarPieza(pieza)): Etiquetado {
  const elementos = elementosDe(armada);
  if (pieza.tipo === "organico" || pieza.tipo === "arco_organico" || !elementos.length) return { armada, elementos, sonda: false };
  const { ranuras } = recorrerDatos(pieza);
  if (!ranuras.length) return { armada, elementos, sonda: false };
  const usados = new Set<string>([...ranuras.map((r) => r.codigo), ...elementos.map((e) => e.codigo)]);
  const formatosPieza = [...new Set(elementos.map((e) => e.formatoId))];
  let pendientes = [...ranuras];
  let sonda = true;
  for (let tanda = 0; tanda < MAX_TANDAS && pendientes.length; tanda++) {
    const tomados = new Set<string>();
    const asignadas = new Map<string, Ranura>();
    const siguen: Ranura[] = [];
    // Sin los repintes: la sonda busca de qué color de los datos sale cada globo (un repinte lo taparía).
    let copia: Pieza = sinRepintes(pieza);
    for (const r of pendientes) {
      const formatos = r.formatos.length ? r.formatos : formatosPieza;
      const libre = coloresDelFormato(formatos[0]!).find((c) => !usados.has(c.codigo) && !tomados.has(c.codigo) && formatos.every((f) => coloresDelFormato(f).some((x) => x.codigo === c.codigo)));
      if (!libre) { siguen.push(r); continue; }
      tomados.add(libre.codigo);
      asignadas.set(libre.codigo, r);
      copia = conValor(copia, r.ruta, libre.codigo);
    }
    if (!asignadas.size) break;
    let probada: ElementoEtiquetado[];
    try { probada = elementosDe(armarPieza(copia)); } catch { sonda = false; break; }
    if (!mismaForma(probada, elementos)) { sonda = false; break; }
    probada.forEach((e, i) => {
      const r = asignadas.get(e.codigo);
      if (r) elementos[i] = { ...elementos[i]!, ranura: r.id, parteRuta: r.parte };
    });
    pendientes = siguen;
  }
  return { armada, elementos, sonda };
}

/** Inventario (parte × formato × color) de elementos ya etiquetados: la parte del armador o, si no la puso, la de la ruta. */
export function inventarioEtiquetado(elementos: readonly ElementoEtiquetado[]): LineaInventario[] {
  const mapa = new Map<string, LineaInventario>();
  for (const e of elementos) {
    const parte = parteEfectiva(e);
    const clave = `${parte}|${e.formatoId}|${e.codigo}`;
    const l = mapa.get(clave) ?? { parte, formatoId: e.formatoId, codigo: e.codigo, cantidad: 0, tubito: e.tubito };
    l.cantidad += 1;
    mapa.set(clave, l);
  }
  return [...mapa.values()].sort((a, b) => a.parte.localeCompare(b.parte) || b.cantidad - a.cantidad);
}

export const parteEfectiva = (e: Pick<ElementoEtiquetado, "parte" | "parteRuta">) => (e.parte !== SIN_PARTE ? e.parte : e.parteRuta ?? SIN_PARTE);
