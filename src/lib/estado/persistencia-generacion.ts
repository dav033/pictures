/**
 * Propuesta aprobada e imagen resultante guardadas por `plan_hash` (iteración
 * 4, D5 del E2E real). Al recargar se perdían la imagen y la aprobación, el
 * botón volvía a «Aprobar y ver cómo queda» y el cliente podía pagar otra
 * generación de la misma propuesta.
 *
 * La aprobación siempre se guarda (pesa unos bytes). La imagen va como una
 * versión reducida (JPEG de ~800 px que genera la página) solo si cabe en el
 * presupuesto: sessionStorage tiene pocos MB y ya guarda la conversación con
 * sus miniaturas (persistencia-adjuntos.ts). Si no cabe, se guarda sin imagen
 * y la página muestra «Ya generaste esta imagen» con la opción explícita de
 * volver a crearla. Mismo patrón que persistencia-adjuntos: sin React ni DOM.
 */

export const CLAVE_GENERACIONES = "demo_generaciones_v1";

/** Una imagen reducida mayor que esto (data URL) no se guarda: ~260 KB de JPEG. */
export const MAX_CARACTERES_IMAGEN_GENERADA = 350_000;
/** Aprobaciones recordadas (las más recientes). */
export const MAX_GENERACIONES_GUARDADAS = 6;
/** Imágenes guardadas a la vez (de las aprobaciones más recientes); el resto queda solo como aprobación. */
export const MAX_IMAGENES_GENERADAS_GUARDADAS = 2;

/** Tamaños que la página intenta, de mejor a más liviano, hasta que uno cabe. */
export const REDUCCIONES_IMAGEN_GENERADA: ReadonlyArray<{ maxDim: number; calidad: number }> = [
  { maxDim: 800, calidad: 0.8 },
  { maxDim: 800, calidad: 0.62 },
  { maxDim: 560, calidad: 0.55 },
];

export type GeneracionGuardada = {
  planHash: string;
  /** Data URL JPEG reducida, o null si no cupo (o aún no está lista). */
  imagen: string | null;
  guardadaEn: number;
  /**
   * La aprobación quedó registrada pero el servicio de imagen respondió
   * VISTA_PREVIA_NO_DISPONIBLE (fal sin saldo): al recargar se muestra ese
   * aviso con la opción de volver a intentar la imagen, no «Aprobar» otra vez.
   * Solo presente cuando es true.
   */
  sinVistaPrevia?: true;
};

function esGeneracion(valor: unknown): valor is GeneracionGuardada {
  if (typeof valor !== "object" || valor === null) return false;
  const { planHash, imagen, guardadaEn, sinVistaPrevia } = valor as Record<string, unknown>;
  return typeof planHash === "string" && planHash.length > 0 && planHash.length <= 200
    && (sinVistaPrevia === undefined || sinVistaPrevia === true)
    && (imagen === null || (typeof imagen === "string" && imagen.startsWith("data:image/") && imagen.length <= MAX_CARACTERES_IMAGEN_GENERADA))
    && typeof guardadaEn === "number" && Number.isFinite(guardadaEn);
}

/** Lo guardado en sessionStorage, validado; cualquier cosa rara se ignora. */
export function leerGeneraciones(texto: string | null | undefined): GeneracionGuardada[] {
  if (!texto) return [];
  try {
    const datos: unknown = JSON.parse(texto);
    const lista = typeof datos === "object" && datos !== null && Array.isArray((datos as { generaciones?: unknown }).generaciones)
      ? (datos as { generaciones: unknown[] }).generaciones
      : [];
    return lista.filter(esGeneracion).slice(0, MAX_GENERACIONES_GUARDADAS);
  } catch {
    return [];
  }
}

export function serializarGeneraciones(generaciones: readonly GeneracionGuardada[]): string {
  return JSON.stringify({ version: 1, generaciones });
}

/** Primera versión reducida que cabe en el presupuesto, o null. */
export function elegirImagenReducida(candidatas: ReadonlyArray<string | null | undefined>): string | null {
  return candidatas.find((imagen): imagen is string => typeof imagen === "string" && imagen.startsWith("data:image/") && imagen.length <= MAX_CARACTERES_IMAGEN_GENERADA) ?? null;
}

/**
 * Registra la aprobación de `planHash` (la más reciente primero). `imagen`
 * undefined conserva la imagen ya guardada para ese plan; null la quita. Solo
 * las `MAX_IMAGENES_GENERADAS_GUARDADAS` más recientes conservan su imagen.
 */
export function registrarGeneracion(
  previas: readonly GeneracionGuardada[],
  planHash: string,
  imagen: string | null | undefined,
  ahora: number,
): GeneracionGuardada[] {
  const anterior = previas.find((generacion) => generacion.planHash === planHash);
  const imagenFinal = imagen === undefined ? anterior?.imagen ?? null : elegirImagenReducida([imagen]);
  const lista = [{ planHash, imagen: imagenFinal, guardadaEn: ahora }, ...previas.filter((generacion) => generacion.planHash !== planHash)].slice(0, MAX_GENERACIONES_GUARDADAS);
  let conImagen = 0;
  return lista.map((generacion) => {
    if (!generacion.imagen) return generacion;
    conImagen += 1;
    return conImagen <= MAX_IMAGENES_GENERADAS_GUARDADAS ? generacion : { ...generacion, imagen: null };
  });
}

/**
 * Registra la aprobación de `planHash` cuya imagen no se pudo crear porque la
 * vista previa no está disponible (D5 sin foto). Sin imagen; una generación
 * posterior con éxito (`registrarGeneracion`) quita la marca.
 */
export function registrarVistaPreviaNoDisponible(previas: readonly GeneracionGuardada[], planHash: string, ahora: number = Date.now()): GeneracionGuardada[] {
  return [{ planHash, imagen: null, guardadaEn: ahora, sinVistaPrevia: true as const }, ...previas.filter((generacion) => generacion.planHash !== planHash)].slice(0, MAX_GENERACIONES_GUARDADAS);
}

/** Degradación si sessionStorage rechaza la escritura: se conservan las aprobaciones sin imágenes. */
export function sinImagenes(generaciones: readonly GeneracionGuardada[]): GeneracionGuardada[] {
  return generaciones.map((generacion) => ({ ...generacion, imagen: null }));
}

/**
 * Qué restaurar al recargar: la aprobación más reciente cuyo plan sigue en la
 * conversación restaurada (un plan que ya no está no se puede mostrar).
 */
export function generacionParaRestaurar(generaciones: readonly GeneracionGuardada[], planHashesEnConversacion: ReadonlySet<string>): GeneracionGuardada | null {
  return [...generaciones].sort((a, b) => b.guardadaEn - a.guardadaEn).find((generacion) => planHashesEnConversacion.has(generacion.planHash)) ?? null;
}
