import { porcentajesMayorResto } from "../escena/tamano-fisico";
import type { SceneSpec } from "../escena/scene-spec";
import type { ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import type { ArmadoGuirnaldaResuelto, FormaGuirnalda, SoporteGuirnalda } from "@/lib/plan/armado-guirnalda";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";

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
export const ACABADO_EN: Readonly<Record<string, string>> = {
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
 * Frase del patrón de color de la estructura del elemento, tal como la escribió
 * Python en `plan_resuelto.patrones_color` (ADR-0028 §12). Adaptador temporal
 * hasta que el prompt de imagen migre a Python: aquí solo se busca la frase;
 * nunca se redacta, se expande ni se cuenta un patrón.
 *
 * `undefined` cuando la estructura no tiene patrón aplicado (una sugerencia
 * `aplicado: false` no es del plan) o cuando la frase viene vacía (modo
 * aleatorio: el reparto orgánico de siempre). En ese caso el prompt no cambia.
 */
export function frasePatronColor(
  patrones: readonly FraseDeEstructura[] | undefined,
  element: SceneSpec["elements"][number],
  campo: "prompt_gemini" | "prompt_lora",
): string | undefined {
  if (!patrones?.length) return undefined;
  const estructura = idDeEstructura(element);
  const frase = patrones.find((patron) => patron.aplicado && patron.estructura_id === estructura)?.[campo].trim();
  return frase || undefined;
}

/**
 * Lo que el prompt lee del armado de una guirnalda (ADR-0032), tal como lo
 * decidió Python: sobre qué va, qué forma toma, de cuántos puntos cuelga y
 * sobre qué pieza va abrazada. Solo elige frases fijas del prompt (soporte,
 * forma, candados); nunca redacta ni cuenta el armado.
 */
export type ArmadoGuirnaldaEnPrompt = {
  soporte: SoporteGuirnalda;
  forma: FormaGuirnalda;
  puntos_de_anclaje?: number;
  /** Con `soporte: "sobre_estructura"`: la pieza del plan sobre la que va. */
  anfitriona?: string;
  /** La frase de la estructura lleva además su patrón de color (no confeti). */
  conPatron: boolean;
  /** El armado resuelto lleva relleno de globos chicos (`relleno` no nulo). */
  conRelleno: boolean;
  /** El armado resuelto lleva remates (`remates` no vacío). */
  conRemates: boolean;
};

/**
 * Lo que el prompt lee del armado de un bouquet (ADR-0030), tal como lo
 * decidió Python: cuántos bouquets forman cada instancia (`grupos`; 2 con un
 * número a cada lado) y si lleva remate y globos número. Solo elige frases
 * fijas (cardinalidad, candados); nunca redacta ni cuenta el armado.
 */
export type ArmadoBouquetEnPrompt = { grupos: number; conRemate: boolean; conNumeros: boolean };

/**
 * Lo que los constructores de prompts leen de un patrón de color o de un
 * armado de bouquet o de guirnalda: a qué estructura pertenece, si está en el
 * plan y las dos frases que escribió Python. Un `PatronColorResuelto` lo cumple
 * tal cual.
 */
export type FraseDeEstructura = Pick<PatronColorResuelto, "estructura_id" | "aplicado" | "prompt_gemini" | "prompt_lora"> & {
  /**
   * Solo en la frase de un armado de bouquet (ADR-0030): cuántos bouquets
   * forman cada instancia de la pieza, tal como lo decidió Python (`grupos`;
   * 2 con un número a cada lado), y si lleva remate y números. El prompt lo
   * lee para contar piezas y elegir el candado, nunca para redactar el armado.
   * Un patrón de color no lo lleva.
   */
  armado?: ArmadoBouquetEnPrompt;
  /** Solo en la frase de una guirnalda con armado (ADR-0032, E5). */
  guirnalda?: ArmadoGuirnaldaEnPrompt;
};

/**
 * Une la frase del armado de una guirnalda con la de su patrón, cuando lo
 * tiene: el armado dice cómo se arma y el patrón de qué color va cada globo
 * (los dos de Python, tal cual). Primero el armado, luego el patrón.
 */
function unirFrases(armado: string, patron: string | undefined, separador: string): string {
  const conPatron = patron?.trim();
  return conPatron ? `${armado.trim()}${separador}${conPatron}` : armado.trim();
}

/**
 * Las frases por estructura de un plan resuelto: sus patrones de color
 * (ADR-0028 §12), sus armados de bouquet (ADR-0030) y sus armados de
 * guirnalda (ADR-0032), que siempre son del plan (`aplicado: true`). Una
 * guirnalda con armado y patrón da una sola frase: la del armado seguida de la
 * del patrón (en Gemini con un espacio, en el caption LoRA con una coma), que
 * reemplaza a la del patrón solo. `undefined` cuando el plan no trae ninguno,
 * para que la petición de siempre siga byte a byte igual.
 */
export function frasesDeEstructuras(
  plan: {
    patrones_color?: readonly PatronColorResuelto[];
    armados_bouquet?: readonly ArmadoBouquetResuelto[];
    armados_guirnalda?: readonly ArmadoGuirnaldaResuelto[];
  } | null | undefined,
): FraseDeEstructura[] | undefined {
  if (!plan || (plan.patrones_color === undefined && plan.armados_bouquet === undefined && plan.armados_guirnalda === undefined)) return undefined;
  const frases: FraseDeEstructura[] = [
    ...(plan.patrones_color ?? []),
    ...(plan.armados_bouquet ?? []).map((armado) => ({
      estructura_id: armado.estructura_id,
      aplicado: true,
      prompt_gemini: armado.prompt_gemini,
      prompt_lora: armado.prompt_lora,
      armado: { grupos: armado.grupos, conRemate: armado.remate.length > 0, conNumeros: armado.numero !== null },
    })),
  ];
  for (const armado of plan.armados_guirnalda ?? []) {
    const indice = frases.findIndex((frase) => frase.aplicado && frase.estructura_id === armado.estructura_id && !frase.armado);
    const patron = indice >= 0 ? frases[indice] : undefined;
    const entrada: FraseDeEstructura = {
      estructura_id: armado.estructura_id,
      aplicado: true,
      prompt_gemini: unirFrases(armado.prompt_gemini, patron?.prompt_gemini, " "),
      prompt_lora: unirFrases(armado.prompt_lora, patron?.prompt_lora, ", "),
      guirnalda: {
        soporte: armado.armado.soporte,
        forma: armado.armado.forma,
        ...(armado.armado.puntos_de_anclaje === undefined ? {} : { puntos_de_anclaje: armado.armado.puntos_de_anclaje }),
        ...(armado.armado.estructura_id === undefined ? {} : { anfitriona: armado.armado.estructura_id }),
        conPatron: Boolean(patron?.prompt_gemini.trim() || patron?.prompt_lora.trim()),
        conRelleno: armado.relleno !== null,
        conRemates: armado.remates.length > 0,
      },
    };
    if (indice >= 0) frases[indice] = entrada;
    else frases.push(entrada);
  }
  return frases;
}

/**
 * El armado de guirnalda de la estructura del elemento (sus instancias
 * repetidas incluidas), cuando su frase aplicada es la de un armado de
 * guirnalda. `undefined` sin él: el prompt no cambia.
 */
export function armadoGuirnaldaDeElemento(
  frases: readonly FraseDeEstructura[] | undefined,
  element: SceneSpec["elements"][number],
): ArmadoGuirnaldaEnPrompt | undefined {
  if (!frases?.length) return undefined;
  const estructura = idDeEstructura(element);
  return frases.find((frase) => frase.aplicado && frase.estructura_id === estructura && frase.guirnalda)?.guirnalda;
}

/**
 * El armado de bouquet de la estructura del elemento (sus instancias repetidas
 * `EST_x#n` incluidas), cuando la frase aplicada de esa estructura es la de un
 * armado. `undefined` con un patrón de color o sin frase: el prompt no cambia.
 */
export function armadoDeElemento(
  frases: readonly FraseDeEstructura[] | undefined,
  element: SceneSpec["elements"][number],
): ArmadoBouquetEnPrompt | undefined {
  if (!frases?.length) return undefined;
  const estructura = idDeEstructura(element);
  return frases.find((frase) => frase.aplicado && frase.estructura_id === estructura && frase.armado)?.armado;
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
