import type { Imagen } from "@/lib/ia/nucleo/tipos";
import { claveImagen, type AdjuntosTurno, type ImagenTurno } from "@/lib/estado/persistencia-adjuntos";

export type AdjuntosGeneracion = {
  fotoEspacio: Imagen | null;
  referencias: Imagen[];
  tieneMiniaturas: boolean;
};

function imagenOriginalDeTurno(imagen: ImagenTurno | undefined): Imagen | undefined {
  if (!imagen || imagen.base64.startsWith("data:")) return undefined;
  return { base64: imagen.base64, mime: imagen.mime };
}

/** Convierte adjuntos de una propuesta en imágenes aptas para el proveedor. */
export function adjuntosParaGeneracion(adjuntos: AdjuntosTurno | undefined): AdjuntosGeneracion {
  const imagenes = [
    ...(adjuntos?.referencias ?? []),
    ...(adjuntos?.fotoEspacio ? [adjuntos.fotoEspacio] : []),
  ];

  return {
    fotoEspacio: imagenOriginalDeTurno(adjuntos?.fotoEspacio) ?? null,
    referencias: (adjuntos?.referencias ?? [])
      .map(imagenOriginalDeTurno)
      .filter((imagen): imagen is Imagen => Boolean(imagen)),
    tieneMiniaturas: imagenes.some((imagen) => imagen.base64.startsWith("data:")),
  };
}

/**
 * El análisis de la foto y el lienzo con los que se genera una propuesta.
 *
 * Una propuesta anclada (regenerar una tarjeta anterior) ya usaba las fotos de su
 * propio mensaje, pero el blueprint y el aspecto salían del compositor actual: si
 * el cliente cambió de foto después, la escenografía se calculaba con el análisis
 * de la foto nueva sobre un plan de la vieja, y los ids `REF_01_E0x` coinciden
 * entre fotos distintas (auditoría 2026-10-04, C8). Anclado, el blueprint es el
 * del mensaje (sin él, ninguno: no se sabe a qué foto pertenecía) y el aspecto de
 * la foto del espacio solo se reutiliza si es la misma foto.
 */
export function contextoDeGeneracion<B, A>(input: {
  anclado: boolean;
  blueprintDelMensaje?: B;
  blueprintActual?: B;
  fotoEspacioAnclada: { base64: string } | null;
  fotoEspacioActual: ({ base64: string } & { aspecto: A }) | null;
  aspectoActivo: A;
}): { blueprint?: B; aspecto: A } {
  if (!input.anclado) {
    return { blueprint: input.blueprintActual, aspecto: input.fotoEspacioActual?.aspecto ?? input.aspectoActivo };
  }
  const mismaFoto = Boolean(input.fotoEspacioAnclada && input.fotoEspacioActual && claveImagen(input.fotoEspacioAnclada) === claveImagen(input.fotoEspacioActual));
  return {
    blueprint: input.blueprintDelMensaje,
    aspecto: mismaFoto && input.fotoEspacioActual ? input.fotoEspacioActual.aspecto : input.aspectoActivo,
  };
}
