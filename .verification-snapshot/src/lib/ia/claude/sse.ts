import { ErrorApiAnthropic } from "./errores";
import { eventoDeFlujo } from "./esquemas";
import type { BloqueCrudo, EventoFlujoAnthropic, RespuestaAnthropic, UsoAnthropic } from "./tipos";

/**
 * Flujo SSE de la API de mensajes (https://platform.claude.com/docs/en/build-with-claude/streaming): eventos separados
 * por una línea en blanco; cada uno con su línea `data:` en JSON. `ping` puede llegar en cualquier momento y un evento
 * `error` puede llegar a mitad del flujo.
 */
export async function* leerEventosSse(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<EventoFlujoAnthropic> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";
  try {
    for (;;) {
      const { value, done } = await lector.read();
      pendiente += done ? decodificador.decode() : decodificador.decode(value, { stream: true });
      const bloques = pendiente.split(/\r?\n\r?\n/);
      pendiente = done ? "" : bloques.pop() ?? "";
      for (const bloque of bloques) {
        const datos = bloque.split(/\r?\n/).filter((linea) => linea.startsWith("data:")).map((linea) => linea.slice(5).trimStart());
        if (!datos.length) continue;
        const evento = eventoDeFlujo(JSON.parse(datos.join("\n")));
        if (evento) yield evento;
      }
      if (done) return;
    }
  } finally {
    // El consumidor dejó de leer (corte, error): se suelta la conexión.
    await lector.cancel().catch(() => undefined);
  }
}

/** Arma el mensaje completo a partir de los eventos, igual que lo devolvería la llamada sin flujo. */
export function crearAcumuladorMensaje(): {
  /** Devuelve el texto nuevo si el evento lo trae (para emitirlo en vivo). Lanza con un evento `error`. */
  agregar(evento: EventoFlujoAnthropic): string;
  mensaje(): RespuestaAnthropic;
} {
  let base: RespuestaAnthropic | null = null;
  let terminado = false;
  const bloques: BloqueCrudo[] = [];
  const jsonParcial = new Map<number, string>();
  let uso: UsoAnthropic = { input_tokens: 0, output_tokens: 0 };
  let stopReason: string | null = null;

  const cadena = (bloque: BloqueCrudo | undefined, campo: string): string => (typeof bloque?.[campo] === "string" ? (bloque[campo] as string) : "");

  return {
    agregar(evento) {
      switch (evento.type) {
        case "message_start":
          base = evento.message;
          uso = { ...evento.message.usage };
          return "";
        case "content_block_start":
          bloques[evento.index] = { ...evento.content_block };
          if (evento.content_block.type === "tool_use") jsonParcial.set(evento.index, "");
          return "";
        case "content_block_delta": {
          const bloque = bloques[evento.index];
          if (!bloque) throw new ErrorApiAnthropic(0, "flujo_invalido", `delta del bloque ${evento.index} sin su inicio`);
          const { delta } = evento;
          if (delta.type === "text_delta") {
            bloque.text = cadena(bloque, "text") + delta.text;
            return delta.text;
          }
          if (delta.type === "input_json_delta") jsonParcial.set(evento.index, (jsonParcial.get(evento.index) ?? "") + delta.partial_json);
          else if (delta.type === "thinking_delta") bloque.thinking = cadena(bloque, "thinking") + delta.thinking;
          else bloque.signature = cadena(bloque, "signature") + delta.signature;
          return "";
        }
        case "content_block_stop": {
          const json = jsonParcial.get(evento.index);
          const bloque = bloques[evento.index];
          if (json === undefined || !bloque) return "";
          try {
            bloque.input = json ? JSON.parse(json) : {};
          } catch {
            // El tope de tokens cortó la llamada a medio JSON: no se ejecuta una herramienta con argumentos cortados;
            // el turno queda sin esa llamada y su motivo (MAX_TOKENS) lo dice.
            delete bloques[evento.index];
          }
          return "";
        }
        case "message_delta": {
          if (evento.delta.stop_reason !== undefined) stopReason = evento.delta.stop_reason;
          // El `usage` de message_delta es acumulado: reemplaza lo anterior, no se suma.
          const nuevo = evento.usage ?? {};
          uso = {
            input_tokens: nuevo.input_tokens ?? uso.input_tokens,
            output_tokens: nuevo.output_tokens ?? uso.output_tokens,
            cache_creation_input_tokens: nuevo.cache_creation_input_tokens ?? uso.cache_creation_input_tokens,
            cache_read_input_tokens: nuevo.cache_read_input_tokens ?? uso.cache_read_input_tokens,
            output_tokens_details: nuevo.output_tokens_details ?? uso.output_tokens_details,
          };
          return "";
        }
        case "message_stop":
          terminado = true;
          return "";
        case "error":
          throw new ErrorApiAnthropic(0, evento.error.type, evento.error.message);
        case "ping":
          return "";
      }
    },
    mensaje() {
      if (!base || !terminado) throw new ErrorApiAnthropic(0, "flujo_incompleto", "el flujo terminó antes de message_stop");
      const inicio: RespuestaAnthropic = base;
      return { ...inicio, content: bloques.filter((bloque): bloque is BloqueCrudo => Boolean(bloque)), stop_reason: stopReason, usage: uso };
    },
  };
}
