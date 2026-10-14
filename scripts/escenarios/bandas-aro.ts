import type { FilaBanda } from "./bandas";

/**
 * Las bandas de conteo del aro orgánico **por diámetro** (REQ-014 T60). El conteo por metro de eje (π × diámetro) sube con el diámetro
 * porque el tubo de 30 cm ocupa parte del ancho: 8,9 globos/m a 1 m, 12,9 a 1,6 m, 14,5 a 2 m y 16,7 a 3 m en la densidad ligera. Una sola
 * banda por densidad dejaba fuera a los aros chicos o a los grandes.
 *
 * Medido con la fachada `armarDesdeEspec` (aro_circular, organica_fina, diámetros de 1 a 3 m de 0,2 en 0,2, el 570, el 056 sin R-9 y de 2 a 6
 * colores mezclados): por cada tramo, el mínimo y el máximo por metro en sus puntos medidos (el conteo por metro crece con el diámetro, así que
 * los bordes acotan el tramo), con un 5 % de margen. Un tramo incluye sus dos bordes y sigue al anterior.
 *
 * Solo la densidad ligera a 2 m tiene evidencia de PARIDAD (idea 28, 2 x 2 m: Python 15,0/m, foto 13,5/m, motor 14,5/m); el resto es un pin de
 * regresión del motor de hoy, no una verdad externa.
 *
 * Cada tramo: [diámetro desde, hasta (m), mínimo/m, máximo/m].
 */
type Tramo = readonly [desde: number, hasta: number, minimo: number, maximo: number];
const TRAMOS: Readonly<Record<"sencilla" | "media" | "lujosa", readonly Tramo[]>> = {
  sencilla: [[1.0, 1.4, 8.4, 16.7], [1.4, 1.8, 11.8, 19.6], [1.8, 2.2, 13.3, 21.4], [2.2, 3.0, 14.4, 23.7]],
  media: [[1.0, 1.4, 10.2, 21.6], [1.4, 1.8, 14.0, 23.5], [1.8, 2.2, 17.0, 27.9], [2.2, 3.0, 18.5, 30.1]],
  lujosa: [[1.0, 1.4, 13.0, 24.6], [1.4, 1.8, 19.0, 28.6], [1.8, 2.2, 20.5, 31.3], [2.2, 3.0, 21.2, 35.3]],
};

export const DIAMETRO_ARO_MIN_M = 1.0;
export const DIAMETRO_ARO_MAX_M = 3.0;

export const FILAS_ARO_ORGANICO: readonly FilaBanda[] = (Object.entries(TRAMOS) as [keyof typeof TRAMOS, readonly Tramo[]][]).flatMap(([densidad, tramos]) =>
  tramos.map(([desde, hasta, minPorMetro, maxPorMetro]): FilaBanda => ({
    estructuras: ["aro_circular"], tamanos: ["organica_fina"], densidad, diametroM: [desde, hasta], minPorMetro, maxPorMetro,
    origen: "medido",
    fuente: `Medido con la fachada (REQ-014 T60): aro ${densidad} de ${desde} a ${hasta} m de diámetro, ${minPorMetro}-${maxPorMetro} globos/m. Regression pin; only sencilla d=2 has PARIDAD evidence (idea 28: Python 15,0/m, foto 13,5/m, motor 14,5/m).`,
  })),
);
