import { createHash, createHmac } from "node:crypto";

export const CABECERA_TIMESTAMP = "X-Voz-Timestamp";
export const CABECERA_FIRMA = "X-Voz-Firma";

/** Firma del contrato con el VPS: HMAC-SHA256 hex de `${timestamp}.${sha256hex(cuerpo)}` con el secreto compartido. */
export function firmarPedido(secreto: string, timestamp: number, cuerpo: Uint8Array): string {
  const huella = createHash("sha256").update(cuerpo).digest("hex");
  return createHmac("sha256", secreto).update(`${timestamp}.${huella}`).digest("hex");
}
