import { z } from "zod";

/**
 * Armado de un arco: la banda de globos que sigue una línea guía, con su patrón de color, sus capas a lo ancho
 * y sus secciones por altura. Es declarativo y apunta a `materiales` por índice, como `patron_color`
 * (ADR-0028), `armado_bouquet` (ADR-0030), `armado_guirnalda` (ADR-0032) y `armado_columna` (ADR-0033).
 *
 * **El dueño de la lógica es `clasificador-decoraciones`** (`src/lib/arco/`), migrado 1 a 1 a
 * `services/ai-api/app/arco/` y probado contra 259 vectores de oro. Este archivo es solo la forma: las reglas
 * cruzadas —qué patrón admite cuántos colores, qué ancho necesita un globo R36, cuántos globos caben a lo
 * ancho antes de que la banda tape la abertura— las valida únicamente `app/armado_arco.py`. Repetirlas aquí
 * sería un segundo dueño.
 *
 * Ningún campo lleva `.default()`: Zod 4 lo exportaría como requerido y lo escribiría dentro del plan que
 * firma `plan_hash`.
 *
 * **Los mandos del motor van en camelCase** (`anchoM`, `globosAncho`, `variacionTono`) porque son el
 * vocabulario del motor y viajan tal cual hasta él; lo que mira el plan va en snake_case, como el resto de
 * los contratos. Traducir los nombres en la frontera sería el sitio donde se pierde un mando sin que nada
 * falle.
 */

export const ARMADO_ARCO_VERSION = "armado-arco.v1" as const;

/** La línea guía del arco: medio punto, un arco más alto que ancho, o una herradura con patas rectas. */
export const FORMAS_ARCO = ["alto", "semi", "herradura"] as const;
export type FormaArco = (typeof FORMAS_ARCO)[number];

/** Los catorce patrones del diseñador. El orden es el de `PATRON_IDS` del motor. */
export const PATRONES_ARCO = [
  "solido",
  "bloques",
  "apilado",
  "espiral",
  "espiralPunteada",
  "zigzag",
  "chevron",
  "diamante",
  "punteado",
  "franjas",
  "floral",
  "ombre",
  "arcoiris",
  "doslados",
] as const;
export type PatronArco = (typeof PATRONES_ARCO)[number];

/** Tamaños de globo redondo del catálogo (la pulgada nominal). */
export const TAMANOS_ARCO = [5, 9, 12, 18, 24, 36] as const;
export type TamanoArco = (typeof TAMANOS_ARCO)[number];

export const ORIGENES_ARMADO_ARCO = ["decorador", "referencia", "sugerido"] as const;

/** Máximo de colores de la secuencia de una capa o de una sección (`MAX_SECUENCIA_ARCO` del motor). */
export const MAX_SECUENCIA_ARCO = 16;

/** Secciones por altura que puede llegar a tener un arco (tramos de 0,4 m). */
export const MAX_SECCIONES_ARCO = 40;

const IndiceMaterialSchema = z.number().int().min(0).max(11);
const TamanoSchema = z.literal(TAMANOS_ARCO);

/**
 * Forma y tamaño del arco. El **grosor de la banda no se elige**: sale del tamaño del globo y de cuántos van
 * a lo ancho, como cuando se arma de verdad.
 */
export const GeometriaArcoSchema = z
  .object({
    forma: z.enum(FORMAS_ARCO),
    /** Ancho exterior (m). */
    anchoM: z.number().min(0.8).max(10),
    /** Alto exterior (m). Con `forma: "semi"` lo deduce del ancho y este valor se ignora. */
    altoM: z.number().min(0.8).max(6),
    /** Cuántos globos caben a lo ancho de la banda (el arcoíris admite hasta 16: varios por banda). */
    globosAncho: z.number().int().min(2).max(16),
    suelo: z.boolean(),
  })
  .strict();

export type GeometriaArco = z.infer<typeof GeometriaArcoSchema>;

/**
 * Qué globo se usa y cómo se ve el conjunto. Los rangos son los del motor (`normalizarConfig`): lo que se
 * salga se acota allá, no se rechaza, porque un enlace viejo tiene que poder abrirse.
 */
export const GloboArcoSchema = z
  .object({
    nominal: TamanoSchema,
    /** Cuánto se infla respecto al tamaño típico (1 = normal). */
    inflado: z.number().min(0.8).max(1.1),
    /** Diámetro respecto a la separación entre columnas (1 = se tocan, >1 = se solapan). */
    tamano: z.number().min(0.9).max(1.5),
    /** Alargamiento del globo a lo largo del arco (1 = círculo). */
    ovalo: z.number().min(1).max(1.4),
    /** Separación entre filas (1 = empaquetado hexagonal). */
    separacion: z.number().min(0.7).max(1.4),
    /** Ajuste en las curvas: agranda los de afuera y achica los de adentro para que se toquen parejo. */
    compensacion: z.number().min(0).max(1),
    variacionTam: z.number().min(0).max(0.3),
    variacionTono: z.number().min(0).max(0.25),
    desorden: z.number().min(0).max(0.4),
    brillo: z.number().min(0).max(1),
    sombra: z.number().min(0).max(0.5),
    contorno: z.number().min(0).max(3),
    /** Cuánto se oscurecen los globos de los bordes de la banda (los que quedan atrás). */
    profundidad: z.number().min(0).max(1),
    semilla: z.number().int().min(1).max(99999),
  })
  .strict();

export type GloboArco = z.infer<typeof GloboArcoSchema>;

/**
 * Los mandos propios del patrón elegido. Son todos opcionales porque cada patrón tiene los suyos: el motor
 * (`opciones_admitidas()` de `armado_arco.py`) dice cuáles aplican, con su rango y su valor por defecto, y
 * acota los que lleguen fuera de rango. Esta lista es la unión de los catorce.
 */
export const OpcionesPatronArcoSchema = z
  .object({
    /** Espiral, zigzag, chevron y franjas: ancho de la franja en filas de globos. */
    ancho: z.number().min(0.5).max(6).optional(),
    /** Espiral, chevron y franjas: 2 sigue la diagonal de los globos; 0 son franjas rectas. */
    inclinacion: z.number().min(-3).max(4).optional(),
    /** Espiral: cada cuántas filas cambia de sentido el giro; 0 = nunca. */
    inversion: z.number().min(0).max(20).optional(),
    /** Casi todos: las dos patas quedan reflejadas. */
    espejo: z.number().min(0).max(1).optional(),
    /** Bloques: filas de cada bloque (0 reparte en partes iguales) y globos que se cuelan al vecino. */
    largo: z.number().min(0).max(20).optional(),
    mezcla: z.number().min(0).max(4).optional(),
    /** Apilado, chevron, ombré, arcoíris: invierte el orden o la dirección. */
    invertir: z.number().min(0).max(1).optional(),
    /** Espiral punteada: cada cuántos globos del color B aparece el punto. */
    cadaN: z.number().min(1).max(6).optional(),
    /** Zigzag: cuánto sube y baja cada quiebre (filas) y cuánto tarda en cambiar de dirección. */
    amplitud: z.number().min(0).max(8).optional(),
    /** Zigzag, diamante: largo del zigzag / separación entre rombos. */
    periodo: z.number().min(1).max(16).optional(),
    /** Diamante y floral: tamaño del rombo o de la flor. */
    radio: z.number().min(0.8).max(5).optional(),
    /** Diamante: cuánto se aplasta el rombo a lo largo del arco. */
    aspecto: z.number().min(0.5).max(1.8).optional(),
    /** Punteado y floral: filas entre lunares o entre flores. */
    sepFilas: z.number().min(2).max(16).optional(),
    /** Punteado: cada cuántos globos de la fila hay un lunar. */
    sepAncho: z.number().min(1).max(4).optional(),
    /** Punteado: tamaño del lunar respecto a los globos del fondo. */
    tamanoPunto: z.number().min(0.8).max(1.8).optional(),
    /** Punteado: desplaza los lunares de una fila a la siguiente. */
    escalonar: z.number().min(0).max(1).optional(),
    /** Floral: tamaño de los pétalos y si las flores alternan de lado. */
    escalaPetalo: z.number().min(1).max(1.8).optional(),
    alternar: z.number().min(0).max(1).optional(),
    /** Ombré: 0 a lo largo, 1 simétrico, 2 a lo ancho; y cuánto se mezclan dos tonos en la frontera. */
    modo: z.number().min(0).max(2).optional(),
    suavidad: z.number().min(0).max(1).optional(),
    /** Dos lados: dónde cambia de color a lo ancho de la banda. */
    corte: z.number().min(0.2).max(0.8).optional(),
  })
  .strict();

export type OpcionesPatronArco = z.infer<typeof OpcionesPatronArcoSchema>;

/**
 * Una secuencia de colores propia, por índice de material. `null` = sigue el patrón.
 *
 * En una **capa** (a lo ancho, de afuera hacia adentro) la secuencia se repite a lo largo del arco. En una
 * **sección** (por altura, tramos de 0,4 m desde el piso) hay un color por capa a lo ancho y manda sobre las
 * capas y sobre el patrón.
 */
const SecuenciaSchema = z.array(IndiceMaterialSchema).min(1).max(MAX_SECUENCIA_ARCO).nullable();

export const ArmadoArcoV1Schema = z
  .object({
    version: z.literal(ARMADO_ARCO_VERSION),
    origen: z.enum(ORIGENES_ARMADO_ARCO),
    patron: z.enum(PATRONES_ARCO),
    opciones: OpcionesPatronArcoSchema,
    geometria: GeometriaArcoSchema,
    globo: GloboArcoSchema,
    /** Una por globo a lo ancho, de afuera hacia adentro. Vacía = todas siguen el patrón. */
    capas: z.array(SecuenciaSchema).max(16),
    /** De abajo hacia arriba, una por tramo de 0,4 m. Vacía = ninguna personalizada. */
    secciones: z.array(SecuenciaSchema).max(MAX_SECCIONES_ARCO),
    /**
     * Los materiales que usa el patrón, en orden: el primero es el color principal. Son índices de
     * `materiales` de la estructura, y cada patrón toma los que necesita (el sólido, uno; el arcoíris, hasta
     * ocho).
     */
    materiales: z.array(IndiceMaterialSchema).min(1).max(8),
  })
  .strict();

export type ArmadoArcoV1 = z.infer<typeof ArmadoArcoV1Schema>;

/** Un globo ya colocado por el motor: dónde va, de qué tamaño se dibuja y de qué material es. */
export const GloboArcoResueltoSchema = z
  .object({
    /** Posición en píxeles del lienzo del motor (600 × 600), que es donde el dibujo tiene sentido. */
    x: z.number(),
    y: z.number(),
    rx: z.number().nonnegative(),
    ry: z.number().nonnegative(),
    /** Giro en grados, ya cuantizado a pasos de 15°. */
    rot: z.number().int().min(0).max(359),
    material: IndiceMaterialSchema,
    /** Fila a lo largo del arco, capa a lo ancho (0 = la de afuera) y sección por altura (0 = la del piso). */
    fila: z.number().int().nonnegative(),
    carril: z.number().int().nonnegative(),
    seccion: z.number().int().nonnegative(),
    /** −1 (atrás) a 1 (adelante): con esto el dibujo decide el oscurecimiento. */
    prof: z.number().min(-1).max(1),
  })
  .strict();

export type GloboArcoResuelto = z.infer<typeof GloboArcoResueltoSchema>;

/**
 * El arco resuelto: lo que Python devuelve y la gráfica muestra sin recalcular nada. Los globos vienen
 * ordenados de atrás hacia adelante, que es el orden en el que hay que pintarlos.
 *
 * Las posiciones van en **píxeles del lienzo del motor**, no en metros, a diferencia de la columna. No es
 * descuido: el motor del arco coloca sobre su lienzo y de ahí sale su SVG; pasarlo a metros aquí y volverlo a
 * píxeles en el cliente sería reimplementar su escala, que es justo lo que esta migración viene a quitar. Las
 * medidas reales van aparte, en `ancho_m`, `alto_m`, `grosor_m` y `largo_m`.
 */
export const ArcoResueltoSchema = z
  .object({
    version: z.literal(ARMADO_ARCO_VERSION),
    globos: z.array(GloboArcoResueltoSchema).max(1200),
    filas: z.number().int().nonnegative(),
    columnas: z.number().int().nonnegative(),
    secciones: z.number().int().nonnegative(),
    /** Medidas reales en metros: el arco, el grosor de la banda y el largo de la línea guía. */
    ancho_m: z.number().nonnegative(),
    alto_m: z.number().nonnegative(),
    grosor_m: z.number().nonnegative(),
    largo_m: z.number().nonnegative(),
    diametro_m: z.number().nonnegative(),
    /** Densidad lograda y la que daría la fórmula clásica de cuartetos (N = 4,8 · L / d), para comparar. */
    globos_por_metro: z.number().nonnegative(),
    formula_clasica: z.number().nonnegative(),
    conteo: z
      .array(z.object({ material: IndiceMaterialSchema, cantidad: z.number().int().positive() }).strict())
      .max(16),
    /** Lo que hay que comprar: el conteo con el margen de desperdicio redondeado hacia arriba. */
    compra: z
      .array(
        z
          .object({
            material: IndiceMaterialSchema,
            cantidad: z.number().int().positive(),
            comprar: z.number().int().positive(),
          })
          .strict(),
      )
      .max(16),
    total_comprar: z.number().int().nonnegative(),
    /** Lo que el motor corrigió del armado pedido, en español, para mostrarlo. */
    avisos: z.array(z.string().min(1).max(300)).max(16),
  })
  .strict();

export type ArcoResuelto = z.infer<typeof ArcoResueltoSchema>;

/**
 * Lo que devuelve la ruta del editor: el arco resuelto **y su dibujo**.
 *
 * El SVG lo emite el mismo motor que colocó los globos, así que la gráfica no vuelve a calcular nada: lo
 * muestra. Va aquí y no dentro del plan a propósito — son decenas de kilobytes por pieza, se regenera cuando
 * haga falta y no tiene por qué viajar en cada resolución ni entrar en `plan_hash`.
 */
export const VistaArcoSchema = z
  .object({
    arco: ArcoResueltoSchema,
    grafica: z
      .object({
        /** Lado del lienzo cuadrado del motor, para el `viewBox`. */
        lienzo: z.number().int().positive(),
        /** El interior del `<svg>`: `<defs>` con los degradados y un `<g data-…>` por globo. */
        svg: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type VistaArco = z.infer<typeof VistaArcoSchema>;
