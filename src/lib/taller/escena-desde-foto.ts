import { devolverCupoEscenaIA, tomarCupoEscenaIA, TOPE_POR_HORA } from "@/lib/globos3d/cupo-escena-ia";
import { ErrorLecturaFoto, type FotoLectura } from "@/lib/globos3d/leer-foto-ia";
import type { Modelado } from "@/lib/globos3d/modelar-desde-foto";
import { MIMES_FOTO, TOPE_BYTES_FOTO } from "./buscar-foto";
import { TEXTO_CUOTA_IA, TEXTO_FOTO_NO_CLARA, TEXTO_FOTO_NO_LEIDA, TEXTO_SIN_IA } from "@/lib/globos3d/honestidad-respuesta";

/**
 * `POST /api/escena-desde-foto` (REQ-001 paso 7): recibe la foto de una decoración (multipart, campo `imagen`, ≤ 6 MB,
 * JPEG/PNG/WebP), la lleva a JPEG de hasta 1536 px, la hace leer por Gemini, busca las plantillas parecidas de la
 * biblioteca y compila la lectura a una escena. La ruta solo pone las dependencias reales; la validación, el cupo y los
 * errores viven aquí y se prueban sin red con dependencias inyectadas.
 */

export const LADO_MAXIMO_LECTURA = 1536;

export type DependenciasEscenaDesdeFoto = {
  autenticado: (request: Request) => boolean;
  mismoOrigen: (request: Request) => boolean;
  /** Lleva la imagen a JPEG de hasta `lado` px; lanza si no es una imagen legible. */
  normalizar: (bytes: Uint8Array, lado: number) => Promise<Uint8Array>;
  /** Lee la foto (ya normalizada), busca plantillas y compila. */
  modelar: (foto: FotoLectura, signal?: AbortSignal) => Promise<Modelado>;
};

const json = (cuerpo: Record<string, unknown>, status = 200) => Response.json(cuerpo, { status });

/** El motivo por el que una foto no sirve (tamaño o formato), o `null` si pasa. */
export function motivoFotoInvalida(bytes: number, mime: string): { status: number; error: string } | null {
  if (bytes === 0) return { status: 400, error: "La foto está vacía." };
  if (bytes > TOPE_BYTES_FOTO) return { status: 413, error: "La foto pesa más de 6 MB." };
  if (!MIMES_FOTO.includes(mime)) return { status: 415, error: "La foto debe ser JPEG, PNG o WebP." };
  return null;
}

/** Del error de la lectura a la respuesta HTTP (y si el pedido no gastó cupo: la IA sin configurar). */
export function respuestaDeErrorLectura(error: unknown): { status: number; error: string; sinIA: boolean } {
  if (error instanceof ErrorLecturaFoto) {
    if (error.causa === "sin_ia") return { status: 503, error: TEXTO_SIN_IA, sinIA: true };
    if (error.causa === "invalida") return { status: 502, error: TEXTO_FOTO_NO_CLARA, sinIA: false };
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(error.message)) return { status: 429, error: TEXTO_CUOTA_IA, sinIA: false };
  }
  return { status: 502, error: TEXTO_FOTO_NO_LEIDA, sinIA: false };
}

export async function atenderEscenaDesdeFoto(request: Request, deps: DependenciasEscenaDesdeFoto): Promise<Response> {
  if (!deps.autenticado(request) || !deps.mismoOrigen(request)) return json({ error: "Sesión requerida." }, 401);

  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > TOPE_BYTES_FOTO + 16 * 1024) return json({ error: "La foto pesa más de 6 MB." }, 413);

  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return json({ error: "El cuerpo debe ser un formulario con la foto en el campo «imagen»." }, 400);
  }
  const imagen = formulario.get("imagen");
  if (!(imagen instanceof Blob)) return json({ error: "Falta la foto en el campo «imagen»." }, 400);
  const invalida = motivoFotoInvalida(imagen.size, imagen.type);
  if (invalida) return json({ error: invalida.error }, invalida.status);

  let normalizada: Uint8Array;
  try {
    normalizada = await deps.normalizar(new Uint8Array(await imagen.arrayBuffer()), LADO_MAXIMO_LECTURA);
  } catch {
    return json({ error: "No se pudo leer la foto: el archivo no es una imagen válida." }, 400);
  }

  if (!tomarCupoEscenaIA()) return json({ error: `Se alcanzó el límite de ${TOPE_POR_HORA} pedidos por hora a la IA de la escena. Inténtalo más tarde.` }, 429);
  try {
    const m = await deps.modelar({ bytes: normalizada, mime: "image/jpeg" }, request.signal);
    return json({ escena: m.escena, lectura: m.lectura, notas: m.notas, omitidas: m.omitidas, descartadas: m.descartadas, plantillas: m.plantillas, avisos: m.avisos, uso: m.uso });
  } catch (error) {
    const r = respuestaDeErrorLectura(error);
    if (r.sinIA) devolverCupoEscenaIA();
    return json({ error: r.error }, r.status);
  }
}
