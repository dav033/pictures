/**
 * Crop math for showing one detected piece of a reference photo. Pure (no
 * React, no DOM) so it can be tested without a browser. The analysis returns
 * `reference_bbox` normalized to the source image; the client crops with CSS
 * only, without extra requests.
 */

export type CajaNormalizada = { x: number; y: number; width: number; height: number };

export type EstiloRecorte = {
  /** Percent sizes and offsets for an absolutely positioned `<img>` inside the frame. */
  width: string;
  height: string;
  left: string;
  top: string;
};

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}

function porcentaje(valor: number): string {
  return `${Number((valor * 100).toFixed(3))}%`;
}

/**
 * Style that fills a frame of aspect `aspectoMarco` (width / height) with the
 * bbox region, without distortion. The bbox grows around its center (plus a
 * small margin) until it matches the frame aspect, and shifts to stay inside
 * the photo. Returns null when the grown region no longer fits the photo; the
 * caller then falls back to `object-fit: cover` centered on the bbox.
 */
export function estiloRecorte(caja: CajaNormalizada, natural: { ancho: number; alto: number }, aspectoMarco: number, margen = 0.06): EstiloRecorte | null {
  if (!(natural.ancho > 0 && natural.alto > 0 && aspectoMarco > 0)) return null;
  const x = limitar(caja.x, 0, 1);
  const y = limitar(caja.y, 0, 1);
  const anchoCaja = limitar(caja.width, 0.001, 1 - x);
  const altoCaja = limitar(caja.height, 0.001, 1 - y);
  // Work in pixels so the aspect comparison is real.
  let ancho = anchoCaja * natural.ancho * (1 + margen * 2);
  let alto = altoCaja * natural.alto * (1 + margen * 2);
  if (ancho / alto < aspectoMarco) ancho = alto * aspectoMarco;
  else alto = ancho / aspectoMarco;
  if (ancho > natural.ancho + 0.5 || alto > natural.alto + 0.5) return null;
  const centroX = (x + anchoCaja / 2) * natural.ancho;
  const centroY = (y + altoCaja / 2) * natural.alto;
  const izquierda = limitar(centroX - ancho / 2, 0, natural.ancho - ancho);
  const arriba = limitar(centroY - alto / 2, 0, natural.alto - alto);
  const escalaX = natural.ancho / ancho;
  const escalaY = natural.alto / alto;
  return {
    width: porcentaje(escalaX),
    height: porcentaje(escalaY),
    left: porcentaje(-(izquierda / natural.ancho) * escalaX),
    top: porcentaje(-(arriba / natural.alto) * escalaY),
  };
}

/** `object-position` centered on the bbox, for the fallback before the photo loads. */
export function posicionCentrada(caja: CajaNormalizada): string {
  const centroX = limitar(caja.x + caja.width / 2, 0, 1);
  const centroY = limitar(caja.y + caja.height / 2, 0, 1);
  return `${Number((centroX * 100).toFixed(2))}% ${Number((centroY * 100).toFixed(2))}%`;
}

/**
 * The analysis names images `REF_01`, `REF_02`… by attachment order
 * (`/api/references/analyze`). An image may carry its own id; otherwise the
 * position decides.
 */
export function imagenDeReferencia<T extends { id?: string; base64: string }>(imagenes: readonly T[] | undefined, sourceImageId: string): T | undefined {
  if (!imagenes?.length) return undefined;
  const porId = imagenes.find((imagen) => imagen.id === sourceImageId);
  if (porId) return porId;
  const indice = /^REF_(\d+)$/.exec(sourceImageId)?.[1];
  if (!indice) return undefined;
  const candidata = imagenes[Number(indice) - 1];
  return candidata && (!candidata.id || !/^REF_\d+$/.test(candidata.id)) ? candidata : undefined;
}

export function urlImagen(imagen: { base64: string; mime: string }): string {
  return imagen.base64.startsWith("data:") ? imagen.base64 : `data:${imagen.mime};base64,${imagen.base64}`;
}
