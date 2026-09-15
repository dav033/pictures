import type { Herramienta } from "./tipos";
import { DENSIDADES, MEZCLAS, ROLES_ESCENA, ROLES_MATERIAL, TIPOS_ESTRUCTURA, UBICACIONES } from "@/lib/plan/tipos";
import { EJEMPLO_UNIDADES_DECLARADAS, ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";

const SELECCION_PROPIEDADES = {
  product_id: { type: "string" },
  variant_id: { type: "string" },
  cantidad: { type: "integer" },
  color: { type: "string" },
  razon: { type: "string" },
} as const;

/**
 * `confirmar_seleccion_rag` cambia con el modo porque el despiece legacy sale
 * de `calcular_medidas`, y en DISEÑO DE DECORACIÓN esa herramienta no se expone
 * (`herramientasActivas`): allí `usar_despiece` solo podía terminar en el
 * rechazo "usar_despiece sin haber llamado calcular_medidas en este turno", que
 * el modelo no puede corregir. En ese modo el campo no existe y la descripción
 * manda las cantidades a confirmar_plan_decoracion.
 */
function confirmarSeleccionRag(conDespiece: boolean): Herramienta {
  return {
    nombre: "confirmar_seleccion_rag",
    descripcion:
      "Confirma la selección final usando únicamente product_id y variant_id recuperados por buscar_catalogo_rag en este mismo turno. Nunca incluyas precio: el backend lo calcula desde PostgreSQL. Usa una variante explícita cuando el cliente pidió tamaño; " +
      (conDespiece
        ? "usa usar_despiece únicamente después de calcular_medidas cuando el cliente no pidió tamaño específico."
        : "en el modo DISEÑO DE DECORACIÓN no hay despiece: las cantidades y los tamaños de una estructura los calcula confirmar_plan_decoracion."),
    esquema: {
      type: "object",
      required: ["seleccion"],
      properties: {
        seleccion: {
          type: "array",
          items: {
            type: "object",
            required: ["product_id"],
            properties: conDespiece
              ? { ...SELECCION_PROPIEDADES, usar_despiece: { type: "boolean" } }
              : { ...SELECCION_PROPIEDADES },
          },
        },
      },
    },
  };
}

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
  confirmarSeleccionRag(true),
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

/**
 * Las mismas herramientas RAG como las ve el modo DISEÑO DE DECORACIÓN: sin
 * `calcular_medidas` (sus cantidades contradicen las que cotiza el plan) y sin
 * el camino de despiece que dependía de ella.
 */
export const HERRAMIENTAS_RAG_MODO_PLAN: Herramienta[] = HERRAMIENTAS_RAG
  .filter((herramienta) => herramienta.nombre !== "calcular_medidas")
  .map((herramienta) => (herramienta.nombre === "confirmar_seleccion_rag" ? confirmarSeleccionRag(false) : herramienta));

export const HERRAMIENTAS_PLAN: Herramienta[] = [
  {
    nombre: "confirmar_plan_decoracion",
    descripcion: "Confirma el diseño completo: estructuras, ubicación, productos y colores. Nunca mandes precios. En las estructuras con geometría (arco, semiarco, guirnalda, columna, pared, centro_mesa) no mandes variant_id, tamaños ni cantidades de globos: el backend los calcula desde la geometría y el catálogo real; las piezas sin geometría (bouquet, figura, kit, backdrop, accesorio) sí llevan variant_id por material y unidades_declaradas. Cada product_id debe haber aparecido en buscar_catalogo_rag de este turno. Es la última herramienta del turno y devuelve el desglose que se muestra antes de generar la imagen.",
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
            fuente: { type: "string", enum: ["cliente", "supuesto", "foto"], description: "cliente: el cliente dio el tipo o las medidas. foto: solo el TIPO de espacio se vio en una foto; nunca uses foto para medidas. No mandes ancho_m, alto_m ni largo_m del espacio si el cliente no las dio: no se miden desde una foto." },
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
              repeticiones: { type: "integer", minimum: 1, maximum: 24, description: "Número de piezas iguales de esta estructura (el número de piezas que muestra la referencia, ej. 2 columnas). No es un número de globos." },
              densidad: { type: "string", enum: [...DENSIDADES] },
              mezcla: { type: "string", enum: [...MEZCLAS], description: "organica_fina pide globos de 5, 9, 12, 18 y 24 pulgadas del mismo producto y color (organica_gruesa de 9 a 24, solo_grandes 18 y 24). Revisa diametro_pulgadas de las variantes: organica_fina necesita las 5 pulgadas exactas y al menos una de 18 o 24 (si falta el 24 el backend lo sustituye por 18, si falta el 18 por 24 o 12 y si falta el 9 por 12, y lo avisa); un producto que solo tiene 5, 9 y 12 pulgadas (o solo 9 y 12) no cabe en organica_fina: usa clasica. Usa clasica también si el cliente pidió un único tamaño. Una estructura orgánica toda de 12 pulgadas se ve plana." },
              unidades_declaradas: { type: "integer", minimum: 1, description: `Solo para piezas sin geometría (bouquet, figura, kit, backdrop, accesorio). Son unidades de venta del catálogo para la pieza completa, sumando todas sus repeticiones: si la pieza se arma con globos sueltos, es el total de GLOBOS (no el número de figuras ni de bouquets); si el material es un kit empaquetado, un telón o un accesorio, es el número de piezas. Se reparte entre los materiales según participacion y cada material recibe al menos 1, así que nunca declares menos unidades que materiales. Mínimos: ${EJEMPLO_UNIDADES_DECLARADAS}.` },
              materiales: {
                type: "array",
                minItems: 1,
                maxItems: 6,
                items: {
                  type: "object",
                  required: ["product_id", "participacion", "rol_material"],
                  properties: {
                    product_id: { type: "string" },
                    variant_id: { type: "string", description: "Obligatorio en las piezas sin geometría (bouquet, figura, kit, backdrop, accesorio), una variante por material. En las estructuras con geometría (arco, semiarco, guirnalda, columna, pared, centro_mesa) no lo mandes: el tamaño lo resuelve el backend." },
                    color: { type: "string" },
                    acabado: { type: "string", description: "solo si el cliente lo pidió explícitamente o la imagen de referencia lo muestra (cromado = reflex); no lo inventes desde el estilo" },
                    participacion: { type: "number", minimum: 0, maximum: 1, description: "Fracción de los globos de esta estructura que va en este material. Todas las participaciones de una estructura suman exactamente 1: usa décimas o veinteavos (0,5 / 0,3 / 0,2, o 0,4 / 0,35 / 0,25), nunca 0,33 tres veces." },
                    rol_material: { type: "string", enum: [...ROLES_MATERIAL], description: "principal = el material con mayor participacion (uno solo por estructura); secundario = el que acompaña; acento = una participación pequeña." },
                  },
                },
              },
              porque: { type: "string", description: "Una frase corta para el cliente, en español y sin jerga, sobre para qué sirve la pieza en su evento (ej.: \"Enmarca la mesa del pastel\"). No menciones la imagen de referencia ni la foto analizada, identificadores ni verbos técnicos como \"materializa\"." },
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
