import type { FilaBanda } from "./bandas";

/**
 * Bandas del aro orgánico (REQ-014 T60 / P-092). El máximo se midió cada centímetro entre 1 y 3 m con 570 y 056;
 * en cada décima, siete perfiles de uno a seis colores confirmaron que ese par contiene los extremos. Cada diámetro
 * permite como máximo el 105 % del mayor conteo observado, redondeado hacia abajo al globo entero. La medida se
 * redondea al centímetro como en el constructor y el tope se consulta sin interpolar. No se suma tolerancia fija.
 *
 * Los mínimos conservan los tramos medidos en T60. Solo el aro sencilla de 2 m tiene evidencia PARIDAD (idea 28:
 * Python 15,0/m, foto 13,5/m, motor 14,5/m). Los demás datos son pines de regresión del motor, no evidencia externa.
 */
type Tramo = readonly [desde: number, hasta: number, minimoPorMetro: number];

/** Máximo observado por centímetro en los perfiles 570 y 056, por densidad. */
const MAXIMOS_MEDIDOS: Readonly<Record<"sencilla" | "media" | "lujosa", readonly number[]>> = {
  sencilla: [
    34, 34, 35, 34, 37, 37, 38, 40, 41, 42, 43, 44, 44, 45, 46, 47, 47, 48, 50, 51,
    51, 52, 54, 55, 55, 56, 57, 57, 57, 60, 61, 61, 62, 63, 63, 64, 66, 67, 67, 69,
    70, 70, 71, 72, 73, 73, 74, 75, 75, 78, 79, 80, 80, 81, 82, 82, 83, 84, 85, 85,
    87, 88, 90, 90, 91, 92, 93, 93, 94, 95, 95, 97, 98, 99, 99, 100, 102, 102, 103, 104,
    105, 103, 107, 108, 108, 109, 110, 111, 111, 113, 114, 114, 116, 117, 118, 118, 119, 120, 121, 121,
    122, 123, 124, 126, 127, 128, 128, 129, 130, 130, 131, 132, 133, 134, 135, 137, 138, 138, 139, 140,
    140, 141, 142, 143, 144, 145, 146, 146, 147, 149, 150, 150, 151, 152, 152, 154, 155, 156, 156, 157,
    156, 159, 160, 161, 161, 163, 164, 165, 166, 167, 167, 168, 169, 169, 168, 172, 174, 174, 175, 176,
    176, 177, 178, 178, 179, 180, 181, 182, 183, 185, 185, 186, 187, 188, 188, 189, 190, 190, 192, 193,
    194, 194, 196, 197, 198, 198, 199, 200, 202, 202, 203, 204, 205, 205, 206, 208, 208, 209, 210, 212,
    212,
  ],
  media: [
    37, 38, 37, 43, 44, 46, 44, 52, 53, 51, 48, 56, 48, 54, 52, 61, 60, 60, 64, 64,
    65, 52, 58, 68, 61, 72, 74, 75, 74, 78, 79, 76, 76, 82, 81, 80, 75, 78, 83, 89,
    90, 91, 92, 86, 94, 91, 93, 96, 88, 99, 102, 95, 102, 103, 101, 105, 109, 101, 102, 110,
    112, 114, 109, 114, 106, 103, 121, 120, 122, 110, 123, 126, 122, 128, 128, 130, 132, 129, 135, 136,
    124, 138, 139, 132, 134, 121, 144, 145, 144, 147, 143, 143, 150, 150, 144, 150, 156, 157, 158, 158,
    159, 161, 159, 163, 163, 162, 158, 164, 167, 160, 168, 172, 174, 173, 167, 170, 171, 179, 180, 181,
    183, 177, 181, 186, 185, 186, 186, 188, 193, 194, 192, 196, 189, 195, 198, 194, 195, 203, 200, 202,
    204, 203, 208, 209, 207, 210, 213, 215, 215, 215, 218, 194, 219, 216, 221, 223, 221, 226, 226, 228,
    229, 231, 231, 232, 234, 235, 230, 232, 238, 240, 237, 242, 243, 242, 245, 245, 247, 245, 250, 248,
    251, 254, 253, 255, 252, 257, 259, 260, 262, 261, 258, 265, 262, 267, 261, 270, 270, 271, 267, 275,
    270,
  ],
  lujosa: [
    44, 54, 44, 50, 49, 52, 51, 58, 60, 56, 59, 56, 61, 66, 68, 68, 72, 63, 74, 76,
    71, 79, 71, 75, 86, 82, 79, 80, 85, 85, 84, 93, 89, 94, 86, 96, 100, 91, 102, 103,
    103, 101, 107, 113, 114, 107, 103, 112, 107, 113, 106, 115, 117, 108, 124, 128, 127, 113, 122, 123,
    131, 133, 146, 125, 135, 145, 139, 142, 139, 132, 134, 137, 148, 140, 145, 148, 149, 152, 154, 165,
    154, 154, 173, 149, 157, 165, 169, 165, 172, 177, 168, 162, 187, 191, 174, 192, 172, 181, 193, 173,
    187, 189, 181, 177, 193, 185, 180, 191, 195, 181, 209, 196, 206, 199, 206, 205, 211, 208, 206, 218,
    205, 205, 228, 214, 217, 229, 223, 235, 232, 219, 217, 226, 221, 242, 235, 246, 230, 245, 235, 230,
    253, 261, 237, 267, 243, 269, 236, 259, 266, 250, 249, 269, 263, 264, 260, 253, 245, 276, 265, 272,
    257, 258, 280, 272, 267, 263, 273, 271, 286, 282, 281, 283, 280, 285, 302, 286, 271, 288, 274, 288,
    295, 319, 308, 298, 312, 321, 297, 306, 291, 305, 314, 299, 287, 322, 322, 310, 334, 328, 345, 316,
    311,
  ],
};

const DIAMETROS_M = Array.from({ length: 201 }, (_, i) => Math.round((1 + i * 0.01) * 100) / 100);

const TRAMOS: Readonly<Record<keyof typeof MAXIMOS_MEDIDOS, readonly Tramo[]>> = {
  sencilla: [[1.0, 1.4, 8.4], [1.4, 1.8, 11.8], [1.8, 2.2, 13.3], [2.2, 3.0, 14.4]],
  media: [[1.0, 1.4, 10.2], [1.4, 1.8, 14.0], [1.8, 2.2, 17.0], [2.2, 3.0, 18.5]],
  lujosa: [[1.0, 1.4, 13.0], [1.4, 1.8, 19.0], [1.8, 2.2, 20.5], [2.2, 3.0, 21.2]],
};

export const DIAMETRO_ARO_MIN_M = 1.0;
export const DIAMETRO_ARO_MAX_M = 3.0;

export const FILAS_ARO_ORGANICO: readonly FilaBanda[] = (Object.entries(TRAMOS) as [keyof typeof TRAMOS, readonly Tramo[]][]).flatMap(([densidad, tramos]) =>
  tramos.map(([desde, hasta, minPorMetro]): FilaBanda => ({
    estructuras: ["aro_circular"], tamanos: ["organica_fina"], densidad, diametroM: [desde, hasta], minPorMetro,
    maxGlobosPorDiametro: MAXIMOS_MEDIDOS[densidad]
      .map((maximo, i): readonly [number, number] => [DIAMETROS_M[i]!, Math.floor(maximo * 1.05)])
      .filter(([diametro]) => diametro >= desde && diametro <= hasta),
    margenGlobos: 3, margenMaxGlobos: 0,
    origen: "medido",
    fuente: "Medido con la fachada (REQ-014 T60/P-092): aro " + densidad + " de " + desde + " a " + hasta + " m; máximos por centímetro, +5 %. Solo el aro sencilla de 2 m tiene evidencia PARIDAD (idea 28).",
  })),
);
