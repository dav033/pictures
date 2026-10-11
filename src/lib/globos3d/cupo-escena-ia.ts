import { decidir } from "@/lib/registro/servidor";
import { topeDurable, type ResultadoTope } from "@/lib/topes/tope-durable";

/**
 * Tope de pedidos por hora a la IA de la escena, compartido por `/api/escena-ia` y `/api/escena-desde-foto` (una lectura de
 * foto cuesta más que un mensaje, pero cuenta como un pedido). Si se acaba, la decisión queda en el registro.
 *
 * Las rutas usan las versiones `…Durable`: el contador vive en Neon y vale para todas las instancias (`topes/tope-durable.ts`).
 * Las funciones sin ese sufijo son el contador en memoria de la instancia, lo que responde si la base no está.
 */
export const TOPE_POR_HORA = 60;
const HORA_MS = 3_600_000;

/**
 * La revisión de una ronda de refinado (`/api/escena-ia/similitud`) tiene su propio cupo, aparte del de los pedidos: una ronda
 * ya pagada (un pedido a Gemini con foto y captura) no debe descartarse porque la hora se acabó justo antes de revisarla. Cada
 * revisión sigue a una ronda, así que con el doble de tope nunca se acaba antes que el de los pedidos.
 */
export const TOPE_SIMILITUD_POR_HORA = TOPE_POR_HORA * 2;

export const CLAVE_PEDIDOS_ESCENA_POR_HORA = "escena_ia_hora";
export const CLAVE_SIMILITUD_ESCENA_POR_HORA = "escena_ia_similitud_hora";

const TEXTO_TOPE_PEDIDOS = "tope de mensajes por hora del asistente de escena";
const TEXTO_TOPE_SIMILITUD = "tope de revisiones de ronda por hora del asistente de escena";

let ventana = { desde: Date.now(), usadas: 0 };
let ventanaSimilitud = { desde: Date.now(), usadas: 0 };

/** Toma un pedido del cupo de la hora; `false` si ya se usaron los `TOPE_POR_HORA`. */
export function tomarCupoEscenaIA(ahora = Date.now()): boolean {
  if (ahora - ventana.desde > HORA_MS) ventana = { desde: ahora, usadas: 0 };
  if (ventana.usadas >= TOPE_POR_HORA) {
    decidir("regla:escena_ia_tope", TEXTO_TOPE_PEDIDOS, { usadas: ventana.usadas, tope: TOPE_POR_HORA });
    return false;
  }
  ventana.usadas += 1;
  return true;
}

/** Toma una revisión de ronda del cupo de la hora; `false` si ya se usaron las `TOPE_SIMILITUD_POR_HORA`. */
export function tomarCupoSimilitud(ahora = Date.now()): boolean {
  if (ahora - ventanaSimilitud.desde > HORA_MS) ventanaSimilitud = { desde: ahora, usadas: 0 };
  if (ventanaSimilitud.usadas >= TOPE_SIMILITUD_POR_HORA) {
    decidir("regla:escena_ia_tope", TEXTO_TOPE_SIMILITUD, { usadas: ventanaSimilitud.usadas, tope: TOPE_SIMILITUD_POR_HORA });
    return false;
  }
  ventanaSimilitud.usadas += 1;
  return true;
}

/** Devuelve un pedido al cupo (la IA no estaba configurada: ese pedido no gastó nada). */
export function devolverCupoEscenaIA(): void {
  ventana.usadas = Math.max(0, ventana.usadas - 1);
}

/**
 * Toma en la base y, si se niega, lo deja en el registro. La toma en memoria ya lo registra al negarse por su cuenta: si
 * respondió ella no se registra dos veces.
 */
async function tomarDurable(clave: string, tope: number, texto: string, enMemoria: () => ResultadoTope): Promise<ResultadoTope> {
  const { toma, origen } = await topeDurable().tomar(clave, tope, enMemoria);
  if (!toma.ok && origen === "base") decidir("regla:escena_ia_tope", texto, { usadas: toma.usadas, tope: toma.tope });
  return toma;
}

/** `tomarCupoEscenaIA` contado en Neon para todas las instancias; si la base no responde, el contador en memoria de esta. */
export function tomarCupoEscenaIADurable(ahora = Date.now()): Promise<ResultadoTope> {
  return tomarDurable(CLAVE_PEDIDOS_ESCENA_POR_HORA, TOPE_POR_HORA, TEXTO_TOPE_PEDIDOS, () => {
    const ok = tomarCupoEscenaIA(ahora);
    return ok ? { ok, usadas: ventana.usadas } : { ok, usadas: ventana.usadas, tope: TOPE_POR_HORA };
  });
}

/** `tomarCupoSimilitud` contado en Neon para todas las instancias; si la base no responde, el contador en memoria de esta. */
export async function tomarCupoSimilitudDurable(ahora = Date.now()): Promise<boolean> {
  const toma = await tomarDurable(CLAVE_SIMILITUD_ESCENA_POR_HORA, TOPE_SIMILITUD_POR_HORA, TEXTO_TOPE_SIMILITUD, () => {
    const ok = tomarCupoSimilitud(ahora);
    return ok ? { ok, usadas: ventanaSimilitud.usadas } : { ok, usadas: ventanaSimilitud.usadas, tope: TOPE_SIMILITUD_POR_HORA };
  });
  return toma.ok;
}

/**
 * Devuelve el pedido al contador y a la hora de donde salió (`toma` es lo que devolvió `tomarCupoEscenaIADurable`): la devolución
 * llega tras una llamada a Gemini y puede cruzar la hora; en la hora nueva no hay nada que devolver.
 */
export function devolverCupoEscenaIADurable(toma: ResultadoTope): Promise<void> {
  return topeDurable().devolver(CLAVE_PEDIDOS_ESCENA_POR_HORA, (toma.ok && toma.recibo) || { origen: "memoria" }, devolverCupoEscenaIA);
}

/** Solo para las pruebas. */
export function reiniciarCupoEscenaIA(): void {
  ventana = { desde: Date.now(), usadas: 0 };
  ventanaSimilitud = { desde: Date.now(), usadas: 0 };
}
