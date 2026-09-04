import type { Herramienta } from "./tipos";
import { DENSIDADES, MEZCLAS, ROLES_ESCENA, ROLES_MATERIAL, TIPOS_ESTRUCTURA, UBICACIONES } from "@/lib/plan/tipos";
import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "@/lib/plan/composicion";

/**
 * Catálogo de herramientas en JSON Schema puro. El adaptador de Gemini las
 * traduce a su propio formato de cable (FunctionDeclaration) — este archivo
 * es la única fuente de verdad.
 *
 * Los enums de `estructuras[]` (tipo, rol_escena, ubicacion, densidad, mezcla,
 * rol_material) se toman de `@/lib/plan/tipos`, que a su vez los toma de
 * `@/lib/plan/composicion` (PLAN-COMPOSICION-RICA-V001.md §6.2): no se
 * mantiene una segunda lista manual de los mismos valores. Esto todavía
 * describe Plan 1.0 — `TIPOS_ESTRUCTURA`/`UBICACIONES` re-exportan a
 * propósito el subconjunto legado (sin `escultura` ni ubicaciones nuevas)
 * hasta que el planificador y `registro-herramientas.ts` sepan producir y
 * resolver Plan 1.1.
 */
export const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: "guardar_brief",
    descripcion: "Guarda o actualiza los datos del evento del cliente conforme los va mencionando.",
    esquema: {
      type: "object",
      properties: {
        tipo_evento: { type: "string", description: "boda, XV años, corporativo, bautizo…" },
        espacio: { type: "string", description: "jardín, salón, playa, terraza, hacienda…" },
        invitados: { type: "number", description: "número aproximado de invitados" },
        colores: {
          type: "array",
          items: { type: "string" },
          description: "paleta mencionada por el cliente, ej. ['tierra', 'blanco']",
        },
        estilo: {
          type: "string",
          description: "boho, rustico, clasico, minimalista, glamour, tropical",
        },
        momento_dia: { type: "string", description: "momento de la celebración: día, tarde, atardecer o noche" },
        fecha: { type: "string", description: "fecha o temporada del evento" },
        presupuesto: { type: ["number", "string"], description: "presupuesto aproximado en pesos; número si el cliente da una cifra, texto si da un rango (ej. '$100.000 a $200.000')" },
      },
    },
  },
  {
    nombre: "buscar_catalogo",
    descripcion:
      "Busca productos reales del catálogo de globos y fiesta de Sempertex (globos, guirnaldas, banderolas, velas, kits…). Es la única fuente válida de productos. El precio siempre es por paquete, no por pieza — la respuesta incluye las unidades por paquete al lado del precio: menciónalas si hablas de precio.",
    esquema: {
      type: "object",
      properties: {
        texto: {
          type: "string",
          description: "búsqueda libre, ej. 'globo corazón dorado'",
        },
        categorias: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "globo_latex",
              "globo_metalizado",
              "globo_numero_letra",
              "guirnalda_arco",
              "banderola_cartel",
              "vela",
              "desechable",
              "empaque",
              "complemento",
              "kit",
            ],
          },
          description: "Deja vacío para traer de todas las categorías.",
        },
        colores: {
          type: "array",
          items: { type: "string" },
          description: "dorado, plateado, rojo, azul, rosado, verde, blanco, negro, morado…",
        },
        ocasiones: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "cumpleanos",
              "boda",
              "baby_shower",
              "san_valentin",
              "dia_madre",
              "dia_padre",
              "dia_mujer",
              "navidad",
              "halloween",
              "graduacion",
              "xv_anos",
            ],
          },
        },
        formas: {
          type: "array",
          items: {
            type: "string",
            enum: ["redondo", "corazon", "link", "modelar"],
          },
          description:
            "forma física del globo (no el tamaño): redondo, corazon, link (Link-O-Loon®), modelar (para figuras). Úsalo cuando el cliente pida una forma sin decir un código exacto, ej. 'globos de corazón'. Para 'globos metalizados' usa categorias: globo_metalizado, no este filtro — metalizado es un acabado, no una forma.",
        },
        tamanos: {
          type: "array",
          items: { type: "string" },
          description: "código de tamaño tal cual lo usa el catálogo: R-5, R-9, R-12, R-18, R-24, 16 IN, 18 IN…",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Tags temáticos exactos del catálogo (no una lista fija, hay cientos) para personajes, franquicias o motivos que no son color/ocasión/categoría — ej. 'BARBIE', 'ANIMALES DE LA GRANJA', 'ARAÑAS', 'VIRGEN DEL CARMEN'. Cada producto que devuelve buscar_catalogo trae sus tags: úsalos para refinar una búsqueda siguiente en vez de adivinar la ortografía exacta.",
        },
        precio_max: {
          type: "number",
          description: "precio máximo por paquete en pesos colombianos",
        },
        solo_disponibles: { type: "boolean", default: true },
        limite: { type: "integer", default: 8, maximum: 20 },
      },
    },
  },
  {
    nombre: "consultar_disponibilidad",
    descripcion:
      "Revalida el stock de piezas ya recomendadas antes de confirmarle al cliente que puede pedirlas. Úsala si el cliente lleva varios turnos armando su selección.",
    esquema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "ids de las piezas del catálogo Shopify a revalidar",
        },
      },
    },
  },
  {
    nombre: "calcular_medidas",
    descripcion:
      "Calcula cuántos globos de cada tamaño se necesitan para una figura de medidas dadas (arco, guirnalda, columna, pared, centro de mesa). Úsala en cuanto el cliente mencione medidas o el tamaño del espacio, antes de cotizar. El resultado siempre viene marcado como estimado preliminar: dilo así, no como un número exacto garantizado.",
    esquema: {
      type: "object",
      required: ["figura"],
      properties: {
        figura: {
          type: "string",
          enum: [...TIPOS_ESTRUCTURA_GEOMETRICOS],
        },
        ancho_m: { type: "number" },
        alto_m: { type: "number" },
        largo_m: { type: "number", description: "solo guirnalda recta" },
        densidad: {
          type: "string",
          enum: [...DENSIDADES],
          default: "media",
        },
        colores: { type: "array", items: { type: "string" } },
        mezcla: {
          type: "string",
          enum: [...MEZCLAS],
          default: "organica_fina",
        },
      },
    },
  },
  {
    nombre: "cotizar",
    descripcion:
      "Convierte un despiece (de calcular_medidas, o de tamaños y cantidades que decida el cliente) en una cotización con referencias reales, paquetes cerrados y precio en pesos colombianos. El precio es siempre por paquete completo, nunca prorrateado — si sobran unidades del paquete, dilo explícitamente, no lo escondas.",
    esquema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["tamano", "cantidad"],
            properties: {
              tamano: { type: "string", description: "código tal cual lo usa el catálogo, ej. R-12" },
               color: { type: "string" },
               acabado: { type: "string", description: "solo si el cliente lo pidió explícitamente; no lo inventes desde el estilo" },
              cantidad: { type: "integer" },
            },
          },
        },
      },
    },
  },
  {
    nombre: "buscar_decoraciones",
    descripcion:
      "Busca decoraciones (paquetes curados de varias piezas) reales del catálogo. Es la única fuente válida de decoraciones.",
    esquema: {
      type: "object",
      properties: {
        estilos: {
          type: "array",
          items: { type: "string" },
          description:
            "boho, rustico, clasico, minimalista, glamour — opcional, deja vacío para ver todas",
        },
      },
    },
  },
  {
    nombre: "confirmar_seleccion_ia",
    descripcion:
      "Úsala cuando ya decidiste tú mismo qué piezas concretas usar para generarle la visualización al cliente, sin pedirle que elija nada. Los ids deben venir de resultados de buscar_catalogo o buscar_decoraciones de ESTE MISMO turno — no reuses ids de turnos anteriores, no los recuerdas. En cuanto la llames, la app genera la imagen automáticamente con esos ids, así que solo inclúyelos cuando tu elección ya sea definitiva para este turno. El cliente puede seguir viendo y tocando las tarjetas de producto en pantalla incluso después de esto, y puede agregar o quitar piezas a mano en cualquier momento — eso no te lo notifica la conversación, así que si más adelante te pide un ajuste, trátalo como una instrucción normal sobre la propuesta actual. Te devuelve 'piezas' (nombre, categoria, precio por paquete, unidades por paquete) y 'total_aproximado' — úsalos para darle al cliente un desglose real de la propuesta en tu respuesta, no solo un resumen vago. Si el cliente pide un ajuste sobre una imagen ya generada (ej. \"hazla de noche\", \"más velas\"), vuelve a llamarla con los ids que correspondan y describe el cambio en 'instruccion'.",
    esquema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "ids de producto (variante) ya vistos en resultados de este mismo turno",
        },
        instruccion: {
          type: "string",
          description: "ajuste en lenguaje natural sobre una imagen ya generada, si aplica",
        },
      },
    },
  },
];

/**
 * Herramientas del pipeline RAG (plan Fase 4) — aparte de HERRAMIENTAS a
 * propósito (G-02: en paralelo, sin tocar el flujo SQLite existente). Solo
 * se agregan a la conversación si RAG_ENABLED=true (ver ejecutar.ts).
 */
export const HERRAMIENTAS_RAG: Herramienta[] = [
  {
    nombre: "buscar_catalogo_rag",
    descripcion:
      "Busca productos reales del catálogo mediante retrieval híbrido (semántico + texto). Pásale el mensaje del cliente tal cual, o un resumen fiel de lo que busca — la interpretación de intención (filtros, presupuesto, colores, tamaño) ocurre internamente. Es la única fuente válida de productos cuando el modo RAG está activo: no menciones ningún producto que no haya aparecido en su respuesta. Cada llamada busca UN concepto — si el cliente (o una imagen de referencia) menciona varios elementos distintos (ej. globos + cortina de fondo + velas), llama esta herramienta una vez POR CADA elemento, no trates de meterlos todos en una sola búsqueda de globos. Cada variante trae 'tamano', 'diametro_pulgadas', 'forma' y, cuando existe evidencia, 'colores'. Si devuelve status 'AMBIGUOUS_SKU' o sku_status 'ambiguous', NO selecciones ni inventes una variante: pide al cliente que aclare el SKU exacto. Si el cliente pidió un tamaño, ya viene filtrado; si NO lo pidió y vas a usar calcular_medidas para una figura (arco/guirnalda/columna), no elijas una sola variante de tamaño a mano: usa 'usar_despiece' en confirmar_seleccion_rag para que el backend arme la mezcla real de tamaños.",
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
      "Confirma la selección final de productos. SOLO puedes usar product_id/variant_id que hayan aparecido en un resultado de buscar_catalogo_rag de ESTE MISMO turno — cualquier id inventado, recordado de otro turno o copiado mal se rechaza automáticamente en el backend, no se lo pases igual. NUNCA incluyas precio: el backend lo calcula desde la base de datos real y te lo devuelve en la respuesta junto con el desglose. Si ningún producto recuperado cumple lo que pide el cliente, no llames esta herramienta — dile que no encontraste algo que cumpla exactamente eso.\n\nCada ítem de 'seleccion' es UNO de dos tipos:\n1) Tamaño explícito: {product_id, variant_id, cantidad} — úsalo cuando el cliente pidió un tamaño concreto, o la pieza no tiene mezcla de tamaños que armar (backdrop, kit, vela, accesorio).\n2) Mezcla de tamaños: {product_id, usar_despiece: true, color?} — úsalo SOLO cuando llamaste calcular_medidas en este mismo turno para una figura (arco/guirnalda/columna/pared/centro de mesa) y el cliente NO pidió un tamaño específico. El backend arma la mezcla real de tamaños de ESE producto según el despiece geométrico — nunca elijas tú a mano una sola variante de tamaño para representar una figura completa. Si calculaste medidas con varios colores, manda un ítem 'usar_despiece' POR CADA color, con 'color' igual al que le pasaste a calcular_medidas. La respuesta trae 'sustituciones' (cuando un tamaño exacto no existía en ese color/producto y se usó el más cercano) y 'sin_cobertura' (tamaños del despiece que ese producto no puede cubrir en ninguna variante) — SIEMPRE díselas al cliente si vienen no vacías, nunca en silencio.",
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
              variant_id: { type: "string", description: "requerido salvo que uses usar_despiece" },
              cantidad: { type: "integer", description: "requerido salvo que uses usar_despiece (el backend calcula la cantidad de cada tamaño desde el despiece)" },
              usar_despiece: {
                type: "boolean",
                description: "true para que el backend arme la mezcla de tamaños de este producto desde el despiece de calcular_medidas, en vez de una sola variante elegida a mano.",
              },
              color: { type: "string", description: "solo con usar_despiece + calcular_medidas con varios colores: cuál color de esa mezcla representa este producto" },
              razon: { type: "string", description: "por qué elegiste esta pieza, en una frase" },
            },
          },
        },
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
              mezcla: { type: "string", enum: [...MEZCLAS] },
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
                    acabado: { type: "string", description: "solo si el cliente lo pidió explícitamente; no lo inventes desde el estilo" },
                    participacion: { type: "number", minimum: 0, maximum: 1 },
                    rol_material: { type: "string", enum: [...ROLES_MATERIAL] },
                  },
                },
              },
              porque: { type: "string" },
              referencia_element_id: { type: "string", description: "Si el cliente adjuntó una imagen de referencia (ver ANALISIS_REFERENCIA_VISUAL), el element_id (ej. REF_01_E01) que esta estructura materializa. Omite si esta estructura no viene de la referencia." },
            },
          },
        },
        referencia_omitida: {
          type: "array",
          maxItems: 40,
          description: "Elementos aprobados de ANALISIS_REFERENCIA_VISUAL que decides NO incluir en el plan. Usa fuera_de_catalogo solo cuando el alcance real de esa categoría sea fuera_de_catalogo; usa emulacion_propuesta para ofrecer una reinterpretación de una categoría emulable y explica propuesta. Junto con estructuras[].referencia_element_id debe cubrir todos los elementos aprobados.",
          items: {
            type: "object",
            required: ["element_id", "motivo", "motivo_tipo"],
            properties: {
              element_id: { type: "string" },
              motivo: { type: "string" },
              motivo_tipo: { type: "string", enum: ["fuera_de_catalogo", "emulacion_propuesta", "emulacion_rechazada", "decision_de_diseno"] },
              propuesta: { type: "string", description: "Obligatoria con motivo_tipo emulacion_propuesta; describe qué se construirá en lugar del elemento observado." },
            },
          },
        },
      },
    },
  },
];
