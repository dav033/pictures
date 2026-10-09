import type { ConfigVoz } from "./config";
import { ErrorVoz, type CodigoErrorVoz, type RespuestaVps } from "./cliente-vps";
import { MAX_BYTES_AUDIO, esTipoAudioAceptado, tipoBase } from "./limites";
import type { ResultadoLimite } from "./limite";

/**
 * `POST /api/voz/transcribir`: recibe el audio crudo del dictado, lo reenvía firmado al VPS y devuelve `{ texto }`. La ruta
 * solo pone las dependencias reales; la validación, el cupo y los errores viven aquí y se prueban sin red. El audio no se
 * guarda en ningún lado: pasa por memoria y se descarta.
 */

export type DependenciasTranscripcion = {
  autenticado: (request: Request) => boolean;
  mismoOrigen: (request: Request) => boolean;
  config: () => ConfigVoz;
  cupo: (ip: string) => ResultadoLimite;
  transcribir: (audio: Uint8Array, contentType: string, config: ConfigVoz) => Promise<RespuestaVps>;
};

const json = (cuerpo: Record<string, unknown>, status = 200, cabeceras: Record<string, string> = {}) =>
  Response.json(cuerpo, { status, headers: { "Cache-Control": "no-store", ...cabeceras } });

const MENSAJES: Record<CodigoErrorVoz, { status: number; error: string }> = {
  no_configurada: { status: 503, error: "El dictado por voz no está configurado en este servidor." },
  ocupado: { status: 503, error: "El dictado está ocupado ahora. Inténtalo de nuevo en unos segundos." },
  demasiado_largo: { status: 413, error: "El dictado es demasiado largo (máximo 60 segundos)." },
  servicio: { status: 502, error: "No se pudo transcribir el dictado ahora. Inténtalo de nuevo." },
  tiempo_agotado: { status: 504, error: "El dictado tardó demasiado en transcribirse. Inténtalo de nuevo." },
};

export function ipDe(request: Request): string {
  const reenviada = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (reenviada || request.headers.get("x-real-ip")?.trim() || "desconocida").slice(0, 64);
}

/** Lee el cuerpo sin pasarse de `tope` bytes: no confía en `Content-Length`. `null` si lo supera. */
export async function leerConTope(request: Request, tope: number): Promise<Uint8Array | null> {
  const lector = request.body?.getReader();
  if (!lector) return new Uint8Array(0);
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) { await lector.cancel(); return null; }
    trozos.push(value);
  }
  const audio = new Uint8Array(total);
  let desplazamiento = 0;
  for (const trozo of trozos) { audio.set(trozo, desplazamiento); desplazamiento += trozo.byteLength; }
  return audio;
}

/** `GET`: si el dictado está encendido, para que el navegador sepa si muestra el micrófono. Solo un booleano. */
export function atenderEstadoVoz(request: Request, deps: Pick<DependenciasTranscripcion, "autenticado" | "config">): Response {
  if (!deps.autenticado(request)) return json({ error: "Sesión requerida." }, 401);
  return json({ habilitada: deps.config().habilitada });
}

export async function atenderTranscripcion(request: Request, deps: DependenciasTranscripcion): Promise<Response> {
  const config = deps.config();
  if (!config.habilitada) return json({ error: "El dictado por voz no está habilitado." }, 404);
  if (!deps.autenticado(request) || !deps.mismoOrigen(request)) return json({ error: "Sesión requerida." }, 401);

  const contentType = tipoBase(request.headers.get("content-type"));
  if (!esTipoAudioAceptado(contentType)) return json({ error: "El dictado debe ser un audio (webm, ogg, mp4 o wav)." }, 415);
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_AUDIO) return json({ error: MENSAJES.demasiado_largo.error }, 413);

  const cupo = deps.cupo(ipDe(request));
  if (!cupo.permitido) return json({ error: "Demasiados dictados seguidos. Espera un momento." }, 429, { "Retry-After": String(cupo.reintentarEnSeg) });

  const audio = await leerConTope(request, MAX_BYTES_AUDIO);
  if (audio === null) return json({ error: MENSAJES.demasiado_largo.error }, 413);
  if (audio.byteLength === 0) return json({ error: "No llegó audio." }, 400);

  try {
    const respuesta = await deps.transcribir(audio, contentType, config);
    return json({ texto: respuesta.texto.trim() });
  } catch (error) {
    const codigo: CodigoErrorVoz = error instanceof ErrorVoz ? error.codigo : "servicio";
    const { status, error: mensaje } = MENSAJES[codigo];
    const espera = error instanceof ErrorVoz ? error.reintentarEnSeg : undefined;
    return json({ error: mensaje, codigo }, status, espera ? { "Retry-After": String(espera) } : {});
  }
}
