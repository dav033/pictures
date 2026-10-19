import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { auditarLlamadaIa, conRegistro } from "@/lib/registro/servidor";
import { transcribirEnVps } from "@/lib/voz/cliente-vps";
import { leerConfigVoz } from "@/lib/voz/config";
import { tomarCupoVoz } from "@/lib/voz/limite";
import { atenderEstadoVoz, atenderTranscripcion } from "@/lib/voz/transcribir";

/**
 * Dictado por voz (REQ-009): el audio del micrófono → texto con Whisper en el VPS (faster-whisper, sin coste por llamada).
 * Sesión y mismo origen, cupo por IP, topes de tamaño y reenvío firmado viven en `@/lib/voz`. La auditoría registra cada
 * llamada (proveedor «whisper-vps», duración, coste 0) pero ni el audio ni el texto: `auditarEntrada` y `auditarSalida` van apagados (la entrada no se lee
 * nunca, ni aunque el Content-Type diga «json»). Corre en Node (el runtime por defecto): con `cacheComponents` Next rechaza declarar `runtime`.
 */
export const POST = conRegistro("/api/voz/transcribir", atenderPOST, { auditarEntrada: false, auditarSalida: false });

/** `{ habilitada }`: lo único del servicio que ve el navegador. Sin `conRegistro`: no decide nada. */
export function GET(request: Request) {
  return atenderEstadoVoz(request, { autenticado: isAuthenticatedRequest, config: () => leerConfigVoz() });
}

function atenderPOST(request: Request) {
  return atenderTranscripcion(request, {
    autenticado: isAuthenticatedRequest,
    mismoOrigen: isSameOriginRequest,
    config: () => leerConfigVoz(),
    cupo: tomarCupoVoz,
    transcribir: (audio, contentType, config) => auditarLlamadaIa(
      { proveedor: "whisper-vps", modelo: "faster-whisper-small", proposito: "dictado_voz", parametros: { bytes: audio.byteLength, tipo: contentType } },
      () => transcribirEnVps(audio, contentType, config),
      (r) => ({ modelo: "faster-whisper-small", costeEstimadoUsd: 0, crudo: { duracion_s: r.duracion_s, ms_servicio: r.ms } }),
    ),
  });
}
