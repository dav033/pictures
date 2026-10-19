import type { DatosAyuda } from "@/components/ui/Ayuda";

/**
 * Las ayudas («?») de la vista guiada, en un solo sitio: cada una con su id (el que queda en el registro
 * `ayuda.abrir`), el tema que nombra el botón para el lector de pantalla y el texto, de una o dos frases en
 * palabras de cliente. Pedido del dueño (2026-10-07): «iconos de tooltip que expliquen formularios, gráficas,
 * inputs y lo que sea necesario, pero tampoco nos pasemos». Por eso son pocas y solo donde algo no se entiende
 * solo; ninguna repite la etiqueta que acompaña. `scripts/test/test-ayudas-guiada.ts` comprueba que cada id es
 * único, que ningún texto pasa de 160 caracteres y que todas se usan.
 *
 * Los textos explican, no calculan: las cifras de los ejemplos no salen del plan (las cantidades y el precio son
 * siempre los de Python).
 */
export const AYUDAS = {
  /** FilaPieza (primera pieza de «Tu plan»): el dibujo del motor junto a la pieza. */
  graficaArmado: {
    id: "grafica-armado",
    tema: "el dibujo de la pieza",
    texto: "Muestra cómo se arma la pieza: dónde va cada color y qué tamaño de globo lleva. Es una guía para armarla, no una foto.",
  },
  /** FilaPieza (primera pieza): la barra de tamaños. */
  barraTamanos: {
    id: "barra-tamanos",
    tema: "la barra de tamaños",
    texto: "Cada tramo es un tamaño de globo, en pulgadas: cuanto más largo, más globos de ese tamaño lleva. El tono más intenso es el globo más grande.",
  },
  /** «Ver detalle»: la tabla de la primera pieza. */
  tablaDetalle: {
    id: "tabla-detalle",
    tema: "la tabla de globos",
    texto: "Cada fila es un globo (color y modelo) y cada columna, un tamaño en pulgadas. La cifra dice cuántos lleva la pieza; «Total» los suma.",
  },
  /** «Ajustar mi plan» → «Colores de tu plan»: la barra y los %. */
  coloresPorcentaje: {
    id: "colores-porcentaje",
    tema: "los porcentajes de color",
    texto: "La barra y el % muestran qué parte de todos los globos del plan es de cada color. Si cambias cantidades, se recalculan solos.",
  },
  /** «Ajustar mi plan» → primer color de la primera pieza: la cifra frente al %. */
  cantidadPorcentaje: {
    id: "cantidad-porcentaje",
    tema: "la cantidad y el porcentaje",
    texto: "La cifra es cuántos globos de ese color lleva la pieza y el %, qué parte del total son. Cambia la cifra con − / + o escríbela; el % se ajusta solo.",
  },
  /** «Ajustar mi plan» → «Cambiar» / «Añadir un color» (el catálogo). */
  cambiarAnadirColor: {
    id: "cambiar-anadir-color",
    tema: "cambiar o añadir un color",
    texto: "«Cambiar» pone otro globo del catálogo en el lugar de ese color. «Añadir un color» suma uno nuevo en una parte pequeña de tus piezas.",
  },
  /** Precio al cliente (negocio): «Tu ganancia». */
  ganancia: {
    id: "ganancia",
    tema: "tu ganancia",
    texto: "Ejemplo: si materiales y gastos suman $100.000 y pones 30 %, el precio al cliente es $130.000 y tú ganas $30.000.",
  },
  /** Precio al cliente (negocio): «Valor por unidad» de un gasto. */
  valorUnidad: {
    id: "valor-unidad",
    tema: "el valor por unidad",
    texto: "Lo que vale una sola unidad de este gasto: una hora, un viaje o un día de alquiler. Se multiplica por la cantidad para dar el total.",
  },
  /** Precio al cliente (negocio): «Por paquete» / «Por unidad (a granel)» y el sobrante. */
  modoGlobos: {
    id: "modo-globos",
    tema: "cómo cotizar los globos",
    texto: "Por paquete cobras paquetes cerrados, aunque sobren globos. A granel cobras solo los globos que lleva el plan, sueltos.",
  },
  /** Precio personal: el total de los materiales. */
  precioPersonal: {
    id: "precio-personal",
    tema: "el precio de los materiales",
    texto: "Es lo que cuestan los globos en la tienda en línea, en paquetes cerrados y con IVA. El montaje o un decorador se pagan aparte.",
  },
  /** «Tu elección»: cantidades «≈» contadas en la foto. */
  contadasFoto: {
    id: "contadas-foto",
    tema: "las cantidades contadas en la foto",
    texto: "Salen de contar los globos que se ven en la foto, no de armar la pieza, así que pueden variar un poco.",
  },
  /** La lectura de la foto de inspiración. */
  lecturaFoto: {
    id: "lectura-foto",
    tema: "lo que leí en tu foto",
    texto: "Es lo que reconocí en tu foto: piezas, colores y tamaños. «Se ve clara», «Probable» o «Dudosa» dice qué tan seguro estoy de cada pieza.",
  },
} as const satisfies Record<string, DatosAyuda>;

export type ClaveAyuda = keyof typeof AYUDAS;
