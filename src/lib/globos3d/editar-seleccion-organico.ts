import type { ColorOrganico, OpcionesOrganico } from "./organico";
import { formatoPorId } from "./formatos";
import { nombreColor } from "./herramientas-escena-colores";
import { FORMATOS_AJUSTABLES, ajustarTamanos } from "./herramientas-escena-tamanos";
import { comoOrganico, conPaleta, editar, inflado, paletaDe, type PiezaOrganica } from "./organico-ajustes";
import type { ParametrosTrazoOrganico } from "./trazo-organico";
import type { Pieza } from "./piezas";
import { estrategiaRepinte, formatosSeleccionados, seleccionados, type Contexto, type Estrategia } from "./editar-seleccion-estrategias";

/**
 * **Estrategias de `editarSeleccion` para lo orgánico** (orgánico con o sin trazo y arco orgánico por medidas). Aquí el
 * color no está en un objeto de formato: la paleta (`ColorOrganico`) se reparte entre todos los tamaños. En orden:
 * - color: `paleta` (si TODOS los globos de esos colores están en la selección: se cambia el código en la paleta, «todo
 *   el rosado a azul»), `paleta por tamaño` (se parten las entradas con `formatos` para que solo esos tamaños tomen el
 *   color nuevo, con el mismo peso) y, si al armar cambian globos de otros tamaños (el reparto vuelve a tirar el azar),
 *   `repinte` (una regla en la pieza: exacto);
 * - formato («los R-24 a R-18»): el peso de ese tamaño pasa al otro en la mezcla, las zonas, el relleno y la paleta;
 * - quitar: un tamaño con `ajustar_tamanos` (quitar), o un color de la paleta (los demás colores toman sus globos);
 * - inflado: el inflado de ese tamaño (sin trazo; el trazo usa los inflados de la técnica).
 * Por partes (tramos) solo se cambia el color (repinte): la mezcla y la paleta son de toda la pieza.
 */

const esOrganica = (p: Pieza): p is PiezaOrganica => p.tipo === "organico" || p.tipo === "arco_organico";

const paletaCompleta: Estrategia = {
  nombre: "paleta",
  cambios: ["color"],
  aplicar: (ctx) => {
    if (ctx.cambio.tipo !== "color" || !esOrganica(ctx.pieza)) return "solo colores de lo orgánico";
    const codigos = [...new Set(seleccionados(ctx).map((e) => e.codigo))];
    const fuera = ctx.antes.elementos.filter((e, i) => !ctx.seleccion[i] && codigos.includes(e.codigo)).length;
    if (fuera) return `esos colores los llevan también ${fuera} globos fuera de la selección`;
    const paleta = paletaDe(ctx.pieza);
    if (!paleta.some((c) => codigos.includes(c.codigo))) return "esos colores no están en la paleta (el motor los sustituyó por el formato)";
    const destino = ctx.cambio.codigo;
    return conPaleta(ctx.pieza, paleta.map((c) => (codigos.includes(c.codigo) ? { ...c, codigo: destino } : { ...c })));
  },
};

const paletaPorTamano: Estrategia = {
  nombre: "paleta por tamaño",
  cambios: ["color"],
  aplicar: (ctx) => {
    if (ctx.cambio.tipo !== "color" || !esOrganica(ctx.pieza)) return "solo colores de lo orgánico";
    if (ctx.selector.partes?.length) return "la paleta es de toda la pieza: por partes no se parte";
    const tamanos = formatosSeleccionados(ctx);
    const presentes = [...new Set(ctx.antes.elementos.map((e) => e.formatoId))];
    const colores = ctx.selector.colores;
    const formatosDe = (c: ColorOrganico) => (c.formatos?.length ? [...c.formatos] : presentes);
    const tocadas = paletaDe(ctx.pieza).filter((c) => (!colores?.length || colores.includes(c.codigo)) && formatosDe(c).some((f) => tamanos.includes(f)));
    if (!tocadas.length) return "ninguna entrada de la paleta va en esos tamaños";
    const paleta: ColorOrganico[] = paletaDe(ctx.pieza).flatMap((c) => {
      if (!tocadas.includes(c)) return [{ ...c }];
      const quedan = formatosDe(c).filter((f) => !tamanos.includes(f));
      return quedan.length ? [{ ...c, formatos: quedan }] : [];
    });
    paleta.push({ codigo: ctx.cambio.codigo, peso: tocadas.reduce((s, c) => s + c.peso, 0) || 1, formatos: tamanos });
    return conPaleta(ctx.pieza, paleta);
  },
};

// ----------------------------------------------------------------------------------------------------------
// Formato, quitar e inflado
// ----------------------------------------------------------------------------------------------------------

/** El único tamaño seleccionado, si la selección es por tamaño (sin partes ni colores). */
function soloUnTamano(ctx: Contexto, que: string): string {
  if (ctx.selector.partes?.length || ctx.selector.colores?.length) throw new Error(`en lo orgánico ${que} es de todo el tamaño (la mezcla es de toda la pieza): no se puede solo en una parte o un color`);
  const tamanos = formatosSeleccionados(ctx);
  if (tamanos.length !== 1) throw new Error(`${que} va de un tamaño a la vez (la selección tiene ${tamanos.join(", ")})`);
  return tamanos[0]!;
}

const renombrar = (pesos: Readonly<Record<string, number>>, de: string, a: string): Record<string, number> => {
  const salida: Record<string, number> = {};
  for (const [f, w] of Object.entries(pesos)) { const k = f === de ? a : f; salida[k] = (salida[k] ?? 0) + w; }
  return salida;
};
const formatosRenombrados = (c: ColorOrganico, de: string, a: string): ColorOrganico => (c.formatos ? { ...c, formatos: [...new Set(c.formatos.map((f) => (f === de ? a : f)))] } : { ...c });

const mezcla: Estrategia = {
  nombre: "mezcla",
  cambios: ["formato"],
  aplicar: (ctx) => {
    if (ctx.cambio.tipo !== "formato" || !esOrganica(ctx.pieza)) return "solo formatos de lo orgánico";
    let de: string;
    try { de = soloUnTamano(ctx, "el formato"); } catch (e) { return (e as Error).message; }
    const a = ctx.cambio.formatoId;
    if (!(FORMATOS_AJUSTABLES as readonly string[]).includes(a)) return `${a} no va en lo orgánico (van ${FORMATOS_AJUSTABLES.join(", ")})`;
    const p = comoOrganico(ctx.pieza);
    const k = inflado(p, a) / inflado(p, de);
    const relleno = <T extends { formatoId: string; infladoCm: number }>(r: T): T => (r.formatoId === de ? { ...r, formatoId: a, infladoCm: Math.round(r.infladoCm * k) } : r);
    const trazo = (t: ParametrosTrazoOrganico): ParametrosTrazoOrganico => ({
      ...t, mezcla: renombrar(t.mezcla, de, a),
      ...(t.zonas ? { zonas: t.zonas.map((z) => ({ ...z, pesos: renombrar(z.pesos, de, a) })) } : {}),
      ...(t.relleno ? { relleno: t.relleno.map(relleno) } : {}),
      colores: t.colores.map((c) => formatosRenombrados(c, de, a)),
    });
    const opciones = (o: OpcionesOrganico): OpcionesOrganico => ({
      ...o, tramos: o.tramos.map((t) => ({ ...t, mezcla: t.mezcla.map((m) => ({ ...m, pesos: renombrar(m.pesos, de, a) })) })),
      relleno: o.relleno.map(relleno), colores: o.colores.map((c) => formatosRenombrados(c, de, a)),
    });
    return editar(p, trazo, opciones);
  },
};

const quitar: Estrategia = {
  nombre: "quitar",
  cambios: ["quitar"],
  aplicar: (ctx) => {
    if (!esOrganica(ctx.pieza)) return "solo lo orgánico";
    const s = ctx.selector;
    if (s.colores?.length && !s.formatos?.length && !s.partes?.length) {
      const paleta = paletaDe(ctx.pieza).filter((c) => !s.colores!.includes(c.codigo));
      if (!paleta.length) return "la pieza se quedaría sin colores: cambia el color en vez de quitarlo";
      ctx.notas.push(`quité ${s.colores.map(nombreColor).join(", ")} de la paleta: sus globos toman los demás colores`);
      return conPaleta(ctx.pieza, paleta.map((c) => ({ ...c })));
    }
    if (s.partes?.length || s.colores?.length) return "en lo orgánico se quita un tamaño entero o un color entero, no los de una parte";
    const tamanos = formatosSeleccionados(ctx);
    const malos = tamanos.filter((f) => !(FORMATOS_AJUSTABLES as readonly string[]).includes(f));
    if (malos.length) return `${malos.join(", ")} no es un tamaño de la mezcla orgánica`;
    return ajustarTamanos(ctx.pieza, { cambios: tamanos.map((f) => ({ formato: f, accion: "quitar" as const })) }, ctx.notas).pieza;
  },
};

const infladoTamano: Estrategia = {
  nombre: "inflado",
  cambios: ["inflado"],
  aplicar: (ctx) => {
    if (ctx.cambio.tipo !== "inflado" || !esOrganica(ctx.pieza)) return "solo inflados de lo orgánico";
    let f: string;
    try { f = soloUnTamano(ctx, "el inflado"); } catch (e) { return (e as Error).message; }
    const p = comoOrganico(ctx.pieza);
    if (p.generador?.tipo === "trazo") return "en una pieza de trazo cada tamaño va con el inflado de la técnica orgánica (no se cambia por tamaño): cambia el tamaño (formato) en su lugar";
    const cm = ctx.cambio.infladoCm;
    if (!formatoPorId(f)) return `formato desconocido ${f}`;
    return { ...p, opciones: { ...p.opciones, inflados: { ...(p.opciones.inflados ?? {}), [f]: cm } } };
  },
};

export const ESTRATEGIAS_ORGANICO: readonly Estrategia[] = [paletaCompleta, paletaPorTamano, estrategiaRepinte, mezcla, quitar, infladoTamano];
