import type { Content, ContentListUnion, ContentUnion, GenerateContentParameters, Part } from "@google/genai";
import type { ClienteGenerativo, RespuestaGenerativa } from "@/lib/ia/nucleo/cliente-generativo";
import type { ClienteAnthropic } from "./cliente";
import type { ConfigClaude } from "./config";
import { cuerpoMensajes } from "./cuerpo";
import { herramientasAnthropic } from "./herramientas";
import { esUsoHerramienta, motivoFinClaude, textoDeContenido, usoDeAnthropic } from "./respuesta";
import type { BloqueEntrada, MensajeAnthropic } from "./tipos";

/**
 * Claude con la forma del cliente de Gemini (`models.generateContent`) para los llamadores de una sola pasada (lectura de
 * la foto 3D, detección de globos, parser de intención, intérprete de módulos, resumen del feedback, traducción): así cada
 * uno sigue armando SU petición de Gemini, que en producción sale idéntica, y solo en local con Claude se traduce aquí.
 * - `responseJsonSchema` → una herramienta forzada con ese esquema (`tool_choice: tool`; un esquema que no es objeto va
 *   envuelto en `resultado`) y la respuesta es el JSON de sus argumentos: el equivalente de la salida estructurada.
 *   Sin razonamiento en ese caso (Haiku 5.5 no razona con herramienta forzada).
 * - Partes de texto → bloques de texto; `inlineData` → bloques de imagen, en el mismo orden; las de pensamiento se omiten.
 * - `maxOutputTokens` → `max_tokens`; `temperature`, `thinkingConfig` y demás de Gemini no se mandan (Haiku 5.5 rechaza
 *   temperaturas distintas de la de fábrica; el razonamiento sale de `IA_LOCAL_ESFUERZO`).
 */

const HERRAMIENTA_JSON = "responder_json";

type Objeto = Record<string, unknown>;
const esObjeto = (valor: unknown): valor is Objeto => typeof valor === "object" && valor !== null && !Array.isArray(valor);

function bloqueDeParte(parte: Part | string): BloqueEntrada | null {
  if (typeof parte === "string") return parte.trim() ? { type: "text", text: parte } : null;
  if (parte.thought === true) return null;
  if (typeof parte.text === "string") return parte.text.trim() ? { type: "text", text: parte.text } : null;
  if (parte.inlineData?.data && parte.inlineData.mimeType) return { type: "image", source: { type: "base64", media_type: parte.inlineData.mimeType, data: parte.inlineData.data } };
  throw new Error("Claude local solo recibe texto e imágenes en línea (parte de Gemini no soportada).");
}

const esContenido = (valor: unknown): valor is Content => esObjeto(valor) && Array.isArray(valor.parts);

function contenidosDe(lista: ContentListUnion): Content[] {
  const elementos = Array.isArray(lista) ? lista : [lista];
  if (elementos.every(esContenido)) return elementos;
  // Una lista de partes (o una sola) es un único mensaje del usuario, como en Gemini.
  return [{ role: "user", parts: elementos.map((parte) => (typeof parte === "string" ? { text: parte } : (parte as Part))) }];
}

function mensajesDe(lista: ContentListUnion): MensajeAnthropic[] {
  const mensajes: MensajeAnthropic[] = [];
  for (const contenido of contenidosDe(lista)) {
    const bloques = (contenido.parts ?? []).map(bloqueDeParte).filter((bloque): bloque is BloqueEntrada => bloque !== null);
    if (!bloques.length) continue;
    const role = contenido.role === "model" ? "assistant" : "user";
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo?.role === role) ultimo.content.push(...bloques);
    else mensajes.push({ role, content: bloques });
  }
  if (mensajes[0]?.role === "assistant") mensajes.unshift({ role: "user", content: [{ type: "text", text: "(continúa la conversación)" }] });
  return mensajes;
}

function sistemaDe(valor: ContentUnion | undefined): string {
  if (valor === undefined) return "";
  if (typeof valor === "string") return valor;
  const partes = Array.isArray(valor) ? valor : esContenido(valor) ? valor.parts ?? [] : [valor];
  return partes.map((parte) => (typeof parte === "string" ? parte : typeof parte.text === "string" ? parte.text : "")).join("\n");
}

/** El esquema de la salida estructurada como herramienta: `input_schema` tiene que ser un objeto. */
function herramientaJson(esquema: unknown): { esquema: Objeto; envuelto: boolean } {
  if (!esObjeto(esquema)) throw new Error("responseJsonSchema debe ser un esquema JSON (objeto).");
  return esquema.type === "object" || esquema.type === undefined
    ? { esquema, envuelto: false }
    : { esquema: { type: "object", properties: { resultado: esquema }, required: ["resultado"] }, envuelto: true };
}

/**
 * Solo lo que se traduce (sistema, esquema JSON, tope de salida, corte) o se ignora a propósito (temperatura y
 * razonamiento de Gemini, tipo de respuesta texto/JSON). Cualquier otra cosa (tools, toolConfig, responseModalities,
 * responseSchema, topP…) lanza antes de llamar: callarla cambiaría lo que pidió el llamador sin que nadie lo note.
 */
const PARAMETROS_ADMITIDOS = new Set(["model", "contents", "config"]);
const AJUSTES_ADMITIDOS = new Set(["systemInstruction", "responseMimeType", "responseJsonSchema", "maxOutputTokens", "temperature", "thinkingConfig", "abortSignal"]);
const TIPOS_RESPUESTA_ADMITIDOS = new Set(["application/json", "text/plain"]);

function validarParametros(parametros: GenerateContentParameters): void {
  const sobrantes = [
    ...Object.keys(parametros).filter((clave) => !PARAMETROS_ADMITIDOS.has(clave)),
    ...Object.entries(parametros.config ?? {}).filter(([clave, valor]) => valor !== undefined && !AJUSTES_ADMITIDOS.has(clave)).map(([clave]) => `config.${clave}`),
  ];
  if (sobrantes.length) throw new Error(`Claude local no traduce estos parámetros de Gemini: ${sobrantes.join(", ")}.`);
  const tipo = parametros.config?.responseMimeType;
  if (tipo !== undefined && !TIPOS_RESPUESTA_ADMITIDOS.has(tipo)) throw new Error(`Claude local no traduce responseMimeType «${tipo}».`);
}

export function comoClienteGemini(cliente: ClienteAnthropic, config: ConfigClaude): ClienteGenerativo {
  return {
    models: {
      async generateContent(parametros: GenerateContentParameters): Promise<RespuestaGenerativa> {
        validarParametros(parametros);
        const ajustes = parametros.config ?? {};
        const json = ajustes.responseJsonSchema !== undefined ? herramientaJson(ajustes.responseJsonSchema) : null;
        const cuerpo = cuerpoMensajes({
          config: json ? { ...config, pensamiento: false } : config,
          maxTokens: ajustes.maxOutputTokens ?? config.maxTokens,
          sistema: sistemaDe(ajustes.systemInstruction),
          mensajes: mensajesDe(parametros.contents),
          herramientas: json ? herramientasAnthropic([{ nombre: HERRAMIENTA_JSON, descripcion: "Entrega la respuesta completa con este esquema JSON.", esquema: json.esquema }]) : [],
          ...(json ? { eleccion: { type: "tool" as const, name: HERRAMIENTA_JSON } } : {}),
        });
        const respuesta = await cliente.messages.create(cuerpo, { signal: ajustes.abortSignal });
        const llamada = respuesta.content.find((bloque) => esUsoHerramienta(bloque) && bloque.name === HERRAMIENTA_JSON);
        const argumentos = llamada && esUsoHerramienta(llamada) ? llamada.input : null;
        const texto = json && argumentos ? JSON.stringify(json.envuelto ? argumentos.resultado ?? null : argumentos) : textoDeContenido(respuesta.content);
        const uso = usoDeAnthropic(respuesta.usage);
        const finishReason = motivoFinClaude(respuesta.stop_reason);
        return {
          text: texto || undefined,
          candidates: [{ content: { role: "model", parts: texto ? [{ text: texto }] : [] }, ...(finishReason ? { finishReason } : {}) }],
          usageMetadata: { promptTokenCount: uso.entrada, candidatesTokenCount: uso.salida, thoughtsTokenCount: uso.pensamiento, cachedContentTokenCount: uso.cacheados },
          modelVersion: respuesta.model,
        };
      },
    },
  };
}
