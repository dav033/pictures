import type { ClienteAnthropic } from "../ia/claude/cliente";
import { costeClaudeUsd } from "../ia/claude/precios";
import { esUsoHerramienta, textoDeContenido, usoDeAnthropic } from "../ia/claude/respuesta";
import { crearAcumuladorMensaje } from "../ia/claude/sse";
import type { CuerpoMensajes, EventoFlujoAnthropic, RespuestaAnthropic } from "../ia/claude/tipos";
import { auditarLlamadaIa, iniciarLlamadaIa, type DescripcionLlamadaIa, type LlamadaIaEnCurso, type ResultadoLlamadaIa } from "./envoltorios";

/**
 * El equivalente de `envolverClienteGemini` para el transporte de Claude (`getClaudeClient`): cada `messages.create` y
 * `messages.stream` deja `llamada_ia` (sistema, mensajes, herramientas, parámetros) y `respuesta_ia` (texto, llamadas,
 * motivo de fin, tokens con lectura y escritura de caché, coste estimado, ms o error). Devuelve y lanza exactamente lo
 * mismo que el cliente envuelto. Las imágenes base64 se guardan como huella (redacción del registro).
 */

const PROVEEDOR_REGISTRO = "claude";

export function describirPeticionAnthropic(cuerpo: CuerpoMensajes, proposito: string): DescripcionLlamadaIa {
  return {
    proveedor: PROVEEDOR_REGISTRO,
    modelo: cuerpo.model,
    proposito,
    ...(cuerpo.system ? { sistema: cuerpo.system.map((bloque) => bloque.text).join("\n") } : {}),
    mensajes: cuerpo.messages,
    ...(cuerpo.tools ? { herramientas: cuerpo.tools } : {}),
    parametros: { max_tokens: cuerpo.max_tokens, thinking: cuerpo.thinking, output_config: cuerpo.output_config, tool_choice: cuerpo.tool_choice },
  };
}

export function extraerRespuestaAnthropic(respuesta: RespuestaAnthropic): ResultadoLlamadaIa {
  const uso = usoDeAnthropic(respuesta.usage);
  const llamadas = respuesta.content.filter(esUsoHerramienta).map((bloque) => ({ nombre: bloque.name, id: bloque.id, argumentos: bloque.input }));
  const coste = costeClaudeUsd(respuesta.model, respuesta.usage);
  return {
    texto: textoDeContenido(respuesta.content),
    ...(llamadas.length ? { llamadasHerramientas: llamadas } : {}),
    ...(respuesta.stop_reason ? { motivoFin: respuesta.stop_reason } : {}),
    tokens: { entrada: uso.entrada, salida: uso.salida, pensamiento: uso.pensamiento, cacheados: uso.cacheados, cacheEscritos: uso.cacheEscritos },
    modelo: respuesta.model,
    ...(coste !== undefined ? { costeEstimadoUsd: coste } : {}),
  };
}

async function* flujoAuditado(flujo: AsyncIterable<EventoFlujoAnthropic>, llamada: LlamadaIaEnCurso): AsyncGenerator<EventoFlujoAnthropic> {
  const acumulador = crearAcumuladorMensaje();
  let texto = "";
  let cerrada = false;
  try {
    for await (const evento of flujo) {
      texto += acumulador.agregar(evento);
      yield evento;
    }
    cerrada = true;
    llamada.terminar(extraerRespuestaAnthropic(acumulador.mensaje()));
  } catch (error) {
    cerrada = true;
    llamada.fallar(error, { texto, interrumpida: true });
    throw error;
  } finally {
    // El consumidor dejó de leer (corte, plazo) antes del final.
    if (!cerrada) llamada.terminar({ texto, interrumpida: true });
  }
}

const envueltos = new WeakSet<ClienteAnthropic>();

export function envolverClienteAnthropic(cliente: ClienteAnthropic, opciones: { proposito: string }): ClienteAnthropic {
  if (envueltos.has(cliente)) return cliente;
  const envuelto: ClienteAnthropic = {
    messages: {
      create: (cuerpo, llamada) => auditarLlamadaIa(
        describirPeticionAnthropic(cuerpo, opciones.proposito),
        () => cliente.messages.create(cuerpo, llamada),
        extraerRespuestaAnthropic,
      ),
      stream: async (cuerpo, llamada) => {
        const enCurso = iniciarLlamadaIa(describirPeticionAnthropic(cuerpo, opciones.proposito));
        let flujo: AsyncIterable<EventoFlujoAnthropic>;
        try {
          flujo = await cliente.messages.stream(cuerpo, llamada);
        } catch (error) {
          enCurso.fallar(error);
          throw error;
        }
        return flujoAuditado(flujo, enCurso);
      },
    },
  };
  envueltos.add(envuelto);
  return envuelto;
}
