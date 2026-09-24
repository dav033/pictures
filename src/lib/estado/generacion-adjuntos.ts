import type { Imagen } from "@/lib/ia/nucleo/tipos";
import type { AdjuntosTurno, ImagenTurno } from "@/lib/estado/persistencia-adjuntos";

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
