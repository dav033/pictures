import { ApiError, GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { conReintento } from "../retry";
import { ErrorIA } from "../tipos";
import type { ChatPort, FragmentoChat, Herramienta, LlamadaHerramienta, Mensaje, PeticionChat, TurnoChat } from "../tipos";

/** Mismo default que tenía este adaptador dentro de demo-decoracion — se
 * conserva para no cambiar comportamiento; un consumidor nuevo lo overridea
 * con `opts.modelo` o la misma env var. */
const MODELO_POR_DEFECTO = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";

function herramientaADeclaracion(h: Herramienta): FunctionDeclaration {
  return {
    name: h.nombre,
    description: h.descripcion,
    parametersJsonSchema: h.esquema,
  };
}

/**
 * Agrupa mensajes "herramienta" consecutivos en un solo Content: Gemini
 * espera todas las functionResponse de un mismo turno juntas en un único
 * mensaje de rol "user".
 */
function historialAContents(historial: Mensaje[]): Content[] {
  const contents: Content[] = [];

  for (const m of historial) {
    if (m.rol === "usuario") {
      // Cada imagen queda pegada a su ID semántico. El modelo no ve EXIF/XMP
      // de forma fiable; esta etiqueta multimodal es el metadato que sí llega
      // al contexto y permite enlazarla con un JSON por el mismo ID.
      const parts: Part[] = [];
      for (const img of m.imagenes ?? []) {
        if (img.id) {
          parts.push({
            text: `[IMAGEN_ID=${img.id}]${img.descripcion ? ` ${img.descripcion}` : ""}`,
          });
        }
        parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
      }
      parts.push({ text: m.texto });
      contents.push({ role: "user", parts });
    } else if (m.rol === "asistente" && "texto" in m) {
      contents.push({ role: "model", parts: [{ text: m.texto }] });
    } else if (m.rol === "asistente" && "llamadas" in m) {
      const parts: Part[] = m.llamadas.map((l) => ({
        functionCall: { name: l.nombre, args: l.args, ...(l.id ? { id: l.id } : {}) },
        // Requerido por los modelos "thinking" de Gemini en llamadas de función
        // multi-turno: sin esto, la API rechaza el turno siguiente con
        // INVALID_ARGUMENT ("missing thought_signature").
        ...(typeof l.meta?.thoughtSignature === "string"
          ? { thoughtSignature: l.meta.thoughtSignature }
          : {}),
      }));
      contents.push({ role: "model", parts });
    } else if (m.rol === "herramienta") {
      const parte: Part = {
        functionResponse: {
          name: m.nombre,
          response: m.resultado as Record<string, unknown>,
          ...(m.llamadaId ? { id: m.llamadaId } : {}),
        },
      };
      const ultimo = contents[contents.length - 1];
      if (ultimo?.role === "user" && ultimo.parts?.every((p) => "functionResponse" in p)) {
        ultimo.parts.push(parte);
      } else {
        contents.push({ role: "user", parts: [parte] });
      }
    }
  }

  return contents;
}

function extraerLlamadas(partes: Part[]): LlamadaHerramienta[] {
  return partes
    .filter((parte): parte is Part & { functionCall: NonNullable<Part["functionCall"]> } =>
      Boolean(parte.functionCall?.name),
    )
    .map((parte) => ({
      id: parte.functionCall.id,
      nombre: parte.functionCall.name!,
      args: parte.functionCall.args ?? {},
      meta: parte.thoughtSignature ? { thoughtSignature: parte.thoughtSignature } : undefined,
    }));
}

/**
 * `ApiError.status` es el status HTTP real que expone @google/genai; se usa
 * como señal primaria y el substring del mensaje queda de respaldo para
 * errores que no traen status (red, abort por timeout local).
 */
function categorizarError(error: unknown): ErrorIA {
  const mensaje = error instanceof Error ? error.message : "Error desconocido";
  const status = error instanceof ApiError ? error.status : undefined;
  const m = mensaje.toLowerCase();

  if (status === 401 || status === 403 || m.includes("api key") || m.includes("api_key") || m.includes("permission"))
    return new ErrorIA("sin_llave", "gemini", mensaje, false);
  if (status === 429 || m.includes("quota") || m.includes("rate") || m.includes("429"))
    return new ErrorIA("cuota", "gemini", mensaje, true);
  if (m.includes("safety") || m.includes("blocked") || m.includes("filtered"))
    return new ErrorIA("filtrado", "gemini", mensaje, false);
  if (status === 504 || m.includes("timeout") || m.includes("deadline"))
    return new ErrorIA("timeout", "gemini", mensaje, true);
  if (status !== undefined && status >= 500) return new ErrorIA("desconocido", "gemini", mensaje, true);
  return new ErrorIA("desconocido", "gemini", mensaje, true);
}

function esReintentable(error: unknown): boolean {
  return categorizarError(error).reintentable;
}

/**
 * Adaptador `ChatPort` para Gemini. `apiKey`/`modelo` son opcionales — si no
 * se dan, caen a `GEMINI_API_KEY`/`GEMINI_CHAT_MODEL` (mismo comportamiento
 * que tenía este adaptador dentro de demo-decoracion, donde nunca se pasaban
 * explícitos). `thinkingLevel` no se envía por defecto — comportamiento del
 * modelo tal cual, sin bajar el razonamiento salvo que el consumidor lo pida.
 */
export function crearChatGemini(opts?: { apiKey?: string; modelo?: string; thinkingLevel?: ThinkingLevel }): ChatPort {
  const apiKey = opts?.apiKey ?? process.env.GEMINI_API_KEY;
  const modelo = opts?.modelo ?? MODELO_POR_DEFECTO;
  const thinkingConfig = opts?.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : undefined;

  function cliente(): GoogleGenAI | null {
    if (!apiKey) return null;
    return new GoogleGenAI({ apiKey });
  }

  return {
    id: "gemini",
    modelo,

    async turno(p: PeticionChat): Promise<TurnoChat> {
      const client = cliente();
      if (!client) throw new ErrorIA("sin_llave", "gemini", "No hay GEMINI_API_KEY configurada.", false);

      try {
        const respuesta = await conReintento(
          () =>
            client.models.generateContent({
              model: modelo,
              contents: historialAContents(p.historial),
              config: {
                systemInstruction: p.sistema,
                abortSignal: p.signal,
                tools: p.herramientas.length
                  ? [{ functionDeclarations: p.herramientas.map(herramientaADeclaracion) }]
                  : undefined,
                ...(thinkingConfig ? { thinkingConfig } : {}),
              },
            }),
          { esReintentable, signal: p.signal },
        );

        const partes = respuesta.candidates?.[0]?.content?.parts ?? [];
        return {
          texto: respuesta.text ?? "",
          llamadas: extraerLlamadas(partes),
          uso: {
            entrada: respuesta.usageMetadata?.promptTokenCount ?? 0,
            salida: respuesta.usageMetadata?.candidatesTokenCount ?? 0,
            cacheados: respuesta.usageMetadata?.cachedContentTokenCount ?? 0,
          },
          modelo,
        };
      } catch (error) {
        throw categorizarError(error);
      }
    },

    async *turnoStream(p: PeticionChat): AsyncIterable<FragmentoChat> {
      const client = cliente();
      if (!client) throw new ErrorIA("sin_llave", "gemini", "No hay GEMINI_API_KEY configurada.", false);

      try {
        // Reintento SOLO en la apertura del stream (aún no salió ningún byte
        // al cliente). Un fallo DESPUÉS del primer chunk nunca se reintenta
        // aquí — eso duplicaría texto ya emitido; el consumidor (el motor de
        // conversación, o el propio caller) decide cómo mostrar ese error.
        const stream = await conReintento(
          () =>
            client.models.generateContentStream({
              model: modelo,
              contents: historialAContents(p.historial),
              config: {
                systemInstruction: p.sistema,
                abortSignal: p.signal,
                tools: p.herramientas.length
                  ? [{ functionDeclarations: p.herramientas.map(herramientaADeclaracion) }]
                  : undefined,
                ...(thinkingConfig ? { thinkingConfig } : {}),
              },
            }),
          { esReintentable, signal: p.signal },
        );

        let texto = "";
        // Si el modelo llama a más de una herramienta en el mismo turno,
        // cada functionCall puede llegar en un chunk de streaming distinto.
        // Se acumulan por nombre+args (no se sobreescribe el array completo
        // en cada chunk) para no perder una llamada anterior ni su
        // thoughtSignature — ese fue exactamente el bug: al sobreescribir,
        // Gemini rechazaba el turno siguiente por "missing thought_signature"
        // en la llamada que quedó pisada.
        const llamadasPorClave = new Map<string, LlamadaHerramienta>();
        let uso = { entrada: 0, salida: 0, cacheados: 0 };

        for await (const chunk of stream) {
          const delta = chunk.text ?? "";
          if (delta) {
            texto += delta;
            yield { tipo: "texto", delta };
          }
          const partes = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const llamada of extraerLlamadas(partes)) {
            const clave = llamada.id ?? `${llamada.nombre}:${JSON.stringify(llamada.args)}`;
            llamadasPorClave.set(clave, llamada);
          }
          if (chunk.usageMetadata) {
            uso = {
              entrada: chunk.usageMetadata.promptTokenCount ?? 0,
              salida: chunk.usageMetadata.candidatesTokenCount ?? 0,
              cacheados: chunk.usageMetadata.cachedContentTokenCount ?? 0,
            };
          }
        }

        yield { tipo: "fin", texto, llamadas: [...llamadasPorClave.values()], uso, modelo };
      } catch (error) {
        throw categorizarError(error);
      }
    },
  };
}
