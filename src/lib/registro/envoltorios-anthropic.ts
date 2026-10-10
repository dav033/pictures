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
 * Con el transporte `cli` (Claude Code con la suscripción del dueño) la petición lleva `transporte: "cli"` en sus
 * parámetros y el coste es 0: no hay factura por llamada; los tokens se guardan igual.
 */

const PROVEEDOR_REGISTRO = "claude";

type Transporte = "api" | "cli";

export function describirPeticionAnthropic(cuerpo: CuerpoMensajes, proposito: string, transporte: Transporte = "api"): DescripcionLlamadaIa {
  return {
    proveedor: PROVEEDOR_REGISTRO,
    modelo: cuerpo.model,
    proposito,
    ...(cuerpo.system ? { sistema: cuerpo.system.map((bloque) => bloque.text).join("\n") } : {}),
    mensajes: cuerpo.messages,
    ...(cuerpo.tools ? { herramientas: cuerpo.tools } : {}),
    parametros: { max_tokens: cuerpo.max_tokens, thinking: cuerpo.thinking, output_config: cuerpo.output_config, tool_choice: cuerpo.tool_choice, ...(transporte === "cli" ? { transporte } : {}) },
  };
}

export function extraerRespuestaAnthropic(respuesta: RespuestaAnthropic, transporte: Transporte = "api"): ResultadoLlamadaIa {
  const uso = usoDeAnthropic(respuesta.usage);
  const llamadas = respuesta.content.filter(esUsoHerramienta).map((bloque) => ({ nombre: bloque.name, id: bloque.id, argumentos: bloque.input }));
  const coste = transporte === "cli" ? 0 : costeClaudeUsd(respuesta.model, respuesta.usage);
  return {
    texto: textoDeContenido(respuesta.content),
    ...(llamadas.length ? { llamadasHerramientas: llamadas } : {}),
    ...(respuesta.stop_reason ? { motivoFin: respuesta.stop_reason } : {}),
    tokens: { entrada: uso.entrada, salida: uso.salida, pensamiento: uso.pensamiento, cacheados: uso.cacheados, cacheEscritos: uso.cacheEscritos },
    modelo: respuesta.model,
    ...(coste !== undefined ? { costeEstimadoUsd: coste } : {}),
    ...(respuesta.tiemposCli ? { crudo: { tiemposCli: respuesta.tiemposCli } } : {}),
  };
}

async function* flujoAuditado(flujo: AsyncIterable<EventoFlujoAnthropic>, llamada: LlamadaIaEnCurso, transporte: Transporte): AsyncGenerator<EventoFlujoAnthropic> {
  const acumulador = crearAcumuladorMensaje();
  let texto = "";
  let cerrada = false;
  try {
    for await (const evento of flujo) {
      texto += acumulador.agregar(evento);
      yield evento;
    }
    cerrada = true;
    llamada.terminar(extraerRespuestaAnthropic(acumulador.mensaje(), transporte));
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

export function envolverClienteAnthropic(cliente: ClienteAnthropic, opciones: { proposito: string; transporte?: Transporte }): ClienteAnthropic {
  if (envueltos.has(cliente)) return cliente;
  const transporte = opciones.transporte ?? "api";
  const envuelto: ClienteAnthropic = {
    messages: {
      create: (cuerpo, llamada) => auditarLlamadaIa(
        describirPeticionAnthropic(cuerpo, opciones.proposito, transporte),
        () => cliente.messages.create(cuerpo, llamada),
        (respuesta) => extraerRespuestaAnthropic(respuesta, transporte),
      ),
      stream: async (cuerpo, llamada) => {
        const enCurso = iniciarLlamadaIa(describirPeticionAnthropic(cuerpo, opciones.proposito, transporte));
        let flujo: AsyncIterable<EventoFlujoAnthropic>;
        try {
          flujo = await cliente.messages.stream(cuerpo, llamada);
        } catch (error) {
          enCurso.fallar(error);
          throw error;
        }
        return flujoAuditado(flujo, enCurso, transporte);
      },
    },
  };
  envueltos.add(envuelto);
  return envuelto;
}
