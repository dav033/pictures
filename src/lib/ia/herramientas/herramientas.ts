import type { Herramienta } from "../nucleo/tipos";
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
 * DISEÑO DE DECORACIÓN es el único modo: las cantidades y los tamaños de una
 * estructura los calcula `confirmar_plan_decoracion`, así que esta herramienta
 * no tiene despiece propio.
 */
const CONFIRMAR_SELECCION_RAG: Herramienta = {
  nombre: "confirmar_seleccion_rag",
  descripcion:
    "Confirma la selección final usando únicamente product_id y variant_id recuperados por buscar_catalogo_rag en este mismo turno. Nunca incluyas precio: el backend lo calcula desde PostgreSQL. Usa una variante explícita cuando el cliente pidió tamaño; en el modo DISEÑO DE DECORACIÓN no hay despiece: las cantidades y los tamaños de una estructura los calcula confirmar_plan_decoracion.",
  esquema: {
    type: "object",
    required: ["seleccion"],
    properties: {
      seleccion: {
        type: "array",
        items: {
          type: "object",
          required: ["product_id"],
          properties: { ...SELECCION_PROPIEDADES },
        },
      },
    },
  },
};

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
  CONFIRMAR_SELECCION_RAG,
];

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
              mezcla: { type: "string", enum: [...MEZCLAS], description: "organica_fina pide globos de 5, 9, 12, 18 y 24 pulgadas del mismo producto y color (organica_gruesa de 9 a 24, solo_grandes 18 y 24). Revisa diametro_pulgadas de las variantes: organica_fina necesita las 5 pulgadas exactas, al menos una de 9 o 12, y al menos una de 18 o 24 (si falta el 24 el backend lo sustituye por 18, si falta el 18 por 24 o 12 y si falta el 9 por 12, y lo avisa); un producto que solo tiene 5, 9 y 12 pulgadas (o solo 9 y 12) no cabe en organica_fina: usa clasica. Usa clasica también si el cliente pidió un único tamaño. Una estructura orgánica toda de 12 pulgadas se ve plana." },
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

/**
 * Ajusta la propuesta ya vigente en vez de diseñar una nueva (§7 "editar una
 * propuesta desde el chat"). Mismo esquema que `EdicionSchema`
 * (src/lib/plan/edicion-esquemas.ts), que es lo que de verdad valida los
 * argumentos en el handler — este JSON Schema solo guía al modelo, igual que
 * el resto de herramientas de este archivo describe requisitos condicionales
 * en texto en vez de en el esquema. Se registra aparte de `HERRAMIENTAS_PLAN`
 * porque `herramientasActivas()` solo la expone cuando `estado.planVigente`
 * existe: el modelo no puede convocarla por su cuenta sin evidencia firmada
 * de que hay algo que editar.
 */
export const AJUSTAR_PLAN_DECORACION: Herramienta = {
  nombre: "ajustar_plan_decoracion",
  descripcion:
    "Ajusta la propuesta YA vigente de este turno (agrega, reemplaza o quita un material de una sola estructura) en vez de diseñar una propuesta nueva. Solo existe cuando hay una propuesta vigente. Úsala cuando el cliente pide un cambio puntual sobre lo que ya vio (\"cambia el globo rosado por dorado\", \"quita la columna izquierda\", \"agrégale unos morados\"); usa confirmar_plan_decoracion solo si el cliente pide diseñar algo distinto desde cero. No llames esta herramienta y confirmar_plan_decoracion en el mismo turno: es una u otra. El product_id y variant_id de `variante` deben haber aparecido en buscar_catalogo_rag de este mismo turno, igual que en confirmar_plan_decoracion. Nunca mandes precios: el backend los recalcula. Devuelve el desglose actualizado que reemplaza al de la propuesta vigente.",
  esquema: {
    type: "object",
    required: ["accion", "estructura_id"],
    properties: {
      accion: {
        type: "string",
        enum: ["agregar", "reemplazar", "quitar"],
        description: "agregar: suma un material nuevo a la estructura con la participación indicada. reemplazar: cambia la variante objetivo (objetivo_variant_id) por la de `variante`. quitar: elimina la variante objetivo (no la uses si es el único material de la estructura).",
      },
      estructura_id: { type: "string", description: "estructura_id de la propuesta vigente que se va a tocar." },
      objetivo_variant_id: { type: "string", description: "Obligatorio en reemplazar y quitar: variant_id actual de la propuesta vigente que se reemplaza o elimina." },
      variante: {
        type: "object",
        description: "Obligatoria en agregar y reemplazar: la pieza nueva, recuperada con buscar_catalogo_rag en este mismo turno.",
        required: ["product_id", "variant_id"],
        properties: {
          product_id: { type: "string" },
          variant_id: { type: "string" },
          color: { type: "string" },
          acabado: { type: "string" },
        },
      },
      participacion: { type: "number", minimum: 0.01, maximum: 0.8, description: "Solo para agregar: fracción de la estructura que ocupa el material nuevo (0,01 a 0,8). Si no la mandas, el sistema usa 0,2." },
    },
  },
};
