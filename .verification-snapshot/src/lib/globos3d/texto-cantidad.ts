/** Cantidades con su sustantivo en singular o plural: el mismo texto en pantalla, en la hoja de armado y en el texto copiado. */

export const plural = (n: number, uno: string, muchos: string): string => (n === 1 ? uno : muchos);

/** «1 globo», «2 globos». */
export const textoGlobos = (n: number): string => `${n} ${plural(n, "globo", "globos")}`;

/** Un número como lo escriben la lista y la hoja: coma decimal y hasta un decimal. */
export const textoNumero = (n: number): string => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
