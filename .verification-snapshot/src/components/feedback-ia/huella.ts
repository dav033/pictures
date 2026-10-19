/** Una huella corta (FNV-1a de 32 bits, en hexadecimal) de un texto: para decir «es la misma imagen/escena» sin mandarla. */
export function huellaTexto(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
