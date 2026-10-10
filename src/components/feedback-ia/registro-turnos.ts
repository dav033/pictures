/**
 * Los turnos que esta página ya registró (POST sin nota, REQ-010). Solo se registran los turnos PRODUCIDOS en esta página, al
 * terminar; los restaurados al cargar nunca se registran (solo se consultan). En memoria: cada turno se registra una vez por página.
 */
const registrados = new Set<string>();

export const yaRegistrado = (clave: string): boolean => registrados.has(clave);
export const marcarRegistrado = (clave: string): void => { registrados.add(clave); };
export const desmarcarRegistrado = (clave: string): void => { registrados.delete(clave); };

/** Para las pruebas. */
export const reiniciarRegistros = (): void => { registrados.clear(); };
