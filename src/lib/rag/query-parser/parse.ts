import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { interpretarConsultaDeterminista, mergeGeminiIntent, type DeterministicParse } from "./deterministic";
import { IntentQuerySchema, type IntentQuery } from "./schema";
import { parseEventSearchIntent, interpretarConsultaEvento } from "./event-search";
import { registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "@/lib/ia/telemetria-llamadas";

const JSON_SCHEMA = z.toJSONSchema(IntentQuerySchema, { target: "draft-7" });

const INSTRUCCION = `Interpretas mensajes de clientes de una tienda de decoración de fiestas.
Devuelve únicamente JSON compatible con el schema recibido. No devuelvas productos, SKU,
precios del catálogo, inventario ni explicaciones.

Reglas:
- filtros_duros son requisitos explícitos; preferencias como "preferiría" quedan en semantic_query.
- Usa únicamente enums del schema. Si un atributo no es inequívoco, deja su arreglo vacío.
- "globos" no es una categoría: no adivines entre látex, metalizado o número/letra.
- formas solo significa forma física (redondo, corazón, link, modelar); metalizado es acabado,
  nunca forma.
- diametros_pulgadas solo acepta 5, 9, 12, 18, 24, 36 o 40 cuando el cliente lo pide explícitamente.
- solo_disponibles es true salvo una petición explícita de agotados/descontinuados.
- semantic_query resume la solicitud sin perder nombres exactos o identificadores escritos por el cliente.`;

/** Local parser is exported for the benchmark and for callers that require zero network. */
export function interpretarConsultaLocal(mensaje: string): DeterministicParse {
  return interpretarConsultaDeterminista(mensaje);
}

/**
 * Deterministic-first query interpreter. Gemini is an optional enrichment only
 * for genuinely ambiguous local parses; a provider failure falls back cleanly.
 */
export async function interpretarConsulta(mensaje: string, telemetria?: ContextoTelemetriaIA): Promise<IntentQuery> {
  const local = interpretarConsultaDeterminista(mensaje);
  if (local.confidence === "certain") return local.intent;

  const client = getGeminiClient();
  if (!client) return local.intent;

  const inicio = Date.now();
  try {
    const respuesta = await client.models.generateContent({
      model: MODELO_CHAT,
      contents: [{ role: "user", parts: [{ text: mensaje }] }],
      config: {
        systemInstruction: INSTRUCCION,
        responseMimeType: "application/json",
        responseJsonSchema: JSON_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    registrarGemini({ flujo: "armador_decoracion", capacidad: "parser_intencion", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie: "/api/chat", ...telemetria }, usage: respuesta.usageMetadata, thinkingLevel: "minimal" });
    const texto = respuesta.text;
    if (!texto) return local.intent;
    const remote = IntentQuerySchema.parse(JSON.parse(texto));
    return mergeGeminiIntent(local, remote);
  } catch (error) {
    registrarGemini({ flujo: "armador_decoracion", capacidad: "parser_intencion", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: "/api/chat", ...telemetria }, thinkingLevel: "minimal" });
    // A search must remain available during quota, timeout or malformed model
    // output incidents. Local facts are safer than a partial remote result.
    return local.intent;
  }
}

export { parseEventSearchIntent, interpretarConsultaEvento };
