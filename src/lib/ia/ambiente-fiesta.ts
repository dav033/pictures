/**
 * Contexto de fiesta: lo que hace que un jardín con tres estructuras de globos
 * se lea como un evento y no como un catálogo (fase 6.B de
 * PLAN-IMAGE-AND-COLOR-FIDELITY.md).
 *
 * EL PROBLEMA NO ERA QUE APARECIERAN OBJETOS. La lista de prohibiciones que hay
 * hoy en el prompt es el instinto correcto aplicado en el nivel equivocado: lo
 * que no puede pasar es que un objeto aparezca en la imagen SIN QUE EL CLIENTE
 * SEPA QUE NO LO ESTÁ COMPRANDO. Prohibirlos todos convierte cada vista previa
 * en un producto flotando sobre césped vacío; permitirlos sin marcar convierte
 * la vista previa en una promesa comercial que nadie cotizó.
 *
 * DOS FUENTES LEGÍTIMAS Y NINGUNA MÁS:
 *  1. Escenografía detectada en la foto del propio cliente. Ya entra por su
 *     camino (`escenografiaFromReference`), el cliente la ve y la alterna por
 *     chip, y no toca cotización ni `plan_hash`.
 *  2. Este interruptor explícito, que es lo que añade esta fase.
 *
 * Nada de aquí sale de un modelo. El vocabulario es fijo y está abajo: un
 * modelo puede elegir de la lista, nunca ampliarla. Una lista abierta sería
 * exactamente el fallo que la prohibición intentaba evitar.
 *
 * Puro: sin proveedor, HTTP, base de datos ni entorno.
 */

/** Cuánto ambiente pide el cliente. `ninguno` es el estado por defecto. */
export type NivelAmbiente = "ninguno" | "minimo" | "completo";

/**
 * Vocabulario cerrado de props de ambiente. Frases en inglés porque van al
 * prompt de composición, que es lo único que las consume.
 *
 * No hay comida, no hay personas, no hay marcas y no hay nada que pueda leerse
 * como una estructura de globos: eso último volvería a mezclar lo que se cobra
 * con lo que no.
 */
const PROPS_AMBIENTE = {
  minimo: ["a low side table", "string lights overhead"],
  completo: ["a low side table", "string lights overhead", "a few folding chairs", "a small cake table with a plain cloth"],
} as const satisfies Record<Exclude<NivelAmbiente, "ninguno">, readonly string[]>;

/** Techo duro de props. Más que esto y la decoración deja de ser el tema de la foto. */
export const MAX_PROPS_AMBIENTE = 4;

export type Ambiente = {
  nivel: NivelAmbiente;
  /** Props a añadir. Vacío cuando el nivel es `ninguno`. */
  props: string[];
  /**
   * Frase que el prompt de composición debe llevar cuando hay props. Sin ella
   * el modelo no distingue lo cotizado de lo añadido, y la imagen sí.
   */
  instruccion: string;
  /** Texto para el cliente, allí donde la imagen aparece junto a un precio. */
  aviso: string;
};

const AVISO_NO_COTIZADO = "Los muebles, luces y mesas de la vista previa son ambientación: no están incluidos en la cotización.";

/**
 * Cuando lo no cotizado viene de la foto del propio cliente y no del
 * interruptor. Se nombra distinto porque el cliente reconoce sus propios
 * objetos y decirle que "se añadieron" sería falso.
 */
export const AVISO_ESCENOGRAFIA_NO_COTIZADA = "La vista previa conserva elementos de tu foto (mesas, plintos, flores): no están incluidos en la cotización.";

export function ambienteDeFiesta(nivel: NivelAmbiente): Ambiente {
  if (nivel === "ninguno") return { nivel, props: [], instruccion: "", aviso: "" };
  const props = [...PROPS_AMBIENTE[nivel]].slice(0, MAX_PROPS_AMBIENTE);
  return {
    nivel,
    props,
    // "Sparse" y "understated" no son adorno del prompt: sin ellos el modelo
    // llena el encuadre de mobiliario y la decoración deja de ser el tema.
    instruccion: `Add sparse, understated party context so the scene reads as a real event: ${props.join(", ")}. Keep it in the background and secondary to the balloon structures; never add anything not in that list, and never add food, people, signage or additional balloon work.`,
    aviso: AVISO_NO_COTIZADO,
  };
}

/** `true` cuando la respuesta debe llevar el aviso junto al precio. */
export function requiereAvisoNoCotizado(ambiente: Ambiente, escenografiaDeReferencia: readonly unknown[]): boolean {
  // La escenografía de la propia foto del cliente también es no cotizada: el
  // plan es lo que se construye y se cobra, y una mesa que estaba en su foto
  // tampoco se la vendemos.
  return ambiente.props.length > 0 || escenografiaDeReferencia.length > 0;
}

/** Parseo del interruptor tal como llega del cliente. Cualquier otra cosa es `ninguno`. */
export function nivelAmbienteDe(valor: unknown): NivelAmbiente {
  return valor === "minimo" || valor === "completo" ? valor : "ninguno";
}
