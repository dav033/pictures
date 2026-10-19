import { FunctionCallingConfigMode, ThinkingLevel, type Content, type GenerateContentParameters, type Part } from "@google/genai";
import type { ModeloEscenaIA, PasoEscena, UsoPasoEscena } from "./tipos";

/**
 * La IA de la escena con Gemini (producción). Es exactamente lo que hacía `/api/escena-ia` antes de pasar por el registro
 * (W5): la misma petición (sistema, herramientas, `ANY` con la lista permitida en el paso forzado, razonamiento LOW,
 * corte del navegador), el turno del modelo reenviado tal cual (con sus firmas de pensamiento: Gemini las exige en la
 * vuelta siguiente) y las respuestas de las herramientas en un solo mensaje. Lo prueba scripts/test/test-modelo-escena.ts.
 */

type RespuestaGemini = {
  candidates?: Array<{ content?: Content }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
};

/** Lo que usa la sesión del cliente de `@google/genai` (ya auditado por `getGeminiClient`). */
export type ClienteGeminiEscena = { models: { generateContent(parametros: GenerateContentParameters): Promise<RespuestaGemini> } };

/** Texto visible de una respuesta (sin las partes de pensamiento ni el getter `.text`, que avisa si hay funciones). */
function textoDe(contenido: Content | undefined): string {
  return (contenido?.parts ?? []).filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("").trim();
}

/** Estimación con precios de Gemini Flash (US$0,50 por millón de entrada, US$3 por millón de salida y pensamiento). */
function costeGeminiUsd(usos: readonly UsoPasoEscena[]): number {
  const tokens = { entrada: 0, salida: 0, pensamiento: 0 };
  for (const uso of usos) {
    tokens.entrada += uso.entrada;
    tokens.salida += uso.salida;
    tokens.pensamiento += uso.pensamiento;
  }
  return (tokens.entrada * 0.5 + (tokens.salida + tokens.pensamiento) * 3) / 1e6;
}

export function crearModeloEscenaGemini(cliente: ClienteGeminiEscena, modelo: string): ModeloEscenaIA {
  return {
    proveedor: "gemini",
    modelo,
    costeUsd: costeGeminiUsd,
    iniciar({ sistema, declaraciones, historial, partesUsuario, signal }) {
      const contents: Content[] = [
        ...historial.map((h): Content => ({ role: h.rol === "usuario" ? "user" : "model", parts: [{ text: h.texto }] })),
        { role: "user", parts: partesUsuario },
      ];
      return {
        async pedir(forzar): Promise<PasoEscena> {
          const r = await cliente.models.generateContent({
            model: modelo,
            contents,
            config: { systemInstruction: sistema, tools: [{ functionDeclarations: [...declaraciones] }], ...(forzar ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [...forzar] } } } : {}), thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: signal },
          });
          const contenido = r.candidates?.[0]?.content;
          const funciones = (contenido?.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
          // El turno del modelo va tal cual (con sus firmas de pensamiento): Gemini lo exige en la vuelta siguiente.
          if (funciones.length) contents.push(contenido ?? { role: "model", parts: funciones.map((functionCall): Part => ({ functionCall })) });
          return {
            texto: textoDe(contenido),
            llamadas: funciones.map((llamada) => ({ ...(llamada.id ? { id: llamada.id } : {}), nombre: llamada.name ?? "", ...(llamada.args ? { args: llamada.args } : {}) })),
            uso: {
              entrada: r.usageMetadata?.promptTokenCount ?? 0,
              salida: r.usageMetadata?.candidatesTokenCount ?? 0,
              pensamiento: r.usageMetadata?.thoughtsTokenCount ?? 0,
              cacheLeidos: r.usageMetadata?.cachedContentTokenCount ?? 0,
              cacheEscritos: 0,
            },
          };
        },
        responder(respuestas) {
          contents.push({ role: "user", parts: respuestas.map((r): Part => ({ functionResponse: { name: r.nombre, ...(r.id ? { id: r.id } : {}), response: r.respuesta } })) });
        },
      };
    },
  };
}
