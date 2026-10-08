import { formatoPorId } from "./formatos";
import { nombreColor } from "./herramientas-escena-colores";
import { SIN_PARTE, type SelectorGlobos } from "./partes-globos";
import type { Pieza } from "./piezas";
import { coincideFlexible, coincideParteFlexible, type Repinte } from "./repintes";
import { conValor, leer, recorrerDatos, type Etiquetado, type ObjetoFormato } from "./seleccion-datos";

/**
 * **Estrategias de `editarSeleccion`** (editar-seleccion.ts) para las piezas que no son orgánicas, y lo que comparten con
 * las orgánicas (editar-seleccion-organico.ts). Cada una devuelve la pieza nueva (cambiando SOLO sus datos) o el motivo
 * por el que no sirve aquí; el motor arma lo que devuelve y comprueba que solo cambió lo seleccionado. En orden:
 * 1. `datos`: el color está en los datos (un `codigo`, un código de `codigos`/`colores`) y TODOS los globos que salen de
 *    ese código están en la selección → se cambia ese código (los pétalos, la corona, las hojas de la palmera…).
 * 2. `repinte`: el color de lo seleccionado lo comparten globos de fuera (la paleta de un orgánico, un color de la trenza
 *    que va en varias partes) → una regla de repinte en la pieza (repintes.ts) con el selector.
 * 3. `estructura`: formato, inflado o quitar → el objeto de formato de los datos de esa parte (`ParteGlobo`, el tronco,
 *    las hojas, la pieza clásica entera); quitar solo lo que la pieza permite que falte (centro, corona, cocos…).
 */

export type CambioNormal =
  | { tipo: "color"; codigo: string }
  | { tipo: "formato"; formatoId: string }
  | { tipo: "inflado"; infladoCm: number }
  | { tipo: "quitar" };

export type Contexto = {
  pieza: Pieza;
  selector: SelectorGlobos;
  cambio: CambioNormal;
  antes: Etiquetado;
  /** `seleccion[i]`: el elemento i (globos y luego tubitos) está en la selección. */
  seleccion: readonly boolean[];
  notas: string[];
};

export type Estrategia = { nombre: string; cambios: ReadonlyArray<CambioNormal["tipo"]>; aplicar: (ctx: Contexto) => Pieza | string };

/** Partes que una pieza deja quitar (su dato admite `null`). */
const QUITABLES = new Set(["centro", "corona", "acento", "base", "cocos", "frutas", "remate", "borde", "cuello", "ruedas", "flecos", "racimo", "cabeza", "brazos", "piernas"]);

export const seleccionados = (ctx: Contexto) => ctx.antes.elementos.filter((_, i) => ctx.seleccion[i]);
export const formatosSeleccionados = (ctx: Contexto) => [...new Set(seleccionados(ctx).map((e) => e.formatoId))];

// ----------------------------------------------------------------------------------------------------------
// 1. Datos: el código de la ranura de donde salen los globos seleccionados
// ----------------------------------------------------------------------------------------------------------

const datosColor: Estrategia = {
  nombre: "datos",
  cambios: ["color"],
  aplicar: (ctx) => {
    if (ctx.cambio.tipo !== "color") return "solo cambia colores";
    const destino = ctx.cambio.codigo;
    const { ranuras } = recorrerDatos(ctx.pieza);
    let elegidas: number[];
    if (ctx.antes.sonda) {
      const cuenta = new Map<number, { total: number; dentro: number }>();
      let sueltos = 0;
      ctx.antes.elementos.forEach((e, i) => {
        if (e.ranura === undefined) { if (ctx.seleccion[i]) sueltos += 1; return; }
        const c = cuenta.get(e.ranura) ?? { total: 0, dentro: 0 };
        c.total += 1;
        if (ctx.seleccion[i]) c.dentro += 1;
        cuenta.set(e.ranura, c);
      });
      if (sueltos) return `${sueltos} globos de la selección no salen de un color de los datos de la pieza`;
      const mixta = [...cuenta].find(([, c]) => c.dentro > 0 && c.dentro < c.total);
      if (mixta) {
        const r = ranuras[mixta[0]]!;
        return `el ${nombreColor(r.codigo)} de «${r.parte}» lo llevan también ${mixta[1].total - mixta[1].dentro} globos fuera de la selección`;
      }
      elegidas = [...cuenta].filter(([, c]) => c.dentro > 0).map(([id]) => id);
    } else {
      elegidas = ranuras.filter((r) => (r.formatos.length ? r.formatos : [""]).some((f) => coincideFlexible({ formatoId: f, codigo: r.codigo, parte: SIN_PARTE, parteRuta: r.parte }, ctx.selector))).map((r) => r.id);
    }
    if (!elegidas.length) return "no encontré en los datos el color de esos globos";
    let nueva = ctx.pieza;
    for (const id of elegidas) {
      const r = ranuras[id]!;
      if (leer(nueva, r.ruta) !== destino) nueva = conValor(nueva, r.ruta, destino);
    }
    return nueva;
  },
};

// ----------------------------------------------------------------------------------------------------------
// 2. Repinte: una regla en la pieza
// ----------------------------------------------------------------------------------------------------------

const mismaLista = (a: readonly string[] | undefined, b: readonly string[] | undefined) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

export const estrategiaRepinte: Estrategia = {
  nombre: "repinte",
  cambios: ["color"],
  aplicar: (ctx) => {
    if (ctx.cambio.tipo !== "color") return "solo cambia colores";
    const s = ctx.selector;
    // La regla ve las partes que pone el armador, no las de la ruta de los datos.
    const sinParte = ctx.antes.elementos.filter((e, i) => ctx.seleccion[i] && !coincideFlexible({ ...e, parteRuta: undefined }, s)).length;
    if (sinParte) return `${sinParte} globos de la selección no llevan la parte marcada por el armador (una regla de repinte no los vería)`;
    const regla: Repinte = {
      ...(s.formatos?.length ? { formatos: [...s.formatos] } : {}),
      ...(s.partes?.length ? { partes: [...s.partes] } : {}),
      ...(s.colores?.length ? { colores: [...s.colores] } : {}),
      codigo: ctx.cambio.codigo,
    };
    const previas = (ctx.pieza.repintes ?? []).filter((r) => !(mismaLista(r.formatos, regla.formatos) && mismaLista(r.partes, regla.partes) && mismaLista(r.colores, regla.colores)));
    return { ...ctx.pieza, repintes: [...previas, regla] };
  },
};

// ----------------------------------------------------------------------------------------------------------
// 3. Estructura: formato, inflado o quitar, en el objeto de formato de los datos
// ----------------------------------------------------------------------------------------------------------

/** Los objetos de formato de la selección; un motivo si la selección parte un objeto (unos colores sí y otros no). */
export function objetosSeleccionados(ctx: Contexto): ObjetoFormato[] | string {
  const s = ctx.selector;
  const { objetos } = recorrerDatos(ctx.pieza);
  const elegidos: ObjetoFormato[] = [];
  for (const o of objetos) {
    if (s.formatos?.length && !coincideFlexible({ formatoId: o.formatoId, codigo: "", parte: SIN_PARTE }, { formatos: s.formatos })) continue;
    if (s.partes?.length) {
      const porRuta = s.partes.some((p) => coincideParteFlexible(o.parte, p));
      // La parte del armador: todos los globos de ese formato con la parte pedida salen de este objeto si es el único de su formato.
      const unico = objetos.filter((x) => x.formatoId === o.formatoId).length === 1;
      const porArmador = unico && seleccionados(ctx).some((e) => e.formatoId === o.formatoId);
      if (!porRuta && !porArmador) continue;
    }
    if (s.colores?.length) {
      if (!o.codigos.length) return `el color no está en «${o.parte}» (su color va aparte): ese cambio es de todo el ${o.formatoId} de la pieza, no solo de un color`;
      const dentro = o.codigos.filter((c) => s.colores!.includes(c));
      if (!dentro.length) continue;
      if (dentro.length < o.codigos.length) return `«${o.parte}» (${o.formatoId}) lleva también ${o.codigos.filter((c) => !s.colores!.includes(c)).map(nombreColor).join(", ")}: el formato y el inflado son de todo el objeto, no de un color`;
    }
    elegidos.push(o);
  }
  if (!elegidos.length) return "no encontré en los datos el objeto de esos globos";
  return elegidos;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function conFormato(pieza: Pieza, o: ObjetoFormato, destino: string): Pieza {
  const f = formatoPorId(destino)!, viejo = formatoPorId(o.formatoId)!;
  const actual = leer(pieza, o.ruta) as Record<string, unknown>;
  const nuevo: Record<string, unknown> = { ...actual, formatoId: destino };
  if (typeof actual.infladoCm === "number") nuevo.infladoCm = f.infladoDecoracionCm;
  if (typeof actual.grosorCm === "number") nuevo.grosorCm = f.infladoDecoracionCm;
  const k = f.infladoDecoracionCm / viejo.infladoDecoracionCm;
  for (const clave of ["infladoBaseCm", "infladoPuntaCm"]) if (typeof actual[clave] === "number") nuevo[clave] = r1((actual[clave] as number) * k);
  return conValor(pieza, o.ruta, nuevo);
}

function conInflado(pieza: Pieza, o: ObjetoFormato, cm: number): Pieza | string {
  const actual = leer(pieza, o.ruta) as Record<string, unknown>;
  if (typeof actual.infladoCm === "number") return conValor(pieza, o.ruta, { ...actual, infladoCm: cm });
  if (typeof actual.infladoBaseCm === "number" && typeof actual.infladoPuntaCm === "number") {
    const k = cm / (actual.infladoBaseCm as number);
    return conValor(pieza, o.ruta, { ...actual, infladoBaseCm: cm, infladoPuntaCm: r1((actual.infladoPuntaCm as number) * k) });
  }
  return `«${o.parte}» (${o.formatoId}) no tiene un inflado propio`;
}

function sinObjeto(pieza: Pieza, o: ObjetoFormato): Pieza | string {
  const clave = o.ruta[o.ruta.length - 1];
  if (typeof clave === "string" && QUITABLES.has(clave)) return conValor(pieza, o.ruta, null);
  if (typeof clave === "number") {
    const lista = leer(pieza, o.ruta.slice(0, -1));
    if (Array.isArray(lista) && lista.length > 1) return conValor(pieza, o.ruta, undefined);
  }
  return `«${o.parte === SIN_PARTE ? "esos globos" : o.parte}» (${o.formatoId}) es la estructura de la pieza: no se puede quitar (sí cambiarle el color, el formato o el inflado)`;
}

const datosEstructura: Estrategia = {
  nombre: "estructura",
  cambios: ["formato", "inflado", "quitar"],
  aplicar: (ctx) => {
    const objetos = objetosSeleccionados(ctx);
    if (typeof objetos === "string") return objetos;
    // De lo más hondo a lo de arriba: quitar un elemento de una lista no mueve las rutas de los que faltan.
    const orden = [...objetos].sort((a, b) => b.ruta.length - a.ruta.length || Number(b.ruta[b.ruta.length - 1]) - Number(a.ruta[a.ruta.length - 1]));
    let nueva: Pieza = ctx.pieza;
    for (const o of orden) {
      const c = ctx.cambio;
      const hecho = c.tipo === "formato" ? (o.formatoId === c.formatoId ? nueva : conFormato(nueva, o, c.formatoId))
        : c.tipo === "inflado" ? conInflado(nueva, o, c.infladoCm)
          : c.tipo === "quitar" ? sinObjeto(nueva, o) : "cambio desconocido";
      if (typeof hecho === "string") return hecho;
      nueva = hecho;
    }
    return nueva;
  },
};

export const ESTRATEGIAS_GENERALES: readonly Estrategia[] = [datosColor, estrategiaRepinte, datosEstructura];
