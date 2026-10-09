import { ThinkingLevel, type GenerateContentResponseUsageMetadata } from "@google/genai";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { registrarGemini, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import { decidir } from "@/lib/registro/servidor";
import { ESQUEMA_INTERPRETACION, INSTRUCCION_INTERPRETACION, SalidaInterpretacionSchema, interpretarSalida, type Interpretacion } from "./interpretar";

/**
 * US-2: Gemini Flash (solo texto → JSON, nunca imágenes) separa las palabras de un pedido; `interpretar.ts` las vuelve
 * códigos del catálogo. La llamada va auditada (`getGeminiClient` + `registrarGemini` + `decidir`).
 */
export const PROPOSITO_INTERPRETAR_MODULO = "modulos_interpretar";
export const MAX_PEDIDO = 300;

export class ErrorInterpretacion extends Error {
  constructor(mensaje: string, readonly causa: "sin_ia" | "modelo" | "invalida") {
    super(mensaje);
    this.name = "ErrorInterpretacion";
  }
}

type EntradaTelemetria = Parameters<typeof registrarGemini>[0];
/** La telemetría nunca tumba el pedido: si no se puede anotar (taxonomía sin migrar, p. ej.), se sigue. */
function telemetria(entrada: EntradaTelemetria): void {
  try { registrarGemini(entrada); } catch (error) { decidir("regla:modulos_interpretar_telemetria", "no se pudo anotar la llamada en la telemetría", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }); }
}

export type GenerarJson = (texto: string, signal?: AbortSignal) => Promise<{ texto: string; usage?: GenerateContentResponseUsageMetadata }>;

const generarConGemini: GenerarJson = async (texto, signal) => {
  const cliente = getGeminiClient(PROPOSITO_INTERPRETAR_MODULO);
  if (!cliente) throw new ErrorInterpretacion("La IA no está configurada en este servidor.", "sin_ia");
  const r = await cliente.models.generateContent({
    model: MODELO_CHAT,
    contents: [{ role: "user", parts: [{ text: texto }] }],
    config: {
      systemInstruction: INSTRUCCION_INTERPRETACION, responseMimeType: "application/json", responseJsonSchema: ESQUEMA_INTERPRETACION,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }, maxOutputTokens: 800, temperature: 0.1, abortSignal: signal,
    },
  });
  const partes = r.candidates?.[0]?.content?.parts ?? [];
  return { texto: partes.filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("").trim(), usage: r.usageMetadata };
};

export async function interpretarPedido(pedido: string, opciones: { generar?: GenerarJson; signal?: AbortSignal } = {}): Promise<Interpretacion> {
  const texto = pedido.trim().slice(0, MAX_PEDIDO);
  if (!texto) return { ok: false, errores: ["Escribe qué módulo quieres."], desconocidos: [], avisos: [] };
  const generar = opciones.generar ?? generarConGemini;
  const inicio = Date.now();
  let respuesta: Awaited<ReturnType<GenerarJson>>;
  try {
    respuesta = await generar(texto, opciones.signal);
  } catch (error) {
    telemetria({ flujo: "modulos_estudio", capacidad: "parser_intencion", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: "/api/modulos-interpretar" }, thinkingLevel: "minimal" });
    if (error instanceof ErrorInterpretacion) throw error;
    throw new ErrorInterpretacion(error instanceof Error ? error.message : String(error), "modelo");
  }
  telemetria({ flujo: "modulos_estudio", capacidad: "parser_intencion", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie: "/api/modulos-interpretar" }, ...(respuesta.usage ? { usage: respuesta.usage } : {}), thinkingLevel: "minimal" });
  let json: unknown;
  try { json = JSON.parse(respuesta.texto); } catch { json = null; }
  const salida = SalidaInterpretacionSchema.safeParse(json);
  decidir("modelo:modulos_interpretar", salida.success ? "pedido del estudio interpretado" : "la IA devolvió un JSON que no cumple el esquema", { ok: salida.success, modelo: MODELO_CHAT }, { entrada: { pedido: texto } });
  if (!salida.success) throw new ErrorInterpretacion("La IA no devolvió una interpretación válida.", "invalida");
  const resultado = interpretarSalida(salida.data);
  decidir("regla:modulos_interpretar_resultado", resultado.ok ? "configuración resuelta del pedido" : "pedido con datos faltantes o colores fuera del catálogo", resultado.ok ? { config: resultado.config } : { errores: resultado.errores, desconocidos: resultado.desconocidos });
  return resultado;
}
