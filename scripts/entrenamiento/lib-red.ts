/**
 * Guarda de red del arnés. Instala un `fetch` que solo deja pasar a api.anthropic.com (transporte `api`), que responde
 * con respuestas grabadas y coste simulado (`seco`), o que no deja salir nada (`cli`: la suscripción no usa `fetch`).
 * Cualquier otro host se bloquea con error: ni Gemini, ni fal, ni el RAG de Python pueden gastar aunque haya llaves.
 * Una petición con la señal ya abortada se rechaza como lo hace un `fetch` real, y con la pasada detenida (`parado`) no
 * sale ni se responde ninguna más a Anthropic, aunque quien la hace no propague la señal de aborto.
 */
import type { UsoAnthropic } from "@/lib/ia/claude/tipos";
import { CAJAS_DETECCION_SECO, LECTURA_SECO } from "./fixtures/lectura-seco";
import type { TransporteArnes } from "./lib-agregado";

const HOST_ANTHROPIC = "api.anthropic.com";
const HERRAMIENTA_JSON = "responder_json";
export const USO_SECO_POR_DEFECTO: UsoAnthropic = { input_tokens: 2000, output_tokens: 200 };

type BloqueSeco = Record<string, unknown>;
export type RespuestaSeca = { contenido: BloqueSeco[]; modelo: string; motivo: "end_turn" | "tool_use" };

/** La respuesta grabada para cada petición, según las herramientas y el esquema que trae el cuerpo. */
export function respuestaSeca(cuerpo: string): RespuestaSeca {
  const datos = JSON.parse(cuerpo) as { model?: string; tools?: Array<{ name?: string }> };
  const modelo = datos.model ?? "claude-haiku-5-5";
  const herramientas = (datos.tools ?? []).map((t) => t.name);
  if (herramientas.includes(HERRAMIENTA_JSON)) {
    // La detección pide una lista (esquema de array, que la capa envuelve en `resultado`); la lectura, un objeto.
    const input = cuerpo.includes("box_2d") ? { resultado: CAJAS_DETECCION_SECO } : LECTURA_SECO;
    return { contenido: [{ type: "tool_use", id: "toolu_seco", name: HERRAMIENTA_JSON, input }], modelo, motivo: "tool_use" };
  }
  if (herramientas.length) return { contenido: [{ type: "text", text: "Modo seco: sin cambios." }], modelo, motivo: "end_turn" };
  throw new Error("Modo --seco: petición del modelo no reconocida; no se responde.");
}

export type OpcionesGuardaRed = {
  /** Uso de tokens que reporta cada llamada en seco (el coste simulado pasa por la misma contabilidad que el real). */
  uso?: UsoAnthropic;
  /** Número de la llamada (1 = la primera) que responde con error HTTP 500, para probar la contabilidad de fallos. */
  fallarLlamada?: number;
  /** El motivo de paro de la pasada (tope de gasto o de llamadas), o `null` mientras siga. */
  parado?: () => string | null;
};

const bloqueada = (host: string) => new Error(`Guarda de red: llamada bloqueada (${host}) en el transporte del arnés.`);

export type GuardaRed = {
  restaurar: () => void;
  ajustar: (nuevas: OpcionesGuardaRed) => void;
  /** Peticiones a Anthropic que la guarda sirvió o dejó salir desde el último ajuste. */
  servidas: () => number;
};

/**
 * Instala la guarda y devuelve sus mandos. El cliente de Claude guarda la referencia a `fetch` al crearse (una vez por
 * proceso), así que la guarda se instala una sola vez y se reconfigura con `ajustar` (uso simulado, fallo de una llamada).
 */
export function instalarGuardaRed(transporte: TransporteArnes, inicial: OpcionesGuardaRed = {}): GuardaRed {
  const original = globalThis.fetch;
  let opciones: OpcionesGuardaRed = { ...inicial };
  let llamadas = 0;
  const guardada = async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const senal = init?.signal ?? (entrada instanceof Request ? entrada.signal : undefined);
    if (senal?.aborted) throw senal.reason ?? new DOMException("This operation was aborted", "AbortError");
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    const host = url.split("/")[2] ?? "desconocido";
    if (transporte === "cli") throw bloqueada(host);
    if (host !== HOST_ANTHROPIC) throw bloqueada(host);
    const motivoParo = opciones.parado?.() ?? null;
    if (motivoParo !== null) throw new Error(`Guarda de red: pasada detenida (${motivoParo}); no se envía la petición.`);
    llamadas += 1;
    if (transporte === "api") return original(entrada, init);
    if (opciones.fallarLlamada === llamadas) {
      return Response.json({ type: "error", error: { type: "api_error", message: "fallo simulado del modo seco" } }, { status: 500 });
    }
    const cuerpo = typeof init?.body === "string" ? init.body : "";
    const { contenido, modelo, motivo } = respuestaSeca(cuerpo);
    const uso = opciones.uso ?? USO_SECO_POR_DEFECTO;
    return Response.json({ id: `msg_seco_${llamadas}`, type: "message", role: "assistant", model: modelo, content: contenido, stop_reason: motivo, usage: uso });
  };
  globalThis.fetch = guardada as typeof fetch;
  return {
    restaurar: () => { globalThis.fetch = original; },
    ajustar: (nuevas) => { opciones = { ...nuevas }; llamadas = 0; },
    servidas: () => llamadas,
  };
}
