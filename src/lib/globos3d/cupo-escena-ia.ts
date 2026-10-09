import { decidir } from "@/lib/registro/servidor";

/**
 * Tope de pedidos por hora a la IA de la escena, por instancia del servidor y compartido por `/api/escena-ia` y
 * `/api/escena-desde-foto` (una lectura de foto cuesta más que un mensaje, pero cuenta como un pedido). Si se acaba, la
 * decisión queda en el registro.
 */
export const TOPE_POR_HORA = 60;
const HORA_MS = 3_600_000;

let ventana = { desde: Date.now(), usadas: 0 };

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

/** Devuelve un pedido al cupo (la IA no estaba configurada: ese pedido no gastó nada). */
export function devolverCupoEscenaIA(): void {
  ventana.usadas = Math.max(0, ventana.usadas - 1);
}

/** Solo para las pruebas. */
export function reiniciarCupoEscenaIA(): void {
  ventana = { desde: Date.now(), usadas: 0 };
}
