import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { interpretarConsultaDeterminista, mergeGeminiIntent, type DeterministicParse } from "@/lib/rag/query-parser/deterministic";
import { IntentQuerySchema, type IntentQuery } from "@/lib/rag/query-parser/schema";
import { idsTelemetria, registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { INTENT_PARSER_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { isPythonAdapterError, llamarPythonIntentParse } from "@/lib/ia/nucleo/python-adapter";
import { esquemaRaizParaGoogle } from "@/lib/ia/nucleo/esquema-google";

const JSON_SCHEMA = z.toJSONSchema(IntentQuerySchema, { target: "draft-7" });

// Adapted once for Python's `response_schema` (see esquema-google.ts); the
// direct path keeps sending the untouched Zod export.
const JSON_SCHEMA_PYTHON = esquemaRaizParaGoogle(JSON_SCHEMA);

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
 * Gemini enrichment via the Python service (docs/architecture/decisions/0026):
 * Python only makes the provider call with the prompt/schema built here.
 * TypeScript still owns the deterministic-first decision and the merge.
 */
async function enriquecerConGeminiPython(mensaje: string, local: DeterministicParse, telemetria: ContextoTelemetriaIA | undefined, inicio: number): Promise<IntentQuery> {
  const { requestId, correlationId } = idsTelemetria(telemetria);
  try {
    const respuesta = await llamarPythonIntentParse({
      message: mensaje,
      systemInstruction: INSTRUCCION,
      responseJsonSchema: JSON_SCHEMA_PYTHON,
      model: MODELO_CHAT,
      requestId,
      correlationId,
    });
    registrarGemini({
      flujo: "armador_decoracion", capacidad: "parser_intencion", modelo: respuesta.model, inicio, resultado: "ok",
      contexto: { superficie: "/api/chat", ...telemetria },
      usage: respuesta.usage ? {
        promptTokenCount: respuesta.usage.prompt_token_count,
        candidatesTokenCount: respuesta.usage.candidates_token_count,
        thoughtsTokenCount: respuesta.usage.thoughts_token_count,
        cachedContentTokenCount: respuesta.usage.cached_content_token_count,
      } : undefined,
      thinkingLevel: "minimal",
    });
    const remote = IntentQuerySchema.parse(JSON.parse(respuesta.text));
    return mergeGeminiIntent(local, remote);
  } catch (error) {
    registrarGemini({ flujo: "armador_decoracion", capacidad: "parser_intencion", modelo: MODELO_CHAT, inicio, resultado: isPythonAdapterError(error) ? resultadoTelemetria(error) : "error", contexto: { superficie: "/api/chat", ...telemetria }, thinkingLevel: "minimal" });
    // Same fallback as the direct-Gemini path: local facts over a partial or unavailable remote result.
    return local.intent;
  }
}

/**
 * Deterministic-first query interpreter. Gemini is an optional enrichment only
 * for genuinely ambiguous local parses; a provider failure falls back cleanly.
 */
export async function interpretarConsulta(mensaje: string, telemetria?: ContextoTelemetriaIA): Promise<IntentQuery> {
  const local = interpretarConsultaDeterminista(mensaje);
  if (local.confidence === "certain") return local.intent;

  const inicio = Date.now();
  if (INTENT_PARSER_PYTHON_ENABLED) {
    return enriquecerConGeminiPython(mensaje, local, telemetria, inicio);
  }

  const client = getGeminiClient();
  if (!client) return local.intent;

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
