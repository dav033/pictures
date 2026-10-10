import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CABECERA_SOLICITUD_KONTEXT, CODIGO_KONTEXT_EN_CURSO } from "@/lib/generacion/solicitud-kontext-contrato";
import { secretoDeFirmas } from "@/lib/plan/aprobacion";
import type { KontextEnCursoError } from "./kontext";

/**
 * El token con el que el navegador retoma una imagen de Kontext que sigue en curso (contrato en `solicitud-kontext-contrato.ts`).
 * Lleva el id de la solicitud de fal, cuándo vence y una firma HMAC que ata ambos a un ÁMBITO que fija la ruta (el texto de la petición y,
 * donde hay identidad, el navegador): quien no es de ese ámbito no puede pedir la imagen de otro con un id que se haya filtrado, y un id
 * inventado no pasa. Vence a los 15 minutos: cubre los reintentos del navegador y no más.
 */
export const VIDA_SOLICITUD_KONTEXT_MS = 15 * 60_000;

const ID_DE_FAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const firmaDe = (requestId: string, venceEn: number, ambito: string): string =>
  createHmac("sha256", secretoDeFirmas()).update(`kontext|${requestId}|${venceEn}|${createHash("sha256").update(ambito).digest("hex")}`).digest("base64url");

/** El ámbito de un token: cada parte (el texto, el navegador, la captura, el aspecto…) entra por su hash, así que una vista distinta nunca abre el token de otra. */
export const ambitoDeKontext = (...partes: ReadonlyArray<string | undefined>): string => partes.map((p) => createHash("sha256").update(p ?? "").digest("hex")).join("|");

export function firmarSolicitudKontext(requestId: string, ambito: string, ahora = Date.now()): string {
  const venceEn = ahora + VIDA_SOLICITUD_KONTEXT_MS;
  return `${requestId}.${venceEn}.${firmaDe(requestId, venceEn, ambito)}`;
}

/** El id de fal que el token autoriza retomar en ESTE ámbito, o `null` si no es un token válido, está vencido o es de otro ámbito. */
export function abrirSolicitudKontext(token: string, ambito: string, ahora = Date.now()): string | null {
  const [requestId, vence, firma, ...resto] = token.split(".");
  if (resto.length || !requestId || !vence || !firma || !ID_DE_FAL.test(requestId) || !/^\d{10,16}$/.test(vence)) return null;
  const venceEn = Number(vence);
  if (venceEn < ahora) return null;
  const esperada = Buffer.from(firmaDe(requestId, venceEn, ambito));
  const recibida = Buffer.from(firma);
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada) ? requestId : null;
}

export type SolicitudPrevia = { tipo: "ninguna" } | { tipo: "retomar"; requestId: string } | { tipo: "invalida" };

/** Lo que dice la petición sobre retomar: sin encabezado es una imagen nueva; con encabezado, o el token sirve o la petición se rechaza (nunca se envía otra solicitud en silencio: sería pagar dos veces). */
export function solicitudPreviaDe(cabeceras: Headers, ambito: string): SolicitudPrevia {
  const token = cabeceras.get(CABECERA_SOLICITUD_KONTEXT)?.trim();
  if (!token) return { tipo: "ninguna" };
  const requestId = abrirSolicitudKontext(token, ambito);
  return requestId ? { tipo: "retomar", requestId } : { tipo: "invalida" };
}

/** El 202 que le dice al navegador «sigue en curso: repite esta misma petición con este token». */
export function respuestaKontextEnCurso(error: KontextEnCursoError, ambito: string): Response {
  return Response.json(
    { estado: "en_curso", codigo: CODIGO_KONTEXT_EN_CURSO, solicitud_kontext: firmarSolicitudKontext(error.requestId, ambito) },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
