import type { Part } from "@google/genai";
import type { ClienteAnthropic } from "@/lib/ia/claude/cliente";
import type { ConfigClaude } from "@/lib/ia/claude/config";
import { cuerpoMensajes } from "@/lib/ia/claude/cuerpo";
import { herramientaDeDeclaracion, herramientasAnthropic } from "@/lib/ia/claude/herramientas";
import { costeClaudeUsd } from "@/lib/ia/claude/precios";
import { esUsoHerramienta, motivoFinClaude, textoDeContenido, usoDeAnthropic } from "@/lib/ia/claude/respuesta";
import type { BloqueEntrada, MensajeAnthropic, UsoAnthropic } from "@/lib/ia/claude/tipos";
import { registrarClaude, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import type { ModeloEscenaIA, PasoEscena, UsoPasoEscena } from "./tipos";

/**
 * La IA de la escena con Claude (solo local, W5). El mismo bucle que con Gemini, traducido a la API de mensajes:
 * - las declaraciones de Gemini pasan a `tools` con los mismos nombres y argumentos (`herramientasAnthropic`);
 * - el paso forzado (foto con la sala ocupada) manda SOLO las herramientas permitidas con `tool_choice: any`, que es
 *   como se expresa la lista permitida de Gemini (Anthropic no tiene lista; NOTES.md §3);
 * - el turno del modelo se guarda tal cual (razonamiento + texto + tool_use) y los resultados van como `tool_result`;
 * - cada vuelta deja su fila en `ai_call_log` (`registrarClaude`); la auditoría del registro la pone el cliente
 *   (`getClaudeClient("escena_ia")`, ver crear-modelo.ts).
 */

const SUPERFICIE = "/api/escena-ia";

/** Partes de Gemini (texto e `inlineData`) → bloques de Anthropic, en el mismo orden. */
function bloqueDeParte(parte: Part): BloqueEntrada | null {
  if (typeof parte.text === "string") return parte.text.trim() ? { type: "text", text: parte.text } : null;
  if (parte.inlineData?.data && parte.inlineData.mimeType) return { type: "image", source: { type: "base64", media_type: parte.inlineData.mimeType, data: parte.inlineData.data } };
  throw new Error("La escena solo manda texto e imágenes al modelo.");
}

/** Lo que la API cobró en una vuelta, reconstruido desde el uso neutral (para el precio por petición). */
function usoAnthropicDe(uso: UsoPasoEscena): UsoAnthropic {
  return {
    input_tokens: uso.entrada - uso.cacheLeidos - uso.cacheEscritos,
    output_tokens: uso.salida + uso.pensamiento,
    cache_read_input_tokens: uso.cacheLeidos,
    cache_creation_input_tokens: uso.cacheEscritos,
  };
}

export function crearModeloEscenaClaude(
  cliente: ClienteAnthropic,
  config: ConfigClaude,
  dependencias: { registrar?: typeof registrarClaude } = {},
): ModeloEscenaIA {
  const registrar = dependencias.registrar ?? registrarClaude;
  return {
    proveedor: "claude",
    modelo: config.modelo,
    // La tarifa (normal o de prompt largo) depende de cada petición: se suma vuelta por vuelta. Por Claude Code (`cli`) la
    // paga la suscripción del dueño: 0.
    costeUsd: (usos) => (config.transporte === "cli" ? 0 : usos.reduce((suma, uso) => suma + (costeClaudeUsd(config.modelo, usoAnthropicDe(uso)) ?? 0), 0)),
    iniciar({ sistema, declaraciones, historial, partesUsuario, signal }) {
      const todas = declaraciones.map(herramientaDeDeclaracion);
      const herramientas = herramientasAnthropic(todas);
      const mensajes: MensajeAnthropic[] = [];
      const agregar = (mensaje: MensajeAnthropic) => {
        const ultimo = mensajes[mensajes.length - 1];
        if (ultimo?.role === mensaje.role) ultimo.content.push(...mensaje.content);
        else mensajes.push(mensaje);
      };
      for (const turno of historial) {
        if (turno.texto.trim()) agregar({ role: turno.rol === "usuario" ? "user" : "assistant", content: [{ type: "text", text: turno.texto }] });
      }
      if (mensajes[0]?.role === "assistant") mensajes.unshift({ role: "user", content: [{ type: "text", text: "(continúa la conversación)" }] });
      agregar({ role: "user", content: partesUsuario.map(bloqueDeParte).filter((bloque): bloque is BloqueEntrada => bloque !== null) });

      return {
        async pedir(forzar): Promise<PasoEscena> {
          const cuerpo = cuerpoMensajes({
            // Paso forzado sin razonamiento: Haiku 5.5 ya no razona con tool_choice forzado (migration guide), y apagarlo
            // garantiza que ese turno no deje bloques de razonamiento que la vuelta siguiente (con otra lista de
            // herramientas) tendría que reenviar: la API rechaza un bloque reenviado después de cambiar `tools`.
            config: forzar ? { ...config, pensamiento: false } : config,
            maxTokens: config.maxTokens,
            sistema,
            mensajes,
            herramientas: forzar ? herramientasAnthropic(todas.filter((h) => forzar.includes(h.nombre))) : herramientas,
            ...(forzar ? { eleccion: { type: "any" as const } } : {}),
          });
          const inicio = Date.now();
          const telemetria = { flujo: "armador_decoracion" as const, capacidad: "chat_turno" as const, modelo: config.modelo, inicio, contexto: { superficie: SUPERFICIE }, thinkingLevel: config.esfuerzo };
          let respuesta;
          try {
            respuesta = await cliente.messages.create(cuerpo, { signal });
          } catch (error) {
            registrar({ ...telemetria, resultado: resultadoTelemetria(error) });
            throw error;
          }
          registrar({ ...telemetria, modelo: respuesta.model, resultado: "ok", usage: respuesta.usage, finishReason: motivoFinClaude(respuesta.stop_reason) });
          mensajes.push({ role: "assistant", content: respuesta.content });
          const uso = usoDeAnthropic(respuesta.usage);
          return {
            texto: textoDeContenido(respuesta.content).trim(),
            llamadas: respuesta.content.filter(esUsoHerramienta).map((bloque) => ({ id: bloque.id, nombre: bloque.name, args: bloque.input })),
            uso: { entrada: uso.entrada, salida: uso.salida, pensamiento: uso.pensamiento ?? 0, cacheLeidos: uso.cacheados ?? 0, cacheEscritos: uso.cacheEscritos ?? 0 },
          };
        },
        responder(respuestas) {
          // Una llamada sin respuesta (la vuelta se cortó con preguntar_usuario) no llega aquí: la ruta termina el turno.
          agregar({ role: "user", content: respuestas.map((r) => ({ type: "tool_result", tool_use_id: r.id ?? "", content: JSON.stringify(r.respuesta) })) });
        },
      };
    },
  };
}
