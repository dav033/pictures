/**
 * Cuán claro y cuán vivo es de verdad el globo inflado, dicho en inglés.
 *
 * **El problema que resuelve.** El nombre de un color de catálogo viene del
 * color de la **tinta** (el PMS con el que se fabrica el látex), y la tinta no
 * es el globo: medido sobre las 71 referencias de `color-inflado-medido.ts`, el
 * globo inflado está a **ΔE 18,7 de su tinta de media (mediana 17,2), y por
 * encima de 10 en 59 de las 71**. Así que pedirle a un modelo de imagen
 * «raspberry» o «sage green» a secas le pide el tono de la tinta, no el del
 * globo — y el modelo obedece la palabra: pedir «wine red» por el hex de la
 * tinta devolvió un burdeos dos veces, a ΔE 38 y 33 del globo real.
 *
 * **Y la corrección no se puede adivinar.** No es que el globo sea siempre más
 * claro: la claridad se mueve en las dos direcciones y casi se cancela de media
 * (ΔL\* medio +0,6; más claro en 39 de 71), con extremos de +28 en el Dorado y
 * −22 en el Rosado. Lo único sistemático es que pierde algo de croma (ΔC\*
 * medio −6,6). Por eso hace falta la medición y no una regla: si el globo
 * fuera siempre un poco más claro, bastaría con decir «pale» y no medir nada.
 *
 * **Lo que hace, y lo que no.** No renombra el color: le **añade** el matiz que
 * la medición sostiene («pale», «very pale muted», «deep»). Renombrar por
 * cuenta propia fue lo que salió mal en el otro repositorio —el vocabulario
 * automático llamaba «dark grey» al Turquesa Profundo—, así que aquí el nombre
 * lo sigue poniendo el catálogo y la medición solo lo califica.
 *
 * **De dónde salen los cortes.** De la propia distribución de las 71
 * mediciones, no de números inventados: L\* va de 19 a 96 (cuartiles 48 / 63 /
 * 74) y C\* de 13 a 90 (cuartiles 23 / 34 / 57). `L* >= 80` son las 11 más
 * claras, `L* >= 68` el cuarto superior (25), `L* <= 35` las 6 más oscuras y
 * `C* <= 22` el cuartil menos saturado (17). Un color que cae en el medio no
 * recibe matiz: su nombre ya lo describe.
 *
 * Puro: entra un nombre y un acabado, sale texto o `null`.
 */

import { labDeRgb } from "@/lib/rag/catalog/similitud-color";
import { colorInfladoMedido } from "./color-inflado-medido";

/** Cortes de claridad y de croma, en L\* y C\* de CIELAB. */
const MUY_CLARO = 80;
const CLARO = 68;
const OSCURO = 35;
const APAGADO = 22;

function labDeHex(hex: string): readonly [number, number, number] {
  const valor = hex.replace("#", "");
  return labDeRgb(
    parseInt(valor.slice(0, 2), 16),
    parseInt(valor.slice(2, 4), 16),
    parseInt(valor.slice(4, 6), 16),
  );
}

/** Claridad y croma del globo inflado de ese color y acabado, o `null` sin medición. */
export function claridadYCromaMedidos(
  color: string,
  acabado: string,
): { claridad: number; croma: number } | null {
  const medido = colorInfladoMedido(color, acabado);
  if (!medido) return null;
  const [claridad, a, b] = labDeHex(medido.inflado);
  return { claridad, croma: Math.hypot(a, b) };
}

/**
 * El matiz medido de ese color, o `null` cuando no hay medición o cuando el
 * nombre ya lo describe bien.
 *
 * `null` es el caso normal en un neutro (no se puede medir sobre una foto), en
 * un surtido y en cualquier color de la mitad de la distribución.
 */
export function matizMedido(color: string, acabado: string): string | null {
  const medida = claridadYCromaMedidos(color, acabado);
  if (!medida) return null;
  const { claridad, croma } = medida;
  const claridadEn =
    claridad >= MUY_CLARO ? "very pale" : claridad >= CLARO ? "pale" : claridad <= OSCURO ? "deep" : null;
  const cromaEn = croma <= APAGADO ? "muted" : null;
  const partes = [claridadEn, cromaEn].filter((parte): parte is string => parte !== null);
  return partes.length ? partes.join(" ") : null;
}
