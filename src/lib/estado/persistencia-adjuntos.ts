/**
 * Fotos de cada turno en la conversación guardada (iteración 4).
 *
 * En memoria, cada mensaje lleva las fotos del turno en base64 completo
 * (miniatura del cliente y recortes por pieza de la propuesta). sessionStorage
 * tiene un límite de pocos MB, así que al guardar cada foto se sustituye por
 * una miniatura JPEG liviana (data URL) y solo se conservan las más recientes;
 * sin miniatura lista la foto no se guarda. Los ids (`REF_01`…) se conservan
 * para que los recortes sigan enlazados al blueprint tras recargar. Sin React
 * ni DOM: la miniatura la genera la página.
 */
export type ImagenTurno = { id?: string; base64: string; mime: string };
export type AdjuntosTurno = { referencias: ImagenTurno[]; fotoEspacio?: ImagenTurno };

/** Fotos guardadas como máximo (las más recientes): ~50 KB cada una. */
export const MAX_IMAGENES_GUARDADAS = 8;
/** Una miniatura mayor que esto (data URL) no se guarda. */
export const MAX_CARACTERES_MINIATURA = 120_000;

/** Clave estable de una foto en memoria (sin comparar el base64 completo). */
export function claveImagen(imagen: { base64: string }): string {
  return `${imagen.base64.length}:${imagen.base64.slice(-48)}`;
}

/** Una foto restaurada de sessionStorage ya es su miniatura (data URL). */
function esMiniatura(imagen: ImagenTurno): boolean {
  return imagen.base64.startsWith("data:");
}

function fotosDe(adjuntos: AdjuntosTurno): ImagenTurno[] {
  return [...adjuntos.referencias, ...(adjuntos.fotoEspacio ? [adjuntos.fotoEspacio] : [])];
}

/** Fotos de los turnos más recientes, hasta el tope, de la más nueva a la más vieja. */
function fotosRecientes(mensajes: ReadonlyArray<{ adjuntos?: AdjuntosTurno }>): ImagenTurno[] {
  const fotos: ImagenTurno[] = [];
  for (let indice = mensajes.length - 1; indice >= 0 && fotos.length < MAX_IMAGENES_GUARDADAS; indice -= 1) {
    const adjuntos = mensajes[indice]!.adjuntos;
    if (adjuntos) fotos.push(...fotosDe(adjuntos).reverse());
  }
  return fotos.slice(0, MAX_IMAGENES_GUARDADAS);
}

/** Fotos que se guardarían pero aún no tienen miniatura (sin repetir). */
export function imagenesSinMiniatura(mensajes: ReadonlyArray<{ adjuntos?: AdjuntosTurno }>, miniaturas: ReadonlyMap<string, string>): ImagenTurno[] {
  const vistas = new Set<string>();
  return fotosRecientes(mensajes).filter((imagen) => {
    const clave = claveImagen(imagen);
    if (esMiniatura(imagen) || miniaturas.has(clave) || vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

/**
 * Copia de los mensajes lista para sessionStorage: cada foto pasa a su
 * miniatura (o se omite) y solo quedan las `MAX_IMAGENES_GUARDADAS` más
 * recientes. `miniaturas` va de `claveImagen` a data URL; una cadena vacía
 * marca una miniatura que no se pudo generar.
 */
export function aligerarAdjuntos<M extends { adjuntos?: AdjuntosTurno }>(mensajes: readonly M[], miniaturas: ReadonlyMap<string, string>): M[] {
  let restantes = MAX_IMAGENES_GUARDADAS;
  const liviana = (imagen: ImagenTurno): ImagenTurno | null => {
    if (restantes <= 0) return null;
    const miniatura = esMiniatura(imagen) ? imagen.base64 : miniaturas.get(claveImagen(imagen));
    if (!miniatura || miniatura.length > MAX_CARACTERES_MINIATURA) return null;
    restantes -= 1;
    return { ...(imagen.id ? { id: imagen.id } : {}), base64: miniatura, mime: "image/jpeg" };
  };
  const salida = [...mensajes];
  for (let indice = salida.length - 1; indice >= 0; indice -= 1) {
    const mensaje = salida[indice]!;
    if (!mensaje.adjuntos) continue;
    // Mismo orden que fotosRecientes: la foto del espacio va después de las referencias.
    const fotoEspacio = mensaje.adjuntos.fotoEspacio ? liviana(mensaje.adjuntos.fotoEspacio) : null;
    const referencias = [...mensaje.adjuntos.referencias].reverse().map(liviana).reverse().filter((imagen): imagen is ImagenTurno => imagen !== null);
    salida[indice] = {
      ...mensaje,
      adjuntos: referencias.length || fotoEspacio ? { referencias, ...(fotoEspacio ? { fotoEspacio } : {}) } : undefined,
    };
  }
  return salida;
}
