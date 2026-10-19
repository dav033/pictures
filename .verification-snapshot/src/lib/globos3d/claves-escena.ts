import type { Escena } from "./escena";

/**
 * La identidad de «la escena» (D-021): cada escena del historial lleva la `clave` de la escena a la que pertenece, para que la
 * conversación con la IA sepa sobre cuál actúa. Una edición hereda la clave de la escena anterior; abrir una plantilla, una sala
 * vacía o una idea de la biblioteca da una clave nueva. Como la clave va con cada escena del historial, Ctrl+Z y Ctrl+Y la
 * devuelven con ella. Puro (el mapa lo pone quien lo usa).
 */
export function registrarClave(claves: WeakMap<Escena, string>, presente: Escena, nueva: Escena, explicita?: string): void {
  const clave = explicita ?? claves.get(presente);
  if (clave && (explicita || !claves.has(nueva))) claves.set(nueva, clave);
}
