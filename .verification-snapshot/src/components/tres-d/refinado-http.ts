import type { FotoAdjuntaIA } from "@/lib/globos3d/cuerpo-escena-ia";
import type { RespuestaRonda } from "@/lib/globos3d/refinado/bucle";
import type { CuerpoVeredicto, PedirVeredicto } from "@/lib/globos3d/refinado/evaluador";
import type { MotivoRechazo, Veredicto } from "@/lib/globos3d/refinado/motivos";

/**
 * Los pedidos del refinado contra la foto desde el navegador (REQ-001 paso 9): una ronda a `/api/escena-ia`, el veredicto de la
 * ronda a `/api/escena-ia/similitud` y la reducción de la foto al tamaño de las capturas. Aquí vive todo el `fetch` del
 * refinado (la lógica de `lib/globos3d/refinado/` no toca la red). `origen` solo se usa fuera del navegador (las evaluaciones
 * sin cabeza).
 */

export type PedidoRonda = { ok: true; datos: RespuestaRonda } | { ok: false; error: string };

const esRespuestaRonda = (v: unknown): v is RespuestaRonda =>
  typeof v === "object" && v !== null && "escena" in v && typeof (v as { respuesta?: unknown }).respuesta === "string" && Array.isArray((v as { acciones?: unknown }).acciones)
  && typeof (v as { refinar?: unknown }).refinar === "object" && (v as { refinar?: unknown }).refinar !== null;

/** El pedido real de una ronda: `fetch` a `/api/escena-ia` con las cabeceras de la conversación. */
export async function pedirRondaHttp(cuerpo: Record<string, unknown>, signal: AbortSignal, cabeceras: Record<string, string>, origen = ""): Promise<PedidoRonda> {
  try {
    const r = await fetch(`${origen}/api/escena-ia`, { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo), signal });
    const datos: unknown = await r.json().catch(() => null);
    if (r.ok && esRespuestaRonda(datos)) return { ok: true, datos };
    // Una ronda a medias (la IA se cortó) vuelve con la escena pero sin decisión: no se sigue.
    if (r.ok && typeof datos === "object" && datos !== null && "escena" in datos) return { ok: false, error: "La IA se cortó a mitad de la comparación." };
    return { ok: false, error: typeof datos === "object" && datos !== null && "error" in datos && typeof datos.error === "string" ? datos.error : "No pude comparar con la foto ahora." };
  } catch (e) {
    return { ok: false, error: e instanceof DOMException && e.name === "AbortError" ? "Detenido." : "No pude comparar con la foto: revisa la conexión." };
  }
}

const MOTIVOS: readonly MotivoRechazo[] = ["no_mejora", "pieza_baja", "pieza_quitada", "pieza_oculta", "menos_globos", "sin_comparacion"];
const esNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** El veredicto del servidor, o `null` si la respuesta no tiene la forma esperada. */
function veredictoDe(datos: unknown): Veredicto | null {
  if (typeof datos !== "object" || datos === null) return null;
  const v = datos as { aceptada?: unknown; motivo?: unknown; similitud?: unknown; costeEstimadoUsd?: unknown };
  if (typeof v.aceptada !== "boolean" || !esNumero(v.costeEstimadoUsd)) return null;
  const motivo = v.motivo === null ? null : MOTIVOS.find((m) => m === v.motivo) ?? undefined;
  if (motivo === undefined || (v.aceptada && motivo !== null) || (!v.aceptada && motivo === null)) return null;
  const s = v.similitud as { antes?: unknown; despues?: unknown } | null;
  const similitud = s === null ? null : typeof s === "object" && esNumero(s.antes) && esNumero(s.despues) ? { antes: s.antes, despues: s.despues } : undefined;
  return similitud === undefined ? null : { aceptada: v.aceptada, motivo, similitud, costeEstimadoUsd: v.costeEstimadoUsd };
}

/** El pedido real a `/api/escena-ia/similitud` con las cabeceras de la conversación; `null` si el servidor no pudo decidir. */
export function pedirVeredictoHttp(cabeceras: Record<string, string>, origen = ""): PedirVeredicto {
  return async (cuerpo: CuerpoVeredicto, signal) => {
    try {
      const r = await fetch(`${origen}/api/escena-ia/similitud`, { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo), signal });
      return r.ok ? veredictoDe(await r.json().catch(() => null)) : null;
    } catch {
      return null;
    }
  };
}

const CALIDADES = [0.85, 0.7, 0.55];
/** Como las capturas de la escena (`captura-refinar.ts`, que no se importa aquí para no cargar three.js con este módulo). */
const LADO_FOTO_REVISION = 1024;
const TOPE_BYTES_FOTO_REVISION = 1.5 * 1024 * 1024;

/** Lleva la foto a JPEG de a lo más 1024 px (el servidor de la revisión solo admite imágenes de ese tamaño). */
export async function reducirFotoParaRevision(foto: FotoAdjuntaIA): Promise<FotoAdjuntaIA> {
  const bytes = Uint8Array.from(atob(foto.base64), (c) => c.charCodeAt(0));
  const imagen = await createImageBitmap(new Blob([bytes], { type: foto.mime }), { imageOrientation: "from-image" });
  const escala = Math.min(1, LADO_FOTO_REVISION / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));
  const contexto = lienzo.getContext("2d");
  if (!contexto) throw new Error("Este navegador no puede reducir la foto.");
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, lienzo.width, lienzo.height);
  contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  for (const calidad of CALIDADES) {
    const blob = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/jpeg", calidad));
    if (!blob) break;
    if (blob.size <= TOPE_BYTES_FOTO_REVISION || calidad === CALIDADES[CALIDADES.length - 1]) {
      const url = await new Promise<string>((resolver, rechazar) => { const l = new FileReader(); l.onload = () => resolver(String(l.result)); l.onerror = () => rechazar(l.error); l.readAsDataURL(blob); });
      return { mime: "image/jpeg", base64: url.slice(url.indexOf(",") + 1) };
    }
  }
  throw new Error("Este navegador no puede reducir la foto.");
}
