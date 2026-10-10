/** El almacén local del navegador, o `undefined` si el navegador no lo deja leer (privado, datos bloqueados). */
export function almacenLocal(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
