import "server-only";
import { generarConFluxKontext } from "@/lib/ia/kagutsuchi/kontext";
import type { CapturaPreparada } from "./captura-imagen";

/**
 * La llamada de pago de «Ver cómo quedaría» del plan 3D: FLUX.1 Kontext max (D-025, el camino del «Igual al visor» del Taller)
 * con la captura como imagen base. Pasa por `generarConFluxKontext`, que audita la generación (prompt, referencias como hash,
 * coste estimado) y registra la telemetría con la superficie `guiada-3d`: así el gasto de la guiada queda aparte del del Taller
 * (`taller-3d`) y del de /api/generate.
 */
export const SUPERFICIE_IMAGEN_GUIADA_3D = "guiada-3d";

type GeneradorKontext = typeof generarConFluxKontext;

/** Con `solicitudPrevia` no se envía otra solicitud: se retoma la que ya está pagada y en curso en fal (`KontextEnCursoError`). */
export function generarImagenGuiada3d(prompt: string, base: CapturaPreparada, senal: AbortSignal, generador: GeneradorKontext = generarConFluxKontext, solicitudPrevia?: string) {
  return generador(prompt, {
    imagen: { base64: base.base64, mime: base.mime, ancho: base.ancho, alto: base.alto },
    variante: "max",
    signal: senal,
    telemetria: { superficie: SUPERFICIE_IMAGEN_GUIADA_3D },
    ...(solicitudPrevia ? { solicitudPrevia } : {}),
  });
}
