import { ThinkingLevel, type GenerateContentResponseUsageMetadata } from "@google/genai";
import { MODELO_CHAT } from "@/lib/gemini";
import { clienteGenerativoDe, destinoGenerativo, type DestinoGenerativo } from "@/lib/ia/nucleo/cliente-generativo";
import { registrarSegunProveedor, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import { decidir } from "@/lib/registro/servidor";
import { ESQUEMA_INTERPRETACION, INSTRUCCION_INTERPRETACION, SalidaInterpretacionSchema, interpretarSalida, type Interpretacion } from "./interpretar";

/**
 * US-2: Gemini Flash (solo texto → JSON, nunca imágenes) separa las palabras de un pedido; `interpretar.ts` las vuelve
 * códigos del catálogo. La llamada va auditada (`clienteGenerativoDe` + `registrarSegunProveedor` + `decidir`). W5: con
 * Claude activo en local, el mismo pedido va a Claude (el esquema como herramienta forzada); en producción, Gemini igual.
 */
export const PROPOSITO_INTERPRETAR_MODULO = "modulos_interpretar";
export const MAX_PEDIDO = 300;

export class ErrorInterpretacion extends Error {
  constructor(mensaje: string, readonly causa: "sin_ia" | "modelo" | "invalida") {
    super(mensaje);
    this.name = "ErrorInterpretacion";
  }
}

type EntradaTelemetria = Parameters<typeof registrarSegunProveedor>[1];
/** La telemetría nunca tumba el pedido: si no se puede anotar (taxonomía sin migrar, p. ej.), se sigue. */
function telemetria(destino: DestinoGenerativo, entrada: EntradaTelemetria): void {
  try { registrarSegunProveedor(destino.proveedor, entrada); } catch (error) { decidir("regla:modulos_interpretar_telemetria", "no se pudo anotar la llamada en la telemetría", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }); }
}

export type GenerarJson = (texto: string, signal?: AbortSignal) => Promise<{ texto: string; usage?: GenerateContentResponseUsageMetadata }>;

const generarConModelo: GenerarJson = async (texto, signal) => {
  const generativo = clienteGenerativoDe(PROPOSITO_INTERPRETAR_MODULO);
  if (!generativo) throw new ErrorInterpretacion("La IA no está configurada en este servidor.", "sin_ia");
  const r = await generativo.cliente.models.generateContent({
    model: generativo.modelo,
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
  const generar = opciones.generar ?? generarConModelo;
  // Con la generación inyectada (pruebas), la telemetría de siempre.
  const destino: DestinoGenerativo = opciones.generar ? { proveedor: "gemini", modelo: MODELO_CHAT } : destinoGenerativo();
  const inicio = Date.now();
  let respuesta: Awaited<ReturnType<GenerarJson>>;
  try {
    respuesta = await generar(texto, opciones.signal);
  } catch (error) {
    telemetria(destino, { flujo: "modulos_estudio", capacidad: "parser_intencion", modelo: destino.modelo, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: "/api/modulos-interpretar" }, thinkingLevel: destino.esfuerzo ?? "minimal" });
    if (error instanceof ErrorInterpretacion) throw error;
    throw new ErrorInterpretacion(error instanceof Error ? error.message : String(error), "modelo");
  }
  telemetria(destino, { flujo: "modulos_estudio", capacidad: "parser_intencion", modelo: destino.modelo, inicio, resultado: "ok", contexto: { superficie: "/api/modulos-interpretar" }, ...(respuesta.usage ? { usage: respuesta.usage } : {}), thinkingLevel: destino.esfuerzo ?? "minimal" });
  let json: unknown;
  try { json = JSON.parse(respuesta.texto); } catch { json = null; }
  const salida = SalidaInterpretacionSchema.safeParse(json);
  decidir("modelo:modulos_interpretar", salida.success ? "pedido del estudio interpretado" : "la IA devolvió un JSON que no cumple el esquema", { ok: salida.success, modelo: destino.modelo }, { entrada: { pedido: texto } });
  if (!salida.success) throw new ErrorInterpretacion("La IA no devolvió una interpretación válida.", "invalida");
  const resultado = interpretarSalida(salida.data);
  decidir("regla:modulos_interpretar_resultado", resultado.ok ? "configuración resuelta del pedido" : "pedido con datos faltantes o colores fuera del catálogo", resultado.ok ? { config: resultado.config } : { errores: resultado.errores, desconocidos: resultado.desconocidos });
  return resultado;
}
