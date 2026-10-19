import { GROSOR_ORGANICO_POR_DEFECTO_M } from "../../src/lib/globos3d/motor/medidas-espec";
import type { FilaBanda } from "./bandas";

/**
 * Las bandas de conteo de la columna orgánica (y su gemela asimétrica) **por grosor** (REQ-014 T61). El conteo por metro de
 * altura no es constante: sube con el grosor (tubo de 0,4 m ≈ 8 globos/m en ligera; de 1 m ≈ 18) y, en la densidad llena,
 * crece más rápido porque el relleno interior escala con la sección. Una sola banda de PARIDAD (grosor por defecto de 0,7 m)
 * dejaba fuera a todo lo más fino y a lo más grueso: 21 de 2000 escenarios del barrido de la semilla 1.
 *
 * El grosor por defecto (0,7 m) conserva su banda de PARIDAD, independiente de lo medido: es la única referencia externa de la columna.
 *
 * Medido con la fachada `armarDesdeEspec` (organica_fina, `anchoM` de 0,3 a 1,2 m **de 0,025 en 0,025**, alto de 0,8 a 4 m, las dos estructuras): por cada
 * tramo, el mínimo del 570 (que tiene R-9) y el máximo del 570 y del 056, con un 5 % de margen. Se miran los puntos del interior, no solo los bordes: el
 * conteo por metro no crece sin altibajos con el grosor (570 sencilla: 9,3-11,6/m a 0,3 m pero 6,8-8,8/m a 0,35 m; 13,3/m a 1,1 m y 11,7/m a 1,15 m).
 * Se mide también la asimétrica inclinada a la derecha (`lugar: "derecha"`), que da hasta 109,2/m a 1,2 m de grosor y 1,2 m de alto. El mínimo ignora las piezas de menos de 1,2 m, cuyo remate pesa más: los 3 globos de `TOLERANCIA_GLOBOS` lo cubren. Un tramo `hasta` incluye su borde
 * superior y sigue al anterior.
 *
 * Los colores sin R-9 (13 de ~80 códigos: 056, 909...) rellenan menos por metro: la tercera cifra de cada fila es la fracción del mínimo que se les perdona
 * (medida con el 056, con tope de `TOPE_MARGEN_SIN_R9`). Donde ese tope no alcanza, la clase de fallo está en `clases-permitidas.ts` con su extremo medido.
 * P-089 aplica el relleno compensado a las columnas directas; el margen sigue cubriendo diferencias de conteo que quedan dentro del 30 %.
 *
 * Cada tramo: [mínimo/m, máximo/m, fracción de mínimo perdonada sin R-9].
 */
type Cifras = readonly [minimo: number, maximo: number, sinR9: number];
type Tramo = { hasta: number; sencilla: Cifras; media: Cifras; lujosa: Cifras };

export const GROSOR_COLUMNA_MIN_M = 0.3;
export const GROSOR_COLUMNA_MAX_M = 1.2;
/** Lo más que se le perdona de su mínimo a una columna sin R-9: más allá, la clase de fallo se declara en `clases-permitidas.ts`. */
export const TOPE_MARGEN_SIN_R9 = 0.3;

const TRAMOS: readonly Tramo[] = [
  { hasta: 0.4, sencilla: [6.4, 26.3, 0.30], media: [8.3, 32.9, 0.30], lujosa: [11.3, 48.7, 0.25] },
  { hasta: 0.5, sencilla: [7.4, 12.2, 0.30], media: [9.7, 16.1, 0.30], lujosa: [11.3, 23.7, 0.10] },
  { hasta: 0.6, sencilla: [8.5, 14.9, 0.30], media: [11.3, 19.4, 0.30], lujosa: [13.7, 28.9, 0.15] },
  { hasta: 0.7, sencilla: [10.2, 16.7, 0.30], media: [13.7, 22.0, 0.30], lujosa: [16.9, 39.4, 0.20] },
  { hasta: 0.8, sencilla: [12.1, 18.7, 0.30], media: [15.6, 24.6, 0.30], lujosa: [21.8, 59.2, 0.30] },
  { hasta: 1.0, sencilla: [10.2, 24.3, 0.15], media: [16.6, 31.2, 0.30], lujosa: [29.2, 78.8, 0.30] },
  { hasta: 1.2, sencilla: [11.1, 27.7, 0.10], media: [17.3, 36.8, 0.25], lujosa: [46.8, 114.7, 0.30] },
];

const DENSIDADES = ["sencilla", "media", "lujosa"] as const;

/** La banda de PARIDAD para el grosor por defecto (`GROSOR_ORGANICO_POR_DEFECTO_M.columna`): densidad ligera 13-20/m, estándar 19-26/m, llena 24-40/m. */
const PARIDAD_GROSOR_POR_DEFECTO: Readonly<Record<(typeof DENSIDADES)[number], readonly [number, number, string]>> = {
  sencilla: [13, 20, "Densidad ligera 13-20/m (PARIDAD §2). Python: 15,1-17,1/m. Foto: 13,5-18,8/m."],
  media: [19, 26, "Densidad estándar 20-26/m (PARIDAD §2; calibracion-organica.ts cabecera). Python: 19,5-21,9/m."],
  lujosa: [24, 40, "Densidad llena 26-40/m (PARIDAD §2). Python: 23,0-27,5/m; foto: 22,9-39,8/m."],
};

const DEFECTO_M = GROSOR_ORGANICO_POR_DEFECTO_M.columna;

export const FILAS_COLUMNA_ORGANICA: readonly FilaBanda[] = [
  ...DENSIDADES.map((densidad): FilaBanda => {
    const [minPorMetro, maxPorMetro, fuente] = PARIDAD_GROSOR_POR_DEFECTO[densidad];
    return { estructuras: ["columna", "columna_asimetrica"], tamanos: ["organica_fina"], densidad, grosorM: [DEFECTO_M, DEFECTO_M], minPorMetro, maxPorMetro, margenBajoSinR9: TOPE_MARGEN_SIN_R9, origen: "paridad", fuente: `Grosor por defecto (${DEFECTO_M} m). ${fuente}` };
  }),
  ...TRAMOS.flatMap((tramo, i) => {
    const desde = i === 0 ? GROSOR_COLUMNA_MIN_M : TRAMOS[i - 1]!.hasta;
    return DENSIDADES.map((densidad): FilaBanda => {
      const [minPorMetro, maxPorMetro, margenBajoSinR9] = tramo[densidad];
      return {
        estructuras: ["columna", "columna_asimetrica"], tamanos: ["organica_fina"], densidad, grosorM: [desde, tramo.hasta], minPorMetro, maxPorMetro, margenBajoSinR9,
        origen: "medido", fuente: `Medido con la fachada (REQ-014 T61): columna ${densidad} de ${desde} a ${tramo.hasta} m de grosor, ${minPorMetro}-${maxPorMetro} globos/m (colores con R-9; sin R-9 se perdona el ${Math.round(margenBajoSinR9 * 100)} % del mínimo).`,
      };
    });
  }),
];
