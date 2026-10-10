/**
 * Clasifica lo que falló en una pasada de una foto según la etapa donde se rompió la cadena
 * foto → lectura → medida → escena → captura, más las llamadas del asistente. Puro: recibe hechos ya observados.
 */

export const CLASES_FALLO = ["lectura", "medida", "compilacion", "capacidad_faltante", "visor", "escena_vacia", "agente"] as const;
export type ClaseFallo = (typeof CLASES_FALLO)[number];

export type HechosPasada = {
  /** La IA no pudo leer la foto (error de la lectura o respuesta de error del paso de foto). */
  errorLectura: boolean;
  /** Piezas de la lectura descartadas por mal formato (tras el reintento). */
  piezasDescartadas: number;
  /** No hubo detección de globos: sin ella no hay medida. */
  sinDeteccion: boolean;
  /** La medida de proporciones lanzó por una causa distinta de no tener globos. */
  errorMedida: boolean;
  /** Piezas leídas que el taller no sabe armar (tipo «otro»): capacidad que falta. */
  piezasOtro: number;
  /** Piezas que sí son del taller y fallaron al compilar. */
  omitidasCompilacion: number;
  /** La escena no tiene globos armados (proporciones 0). */
  escenaVacia: boolean;
  /** Vueltas del asistente que devolvieron error HTTP. */
  erroresAgente: number;
  /** La captura del visor falló (cuando exista el capturador). */
  capturaFallida: boolean;
};

export const HECHOS_SIN_FALLOS: HechosPasada = {
  errorLectura: false, piezasDescartadas: 0, sinDeteccion: false, errorMedida: false, piezasOtro: 0,
  omitidasCompilacion: 0, escenaVacia: false, erroresAgente: 0, capturaFallida: false,
};

export function clasificarFallos(hechos: HechosPasada): ClaseFallo[] {
  const marcadas = new Set<ClaseFallo>();
  if (hechos.errorLectura || hechos.piezasDescartadas > 0) marcadas.add("lectura");
  if (hechos.sinDeteccion || hechos.errorMedida) marcadas.add("medida");
  if (hechos.omitidasCompilacion > 0) marcadas.add("compilacion");
  if (hechos.piezasOtro > 0) marcadas.add("capacidad_faltante");
  if (hechos.capturaFallida) marcadas.add("visor");
  if (hechos.escenaVacia) marcadas.add("escena_vacia");
  if (hechos.erroresAgente > 0) marcadas.add("agente");
  return CLASES_FALLO.filter((clase) => marcadas.has(clase));
}
