import { porcentajesMayorResto } from "../escena/tamano-fisico";
import type { SceneSpec } from "../escena/scene-spec";

/**
 * Proporción y acabado de color POR ESTRUCTURA para el modelo de imagen y para
 * el QA visual.
 *
 * El plan resuelve la mezcla real de cada estructura (color, acabado, unidades)
 * y el estimado la conserva línea a línea, pero el prompt solo llevaba la lista
 * de colores y un conteo global de toda la escena: un arco 85 % blanco con 15 %
 * dorado se leía igual que uno mitad y mitad, y el observador no tenía criterio
 * para marcarlo. Este módulo es el único dueño de esa redacción, para que el
 * prompt y el QA describan exactamente la misma mezcla.
 *
 * Puro: sin proveedor, HTTP, base de datos ni variables de entorno.
 */

export type ColorDeEstructura = {
  /** Nombre de catálogo tal como lo nombra el resto del prompt (en español). */
  color: string;
  /** Acabado en inglés para el modelo de imagen; null cuando el estimado no lo trae. */
  acabado: string | null;
  unidades: number;
  /** Entero; el conjunto suma 100. */
  pct: number;
};

/**
 * Acabados canónicos del catálogo (`ACABADOS_CATALOGO_V2`) en inglés llano.
 * A propósito NO es el mismo mapa que `FINISH_WORDS` del compilador de
 * captions: ese habla el dialecto con el que se entrenó el LoRA y tiene que
 * coincidir con sus captions, mientras que aquí se le explica el material a un
 * modelo de instrucciones que nunca vio ese vocabulario.
 */
const ACABADO_EN: Readonly<Record<string, string>> = {
  reflex: "high-shine chrome",
  metal: "metallic",
  metalizado: "metallic",
  cromado: "high-shine chrome",
  satin: "satin",
  fashion: "matte",
  mate: "matte",
  perlado: "pearl",
  transparente: "translucent",
};

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function acabadoEnIngles(acabado: string | null | undefined): string | null {
  if (!acabado) return null;
  return ACABADO_EN[plegar(acabado)] ?? null;
}

/** Id de la estructura del plan a la que pertenece un elemento (`EST_02#2` -> `EST_02`). */
export function idDeEstructura(element: SceneSpec["elements"][number]): string {
  return element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!;
}

/**
 * Mezcla de color de la estructura a la que pertenece el elemento, de mayor a
 * menor participación. Vacía cuando el estimado no trae líneas de esa
 * estructura (camino de catálogo sin plan): en ese caso el prompt conserva su
 * texto sin proporciones en vez de inventar una.
 *
 * Solo se describen colores que el elemento ya declara en `resolved_colors`:
 * el estimado etiqueta cada línea con el primer color del producto, así que un
 * color suyo que la estructura no aprobó no puede entrar al prompt.
 */
export function mezclaDeColorDeEstructura(sceneSpec: SceneSpec, element: SceneSpec["elements"][number]): ColorDeEstructura[] {
  const lineas = sceneSpec.material_estimate?.balloons ?? [];
  if (!lineas.length) return [];
  const estructura = idDeEstructura(element);
  const aprobados = new Set(element.resolved_colors.map(plegar));
  const grupos = new Map<string, { color: string; acabado: string | null; unidades: number }>();
  for (const linea of lineas) {
    if (linea.structure_id !== estructura || !linea.color) continue;
    if (aprobados.size && !aprobados.has(plegar(linea.color))) continue;
    const acabado = acabadoEnIngles(linea.finish);
    const clave = JSON.stringify([plegar(linea.color), acabado]);
    const previo = grupos.get(clave);
    grupos.set(clave, { color: previo?.color ?? linea.color, acabado, unidades: (previo?.unidades ?? 0) + linea.design_quantity });
  }
  const ordenados = [...grupos.values()].sort((a, b) =>
    b.unidades - a.unidades
    || (plegar(a.color) < plegar(b.color) ? -1 : plegar(a.color) > plegar(b.color) ? 1 : 0)
    || (a.acabado ?? "").localeCompare(b.acabado ?? ""));
  const porcentajes = porcentajesMayorResto(ordenados.map((grupo) => grupo.unidades));
  return ordenados.map((grupo, indice) => ({ ...grupo, pct: porcentajes[indice]! }));
}

function conAcabado(entrada: ColorDeEstructura): string {
  return `${entrada.color} (~${entrada.pct}%${entrada.acabado ? `, ${entrada.acabado}` : ""})`;
}

/**
 * "mostly blanco (~85%, matte) with dorado accents (~15%, high-shine chrome)".
 * Cadena vacía cuando no hay mezcla que describir o cuando es de un solo
 * color (ese caso lo cubre el MONOCHROME LOCK del prompt).
 */
export function describirMezclaDeColor(mezcla: readonly ColorDeEstructura[]): string {
  if (mezcla.length < 2) return "";
  const [dominante, ...resto] = mezcla;
  const encabezado = dominante!.pct >= 50 ? `mostly ${conAcabado(dominante!)}` : `${conAcabado(dominante!)} as the largest share`;
  return `${encabezado} with ${resto.map((entrada) => `${conAcabado(entrada)} as accents`).join(" and ")}`;
}
