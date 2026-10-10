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
import { discosDeLaFoto, medirProporciones } from "../exp/lib-proporciones";
import { TOLERANCIA_TRAMO } from "../exp/lib-zonas";
import type { Puntajes } from "./lib-agregado";

export type PuntuacionEscena = {
  puntajes: Puntajes;
  piezas: { globosFoto: number; globosArmados: number };
  /** La escena no tiene globos armados: proporciones 0 y clase «escena_vacia». */
  escenaVacia: boolean;
};

const acotar = (n: number) => Math.min(1, Math.max(0, n));

/** Lanza solo si la foto no tiene globos detectados (no hay verdad contra la que medir). */
export function puntuarEscena(entrada: { lectura: LecturaFoto; escena: Escena; deteccion: Deteccion }): PuntuacionEscena {
  const { lectura, escena, deteccion } = entrada;
  const aspecto = lectura.aspecto;
  const fondosFoto = deteccion.fondos.map((f) => cajaDeDeteccion(f, aspecto));
  const verdad = discosDeLaFoto(globosDe(deteccion.globos, aspecto), fondosFoto);
  if (!verdad.length) throw new Error("La foto no tiene globos detectados: no hay con qué medir las proporciones.");
  const armado = armadoDeEscenaEnLaFoto(escena, lectura);
  const piezas = { globosFoto: verdad.length, globosArmados: armado.discos.length };
  if (!armado.discos.length) {
    return { puntajes: { proporciones: 0, colores: null, zonas: null, iou: 0 }, piezas, escenaVacia: true };
  }
  const medida = medirProporciones({
    foto: verdad, armado: armado.discos, aspecto, fondosFoto, fondosArmados: armado.fondos, mismoFondo: mismaFamiliaDeFondo, esTelon,
  });
  return {
    puntajes: {
      proporciones: medida.puntaje,
      colores: medida.zonasColor === null ? null : 1 - medida.zonasColor,
      zonas: medida.tramo ? 1 - acotar(medida.tramo.error / TOLERANCIA_TRAMO) : null,
      iou: medida.iou,
    },
    piezas,
    escenaVacia: false,
  };
}
