import { conReintento, type ChatPort, type FragmentoChat, type PeticionChat, type TurnoChat } from "@sempertex/agente-core";
import { crearClienteClaudeCli } from "./cli/cliente";
import { crearClienteAnthropic } from "./cliente";
import type { ConfigClaude } from "./config";
import { cuerpoMensajes } from "./cuerpo";
import { categorizarErrorClaude } from "./errores";
import { herramientasAnthropic } from "./herramientas";
import { historialAMensajes } from "./historial";
import { turnoDeRespuesta } from "./respuesta";
import { crearAcumuladorMensaje } from "./sse";
import type { CuerpoMensajes } from "./tipos";

/**
 * ChatPort de Claude (solo local; lo entrega `chatDe("claude")` ya envuelto con `envolverChatPort`). Mismo contrato que el
 * adaptador de Gemini: reintenta 429/5xx con `conReintento`, traduce los fallos a `ErrorIA`, y en flujo solo reintenta
 * la apertura (nunca después del primer byte). `temperatura` no se envía: Haiku 5.5 la rechaza. El corte (`signal`) llega
 * al `fetch` (o mata el proceso de Claude Code con el transporte `cli`); un corte se relanza tal cual, sin disfrazarlo de
 * fallo del proveedor.
 */

function cuerpoDeTurno(peticion: PeticionChat, config: ConfigClaude): { cuerpo: CuerpoMensajes; bytesImagen: number } {
  const { mensajes, bytesImagen } = historialAMensajes(peticion.historial);
  return {
    cuerpo: cuerpoMensajes({
      config,
      maxTokens: peticion.maxTokens ?? config.maxTokens,
      sistema: peticion.sistema,
      mensajes,
      herramientas: herramientasAnthropic(peticion.herramientas),
    }),
    bytesImagen,
  };
}

function fallo(error: unknown, signal: AbortSignal | undefined, conImagenes: boolean): unknown {
  return signal?.aborted ? error : categorizarErrorClaude(error, conImagenes);
}

export function crearChatClaude(config: ConfigClaude & { fetch?: typeof fetch }): ChatPort {
  const cliente = config.transporte === "cli" ? crearClienteClaudeCli() : crearClienteAnthropic({ apiKey: config.apiKey, fetch: config.fetch });
  const reintentable = (conImagenes: boolean) => (error: unknown) => categorizarErrorClaude(error, conImagenes).reintentable;

  return {
    id: "claude",
    modelo: config.modelo,
    thinkingLevel: config.esfuerzo,

    async turno(peticion: PeticionChat): Promise<TurnoChat> {
      const { cuerpo, bytesImagen } = cuerpoDeTurno(peticion, config);
      try {
        const respuesta = await conReintento(
          () => cliente.messages.create(cuerpo, { signal: peticion.signal }),
          { esReintentable: reintentable(bytesImagen > 0), signal: peticion.signal },
        );
        return turnoDeRespuesta(respuesta, bytesImagen);
      } catch (error) {
        throw fallo(error, peticion.signal, bytesImagen > 0);
      }
    },

    async *turnoStream(peticion: PeticionChat): AsyncIterable<FragmentoChat> {
      const { cuerpo, bytesImagen } = cuerpoDeTurno(peticion, config);
      try {
        const flujo = await conReintento(
          () => cliente.messages.stream(cuerpo, { signal: peticion.signal }),
          { esReintentable: reintentable(bytesImagen > 0), signal: peticion.signal },
        );
        const acumulador = crearAcumuladorMensaje();
        for await (const evento of flujo) {
          const delta = acumulador.agregar(evento);
          if (delta) yield { tipo: "texto", delta };
        }
        yield { tipo: "fin", ...turnoDeRespuesta(acumulador.mensaje(), bytesImagen) };
      } catch (error) {
        throw fallo(error, peticion.signal, bytesImagen > 0);
      }
    },
  };
}
