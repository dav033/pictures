import { TOPE_CAPTURA_BYTES } from "@/lib/feedback-ia/contrato";
import { armarEscena, type Escena, type EscenaArmada } from "@/lib/globos3d/escena";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import type { CapturasTurno } from "../../feedback-ia/cliente-feedback";
import type { RegistroTurnoIA } from "./registro-feedback";

/**
 * Las capturas «antes» y «después» de un turno para la calificación (REQ-010): la escena guardada del turno dibujada en el visor
 * fuera de pantalla de `captura-refinar.ts` (el mismo código de la comparación con la foto: no mueve ni depende del visor del taller y
 * sirve para la escena de antes, que ya no está en pantalla), desde el frente, como JPEG de hasta 600 KB. Solo se hacen cuando la
 * persona califica, deshace o comenta.
 */

/** Lados a probar, de mayor a menor, hasta que el JPEG quepa en el tope del contrato. */
export const LADOS_CAPTURA_FEEDBACK = [1280, 960, 720, 512] as const;
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

/** La escena como JPEG que cabe en el tope; `null` si no se pudo dibujar (sin WebGL, sin memoria): la calificación sigue sin captura. */
export async function capturarEscenaFeedback(escena: Escena): Promise<Blob | null> {
  try {
    const { capturarEscenaParaRefinar } = await import("../captura-refinar");
    const encuadre = encuadreDeEscena(armarEscena(escena));
    for (const lado of LADOS_CAPTURA_FEEDBACK) {
      const foto = await capturarEscenaParaRefinar(escena, encuadre, lado);
      const imagen = aBlobJpeg(foto.base64);
      if (imagen.size > 0 && imagen.size <= TOPE_CAPTURA_BYTES) return imagen;
    }
    return null;
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
