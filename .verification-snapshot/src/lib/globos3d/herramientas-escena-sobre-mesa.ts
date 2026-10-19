import { colocacionSobreMesa } from "./centro-sobre-mesa";
import type { ColocacionSobre, Escena, EscenaArmada, NodoEscena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import type { Pieza } from "./piezas";

/**
 * `poner_sobre` / `mover_sobre` con una MESA de padre: la decoración va sobre su cubierta (a la altura de la mesa, no a la que diga
 * `altura_cm`), centrada o corrida `x_cm` a la derecha de la mesa, y se mueve con ella. Sin esto la herramienta rechazaba cualquier
 * mueble («no tiene globos donde apoyar») y la IA terminaba poniendo el centro en el PISO, bajo el mantel.
 */
export function sitioSobreMesa(
  escena: Escena, armada: EscenaArmada, mesa: NodoEscena,
  a: { altura_cm?: number; lado?: string; angulo_grados?: number; x_cm?: number },
  pieza: Pieza, id: string | null, giroGrados: number, notas: string[],
): ColocacionSobre {
  const resultado = colocacionSobreMesa(escena, armada, mesa, pieza, { xCm: a.x_cm, giroGrados }, id ?? undefined);
  if ("motivo" in resultado) return fallar(`No cabe sobre «${mesa.nombre}»: ${resultado.motivo}${resultado.motivo.startsWith("no cabe") ? ". Hazla más chica con cambiar_pieza o usa otra." : "."}`);
  if (a.altura_cm !== undefined) notas.push(`en una mesa la altura es la de su cubierta (${Math.round(resultado.puntoCm.y)} cm sobre el piso de la mesa): ignoré altura_cm`);
  if (a.lado !== undefined || a.angulo_grados !== undefined) notas.push("en una mesa va en el centro de la cubierta (x_cm la corre a los lados): ignoré lado y angulo_grados");
  return resultado;
}
