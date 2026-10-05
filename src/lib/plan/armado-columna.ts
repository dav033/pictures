import { z } from "zod";

/**
 * Armado de una columna de globos: su alto, cuántos globos lleva cada capa, de
 * qué tamaño son abajo y arriba, con qué patrón se pinta y qué remate la corona.
 * Es declarativo y apunta a `materiales` por índice, como `patron_color`
 * (ADR-0028), `armado_bouquet` (ADR-0030) y `armado_guirnalda` (ADR-0032).
 *
 * **La lógica tiene un dueño y no es este archivo.** El motor de la columna vive
 * en `clasificador-decoraciones` (`src/lib/columna/`) y su puerto verificado en
 * `services/ai-api/app/armado_columna.py`: de ahí salen las capas, la posición
 * de cada globo, su color y las medidas. Aquí solo está la **forma** de lo que
 * viaja en un plan, y las reglas cruzadas (tamaños que existen, salto de tamaño
 * entre capas vecinas, alto que admite el diámetro, remate que guarda
 * proporción) las valida únicamente Python. Un cambio de criterio se hace
 * primero en `clasificador-decoraciones`, se vuelven a generar los vectores de
 * `contracts/domain/v1/golden/columna/` y después se replica aquí.
 *
 * Ningún campo lleva `.default()`: Zod 4 lo exportaría como requerido y lo
 * escribiría dentro del plan que firma `plan_hash`.
 *
 * Lo que **no** entra, porque es pantalla y no estructura: el brillo, la
 * sombra, el contorno, el oscurecimiento por profundidad y la persona de
 * 1,70 m de referencia. Lo que tampoco entra, porque es comercial y lo cuenta
 * `plan.py`: el desperdicio, el precio y cuántas columnas iguales se arman.
 */

export const ARMADO_COLUMNA_VERSION = "armado-columna.v1" as const;

/**
 * Cómo se arma. `altura`: se pide un alto y el patrón decide el tamaño y el
 * color de cada capa. `capas`: la lista de capas **es** el diseño, y cada una
 * lleva su tamaño y el color de cada uno de sus globos.
 */
export const MODOS_COLUMNA = ["altura", "capas"] as const;
export type ModoColumna = (typeof MODOS_COLUMNA)[number];

/** Los nueve patrones de color de una columna (`clasificador-decoraciones/src/lib/columna/patrones.ts`). */
export const PATRONES_COLUMNA = [
  "solido",
  "apilado",
  "espiral",
  "rayas",
  "zigzag",
  "diamante",
  "punteado",
  "ombre",
  "aleatorio",
] as const;
export type PatronColumna = (typeof PATRONES_COLUMNA)[number];

/** Qué corona la columna. `ninguno` la deja a ras del último anillo. */
export const REMATES_COLUMNA = ["ninguno", "globo", "racimo", "estrella", "corazon"] as const;
export type RemateColumna = (typeof REMATES_COLUMNA)[number];

/**
 * Lo que la foto leyó del remate de una columna (ADR-0039). Es una **lectura**, no un armado: dice qué corona
 * la pieza y de qué color, y el motor pone el resto (el tamaño, los globos del racimo, el alto del foil).
 *
 * Que el campo esté o no es la mitad del dato, y por eso es opcional en el blueprint en vez de tener un valor
 * para «no se sabe»: **ausente** es «no se ve la punta» —la frena el borde de la foto, la tapa algo, está
 * borrosa— y entonces el motor pone su remate; `{ tipo: "ninguno" }` es «la punta no lleva nada», que es una
 * lectura y deja la columna a ras de su último anillo. Confundir las dos es coronar una columna que en la
 * foto no está coronada, o al contrario.
 *
 * `color` va por NOMBRE de catálogo, como el resto de la lectura de la foto: quien la lee no conoce los
 * índices de `materiales` de la pieza, y los resuelve Python con la misma tabla de tonos.
 */
export const RemateLeidoSchema = z
  .object({
    tipo: z.enum(REMATES_COLUMNA),
    color: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type RemateLeido = z.infer<typeof RemateLeidoSchema>;

/** La lectura del remate, dirigida al elemento de la referencia que materializa la columna. */
export const PistaRemateSchema = RemateLeidoSchema.extend({
  referencia_element_id: z.string().trim().min(1).max(80),
}).strict();

export type PistaRemate = z.infer<typeof PistaRemateSchema>;

/** Tamaños nominales de látex redondo del catálogo Sempertex que usa la columna. */
export const TAMANOS_COLUMNA = [5, 9, 12, 18, 24, 36] as const;
export type TamanoColumna = (typeof TAMANOS_COLUMNA)[number];

export const ORIGENES_ARMADO_COLUMNA = ["decorador", "referencia", "sugerido"] as const;

const IndiceMaterialSchema = z.number().int().min(0).max(11);
const TamanoSchema = z.union([
  z.literal(5),
  z.literal(9),
  z.literal(12),
  z.literal(18),
  z.literal(24),
  z.literal(36),
]);

/** Máximo de capas de una columna por capas (`MAX_CAPAS` del motor). */
export const MAX_CAPAS_COLUMNA = 60;
/** De 3 a 6 globos por capa: 4 es el cuarteto clásico. */
export const GLOBOS_CAPA_MIN = 3;
export const GLOBOS_CAPA_MAX = 6;

/**
 * Una capa (un anillo) de la columna por capas: el tamaño de sus globos y el
 * material de cada uno. El largo de `materiales` es cuántos globos lleva.
 */
const CapaColumnaSchema = z
  .object({
    tamano: TamanoSchema,
    materiales: z.array(IndiceMaterialSchema).min(GLOBOS_CAPA_MIN).max(GLOBOS_CAPA_MAX),
  })
  .strict();

export type CapaColumnaV1 = z.infer<typeof CapaColumnaSchema>;

/**
 * Forma y tamaño del cuerpo de globos. `abajo` y `arriba` son el tamaño de los
 * globos de la primera y la última capa: si difieren, la columna se afina (o se
 * ensancha) por tramos a lo largo de la altura. `escalonado` es lo normal —cada
 * capa gira medio paso sobre la de abajo y los globos caen en los huecos de la
 * anterior—; apagado, quedan apilados uno sobre otro.
 */
const CuerpoColumnaSchema = z
  .object({
    alto_m: z.number().min(0.5).max(6),
    globos_capa: z.number().int().min(GLOBOS_CAPA_MIN).max(GLOBOS_CAPA_MAX),
    abajo: TamanoSchema,
    arriba: TamanoSchema,
    escalonado: z.boolean(),
    /** Plato con peso al pie de la columna. Suma 6 cm de alto al total. */
    base: z.boolean(),
  })
  .strict();

/**
 * Cómo se infla y cuánto se aprieta, que es lo que decide cuántas capas caben
 * en un alto y cuánto se tocan los globos. No es decoración: cambia la
 * geometría y por eso viaja en el plan.
 */
const InfladoColumnaSchema = z
  .object({
    /** Respecto al diámetro típico del tamaño nominal (1 = normal). */
    inflado: z.number().min(0.8).max(1.1),
    /** Diámetro del globo respecto a la separación dentro de la capa (1 = se tocan). */
    tamano: z.number().min(1).max(1.4),
    /** Alto de una capa respecto al diámetro (0,8 = la fórmula profesional). */
    compresion: z.number().min(0.7).max(1),
    variacion_tam: z.number().min(0).max(0.3),
    variacion_tono: z.number().min(0).max(0.25),
    desorden: z.number().min(0).max(0.4),
    /** Misma semilla, misma columna: el motor es determinista. */
    semilla: z.number().int().min(1).max(99999),
  })
  .strict();

/**
 * El remate. `tamano` es el globo grande o los del racimo; `cantidad`, los
 * globos del racimo (3 a 5); `foil_m`, el alto de la estrella o el corazón.
 * Los campos que no aplican al tipo elegido los ignora Python.
 */
const RemateColumnaSchema = z
  .object({
    tipo: z.enum(REMATES_COLUMNA),
    tamano: TamanoSchema,
    cantidad: z.number().int().min(3).max(5),
    foil_m: z.number().min(0.3).max(2.5),
    material: IndiceMaterialSchema,
  })
  .strict();

/**
 * Las opciones numéricas del patrón, con las claves del motor. Van las del
 * patrón elegido; de las que falten, Python pone el valor de partida del
 * control (es lo mismo que hace `normalizarConfig` en el motor).
 */
const OpcionesPatronSchema = z
  .object({
    /** Espiral, rayas y zigzag: cuántas veces se repite la secuencia dando la vuelta. */
    vueltas: z.number().min(1).max(3).optional(),
    /** Espiral: 1 sigue la diagonal de los globos que se tocan; 0 son rayas rectas. */
    inclinacion: z.number().min(-2).max(2).optional(),
    /** Apilado: capas por banda de color. */
    grosor: z.number().min(1).max(8).optional(),
    /** Zigzag: cada cuántas capas cambia de sentido, y su inclinación. */
    periodo: z.number().min(2).max(12).optional(),
    amplitud: z.number().min(0.5).max(2).optional(),
    /** Diamante: rombos alrededor, capas de alto de cada rombo y qué parte de la celda ocupa. */
    repet: z.number().min(1).max(3).optional(),
    alto: z.number().min(4).max(16).optional(),
    grueso: z.number().min(0.3).max(0.9).optional(),
    /** Punteado: capas entre puntos y puntos por vuelta. */
    sepCapas: z.number().min(2).max(8).optional(),
    puntos: z.number().min(1).max(3).optional(),
    /** Ombré: globos que se cuelan en la frontera entre tonos, y el sentido. */
    suavidad: z.number().min(0).max(1).optional(),
    invertir: z.number().min(0).max(1).optional(),
  })
  .strict();

export type OpcionesPatronColumna = z.infer<typeof OpcionesPatronSchema>;

export const ArmadoColumnaV1Schema = z
  .object({
    version: z.literal(ARMADO_COLUMNA_VERSION),
    origen: z.enum(ORIGENES_ARMADO_COLUMNA),
    modo: z.enum(MODOS_COLUMNA),
    patron: z.enum(PATRONES_COLUMNA),
    opciones: OpcionesPatronSchema,
    cuerpo: CuerpoColumnaSchema,
    inflado: InfladoColumnaSchema,
    remate: RemateColumnaSchema,
    /**
     * Las capas de abajo hacia arriba. Solo se leen con `modo: "capas"`; con
     * `modo: "altura"` el patrón las decide y esta lista va vacía.
     */
    capas: z.array(CapaColumnaSchema).max(MAX_CAPAS_COLUMNA),
    /**
     * Los materiales que usa el patrón, en orden: el primero es el color
     * principal. Son índices de `materiales` de la estructura, y el patrón
     * toma los primeros que necesita (el ombré, tres; el resto, dos).
     */
    materiales: z.array(IndiceMaterialSchema).min(1).max(8),
  })
  .strict();

export type ArmadoColumnaV1 = z.infer<typeof ArmadoColumnaV1Schema>;

/** Un globo ya colocado por el motor: dónde va, de qué tamaño y de qué material. */
export const GloboColumnaResueltoSchema = z
  .object({
    /** Posición en metros: `x` a la derecha, `y` hacia arriba desde la base del cuerpo, `z` hacia quien mira. */
    x: z.number(),
    y: z.number(),
    z: z.number(),
    /** Radio en metros. */
    r: z.number(),
    material: IndiceMaterialSchema,
    tamano: TamanoSchema,
    /** Capa (0 = la de abajo) y puesto dentro de la capa. */
    capa: z.number().int().nonnegative(),
    puesto: z.number().int().nonnegative(),
    /** −1 (atrás) a 1 (adelante): con esto el dibujo decide el orden y el oscurecimiento. */
    prof: z.number().min(-1).max(1),
  })
  .strict();

export type GloboColumnaResuelto = z.infer<typeof GloboColumnaResueltoSchema>;

/**
 * La columna resuelta: lo que Python devuelve y la gráfica dibuja sin
 * recalcular nada. Los globos vienen ordenados de atrás hacia adelante, que es
 * el orden en el que hay que pintarlos.
 */
export const ColumnaResueltaSchema = z
  .object({
    version: z.literal(ARMADO_COLUMNA_VERSION),
    globos: z.array(GloboColumnaResueltoSchema).max(900),
    capas: z.number().int().nonnegative(),
    /** Medidas reales en metros: el cuerpo de globos, el total con base y remate, y el diámetro. */
    alto_cuerpo_m: z.number().nonnegative(),
    alto_total_m: z.number().nonnegative(),
    diametro_m: z.number().nonnegative(),
    remate_alto_m: z.number().nonnegative(),
    /** Globos por material y tamaño, en el orden en que el patrón nombra los materiales. */
    conteo: z
      .array(
        z
          .object({
            material: IndiceMaterialSchema,
            tamano: TamanoSchema,
            cantidad: z.number().int().positive(),
          })
          .strict(),
      )
      .max(48),
    remate: z
      .object({
        descripcion: z.string().min(1).max(120),
        globos: z
          .array(
            z
              .object({
                material: IndiceMaterialSchema,
                tamano: TamanoSchema,
                cantidad: z.number().int().positive(),
              })
              .strict(),
          )
          .max(8),
        /** Solo con remate de estrella o corazón: el foil no se cuenta como látex. */
        foil: z.string().min(1).max(120).optional(),
      })
      .strict(),
    /** Lo que `sanear` ajustó del armado pedido, en español y para mostrar. */
    avisos: z.array(z.string().min(1).max(240)).max(12),
    /**
     * Derivados para la imagen, igual que en el arco y en la guirnalda orgánica (ADR-0035): a qué estructura
     * pertenece y cómo le cuenta Python este armado a los modelos de imagen, en inglés (el del LoRA en ASCII
     * y sin cifras). Opcionales: los escribe la resolución, no el motor, y viajan **fuera** del snapshot, así
     * que no entran en `plan_hash`. TypeScript solo los inserta, tal cual.
     *
     * Sin ellos el caption solo sabe nombrar la pieza y sus colores, y lo que no dice lo inventa el LoRA con
     * lo que aprendió del corpus: el 2026-10-04, dos columnas orgánicas salieron coronadas por un globo
     * gigante que el plan apaga a propósito y que nadie estaba cobrando.
     */
    estructura_id: z.string().min(1).max(160).optional(),
    prompt_gemini: z.string().max(1500).optional(),
    prompt_lora: z.string().max(600).optional(),
  })
  .strict();

export type ColumnaResuelta = z.infer<typeof ColumnaResueltaSchema>;

/**
 * Lo que devuelve la ruta del editor: la columna resuelta **y su dibujo** (ADR-0034, ADR-0035 paso 3).
 *
 * El SVG lo emite el mismo motor que colocó los globos, así que la gráfica no vuelve a calcular nada: lo
 * muestra. Va aquí y no dentro del plan a propósito —son decenas de kilobytes por pieza, se regenera cuando haga
 * falta y no tiene por qué viajar en cada resolución ni entrar en `plan_hash`—. A diferencia del arco, el lienzo
 * de la columna no es cuadrado (600 × 720): lleva ancho y alto.
 */
export const VistaColumnaSchema = z
  .object({
    columna: ColumnaResueltaSchema,
    grafica: z
      .object({
        /** Lienzo del motor, para el `viewBox`. */
        lienzo: z.object({ ancho: z.number().int().positive(), alto: z.number().int().positive() }).strict(),
        /** El interior del `<svg>`: `<defs>` con los degradados y los globos, la base y el remate. */
        svg: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type VistaColumna = z.infer<typeof VistaColumnaSchema>;
