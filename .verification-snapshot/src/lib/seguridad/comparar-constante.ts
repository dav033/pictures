import { timingSafeEqual } from "node:crypto";

/**
 * Compara dos strings sensibles (contraseñas, api keys) en tiempo
 * constante. `===` filtra cuántos caracteres iniciales coinciden por el
 * tiempo que tarda en fallar — un atacante con suficientes intentos puede
 * usar eso para forjar la credencial byte a byte. `timingSafeEqual` exige
 * buffers del mismo largo, así que el largo distinto se descarta antes
 * (single micro-optimización de longitud, no una fuga explotable: revela
 * solo si el largo coincide, no el contenido).
 */
export function compararEnTiempoConstante(recibido: string, esperado: string): boolean {
  const recibidoBytes = Buffer.from(recibido, "utf8");
  const esperadoBytes = Buffer.from(esperado, "utf8");
  return recibidoBytes.length === esperadoBytes.length && timingSafeEqual(recibidoBytes, esperadoBytes);
}
