import type { Herramienta } from "./tipos";
import { DENSIDADES, MEZCLAS, ROLES_ESCENA, ROLES_MATERIAL, TIPOS_ESTRUCTURA, UBICACIONES } from "@/lib/plan/tipos";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";

/**
 * Registro único de herramientas expuestas al pipeline RAG y al planificador.
 * Los enums de estructuras provienen de los contratos del plan.
 */
export const HERRAMIENTAS_RAG: Herramienta[] = [
  {
    nombre: "guardar_brief",
    descripcion: "Guarda o actualiza datos del evento que el cliente acaba de mencionar.",
    esquema: {
      type: "object",
      properties: {
        tipo_evento: { type: "string" },
        espacio: { type: "string" },
        invitados: { type: "number" },
        colores: { type: "array", items: { type: "string" } },
        estilo: { type: "string" },
        momento_dia: { type: "string" },
        fecha: { type: "string" },
        presupuesto: { type: ["number", "string"] },
      },
    },
  },
  {
    nombre: "buscar_catalogo_rag",
    descripcion:
      "Busca productos reales del catálogo mediante retrieval híbrido (semántico + texto). Pásale el mensaje del cliente tal cual, o un resumen fiel de qué está buscando. La interpretación de intención ocurre internamente. Es la única fuente válida de productos: no menciones ningún producto que no haya aparecido en su respuesta. Cada llamada busca un concepto; si hay varios elementos distintos, llama una vez por cada elemento. Si devuelve status 'AMBIGUOUS_SKU' o sku_status 'ambiguous', no selecciones ni inventes una variante: pregúntale al cliente cuál presentación o color quiere, describiendo las opciones con palabras (nunca con SKU ni códigos).",
    esquema: {
      type: "object",
      required: ["mensaje"],
      properties: {
        mensaje: { type: "string", description: "mensaje del cliente o resumen fiel de qué está buscando" },
      },
    },
  },
  {
    nombre: "confirmar_seleccion_rag",
    descripcion:
      "Confirma la selección final usando únicamente product_id y variant_id recuperados por buscar_catalogo_rag en este mismo turno. Nunca incluyas precio: el backend lo calcula desde PostgreSQL. Usa una variante explícita cuando el cliente pidió tamaño; usa usar_despiece únicamente después de calcular_medidas cuando el cliente no pidió tamaño específico.",
    esquema: {
      type: "object",
      required: ["seleccion"],
      properties: {
        seleccion: {
          type: "array",
          items: {
            type: "object",
            required: ["product_id"],
            properties: {
              product_id: { type: "string" },
              variant_id: { type: "string" },
              cantidad: { type: "integer" },
              usar_despiece: { type: "boolean" },
              color: { type: "string" },
              razon: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    nombre: "calcular_medidas",
    descripcion: "Calcula un despiece físico preliminar para una estructura de decoración. El backend usa estas cantidades para resolver tamaños reales del catálogo; nunca inventes cantidades ni precios.",
    esquema: {
      type: "object",
      required: ["figura"],
      properties: {
        figura: { type: "string", enum: ["arco", "guirnalda", "columna", "pared", "centro_mesa"] },
        ancho_m: { type: "number" },
        alto_m: { type: "number" },
        largo_m: { type: "number" },
        densidad: { type: "string", enum: [...DENSIDADES], default: "media" },
        colores: { type: "array", items: { type: "string" } },
        mezcla: { type: "string", enum: [...MEZCLAS], default: "organica_fina" },
      },
    },
  },
];

export const HERRAMIENTAS_PLAN: Herramienta[] = [
  {
    nombre: "confirmar_plan_decoracion",
    descripcion: "Confirma el diseño completo: estructuras, ubicación, productos y colores. No mandes tamaños, cantidades de globos ni precios; el backend los calcula desde la geometría y el catálogo real. Cada product_id debe haber aparecido en buscar_catalogo_rag de este turno. Es la última herramienta del turno y devuelve el desglose que se muestra antes de generar la imagen.",
    esquema: {
      type: "object",
      required: ["concepto", "espacio", "estructuras"],
      properties: {
        concepto: {
          type: "object",
          required: ["titulo", "descripcion", "paleta"],
          properties: {
            titulo: { type: "string" },
            descripcion: { type: "string" },
            paleta: { type: "array", items: { type: "string" } },
            estilo: { type: "string" },
            ocasion: { type: "string" },
            momento_dia: { type: "string" },
          },
        },
        espacio: {
          type: "object",
          required: ["tipo", "fuente"],
          properties: {
            tipo: { type: "string" },
            ancho_m: { type: "number" },
            alto_m: { type: "number" },
            largo_m: { type: "number" },
            fuente: { type: "string", enum: ["cliente", "supuesto", "foto"] },
          },
        },
        estructuras: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            required: ["estructura_id", "nombre", "tipo", "rol_escena", "ubicacion", "medidas", "densidad", "mezcla", "materiales", "porque"],
            properties: {
              estructura_id: { type: "string", description: "EST_01_ARCO, EST_02_COLUMNAS..." },
              nombre: { type: "string" },
              tipo: { type: "string", enum: [...TIPOS_ESTRUCTURA] },
              rol_escena: { type: "string", enum: [...ROLES_ESCENA] },
              ubicacion: { type: "string", enum: [...UBICACIONES] },
              medidas: { type: "object", properties: { ancho_m: { type: "number" }, alto_m: { type: "number" }, largo_m: { type: "number" } } },
              repeticiones: { type: "integer", minimum: 1, maximum: 24 },
              densidad: { type: "string", enum: [...DENSIDADES] },
              mezcla: { type: "string", enum: [...MEZCLAS], description: "organica_fina pide globos de 5, 9, 12, 18 y 24 pulgadas del mismo producto y color (organica_gruesa de 9 a 24, solo_grandes 18 y 24). Revisa diametro_pulgadas de las variantes: si el producto tiene 5, 9 y 12 pulgadas usa organica_fina aunque falten 18 o 24 (el backend los sustituye por el tamaño más cercano y lo avisa); usa clasica solo si el producto tiene únicamente 12 pulgadas o el cliente pidió un único tamaño. Una estructura orgánica toda de 12 pulgadas se ve plana." },
              unidades_declaradas: { type: "integer", minimum: 1 },
              materiales: {
                type: "array",
                minItems: 1,
                maxItems: 6,
                items: {
                  type: "object",
                  required: ["product_id", "participacion", "rol_material"],
                  properties: {
                    product_id: { type: "string" },
                    variant_id: { type: "string", description: "Solo para backdrop, kit o accesorio; no mandes tamaños para estructuras de globos." },
                    color: { type: "string" },
                    acabado: { type: "string", description: "solo si el cliente lo pidió explícitamente o la imagen de referencia lo muestra (cromado = reflex); no lo inventes desde el estilo" },
                    participacion: { type: "number", minimum: 0, maximum: 1 },
                    rol_material: { type: "string", enum: [...ROLES_MATERIAL] },
                  },
                },
              },
              porque: { type: "string" },
              referencia_element_id: { type: "string", description: "Elemento REF de una imagen de referencia que esta estructura materializa." },
              estructura_oficial: { type: "string", enum: [...ESTRUCTURAS_OFICIALES_IDS], description: "Estructura oficial que materializa; debe ser coherente con tipo, densidad y ubicación (ver ESTRUCTURAS OFICIALES)." },
            },
          },
        },
        referencia_omitida: {
          type: "array",
          maxItems: 40,
          description: "Elementos aprobados de una referencia que decides no incluir; declara siempre el motivo.",
          items: {
            type: "object",
            required: ["element_id", "motivo", "motivo_tipo"],
            properties: {
              element_id: { type: "string" },
              motivo: { type: "string" },
              motivo_tipo: { type: "string", enum: ["fuera_de_catalogo", "emulacion_propuesta", "emulacion_rechazada", "decision_de_diseno"] },
              propuesta: { type: "string", description: "Obligatoria con motivo_tipo emulacion_propuesta." },
            },
          },
        },
      },
    },
  },
];
