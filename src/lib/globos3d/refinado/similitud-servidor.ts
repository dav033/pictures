import { z } from "zod";
import type { FlujoIA } from "@sempertex/agente-core";
import type { ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { EscenaSchema } from "../esquema-escena";
import { encuadreDeLectura } from "../encuadre-foto";
import { LecturaFotoSchema } from "../lectura-foto";
import { MARGEN_MEJORA, coseno, decidirAceptacion, mejoraDe, veredictoDe, type Decision } from "./aceptacion";
import { referenciaDeLectura, revisarEstructura } from "./estructura";
import type { Veredicto } from "./motivos";
import { CapturaCuerpoSchema, MAX_BASE64_CAPTURA } from "./ronda-servidor";
import { MAX_RONDAS_REFINAR } from "./ronda";

/**
 * Lado servidor del criterio de aceptación del refinado (REQ-001 paso 9, P-016). Recibe la foto y las capturas de la escena de
 * antes y de después de la ronda (JPEG de 1024 px) junto con las dos escenas y la lectura de la foto, y DECIDE aquí si la
 * ronda se queda: primero la estructura (`estructura.ts`, gratis; si falla no se pagan embeddings), luego el parecido con la foto
 * (embeddings de imagen de gemini-embedding-2, una imagen por llamada, ~US$0,0001 cada una). La decisión queda en el registro de
 * la conversación (`regla:aceptacion_refinado`) con los números, y al navegador solo vuelve el veredicto. La ruta
 * (`/api/escena-ia/similitud`) solo pone la autenticación y las dependencias reales; todo lo demás se prueba con dependencias
 * inyectadas, sin red. Tiene su propio cupo por hora (`cupo-escena-ia.ts`).
 */

export const SimilitudCuerpoSchema = z.object({
  foto: CapturaCuerpoSchema,
  antes: CapturaCuerpoSchema,
  despues: CapturaCuerpoSchema,
  escenaAntes: EscenaSchema,
  escenaDespues: EscenaSchema,
  /** La lectura que devolvió el servidor al armar la escena (se valida de nuevo: no se confía en el navegador). */
  lectura: LecturaFotoSchema,
  ronda: z.number().int().min(1).max(MAX_RONDAS_REFINAR),
}).strict();
export type SimilitudCuerpo = z.infer<typeof SimilitudCuerpoSchema>;

/** Lo que cuestan las tres llamadas de embedding de imagen. */
export const COSTE_SIMILITUD_USD = 0.0003;
const LADO_EMBEBER = 1024;
/** El flujo de telemetría de estas llamadas: es la evaluación de una ronda, no la búsqueda del armador. */
export const FLUJO_SIMILITUD: FlujoIA = "evaluacion";
export const SUPERFICIE_SIMILITUD = "escena_ia_similitud";
/** Tres imágenes de 1024 px más las dos escenas y la lectura (holgura de 2 MiB). Queda bajo el tope de 10 MiB que el proxy de Next entrega entero. */
export const LIMITE_CUERPO_SIMILITUD_BYTES = 3 * MAX_BASE64_CAPTURA + 2 * 1024 * 1024;

export type RespuestaSimilitud = Veredicto | { error: string };

export type DependenciasSimilitud = {
  autenticado: (request: Request) => boolean;
  mismoOrigen: (request: Request) => boolean;
  /** Toma una revisión del cupo por hora; `false` si ya se acabó. */
  cupo: () => boolean;
  normalizar: (bytes: Uint8Array, lado: number) => Promise<Uint8Array>;
  embeber: (bytes: Uint8Array, mime: string, telemetria?: ContextoTelemetriaIA, flujo?: FlujoIA) => Promise<number[]>;
  /** Los ids de la petición para la telemetría: las tres llamadas de embedding quedan ligadas a ella. */
  contexto: () => ContextoTelemetriaIA;
  /** El registro de decisiones de la conversación (`decidir`). */
  registrar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown }) => void;
};

const json = (cuerpo: RespuestaSimilitud, status = 200) => Response.json(cuerpo, { status });
const DEMASIADO_GRANDE = "Las imágenes o las escenas pesan demasiado.";

/** El cuerpo del pedido como JSON, sin leerlo si ya declara un tamaño mayor al límite. */
async function leerCuerpoAcotado(request: Request): Promise<{ ok: true; json: unknown } | { ok: false; respuesta: Response }> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > LIMITE_CUERPO_SIMILITUD_BYTES) return { ok: false, respuesta: json({ error: DEMASIADO_GRANDE }, 413) };
  let texto: string;
  try { texto = await request.text(); } catch { return { ok: false, respuesta: json({ error: "El pedido no llegó completo." }, 400) }; }
  if (Buffer.byteLength(texto, "utf8") > LIMITE_CUERPO_SIMILITUD_BYTES) return { ok: false, respuesta: json({ error: DEMASIADO_GRANDE }, 413) };
  try { return { ok: true, json: JSON.parse(texto) }; } catch { return { ok: false, respuesta: json({ error: "El pedido no llegó en un formato válido." }, 400) }; }
}

export async function atenderSimilitud(request: Request, deps: DependenciasSimilitud): Promise<Response> {
  if (!deps.autenticado(request) || !deps.mismoOrigen(request)) return json({ error: "Sesión requerida." }, 401);
  const leido = await leerCuerpoAcotado(request);
  if (!leido.ok) return leido.respuesta;
  const cuerpo = SimilitudCuerpoSchema.safeParse(leido.json);
  if (!cuerpo.success) return json({ error: "Faltan la foto, las capturas, las escenas o la lectura, o no cumplen el formato." }, 400);
  if (!deps.cupo()) return json({ error: "Se alcanzó el límite de revisiones por hora a la IA de la escena." }, 429);
  const { foto, antes, despues, escenaAntes, escenaDespues, lectura, ronda } = cuerpo.data;

  const registrar = (decision: Decision, costeEstimadoUsd: number): Veredicto => {
    const veredicto = veredictoDe(decision, costeEstimadoUsd);
    deps.registrar("regla:aceptacion_refinado", "aceptar o descartar una ronda de refinado con la foto", {
      aceptada: decision.aceptada,
      motivo: veredicto.motivo,
      antes: decision.similitud?.antes ?? null,
      despues: decision.similitud?.despues ?? null,
      mejora: decision.similitud ? mejoraDe(decision.similitud) : null,
      margen: MARGEN_MEJORA,
      detalle: decision.aceptada ? null : decision.rechazo.detalle,
      costeEstimadoUsd,
    }, { entrada: { ronda, piezasAntes: escenaAntes.nodos.length, piezasDespues: escenaDespues.nodos.length } });
    return veredicto;
  };

  // La estructura primero: es gratis y, si falla, no se pagan los embeddings.
  const estructura = revisarEstructura(escenaAntes, escenaDespues, encuadreDeLectura(lectura), referenciaDeLectura(lectura));
  if (estructura) return json(registrar(decidirAceptacion(null, estructura), 0));

  const contexto = { ...deps.contexto(), superficie: SUPERFICIE_SIMILITUD };
  const vector = async (imagen: { base64: string }): Promise<number[]> => {
    const normalizada = await deps.normalizar(new Uint8Array(Buffer.from(imagen.base64, "base64")), LADO_EMBEBER);
    return deps.embeber(normalizada, "image/jpeg", contexto, FLUJO_SIMILITUD);
  };
  try {
    const [vFoto, vAntes, vDespues] = await Promise.all([vector(foto), vector(antes), vector(despues)]);
    return json(registrar(decidirAceptacion({ antes: coseno(vFoto, vAntes), despues: coseno(vFoto, vDespues) }, null), COSTE_SIMILITUD_USD));
  } catch (error) {
    console.warn("[escena-ia-similitud] el embedding falló", { mensaje: error instanceof Error ? error.message : String(error) });
    registrar(decidirAceptacion(null, null), 0);
    return json({ error: "No pude comparar las imágenes en este momento." }, 502);
  }
}
