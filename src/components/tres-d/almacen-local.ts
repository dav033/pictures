/** El almacén local del navegador, o `undefined` si el navegador no lo deja leer (privado, datos bloqueados). */
export function almacenLocal(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const oyentes = new Set<() => void>();

/**
 * Avisa cuando el almacén local cambia: en esta pestaña (`guardarEnAlmacen`) y en las demás (`storage`).
 * Para `useSyncExternalStore`.
 */
export function suscribirAlmacen(avisar: () => void): () => void {
  oyentes.add(avisar);
  window.addEventListener("storage", avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

/** Ejecuta una escritura y, si el navegador la dejó hacer, avisa a los oyentes de esta pestaña. */
export function guardarEnAlmacen(escribir: (almacen: Storage | undefined) => boolean): boolean {
  const guardado = escribir(almacenLocal());
  if (guardado) for (const avisar of oyentes) avisar();
  return guardado;
}
