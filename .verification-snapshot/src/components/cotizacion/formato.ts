/** Cómo se escriben los importes y los números en pantalla (solo presentación; ningún cálculo). */
export const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
export const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** Importe ya calculado por Python, o «—» cuando no hay uno que valga. */
export const importeOGuion = (valor: number | null): string => (valor === null ? "—" : pesos.format(valor));

/** Lo que se ve de un resultado que ya no corresponde a lo escrito: atenuado, sin dejar de poder leerse. */
export const CLASE_NO_VIGENTE = "opacity-55";
