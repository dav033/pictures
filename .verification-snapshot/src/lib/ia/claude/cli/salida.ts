import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ErrorCliClaude } from "../errores";
import type { BloqueCrudo, EventoFlujoAnthropic, RespuestaAnthropic, UsoAnthropic } from "../tipos";

/**
 * Lo que escribe `claude -p --output-format stream-json --verbose` (una línea JSON por mensaje) → la respuesta de la API
 * de mensajes que ya entiende el resto (bucle de herramientas, historial, auditoría). Solo importan dos mensajes:
 * - `system/init`: con qué herramientas arrancó; si trae alguna además de la de la salida estructurada, se corta
 *   (`verificarAislamiento`): el modelo no puede tocar el equipo del dueño;
 * - `result`: el texto o la salida estructurada, el uso de tokens y el modelo real.
 */

/** La herramienta interna con la que Claude Code entrega `--json-schema`; ninguna otra se admite. */
const HERRAMIENTAS_ADMITIDAS = new Set(["StructuredOutput"]);

const UsoCliSchema = z.looseObject({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
});

const ResultadoCliSchema = z.looseObject({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  usage: UsoCliSchema.optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
  session_id: z.string().optional(),
  api_error_status: z.number().nullish(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  duration_api_ms: z.number().optional(),
});
export type ResultadoCli = z.infer<typeof ResultadoCliSchema>;

const InitSchema = z.looseObject({ type: z.literal("system"), subtype: z.literal("init"), tools: z.array(z.string()) });

const SalidaEstructuradaSchema = z.object({
  texto: z.string().optional(),
  llamadas: z.array(z.object({ nombre: z.string(), argumentos: z.unknown() })).optional(),
});

export type LineaCli = { tipo: "init"; herramientas: string[] } | { tipo: "resultado"; resultado: ResultadoCli } | null;

/** `null` para las líneas que no importan (mensajes del asistente, eventos de reintento…). Un `result` malformado lanza. */
export function leerLineaCli(linea: string): LineaCli {
  const limpia = linea.trim();
  if (!limpia.startsWith("{")) return null;
  let dato: unknown;
  try {
    dato = JSON.parse(limpia);
  } catch {
    return null;
  }
  const tipo = typeof dato === "object" && dato !== null ? (dato as { type?: unknown; subtype?: unknown }) : {};
  if (tipo.type === "system" && tipo.subtype === "init") {
    const init = InitSchema.safeParse(dato);
    if (!init.success) throw new ErrorCliClaude(0, "aislamiento_sin_verificar", "el mensaje de inicio de Claude Code no trae su lista de herramientas");
    return { tipo: "init", herramientas: init.data.tools };
  }
  if (tipo.type !== "result") return null;
  const resultado = ResultadoCliSchema.safeParse(dato);
  if (!resultado.success) throw new ErrorCliClaude(0, "respuesta_cli_invalida", `el resultado de Claude Code no tiene la forma esperada (${resultado.error.issues[0]?.message ?? "?"})`);
  return { tipo: "resultado", resultado: resultado.data };
}

export function verificarAislamiento(herramientas: readonly string[]): void {
  const sobrantes = herramientas.filter((nombre) => !HERRAMIENTAS_ADMITIDAS.has(nombre));
  if (sobrantes.length) throw new ErrorCliClaude(0, "aislamiento_cli", `Claude Code arrancó con herramientas que no debe tener: ${sobrantes.slice(0, 10).join(", ")}`);
}

const PATRON_SOBRECARGA = /overloaded/i;
const PATRON_CUOTA = /usage limit|rate limit|rate_limit/i;
const PATRON_SESION = /log ?in|not logged|authenticat|invalid api key|oauth/i;
const TIPO_POR_ESTADO: Readonly<Record<number, string>> = { 401: "authentication_error", 429: "rate_limit_error", 529: "overloaded_error" };

function errorDeResultado(resultado: ResultadoCli): ErrorCliClaude {
  const detalle = resultado.result?.trim() || resultado.subtype;
  const status = resultado.api_error_status
    ?? (PATRON_SOBRECARGA.test(detalle) ? 529 : PATRON_CUOTA.test(detalle) ? 429 : PATRON_SESION.test(detalle) ? 401 : 0);
  return new ErrorCliClaude(status, TIPO_POR_ESTADO[status] ?? resultado.subtype, detalle);
}

function usoDe(resultado: ResultadoCli): UsoAnthropic {
  const uso = resultado.usage;
  if (!uso) return { input_tokens: 0, output_tokens: 0 };
  return {
    input_tokens: uso.input_tokens,
    output_tokens: uso.output_tokens,
    cache_creation_input_tokens: uso.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: uso.cache_read_input_tokens ?? null,
  };
}

/** Algunos modelos mandan los argumentos como texto JSON: se aceptan si son un objeto. */
function argumentosDe(valor: unknown, nombre: string): Record<string, unknown> {
  const objeto = typeof valor === "string" ? (() => { try { return JSON.parse(valor) as unknown; } catch { return null; } })() : valor;
  if (typeof objeto === "object" && objeto !== null && !Array.isArray(objeto)) return objeto as Record<string, unknown>;
  throw new ErrorCliClaude(0, "respuesta_cli_invalida", `los argumentos de «${nombre}» no son un objeto`);
}

function contenidoEstructurado(salida: unknown, permitidas: ReadonlySet<string>): BloqueCrudo[] {
  const leida = SalidaEstructuradaSchema.safeParse(salida);
  if (!leida.success) throw new ErrorCliClaude(0, "respuesta_cli_invalida", `la salida estructurada no tiene la forma { texto, llamadas } (${leida.error.issues[0]?.message ?? "?"})`);
  const { texto = "", llamadas = [] } = leida.data;
  const desconocidas = llamadas.filter((llamada) => !permitidas.has(llamada.nombre)).map((llamada) => llamada.nombre);
  if (desconocidas.length) throw new ErrorCliClaude(0, "respuesta_cli_invalida", `pidió herramientas que no estaban permitidas: ${desconocidas.join(", ")}`);
  return [
    ...(texto.trim() ? [{ type: "text", text: texto }] : []),
    ...llamadas.map((llamada) => ({ type: "tool_use", id: `toolu_cli_${randomUUID().replace(/-/g, "")}`, name: llamada.nombre, input: argumentosDe(llamada.argumentos, llamada.nombre) })),
  ];
}

/**
 * El `result` → la respuesta de la API. Con esquema, las llamadas pedidas pasan a bloques `tool_use` con un id propio
 * (el `tool_result` de la vuelta siguiente lo repite). Un error de Claude Code (sesión, cuota, sobrecarga) lanza con el
 * estado de la API si lo informa, para que `categorizarErrorClaude` lo trate como el de la API.
 */
export function respuestaDeResultado(resultado: ResultadoCli, contexto: { modelo: string; conEsquema: boolean; permitidas: ReadonlySet<string> }): RespuestaAnthropic {
  if (resultado.is_error || resultado.subtype !== "success") throw errorDeResultado(resultado);
  if (contexto.conEsquema && resultado.structured_output === undefined) {
    throw new ErrorCliClaude(0, "respuesta_cli_invalida", "Claude Code terminó sin la salida estructurada pedida");
  }
  const content = contexto.conEsquema
    ? contenidoEstructurado(resultado.structured_output, contexto.permitidas)
    : resultado.result?.trim() ? [{ type: "text", text: resultado.result }] : [];
  const modelo = Object.keys(resultado.modelUsage ?? {})[0] ?? contexto.modelo;
  return {
    id: `msg_cli_${resultado.session_id ?? randomUUID()}`,
    model: modelo,
    content,
    stop_reason: content.some((bloque) => bloque.type === "tool_use") ? "tool_use" : "end_turn",
    usage: usoDe(resultado),
    tiemposCli: { turnos: resultado.num_turns, msTotal: resultado.duration_ms, msApi: resultado.duration_api_ms },
  };
}

/** La respuesta completa como eventos del flujo SSE (Claude Code entrega el turno entero: el texto llega de una vez). */
export async function* eventosDeRespuesta(respuesta: RespuestaAnthropic): AsyncGenerator<EventoFlujoAnthropic> {
  yield { type: "message_start", message: { ...respuesta, content: [], stop_reason: null, usage: { ...respuesta.usage, output_tokens: 0 } } };
  for (const [index, bloque] of respuesta.content.entries()) {
    if (bloque.type === "tool_use") {
      yield { type: "content_block_start", index, content_block: { ...bloque, input: {} } };
      yield { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(bloque.input) } };
    } else {
      yield { type: "content_block_start", index, content_block: { type: "text", text: "" } };
      yield { type: "content_block_delta", index, delta: { type: "text_delta", text: typeof bloque.text === "string" ? bloque.text : "" } };
    }
    yield { type: "content_block_stop", index };
  }
  yield { type: "message_delta", delta: { stop_reason: respuesta.stop_reason }, usage: respuesta.usage };
  yield { type: "message_stop" };
}
