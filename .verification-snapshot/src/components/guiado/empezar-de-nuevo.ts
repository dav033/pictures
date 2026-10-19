/**
 * «Empezar de nuevo» de la guiada deja la pestaña como recién abierta (probador 124, hallazgo 15). La conversación
 * (`demo_guiado_v2`) la borra `vaciar`; aquí, lo demás que esta vista guarda en la sesión: los borradores del precio de
 * negocio de sus tarjetas (`cotizacion-profesional:` y `cotizacion-granel:` con clave `plan-<hash>` o `guiado-<idea>`).
 * El plan exacto de una idea sale siempre con el mismo hash, así que sin esto la conversación nueva recuperaba el
 * montaje y la ganancia de la borrada. Los de la clásica (clave = id de su mensaje), el tema y la vista no se tocan.
 */

const PREFIJOS_GUIADA = [
  "cotizacion-profesional:plan-",
  "cotizacion-profesional:guiado-",
  "cotizacion-granel:plan-",
  "cotizacion-granel:guiado-",
] as const;

/** Las claves de la sesión que son estado de la guiada (puro, para probarlo sin navegador). */
export function clavesDeLaGuiada(claves: readonly string[]): string[] {
  return claves.filter((clave) => PREFIJOS_GUIADA.some((prefijo) => clave.startsWith(prefijo)));
}

/** Borra de `almacen` (la sessionStorage) el estado de la guiada; devuelve cuántas claves quitó. */
export function borrarEstadoGuiado(almacen: Pick<Storage, "length" | "key" | "removeItem">): number {
  const claves: string[] = [];
  for (let indice = 0; indice < almacen.length; indice += 1) {
    const clave = almacen.key(indice);
    if (clave !== null) claves.push(clave);
  }
  const borrar = clavesDeLaGuiada(claves);
  for (const clave of borrar) almacen.removeItem(clave);
  return borrar.length;
}
