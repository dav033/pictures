import { decidir } from "@/lib/registro/servidor";

/**
 * Tope de pedidos por hora a la IA de la escena, por instancia del servidor y compartido por `/api/escena-ia` y
 * `/api/escena-desde-foto` (una lectura de foto cuesta más que un mensaje, pero cuenta como un pedido). Si se acaba, la
 * decisión queda en el registro.
 */
export const TOPE_POR_HORA = 60;
const HORA_MS = 3_600_000;

/**
 * La revisión de una ronda de refinado (`/api/escena-ia/similitud`) tiene su propio cupo, aparte del de los pedidos: una ronda
 * ya pagada (un pedido a Gemini con foto y captura) no debe descartarse porque la hora se acabó justo antes de revisarla. Cada
 * revisión sigue a una ronda, así que con el doble de tope nunca se acaba antes que el de los pedidos.
 */
export const TOPE_SIMILITUD_POR_HORA = TOPE_POR_HORA * 2;

let ventana = { desde: Date.now(), usadas: 0 };
let ventanaSimilitud = { desde: Date.now(), usadas: 0 };

/** Toma un pedido del cupo de la hora; `false` si ya se usaron los `TOPE_POR_HORA`. */
export function tomarCupoEscenaIA(ahora = Date.now()): boolean {
  if (ahora - ventana.desde > HORA_MS) ventana = { desde: ahora, usadas: 0 };
  if (ventana.usadas >= TOPE_POR_HORA) {
    decidir("regla:escena_ia_tope", "tope de mensajes por hora del asistente de escena", { usadas: ventana.usadas, tope: TOPE_POR_HORA });
    return false;
  }
  ventana.usadas += 1;
  return true;
}

/** Toma una revisión de ronda del cupo de la hora; `false` si ya se usaron las `TOPE_SIMILITUD_POR_HORA`. */
export function tomarCupoSimilitud(ahora = Date.now()): boolean {
  if (ahora - ventanaSimilitud.desde > HORA_MS) ventanaSimilitud = { desde: ahora, usadas: 0 };
  if (ventanaSimilitud.usadas >= TOPE_SIMILITUD_POR_HORA) {
    decidir("regla:escena_ia_tope", "tope de revisiones de ronda por hora del asistente de escena", { usadas: ventanaSimilitud.usadas, tope: TOPE_SIMILITUD_POR_HORA });
    return false;
  }
  ventanaSimilitud.usadas += 1;
  return true;
}

/** Devuelve un pedido al cupo (la IA no estaba configurada: ese pedido no gastó nada). */
export function devolverCupoEscenaIA(): void {
  ventana.usadas = Math.max(0, ventana.usadas - 1);
}

/** Solo para las pruebas. */
export function reiniciarCupoEscenaIA(): void {
  ventana = { desde: Date.now(), usadas: 0 };
  ventanaSimilitud = { desde: Date.now(), usadas: 0 };
}
