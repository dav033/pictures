/**
 * Los mensajes de la IA que esta página PRODUJO (el envío los añade como burbuja vacía y luego llena el stream). Se marcan en el
 * propio envío, así que no dependen de cuántos trozos llegaron: un mensaje de un solo trozo también cuenta. Los restaurados del
 * historial nunca están aquí y solo se consultan.
 */
const producidos = new Set<string>();

export const marcarProducido = (id: string): void => { producidos.add(id); };
export const esProducido = (id: string): boolean => producidos.has(id);

/** Para las pruebas. */
export const reiniciarProducidos = (): void => { producidos.clear(); };
