/**
 * Puntuación de una pasada en memoria: la misma medida que `medir-proporciones.ts` (`medirCorrida`), pero con la escena
 * final del asistente y la detección que ya hizo la pasada, sin archivos intermedios.
 * Antes de medir se cuentan los globos: sin globos armados la proporción es 0 y la escena cuenta como vacía (no es un
 * fallo de medida). Sin globos detectados en la foto no hay con qué medir: eso sí lanza.
 */
import type { Deteccion } from "@/lib/globos3d/detectar-globos-ia";
import { esTelon } from "@/lib/globos3d/fondos-escenografia";
import { mismaFamiliaDeFondo } from "@/lib/globos3d/fondos-familias";
import type { Escena } from "@/lib/globos3d/escena";
import type { LecturaFoto } from "@/lib/globos3d/lectura-foto";
import { globosDe } from "@/lib/globos3d/medir-geometria";
import { armadoDeEscenaEnLaFoto, cajaDeDeteccion } from "../exp/medir-proporciones";
import { discosDeLaFoto, medirProporciones, type Disco } from "../exp/lib-proporciones";
import { TOLERANCIA_TRAMO } from "../exp/lib-zonas";
import type { Puntajes } from "./lib-agregado";

export type PuntuacionEscena = {
  /** Con solo los globos armados que se ven desde la cámara de la foto (`lib-visibilidad.ts`): la medida honesta. */
  puntajes: Puntajes;
  /** Con TODOS los globos del volumen armado, ocultos incluidos: la medida de antes, para comparar. */
  puntajesTodos: Puntajes;
  piezas: { globosFoto: number; globosArmados: number; globosArmadosVisibles: number };
  /** La escena no tiene globos armados: proporciones 0 y clase «escena_vacia». */
  escenaVacia: boolean;
};

const acotar = (n: number) => Math.min(1, Math.max(0, n));
const PUNTAJES_CERO: Puntajes = { proporciones: 0, colores: null, zonas: null, iou: 0 };

/** Lanza solo si la foto no tiene globos detectados (no hay verdad contra la que medir). */
export function puntuarEscena(entrada: { lectura: LecturaFoto; escena: Escena; deteccion: Deteccion }): PuntuacionEscena {
  const { lectura, escena, deteccion } = entrada;
  const aspecto = lectura.aspecto;
  const fondosFoto = deteccion.fondos.map((f) => cajaDeDeteccion(f, aspecto));
  const verdad = discosDeLaFoto(globosDe(deteccion.globos, aspecto), fondosFoto);
  if (!verdad.length) throw new Error("La foto no tiene globos detectados: no hay con qué medir las proporciones.");
  const armado = armadoDeEscenaEnLaFoto(escena, lectura);
  const piezas = { globosFoto: verdad.length, globosArmados: armado.discos.length, globosArmadosVisibles: armado.visibles.length };
  if (!armado.discos.length) return { puntajes: PUNTAJES_CERO, puntajesTodos: PUNTAJES_CERO, piezas, escenaVacia: true };
  const puntajesDe = (discos: readonly Disco[]): Puntajes => {
    if (!discos.length) return PUNTAJES_CERO;
    const medida = medirProporciones({ foto: verdad, armado: discos, aspecto, fondosFoto, fondosArmados: armado.fondos, mismoFondo: mismaFamiliaDeFondo, esTelon });
    return {
      proporciones: medida.puntaje,
      colores: medida.zonasColor === null ? null : 1 - medida.zonasColor,
      zonas: medida.tramo ? 1 - acotar(medida.tramo.error / TOLERANCIA_TRAMO) : null,
      iou: medida.iou,
    };
  };
  return { puntajes: puntajesDe(armado.visibles), puntajesTodos: puntajesDe(armado.discos), piezas, escenaVacia: false };
}
