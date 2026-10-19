import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica X-Shopify-Hmac-Sha256 contra el cuerpo CRUDO (plan §5.3). Debe
 * calcularse sobre los bytes exactos que mandó Shopify — si el body se
 * parsea a JSON y se reserializa antes de firmar, la firma no calza aunque
 * el contenido "sea el mismo" (espacios, orden de claves, etc. cambian los
 * bytes). Por eso el caller SIEMPRE debe pasar el texto crudo del request,
 * nunca un objeto ya parseado.
 */
export function verificarFirmaShopify(cuerpoCrudo: string, firmaRecibida: string | null, secreto: string): boolean {
  if (!firmaRecibida) return false;
  const firmaCalculada = createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest("base64");

  const a = Buffer.from(firmaCalculada);
  const b = Buffer.from(firmaRecibida);
  // Comparación en tiempo constante: comparar strings con === filtra
  // información de timing que un atacante puede usar para forjar la firma
  // byte a byte. timingSafeEqual exige buffers del mismo largo.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
