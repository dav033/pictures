import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import type { HappiaPackage } from "./tipos";

const MODELO_POR_DEFECTO = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";

const RecomendacionSchema = z.object({
  packageId: z.string(),
  razon: z.string(),
});

const RespuestaIASchema = z.object({
  recomendaciones: z.array(RecomendacionSchema).max(5),
  resumen: z.string(),
});

const JSON_SCHEMA = z.toJSONSchema(RespuestaIASchema, { target: "draft-7" });

const INSTRUCCION = `Recomiendas paquetes de eventos a partir de la descripción libre de un cliente.
Recibes una descripción del evento y una lista de paquetes disponibles, cada uno con su nombre,
condiciones, restricciones, cantidad de invitados base, duración y los ítems que incluye.

Reglas:
- Elige entre 1 y 3 paquetes que mejor encajen con la descripción del cliente.
- Usa exclusivamente los "id" de la lista recibida; nunca inventes un id.
- Ordena de más a menos relevante.
- Cada recomendación lleva una razón breve (una frase) basada en datos reales del paquete.
- El resumen es una frase general dirigida al cliente.
- Si ningún paquete encaja razonablemente, devuelve un arreglo vacío y explica por qué en el resumen.`;

export interface Recomendacion {
  paquete: HappiaPackage;
  razon: string;
}

export interface RecomendacionResultado {
  recomendaciones: Recomendacion[];
  resumen: string;
}

export interface RecomendarPaquetesInput {
  descripcionEvento: string;
  paquetes: HappiaPackage[];
  apiKey?: string;
  modelo?: string;
}

function paqueteAContexto(paquete: HappiaPackage) {
  return {
    id: paquete.id,
    nombre: paquete.name,
    invitados_base: paquete.base_guests,
    duracion_minutos: paquete.standard_duration_minutes,
    condiciones: paquete.conditions,
    restricciones: paquete.restrictions,
    items: paquete.package_items.map((item) => ({
      descripcion: item.description,
      categoria: item.category_name,
    })),
  };
}

export async function recomendarPaquetes(input: RecomendarPaquetesInput): Promise<RecomendacionResultado> {
  const apiKey = input.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta GEMINI_API_KEY (o apiKey) para generar recomendaciones.");
  }
  const paquetesActivos = input.paquetes.filter((p) => p.is_active);
  if (paquetesActivos.length === 0) {
    return { recomendaciones: [], resumen: "No hay paquetes activos disponibles en este momento." };
  }

  const client = new GoogleGenAI({ apiKey });
  const contenido = JSON.stringify(paquetesActivos.map(paqueteAContexto));

  const respuesta = await client.models.generateContent({
    model: input.modelo ?? MODELO_POR_DEFECTO,
    contents: [
      {
        role: "user",
        parts: [
          { text: `Descripción del cliente: ${input.descripcionEvento}` },
          { text: `Paquetes disponibles (JSON): ${contenido}` },
        ],
      },
    ],
    config: {
      systemInstruction: INSTRUCCION,
      responseMimeType: "application/json",
      responseJsonSchema: JSON_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  });

  const texto = respuesta.text;
  if (!texto) {
    return { recomendaciones: [], resumen: "No se pudo generar una recomendación en este momento." };
  }

  const cruda = RespuestaIASchema.parse(JSON.parse(texto));
  const porId = new Map(paquetesActivos.map((p) => [p.id, p]));

  const recomendaciones: Recomendacion[] = cruda.recomendaciones
    .map((r) => {
      const paquete = porId.get(r.packageId);
      return paquete ? { paquete, razon: r.razon } : null;
    })
    .filter((r): r is Recomendacion => r !== null);

  return { recomendaciones, resumen: cruda.resumen };
}

export interface RecomendarPaquetesEstructuradoInput {
  tipoEvento: string;
  invitados: number;
  ubicacion: string;
  paquetes: HappiaPackage[];
  /** false cuando ningún paquete está categorizado exactamente como
   * `tipoEvento` y se le pasó el catálogo activo completo — le pide al LLM
   * que igual busque algo que encaje por temática antes de rendirse. */
  coincidenciaExacta?: boolean;
  /** Servicios que el cliente marcó como necesarios (ej. "Comida",
   * "Mobiliario"). Hoy solo viaja como contexto para que el LLM lo tenga en
   * cuenta al razonar y lo mencione en la razón/resumen si un paquete no lo
   * cubre — la base para filtrar o puntuar por esto en un feature futuro. */
  necesidades?: string[];
  apiKey?: string;
  modelo?: string;
}

/**
 * Puente del flujo por pasos hacia el mismo motor de recomendación: la
 * selección de tipo/invitados/ubicación ya se resolvió de forma determinista
 * (sin LLM) antes de llegar aquí — esto solo la convierte en una descripción
 * de una frase y reutiliza `recomendarPaquetes` para no duplicar prompt,
 * schema ni la lógica anti-alucinación de ids.
 */
export function recomendarPaquetesEstructurado(
  input: RecomendarPaquetesEstructuradoInput,
): Promise<RecomendacionResultado> {
  const notaSinCategoria =
    input.coincidenciaExacta === false
      ? ` El catálogo no tiene ningún paquete categorizado exactamente como "${input.tipoEvento}" — antes de rendirte, revisa si alguno encaja por su temática, colores o elementos aunque esté pensado para otro tipo de evento, y explica esa adaptación en la razón. Si de verdad ninguno aplica, dilo con honestidad.`
      : "";
  const notaNecesidades = input.necesidades?.length
    ? ` El cliente además necesita: ${input.necesidades.join(", ")}. Prioriza paquetes que lo cubran; si alguno de los recomendados no cubre algo de esto, dilo en su razón en vez de omitirlo.`
    : "";
  const descripcionEvento = `Tipo de evento: ${input.tipoEvento}. Cantidad de invitados: ${input.invitados}. Ubicación del evento: ${input.ubicacion}.${notaSinCategoria}${notaNecesidades}`;
  return recomendarPaquetes({
    descripcionEvento,
    paquetes: input.paquetes,
    apiKey: input.apiKey,
    modelo: input.modelo,
  });
}
