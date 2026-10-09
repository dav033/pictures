import { z } from "zod";
import type { ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { coseno } from "./aceptacion-refinado";
import { FotoCuerpoSchema } from "./escena-ia-foto";

/**
 * Lado servidor del criterio de aceptación del refinado (REQ-001 paso 9, P-016): recibe la foto y las dos capturas de la
 * escena (antes y después de la ronda), las lleva a JPEG, las embebe con gemini-embedding-2 (una imagen por llamada,
 * ~US$0,0001 cada una) y devuelve qué tanto se parece cada captura a la foto (coseno). La ruta
 * (`/api/escena-ia/similitud`) solo pone la autenticación y las dependencias reales; todo lo demás se prueba con
 * dependencias inyectadas, sin red. Comparte el tope por hora con `/api/escena-ia`.
 */

export const SimilitudCuerpoSchema = z.object({ foto: FotoCuerpoSchema, antes: FotoCuerpoSchema, despues: FotoCuerpoSchema });
export type SimilitudCuerpo = z.infer<typeof SimilitudCuerpoSchema>;

/** Lo que cuestan las tres llamadas de embedding de imagen. */
export const COSTE_SIMILITUD_USD = 0.0003;
const LADO_EMBEBER = 1024;

export type RespuestaSimilitud = { antes: number; despues: number; costeEstimadoUsd: number } | { error: string };

export type DependenciasSimilitud = {
  autenticado: (request: Request) => boolean;
  mismoOrigen: (request: Request) => boolean;
  /** Toma un pedido del cupo por hora; `false` si ya se acabó. */
  cupo: () => boolean;
  normalizar: (bytes: Uint8Array, lado: number) => Promise<Uint8Array>;
  embeber: (bytes: Uint8Array, mime: string, telemetria?: ContextoTelemetriaIA) => Promise<number[]>;
};

/**
 * El origen del navegador es el mismo host al que llegó el pedido. `isSameOriginRequest` compara contra la URL que arma Next,
 * que en desarrollo usa «localhost» aunque se abra la página por 127.0.0.1; la cabecera `Host` es la que el navegador puso
 * (un sitio ajeno no puede hacer que coincidan: su origen es otro).
 */
export function origenCoincideConHost(request: Request): boolean {
  const origen = request.headers.get("origin"), host = request.headers.get("host");
  if (!origen || !host) return false;
  try { return new URL(origen).host === host; } catch { return false; }
}

const json = (cuerpo: RespuestaSimilitud, status = 200) => Response.json(cuerpo, { status });

export async function atenderSimilitud(request: Request, deps: DependenciasSimilitud): Promise<Response> {
  if (!deps.autenticado(request) || !deps.mismoOrigen(request)) return json({ error: "Sesión requerida." }, 401);
  let crudo: unknown;
  try { crudo = await request.json(); } catch { return json({ error: "El pedido no llegó en un formato válido." }, 400); }
  const cuerpo = SimilitudCuerpoSchema.safeParse(crudo);
  if (!cuerpo.success) return json({ error: "Faltan la foto y las dos capturas, o no cumplen el formato." }, 400);
  if (!deps.cupo()) return json({ error: "Se alcanzó el límite de pedidos por hora a la IA de la escena." }, 429);

  const vector = async (imagen: { base64: string }): Promise<number[]> => {
    const normalizada = await deps.normalizar(new Uint8Array(Buffer.from(imagen.base64, "base64")), LADO_EMBEBER);
    return deps.embeber(normalizada, "image/jpeg", { superficie: "escena_ia_refinar" });
  };
  try {
    const [foto, antes, despues] = await Promise.all([vector(cuerpo.data.foto), vector(cuerpo.data.antes), vector(cuerpo.data.despues)]);
    return json({ antes: coseno(foto, antes), despues: coseno(foto, despues), costeEstimadoUsd: COSTE_SIMILITUD_USD });
  } catch (error) {
    console.warn("[escena-ia-similitud] el embedding falló", { mensaje: error instanceof Error ? error.message : String(error) });
    return json({ error: "No pude comparar las imágenes en este momento." }, 502);
  }
}
