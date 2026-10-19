import { TOPE_CAPTURA_BYTES } from "@/lib/feedback-ia/contrato";
import { armarEscena, type Escena, type EscenaArmada } from "@/lib/globos3d/escena";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import type { CapturasTurno } from "../../feedback-ia/cliente-feedback";
import type { RegistroTurnoIA } from "./registro-feedback";

/**
 * Las capturas «antes» y «después» de un turno para la calificación (REQ-010): la escena guardada del turno dibujada en el visor
 * fuera de pantalla de `captura-refinar.ts` (no mueve ni depende del visor del taller y sirve para la escena de antes, que ya no está
 * en pantalla), desde el frente, como JPEG de hasta 600 KB. Solo se hacen cuando la persona califica, deshace o comenta.
 *
 * Cuidado con la memoria y los contextos WebGL (un visor de más hace que el navegador suelte el del taller): se dibuja UNA vez por
 * captura y, si el JPEG pesa de más, solo se vuelve a codificar más chico o con menos calidad; `captura-refinar` deja un solo visor
 * vivo a la vez y suelta su contexto al terminar; y el trabajo espera a que el navegador esté libre.
 */

/** Lado con que se dibuja (una sola vez). */
export const LADO_CAPTURA_FEEDBACK = 1280;
/** Cómo se vuelve a codificar, de mejor a peor, si el JPEG pesa más que el tope: lado mayor y calidad. */
export const REDUCCIONES_FEEDBACK: readonly { lado: number; calidad: number }[] = [
  { lado: 1280, calidad: 0.78 },
  { lado: 1024, calidad: 0.7 },
  { lado: 800, calidad: 0.6 },
  { lado: 640, calidad: 0.5 },
  { lado: 480, calidad: 0.45 },
];
const ESPERA_LIBRE_MS = 3000;
const ASPECTO = 4 / 3;
const AIRE = 1.25;

/** Lo que ocupa todo lo armado (cm): las cajas de cada pieza puesta. */
function extension(armada: EscenaArmada) {
  const cajas = armada.porNodo.filter((n) => n.copias > 0).map((n) => n.caja).filter((c) => [c.min.x, c.max.x, c.max.y].every(Number.isFinite));
  if (cajas.length === 0) return null;
  return { mitadAncho: Math.max(...cajas.flatMap((c) => [Math.abs(c.min.x), Math.abs(c.max.x)])), alto: Math.max(...cajas.map((c) => c.max.y)) };
}

const entre = (valor: number, minimo: number, maximo: number) => Math.min(maximo, Math.max(minimo, valor));

/** La cámara de frente, a la altura del centro, que deja ver toda la decoración (la cámara de la foto está centrada en x = 0). */
export function encuadreDeEscena(armada: EscenaArmada): Encuadre {
  const e = extension(armada);
  const alto = e?.alto ?? armada.sala.altoCm / 2;
  const mitadAncho = e?.mitadAncho ?? armada.sala.anchoCm / 2;
  const altoCm = entre(Math.max(alto * AIRE, (mitadAncho * 2 * AIRE) / ASPECTO, 120), 60, 1500);
  return { aspecto: ASPECTO, altoCm: Math.round(altoCm), centroYCm: Math.round(entre(alto / 2, -1000, 2000)) };
}

function aBlobJpeg(base64: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

/** Espera a que el navegador esté libre (o `ESPERA_LIBRE_MS`): una captura no debe pelear con lo que la persona está haciendo. */
const cuandoLibre = (): Promise<void> => new Promise((resolver) => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolver(), { timeout: ESPERA_LIBRE_MS });
  else setTimeout(resolver, 250);
});

/** El mismo JPEG más chico o con menos calidad, sin volver a dibujar la escena: el primero de `REDUCCIONES_FEEDBACK` que cabe en el tope. */
export async function recodificarJpeg(imagen: Blob, tope = TOPE_CAPTURA_BYTES): Promise<Blob | null> {
  if (imagen.size > 0 && imagen.size <= tope) return imagen;
  const bitmap = await createImageBitmap(imagen);
  try {
    const mayor = Math.max(bitmap.width, bitmap.height);
    const lienzo = document.createElement("canvas");
    const pincel = lienzo.getContext("2d");
    if (!pincel) return null;
    for (const { lado, calidad } of REDUCCIONES_FEEDBACK) {
      const escala = Math.min(1, lado / mayor);
      lienzo.width = Math.max(1, Math.round(bitmap.width * escala));
      lienzo.height = Math.max(1, Math.round(bitmap.height * escala));
      pincel.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
      const salida = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/jpeg", calidad));
      if (salida && salida.size > 0 && salida.size <= tope) return salida;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** La escena como JPEG que cabe en el tope; `null` si no se pudo dibujar (sin WebGL, sin memoria): la calificación sigue sin captura. */
export async function capturarEscenaFeedback(escena: Escena): Promise<Blob | null> {
  try {
    await cuandoLibre();
    const { capturarEscenaParaRefinar } = await import("../captura-refinar");
    const encuadre = encuadreDeEscena(armarEscena(escena));
    const foto = await capturarEscenaParaRefinar(escena, encuadre, LADO_CAPTURA_FEEDBACK);
    return await recodificarJpeg(aBlobJpeg(foto.base64));
  } catch {
    return null;
  }
}

/** Antes y después de un turno, una a una (dos visores a la vez gastarían la memoria que el teléfono no tiene). */
export async function capturarTurnoFeedback(registro: RegistroTurnoIA | undefined): Promise<CapturasTurno> {
  if (!registro) return {};
  const antes = await capturarEscenaFeedback(registro.escenaAntes);
  const despues = registro.escenaDespues === registro.escenaAntes ? antes : await capturarEscenaFeedback(registro.escenaDespues);
  return { antes, despues };
}
