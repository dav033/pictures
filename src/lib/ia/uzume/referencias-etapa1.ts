import type { ImageInput } from "../nucleo/tipos";

/**
 * Qué imágenes recibe la etapa 1 (el LoRA) cuando el modo híbrido está activo.
 *
 * HOY LA ETAPA 1 NO RECIBE NINGUNA. Con foto del espacio, `route.ts` llama al
 * LoRA con `[]` y toda la referencia del cliente viaja solo como texto: lo que
 * el analizador supo escribir en el caption. La foto que el cliente subió —la
 * que tiene la densidad, el escalonado y el reparto real de la decoración— no
 * llega nunca en píxeles a la etapa que dibuja los globos. Ese es el techo de
 * calidad que el plan llama «el techo real».
 *
 * LO QUE SÍ NO PUEDE PASAR es que el `/edit` copie un fondo. FLUX.2 puede tomar
 * el fondo de cualquier imagen que reciba, y por eso `referenciasParaLoraEdit`
 * filtra a la foto del cliente en cuanto hay venue. Aquí el caso es el
 * contrario y por eso necesita su propia función: en modo híbrido la etapa 1 NO
 * debe ver el venue —de eso se encarga Gemini en la etapa 2— y sí debe ver la
 * referencia. Mandar las dos sería pedirle al LoRA que resuelva la composición
 * entera y volvería a dejar la etapa 2 sin trabajo que hacer.
 *
 * Puro: sin proveedor, HTTP, base de datos ni entorno.
 */

/**
 * Roles que aportan composición sin aportar identidad de producto ni fondo.
 * `palette_reference` queda fuera a propósito: su sitio es la etapa 2, donde el
 * color se compone, y en la etapa 1 solo competiría con los colores que el
 * caption ya declara desde el plan.
 */
const ROLES_COMPOSICION: ReadonlySet<ImageInput["role"]> = new Set(["composition_reference", "element_reference"]);

/** Techo duro. Más referencias diluyen en vez de guiar, y cada una cuesta. */
export const MAX_REFERENCIAS_ETAPA1 = 2;

export function referenciasParaEtapa1Hibrida(inputs: readonly ImageInput[]): ImageInput[] {
  return [...inputs]
    .filter((input) => ROLES_COMPOSICION.has(input.role))
    .sort((uno, otro) => uno.priority - otro.priority)
    .slice(0, MAX_REFERENCIAS_ETAPA1);
}
