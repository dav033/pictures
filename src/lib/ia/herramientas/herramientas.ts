import type { Herramienta } from "../nucleo/tipos";
import { DENSIDADES, MEZCLAS, ROLES_ESCENA, ROLES_MATERIAL, TIPOS_ESTRUCTURA, UBICACIONES } from "@/lib/plan/tipos";
import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "@/lib/plan/composicion";
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
 * Las herramientas del motor del diseñador (ADR-0034 §5), detrás de
 * `ARMADO_ARCO_COLUMNA_V1`. Hasta ahora el chat no tenía ningún mando de
 * armado: el patrón lo ponía el servidor desde la foto o desde un preset.
 * Estas dos le dan al modelo lo mismo que usa el diseñador.
 *
 * `consultar_opciones_armado` es una **consulta**: devuelve lo que el motor
 * admite para ese tipo de pieza —los catorce patrones del arco, los nueve de
 * la columna, o los acabados, repartos y papeles de la guirnalda orgánica—,
 * sacado de su propio `opciones_admitidas()`, para que el modelo no tenga que
 * adivinar un nombre ni un rango. Si allá se añade un patrón o un acabado,
 * aquí se ve sin tocar nada, así que esas listas **no** se repiten ni en la
 * descripción ni en el esquema.
 *
 * `armar_estructura` prueba un armado concreto. Lo valida la puerta de Python
 * sobre el motor migrado y, si se sostiene, devuelve lo que la pieza lleva de
 * verdad —globos, conteo por material y compra— con sus avisos; si no, el
 * motivo. No escribe nada en el plan: el armado que quedó validado lo guarda
 * el servidor y lo pone en la pieza al confirmar.
 *
 * **La guirnalda no tiene patrón**, y eso cambia qué se le pide: lo que la
 * define es su línea (largo, altura, ondulación, festones), su volumen, su
 * mezcla de tamaños y una paleta donde cada color lleva su acabado y su papel.
 * Las condiciones por tipo van en texto y no en el esquema, como el resto de
 * este archivo: el proveedor no respeta un `oneOf` por rama.
 */
const TIPO_CON_MOTOR = {
  type: "string",
  enum: ["arco", "columna", "guirnalda"],
  description: "arco: una banda de globos sobre una línea guía. columna: una pila de anillos. guirnalda: una tira larga y orgánica de globos de varios tamaños, con ondulación y follaje. Son los tres tipos con motor; el resto de las piezas no se arma con esta herramienta.",
} as const;

/** Los seis tamaños nominales del catálogo. Los fija el contrato del plan, no una lista que el motor amplíe. */
const TAMANO_NOMINAL = { type: "integer", enum: [5, 9, 12, 18, 24, 36] } as const;

export const CONSULTAR_OPCIONES_ARMADO: Herramienta = {
  nombre: "consultar_opciones_armado",
  descripcion:
    "Devuelve el catálogo de armado del tipo de pieza que preguntes, tal como lo publica el motor del diseñador. En un arco o una columna: cada patrón con su id, su nombre, qué hace, cuántos colores admite (mínimo y máximo), qué papel juega cada color cuando lo tiene (Centro, Pétalos, Punto…) y cada mando con su clave, su rango, su paso, su valor por defecto y su ayuda; además las formas de la línea guía, los tamaños de globo y los anchos y altos admitidos. En una guirnalda no hay patrones: devuelve los acabados del látex (cada uno con su nombre), los repartos de color con su ayuda, los papeles que puede tener un color y los rangos de largo, grosor y altura. Consúltala ANTES de llamar armar_estructura: los ids de patrón, los acabados, los repartos y las claves de los mandos salen de aquí, nunca de tu memoria. No tiene efecto: no toca el plan ni el catálogo de productos.",
  esquema: {
    type: "object",
    required: ["tipo"],
    properties: { tipo: { ...TIPO_CON_MOTOR } },
  },
};

export const ARMAR_ESTRUCTURA: Herramienta = {
  nombre: "armar_estructura",
  descripcion:
    "Arma un arco, una columna o una guirnalda con el motor del diseñador y te dice si se sostiene. Pásale siempre la pieza (estructura_id, tipo y cuántos colores va a llevar). En un ARCO o una COLUMNA manda además el patrón y los índices de material que usa, y si quieres sus mandos (opciones) y ajustes de geometría. En una GUIRNALDA no hay patrón: manda la paleta (un color por material, cada uno con su acabado y su papel) y, si quieres, el reparto, la forma de la tira, el volumen, la mezcla de tamaños y los adornos. Las medidas salen de la pieza: no las repitas si ya las declaraste o las vas a declarar en confirmar_plan_decoracion. Devuelve el armado validado con lo que lleva de verdad (total de globos, conteo y compra por material, largo y grosor reales) y los avisos del motor; si no se sostiene devuelve el motivo (un patrón, un acabado o un reparto que no existe, un color que la pieza no lleva, un patrón que necesita más colores de los que hay) para que lo corrijas. Llámala una vez por pieza, después de buscar el catálogo y antes de confirmar: el armado que quede validado se guarda y entra en la pieza al confirmar el plan, no lo mandes otra vez en confirmar_plan_decoracion. Si no armas una pieza, el servidor le pone la receta del motor. No cambia precios ni decide catálogo.",
  esquema: {
    type: "object",
    required: ["estructura_id", "tipo", "colores"],
    properties: {
      estructura_id: { type: "string", description: "El mismo estructura_id que va a llevar la pieza en confirmar_plan_decoracion (EST_01_ARCO, EST_02_COLUMNA…)." },
      tipo: { ...TIPO_CON_MOTOR },
      colores: { type: "integer", minimum: 1, maximum: 12, description: "Cuántos materiales va a llevar esta pieza. Es el tope de los índices que puede nombrar el armado. Si la propuesta vigente ya tiene la pieza, manda el servidor." },
      patron: { type: "string", description: "Obligatorio en arco y columna: el id del patrón, tal como lo dio consultar_opciones_armado. No inventes ids. Una guirnalda no tiene patrón: no lo mandes." },
      materiales: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "integer", minimum: 0, maximum: 11 },
        description: "Obligatorio en arco y columna: los materiales que usa el patrón, en orden y por índice dentro de materiales de la estructura (0 es el primero). El primero es el color principal. Tantos como pida el patrón: mira min_colores y max_colores del catálogo. En una guirnalda usa paleta en su lugar.",
      },
      opciones: {
        type: "array",
        maxItems: 12,
        description: "Los mandos del patrón, como pares clave/valor (la clave y el rango salen del catálogo). Manda solo los que quieras cambiar: los demás toman el valor por defecto del motor. Un valor fuera de rango se acota y se avisa; un mando que ese patrón no usa se ignora y se avisa. Va como lista de pares porque cada patrón tiene mandos distintos.",
        items: {
          type: "object",
          required: ["clave", "valor"],
          properties: {
            clave: { type: "string", description: "La clave del mando, por ejemplo ancho, inclinacion, periodo, suavidad." },
            valor: { type: "number" },
          },
        },
      },
      geometria: {
        type: "object",
        description: "Solo arco y columna: ajustes de forma y tamaño. Todo opcional: lo que no mandes sale de las medidas de la pieza o de la receta del motor. En una guirnalda usa forma y volumen.",
        properties: {
          forma: { type: "string", enum: ["alto", "semi", "herradura"], description: "Solo arco: la línea guía. semi es medio punto, alto es más alto que ancho, herradura tiene patas rectas. Con semi el alto lo deduce del ancho." },
          ancho_m: { type: "number", description: "Solo arco: ancho exterior en metros. Lo que se salga del rango del motor se acota con aviso." },
          alto_m: { type: "number", description: "Alto exterior del arco o alto del cuerpo de la columna, en metros." },
          globos_ancho: { type: "integer", description: "Solo arco: cuántos globos van a lo ancho de la banda. Sin esto lo decide el patrón (el arcoíris quiere uno por banda de color)." },
          suelo: { type: "boolean", description: "Solo arco: si la banda llega al piso." },
          tamano_globo: { type: "integer", enum: [5, 9, 12, 18, 24, 36], description: "Solo arco: la pulgada nominal del globo de la banda." },
          globos_capa: { type: "integer", description: "Solo columna: globos por anillo, de 3 a 6 (4 es el cuarteto clásico)." },
          abajo: { type: "integer", enum: [5, 9, 12, 18, 24, 36], description: "Solo columna: la pulgada de los globos de la primera capa." },
          arriba: { type: "integer", enum: [5, 9, 12, 18, 24, 36], description: "Solo columna: la pulgada de los globos de la última capa; distinta de abajo afina o ensancha la columna." },
        },
      },
      paleta: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        description: "Obligatoria en una guirnalda: un color por cada material que quieras usar. Es lo que la define, porque no tiene patrón. Pon primero el que más se vea.",
        items: {
          type: "object",
          required: ["material"],
          properties: {
            material: { type: "integer", minimum: 0, maximum: 11, description: "Índice dentro de materiales de la estructura (0 es el primero)." },
            peso: { type: "number", description: "Cuánto de la guirnalda ocupa este color, en proporción libre. Sin esto, la participación que el material ya tiene en la pieza." },
            acabado: { type: "string", description: "El acabado del látex, con el valor que dio consultar_opciones_armado. Sin esto, el que el plan declare para ese material; si no declara ninguno, el látex normal." },
            rol: { type: "string", description: "El papel del color, con el valor que dio consultar_opciones_armado (uno de ellos reparte globos sueltos entre los demás). Sin esto, el normal." },
          },
        },
      },
      reparto: { type: "string", description: "Solo guirnalda: cómo se reparten los colores a lo largo de la tira, con el valor que dio consultar_opciones_armado (cada uno trae su ayuda). Sin esto, el del diseñador." },
      mezcla_colores: { type: "number", minimum: 0, maximum: 1, description: "Solo guirnalda: cuánto se difuminan los colores en la frontera entre tramos, o cuán puros son los racimos. 0 = corte seco." },
      forma: {
        type: "object",
        description: "Solo guirnalda: la línea de la tira. Todo opcional; el largo sale de las medidas de la pieza y lo demás del motor. Lo que se salga del rango se acota y se avisa.",
        properties: {
          largo_m: { type: "number", description: "Largo de un extremo al otro, en metros." },
          altura_m: { type: "number", description: "Altura de la línea sobre el piso en el extremo izquierdo, en metros." },
          pendiente_m: { type: "number", description: "Cuánto sube (positivo) o baja (negativo) el extremo derecho respecto al izquierdo." },
          onda_m: { type: "number", description: "Amplitud de la ondulación, en metros." },
          ondas: { type: "number", description: "Cuántas ondas hay a lo largo de la tira." },
          colgado_m: { type: "number", description: "Cuánto cuelga la tira entre sujeciones. 0 = tensa." },
          festones: { type: "integer", description: "En cuántos tramos colgados se divide." },
          carga: { type: "number", minimum: -1, maximum: 1, description: "Lado más cargado: −1 izquierda, +1 derecha, 0 parejo. Ese lado va más grueso y con los globos más grandes." },
          suelo: { type: "boolean", description: "Si la tira llega al piso." },
        },
      },
      volumen: {
        type: "object",
        description: "Solo guirnalda: el grosor de la banda y cómo se agrupan los globos. Todo opcional.",
        properties: {
          grosor_extremos_m: { type: "number", description: "Grosor de la banda en los extremos, en metros." },
          grosor_centro_m: { type: "number", description: "Grosor en el centro. Mayor que el de los extremos da la forma de racimo." },
          irregularidad: { type: "number", minimum: 0, maximum: 1, description: "Cuánto varía el grosor a lo largo: 0 es parejo." },
          relleno: { type: "number", minimum: 0, maximum: 1, description: "Qué tan apretados van los globos." },
          racimo: { type: "integer", description: "Globos por racimo." },
          salientes: { type: "number", minimum: 0, maximum: 1, description: "Fracción de globos que se salen de la banda y le dan el aire orgánico." },
        },
      },
      tamanos: {
        type: "array",
        maxItems: 6,
        description: "Solo guirnalda: la mezcla de tamaños, con el peso de cada uno en proporción libre. Manda solo los tamaños que quieras usar; sin esto va la mezcla del diseñador. Un tamaño que no quepa en el grosor lo quita el motor y lo avisa.",
        items: {
          type: "object",
          required: ["tamano", "peso"],
          properties: { tamano: { ...TAMANO_NOMINAL }, peso: { type: "number", minimum: 0, maximum: 100 } },
        },
      },
      adornos: {
        type: "object",
        description: "Solo guirnalda: tallos de follaje y flores por metro. NO se cotizan (no están en el catálogo de globos): se listan para el montaje. No se los cobres al cliente ni los anuncies como parte del precio.",
        properties: {
          follaje: { type: "number", description: "Tallos de follaje por metro." },
          flores: { type: "number", description: "Flores por metro." },
        },
      },
      remate: {
        type: "object",
        description: "Solo columna: qué la corona. Sin esto el motor pone un globo grande.",
        required: ["tipo"],
        properties: {
          tipo: { type: "string", enum: ["ninguno", "globo", "racimo", "estrella", "corazon"] },
          material: { type: "integer", minimum: 0, maximum: 11, description: "Índice del material del remate. Sin esto, el principal." },
          tamano: { ...TAMANO_NOMINAL },
          cantidad: { type: "integer", minimum: 3, maximum: 5, description: "Globos del racimo." },
          foil_m: { type: "number", description: "Alto de la estrella o el corazón, en metros." },
        },
      },
    },
  },
};

/** Las dos juntas, en el orden en el que tienen sentido: primero se consulta, después se arma. */
export const HERRAMIENTAS_ARMADO_MOTOR: Herramienta[] = [CONSULTAR_OPCIONES_ARMADO, ARMAR_ESTRUCTURA];

/**
 * Estimar el conteo de globos (ADR-0038), detrás de `ESTIMAR_CONTEO_V1`. Hasta ahora la IA solo obtenía el
 * número de globos confirmando el plan, que fija estado y token de aprobación. Esta herramienta lo
 * **consulta** sin comprometer nada: para unos candidatos le pregunta a Python cuántos globos cobraría el plan
 * y qué variación de mandos los acerca a un conteo objetivo (el de la foto).
 *
 * Es de solo lectura (`HERRAMIENTAS_SOLO_LECTURA`): no escribe en el estado, no toca `planResuelto`, el token
 * ni `plan_hash`. Las cifras son de Python; la descripción no repite ninguna regla ni tolerancia, y el
 * número que se le dice al cliente sigue saliendo de `confirmar_plan_decoracion`.
 */
export const ESTIMAR_CONTEO_GLOBOS: Herramienta = {
  nombre: "estimar_conteo_globos",
  descripcion:
    "Consulta de SOLO LECTURA: te dice cuántos globos cobraría el plan para hasta 6 candidatos de una pieza (cada uno con sus medidas, densidad y mezcla) y cuál de ellos queda más cerca de un conteo objetivo, por ejemplo el conteo leído en la foto. Por candidato devuelve total_vigente (el que de verdad se cobraría por pieza) y su fuente (formula, o motor si la pieza trae armado), total_formula y total_motor, el reparto por tamaño, si pasa la puerta física, la brecha contra el objetivo con su tolerancia y una sugerencia: la menor variación de mandos que lo acerca. Si la pieza trae armado del motor (armado_de = el estructura_id que ya armaste con armar_estructura en este turno), el total sale del motor y su densidad, su mezcla y sus medidas NO lo mueven: la sugerencia mueve entonces los mandos del armado y la nota lo explica. Úsala antes de armar y de confirmar para elegir entre candidatos; una consulta admite hasta 2 candidatos con armado de guirnalda y, si hay otra estimación en curso, responde ocupado: reintenta una vez. No cambia el plan, no fija estado ni token de aprobación y NO sustituye a confirmar_plan_decoracion: el número que le dices al cliente sale SIEMPRE de confirmar_plan_decoracion, nunca de esta estimación. Si no mandas objetivo y la foto trae un conteo leído de un único elemento, se usa ese.",
  esquema: {
    type: "object",
    required: ["candidatos"],
    properties: {
      candidatos: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        description: "Las variantes de la pieza que quieres comparar: normalmente 2 o 3 que cambien medidas, densidad o mezcla. Cada etiqueta es única y es lo que vuelve en la respuesta.",
        items: {
          type: "object",
          required: ["etiqueta", "tipo", "densidad", "mezcla"],
          properties: {
            etiqueta: { type: "string", description: "Cómo llamas a este candidato (por ejemplo 'arco 3 m media'). No se repite entre candidatos." },
            tipo: { type: "string", enum: [...TIPOS_ESTRUCTURA_GEOMETRICOS], description: "El tipo de la estructura: el que mide la geometría. Un aro circular o un arco asimétrico son tipo arco." },
            estructura_oficial: { type: "string", enum: [...ESTRUCTURAS_OFICIALES_IDS], description: "Opcional. Coherente con tipo y densidad, como en confirmar_plan_decoracion." },
            medidas: {
              type: "object",
              description: "Las medidas que declararías en la estructura. Las que falten se asumen como al confirmar el plan (las de por defecto del tipo) y la respuesta lo avisa; si el cliente no dio medidas, déjalas vacías.",
              properties: {
                ancho_m: { type: "number" },
                alto_m: { type: "number" },
                largo_m: { type: "number" },
              },
            },
            densidad: { type: "string", enum: [...DENSIDADES] },
            mezcla: { type: "string", enum: [...MEZCLAS] },
            colores: { type: "integer", minimum: 1, maximum: 12, description: "Solo importa con armado: cuántos materiales llevaría la pieza. Sin esto se usan los que el armado nombra." },
            repeticiones: { type: "integer", minimum: 1, maximum: 24, description: "Cuántas piezas iguales. El conteo vigente es por pieza; total_instalado las multiplica." },
            armado_de: { type: "string", description: "El estructura_id de una pieza que armar_estructura ya validó en este turno: su armado entra al candidato y la pieza se cuenta con el motor. Sin esto, se cuenta con la fórmula." },
          },
        },
      },
      objetivo: {
        type: "object",
        required: ["conteo"],
        description: "El conteo de globos por pieza al que quieres acercarte, tal como lo leíste en la foto. Sin esto, y si la foto trae un conteo leído de un solo elemento, se usa ese.",
        properties: {
          conteo: { type: "integer", minimum: 1 },
          exacto: { type: "boolean", description: "Solo informativo: se devuelve tal cual en la respuesta; no cambia la tolerancia ni la búsqueda." },
        },
      },
      referencia_element_id: { type: "string", description: "Si la foto trae conteos de varios elementos y no mandas objetivo: de cuál tomarlo." },
    },
  },
};

/**
 * Propiedades de UNA edición de `ajustar_plan_decoracion`. Se usan dos veces:
 * sueltas en la raíz (una sola edición, la forma original) y como elementos de
 * `ediciones` (varias, todas o ninguna). Este JSON Schema solo guía al modelo:
 * lo que de verdad valida los argumentos es `leerEdicionesChat`
 * (src/lib/plan/edicion-chat.ts), con los mismos esquemas que el editor de la
 * tarjeta (`EdicionSchema`, `EdicionRepartoSchema`, `EdicionMezclaSchema` en
 * src/lib/plan/edicion-esquemas.ts). Igual que el resto de herramientas de este
 * archivo, los requisitos condicionales van en texto y no en el esquema.
 */
const PROPIEDADES_EDICION_PLAN: Record<string, unknown> = {
  accion: {
    type: "string",
    enum: ["agregar", "reemplazar", "quitar", "repartir", "mezcla"],
    description:
      "agregar: suma un material nuevo a la estructura (\"agrégale unos morados\"). reemplazar: cambia el material objetivo por `variante` (\"cambia el azul por rojo\"). quitar: elimina el material objetivo (\"quita las servilletas\"); no sirve si es el único material de la estructura: ahí se reemplaza. repartir: cambia cuánto lleva cada color de la estructura sin cambiar los colores (\"que el rosado sea el protagonista\", \"menos blanco y más dorado\"). mezcla: cambia el balance de tamaños de los globos de la estructura (\"globos más grandes\", \"más pequeños\", \"solo globos grandes\").",
  },
  estructura_id: { type: "string", description: "estructura_id de la propuesta vigente que se va a tocar, tal como aparece en la lista de la propuesta vigente." },
  objetivo_variant_id: { type: "string", description: "Obligatorio en reemplazar y quitar: variant_id actual de esa estructura (de la lista de la propuesta vigente) que se reemplaza o elimina." },
  variante: {
    type: "object",
    description: "Obligatoria en agregar y reemplazar: la pieza nueva, recuperada con buscar_catalogo_rag en este mismo turno (el par product_id/variant_id exacto que devolvió).",
    required: ["product_id", "variant_id"],
    properties: {
      product_id: { type: "string" },
      variant_id: { type: "string" },
      color: { type: "string" },
      acabado: { type: "string" },
    },
  },
  participacion: { type: "number", minimum: 0.01, maximum: 0.8, description: "Solo para agregar: fracción de la estructura que ocupa el material nuevo (0,01 a 0,8). Si no la mandas, el sistema usa 0,2." },
  participaciones: {
    type: "array",
    minItems: 2,
    maxItems: 6,
    items: { type: "number", minimum: 0.05, maximum: 0.95 },
    description:
      "Solo para repartir: cuánto pesa cada color, un número por material de la estructura y en el MISMO orden en que la lista de la propuesta vigente los muestra (reparto actual), sumando 1. Cada color pesa al menos 0,05; para quitar un color usa quitar. Ejemplo, rosado protagonista en una estructura rosado, blanco y dorado: [0.6, 0.25, 0.15].",
  },
  mezcla: {
    type: "string",
    enum: ["organica_fina", "clasica", "organica_gruesa", "solo_grandes"],
    description:
      "Solo para la acción mezcla, ordenadas de globos más pequeños a más grandes: organica_fina (muchos globos chicos y pocos grandes de acento), clasica (todos de 12 pulgadas), organica_gruesa (menos chicos y más volumen: \"más grandes\"), solo_grandes (solo globos de 18 y 24 pulgadas). \"Un poco más grandes\" es el escalón siguiente al que tiene ahora la estructura; \"más pequeños\", el anterior.",
  },
};

/**
 * Ajusta la propuesta ya vigente en vez de diseñar una nueva (§7 "editar una
 * propuesta desde el chat"). Una edición suelta (la forma original) o varias en
 * `ediciones`, aplicadas en orden y de forma atómica: cada una parte de la
 * propuesta que dejó la anterior y, si una falla, no se aplica ninguna.
 *
 * Se registra aparte de `HERRAMIENTAS_PLAN` porque `herramientasActivas()` solo
 * la expone cuando `estado.planVigente` existe: el modelo no puede convocarla
 * por su cuenta sin evidencia firmada de que hay algo que editar. Solo ofrece
 * agregar/reemplazar/quitar/repartir/mezcla; el patrón de color y los armados
 * (arco, columna, guirnalda) se quedan en el editor de la tarjeta.
 */
export const AJUSTAR_PLAN_DECORACION: Herramienta = {
  nombre: "ajustar_plan_decoracion",
  descripcion:
    "Ajusta la propuesta YA vigente (la que el cliente ve en pantalla y se describe al final de las instrucciones) en vez de diseñar una nueva. Solo existe cuando hay una propuesta vigente. Úsala para cualquier cambio sobre lo que el cliente ya vio: cambiar un color o un material (\"cambia el azul por rojo en las tres columnas\"), quitar una pieza (\"quita las servilletas\"), agregar un color (\"agrégale dorado\"), cambiar cuánto pesa cada color (\"que el rosado sea el protagonista\") o el tamaño de los globos (\"globos más grandes\"). Para un solo cambio manda los campos de la edición directamente; para varios manda `ediciones` (de 1 a 8): se aplican en orden, cada una sobre el resultado de la anterior, y si una falla no se aplica ninguna. Un \"cámbialo en todas\" son varias ediciones, una por estructura que tenga ese material. Usa confirmar_plan_decoracion solo si el cliente pide diseñar algo distinto desde cero. No llames esta herramienta y confirmar_plan_decoracion en el mismo turno: es una u otra. El product_id y variant_id de cada `variante` deben haber aparecido en buscar_catalogo_rag de este mismo turno, igual que en confirmar_plan_decoracion. Nunca mandes precios ni cantidades de globos: el backend los recalcula. No sirve para el patrón de color ni para armar arcos, columnas o guirnaldas: eso lo cambia el cliente desde la tarjeta. Devuelve el desglose actualizado, que reemplaza al de la propuesta vigente, y su nuevo total.",
  esquema: {
    type: "object",
    properties: {
      ...PROPIEDADES_EDICION_PLAN,
      ediciones: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        description: "Varios cambios en una sola llamada (alternativa a mandar una edición suelta; no mezcles las dos formas). Se aplican en el orden dado y son atómicos: o quedan todos o no queda ninguno.",
        items: {
          type: "object",
          required: ["accion", "estructura_id"],
          properties: PROPIEDADES_EDICION_PLAN,
        },
      },
    },
  },
};
