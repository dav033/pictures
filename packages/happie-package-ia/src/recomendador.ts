import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import type { HappiaPackage } from "./tipos";

const MODELO_POR_DEFECTO = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";

const RecomendacionSchema = z.object({
  packageId: z.string(),
  razon: z.string(),
});

/** Esquema e instrucción dependen de `maxRecomendaciones`: los endpoints de
 * 3 y de 1 recomendación reutilizan el mismo motor, solo cambia este límite. */
function construirSchema(maxRecomendaciones: number) {
  const schema = z.object({
    recomendaciones: z.array(RecomendacionSchema).max(maxRecomendaciones),
    resumen: z.string(),
  });
  return { schema, jsonSchema: z.toJSONSchema(schema, { target: "draft-7" }) };
}

function construirInstruccion(maxRecomendaciones: number): string {
  const reglaCantidad =
    maxRecomendaciones <= 1
      ? "Elige exactamente 1 paquete: el que mejor encaje con la descripción del cliente."
      : `Elige entre 1 y ${maxRecomendaciones} paquetes que mejor encajen con la descripción del cliente, ordenados de más a menos relevante.`;

  return `Recomiendas paquetes de eventos a partir de la descripción libre de un cliente.
Recibes una descripción del evento y una lista de paquetes disponibles, cada uno con su nombre,
condiciones, restricciones, cantidad de invitados base, duración, precio total estimado y los ítems
que incluye.

Reglas:
- ${reglaCantidad}
- Usa exclusivamente los "id" de la lista recibida; nunca inventes un id.
- Cada recomendación lleva una razón breve (una frase) basada en datos reales del paquete.
- El resumen es una frase general dirigida al cliente.
- Si la descripción menciona un presupuesto, compáralo contra el "precio_total" de cada paquete;
  si el mejor candidato lo excede, dilo con honestidad en su razón.
- Si la descripción menciona servicios específicos que el cliente necesita, prioriza paquetes que
  los cubran y no tengas en cuenta ningún servicio que no se haya mencionado.
- Si la descripción menciona preferencias específicas del cliente (colores, temática, materiales,
  restricciones, etc.), tenlas en cuenta al elegir y di en la razón si un paquete las cumple o no.
- Si ningún paquete encaja razonablemente, devuelve un arreglo vacío y explica por qué en el resumen.`;
}

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
  /** Cuántas recomendaciones como máximo debe devolver la IA (por defecto 3). */
  maxRecomendaciones?: number;
  apiKey?: string;
  modelo?: string;
  signal?: AbortSignal;
}

function precioTotalPaquete(paquete: HappiaPackage): number {
  return paquete.package_items
    .filter((item) => item.is_active)
    .reduce((suma, item) => suma + item.total, 0);
}

function paqueteAContexto(paquete: HappiaPackage) {
  return {
    id: paquete.id,
    nombre: paquete.name,
    invitados_base: paquete.base_guests,
    duracion_minutos: paquete.standard_duration_minutes,
    precio_total: precioTotalPaquete(paquete),
    condiciones: paquete.conditions,
    restricciones: paquete.restrictions,
    items: paquete.package_items.filter((item) => item.is_active).map((item) => ({
      descripcion: item.description,
      categoria: item.category_name,
    })),
  };
}

export async function recomendarPaquetes(input: RecomendarPaquetesInput): Promise<RecomendacionResultado> {
  input.signal?.throwIfAborted();
  const apiKey = input.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta GEMINI_API_KEY (o apiKey) para generar recomendaciones.");
  }
  const paquetesActivos = input.paquetes.filter((p) => p.is_active);
  if (paquetesActivos.length === 0) {
    return { recomendaciones: [], resumen: "No hay paquetes activos disponibles en este momento." };
  }

  const maxRecomendaciones = input.maxRecomendaciones ?? 3;
  const { schema, jsonSchema } = construirSchema(maxRecomendaciones);

  const client = new GoogleGenAI({ apiKey });
  const contenido = JSON.stringify(paquetesActivos.map(paqueteAContexto));
  const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(25_000)]);

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
      // `signal` combina el del caller con un timeout propio de 25 s, así que
      // sustituye al `input.signal` que se pasaba suelto: cubre también el caso
      // en que el caller no cancele nunca.
      abortSignal: signal,
      httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } },
      systemInstruction: construirInstruccion(maxRecomendaciones),
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  }).catch((error: unknown) => {
    signal.throwIfAborted();
    throw error;
  });
  signal.throwIfAborted();

  const texto = respuesta.text;
  if (!texto) {
    throw new Error("Respuesta vacia del proveedor.");
  }

  const cruda = schema.parse(JSON.parse(texto));
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
  maxRecomendaciones?: number;
  apiKey?: string;
  modelo?: string;
  signal?: AbortSignal;
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
    maxRecomendaciones: input.maxRecomendaciones,
    apiKey: input.apiKey,
    modelo: input.modelo,
    signal: input.signal,
  });
}

/** Servicios que el cliente puede marcar como necesarios para el evento.
 * Un valor en `false` (o ausente) no es una prohibición: simplemente ese
 * servicio no se menciona en la descripción que recibe la IA, así que no
 * puede tenerlo en cuenta ni exigirlo — se ignora por completo. */
export interface ServiciosSolicitados {
  comida?: boolean;
  bebida?: boolean;
  decoracion?: boolean;
  fotografia?: boolean;
}

const ETIQUETAS_SERVICIO: Record<keyof ServiciosSolicitados, string> = {
  comida: "Comida",
  bebida: "Bebidas",
  decoracion: "Decoración",
  fotografia: "Fotografía",
};

function serviciosRequeridos(servicios?: ServiciosSolicitados): string[] {
  if (!servicios) return [];
  return (Object.keys(ETIQUETAS_SERVICIO) as (keyof ServiciosSolicitados)[])
    .filter((clave) => servicios[clave] === true)
    .map((clave) => ETIQUETAS_SERVICIO[clave]);
}

export interface RecomendarPaquetesConFiltrosInput {
  tipoEvento: string;
  invitados: number;
  presupuesto: number;
  /** Solo los servicios en `true` viajan a la IA; el resto se ignora. */
  servicios?: ServiciosSolicitados;
  /** Preferencias libres del cliente (ej. "colores pastel", "sin globos
   * metálicos", "temática vintage"). Viajan tal cual al prompt como
   * contexto adicional para que la IA las tenga en cuenta al elegir y al
   * redactar la razón — no filtran el catálogo de forma determinista. */
  preferencias?: string[];
  paquetes: HappiaPackage[];
  /** false cuando ningún paquete está categorizado exactamente como
   * `tipoEvento` — mismo criterio que en `recomendarPaquetesEstructurado`. */
  coincidenciaExacta?: boolean;
  maxRecomendaciones?: number;
  apiKey?: string;
  modelo?: string;
  signal?: AbortSignal;
}

/**
 * Puente hacia el mismo motor de recomendación, para el flujo con filtros
 * estructurados: tipo de evento, invitados, presupuesto y servicios
 * booleanos (comida/bebida/decoración/fotografía). Cada servicio en `false`
 * o ausente simplemente no aparece en la descripción — la IA nunca se
 * entera de que esa opción existió, así que no puede penalizar ni exigirla.
 */
export function recomendarPaquetesConFiltros(
  input: RecomendarPaquetesConFiltrosInput,
): Promise<RecomendacionResultado> {
  const necesarios = serviciosRequeridos(input.servicios);

  const notaSinCategoria =
    input.coincidenciaExacta === false
      ? ` El catálogo no tiene ningún paquete categorizado exactamente como "${input.tipoEvento}" — antes de rendirte, revisa si alguno encaja por su temática, colores o elementos aunque esté pensado para otro tipo de evento, y explica esa adaptación en la razón. Si de verdad ninguno aplica, dilo con honestidad.`
      : "";
  const notaServicios = necesarios.length
    ? ` El cliente necesita específicamente: ${necesarios.join(", ")}. Prioriza paquetes que lo cubran; si alguno de los recomendados no cubre algo de esto, dilo en su razón en vez de omitirlo. No tengas en cuenta ningún otro servicio: solo estos.`
    : "";
  const notaPreferencias = input.preferencias?.length
    ? ` El cliente además tiene estas preferencias específicas: ${input.preferencias.join(", ")}. Tenlas en cuenta al elegir y di en la razón si un paquete las cumple o no.`
    : "";

  const descripcionEvento = `Tipo de evento: ${input.tipoEvento}. Cantidad de invitados: ${input.invitados}. Presupuesto disponible: $${input.presupuesto}.${notaSinCategoria}${notaServicios}${notaPreferencias}`;

  return recomendarPaquetes({
    descripcionEvento,
    paquetes: input.paquetes,
    maxRecomendaciones: input.maxRecomendaciones,
    apiKey: input.apiKey,
    modelo: input.modelo,
    signal: input.signal,
  });
}
