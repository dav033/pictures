import { z } from "zod";
import {
  ACABADOS_GUIRNALDA,
  AdornosGuirnaldaSchema,
  AspectoGuirnaldaSchema,
  CantidadesPorTamanoSchema,
  ColoresGuirnaldaSchema,
  TAMANOS_GUIRNALDA,
  TamanosGuirnaldaSchema,
} from "./armado-guirnalda-organica";

/**
 * Armado de una columna orgánica con el motor del diseñador (ADR-0034): una columna irregular de globos de varios
 * tamaños, más ancha abajo que arriba, con racimos que se solapan, globos que se salen de la banda, follaje y flores, y
 * un globo grande opcional sobre la punta. Es declarativo y apunta a `materiales` por índice, como el resto de los
 * armados.
 *
 * **Convive con `armado-columna.v1`, no lo reemplaza.** Aquel es la columna clásica de anillos de 3 a 6 globos (la
 * torre de cuartetos, con patrones de color); este es la columna orgánica, que no lleva anillos ni patrones sino una
 * mezcla de tamaños y una paleta con su acabado. Cuando una pieza trae los dos, manda el clásico: es el que ya
 * existía.
 *
 * **El dueño de la lógica es `clasificador-decoraciones`** (`src/lib/columnaorg/` y `src/lib/organico/`), migrado a
 * `services/ai-api/app/columnaorg/` y `app/organico/` y probado contra 216 vectores de oro. Este archivo es solo la
 * forma: las reglas cruzadas —qué alto admite un grosor, qué tamaños caben en esa banda, qué globo guarda proporción
 * con la punta— las valida únicamente `app/armado_columna_organica.py`.
 *
 * Ningún campo lleva `.default()`: Zod 4 lo exportaría como requerido y lo escribiría dentro del plan que firma
 * `plan_hash`. **Los mandos del motor van en camelCase** porque son su vocabulario y viajan tal cual hasta él; lo que
 * mira el plan va en snake_case, como el resto de los contratos. La mezcla de tamaños, la paleta, los adornos y el
 * aspecto son los mismos esquemas que la guirnalda orgánica: es el mismo motor compartido.
 */

export const ARMADO_COLUMNA_ORGANICA_VERSION = "armado-columna-organica.v1" as const;

export const ORIGENES_ARMADO_COLUMNA_ORGANICA = ["decorador", "referencia", "sugerido"] as const;

const IndiceMaterialSchema = z.number().int().min(0).max(11);

/** La silueta de la columna, en metros. */
export const FormaColumnaOrganicaSchema = z
  .object({
    /** Alto de la columna, con el globo de la punta. */
    altoM: z.number().min(0.5).max(6),
    /** Cuánto se corre la punta hacia un lado: negativo, hacia la izquierda. */
    inclinacionM: z.number().min(-2).max(2),
    /** Amplitud de la S con que serpentea la línea. */
    serpenteoM: z.number().min(0).max(1),
    /** Cuánto tiembla la línea (0 = recta). */
    ondulacion: z.number().min(0).max(1),
    suelo: z.boolean(),
    /** Dibuja una persona de 1,70 m al lado para dar escala. */
    persona: z.boolean(),
  })
  .strict();

/** Grosor visible de la columna y cómo se agrupan los globos. */
export const VolumenColumnaOrganicaSchema = z
  .object({
    /** Grosor de la base y de la punta. */
    grosorPatasM: z.number().min(0.2).max(3),
    grosorCimaM: z.number().min(0.2).max(3),
    irregularidad: z.number().min(0).max(1),
    relleno: z.number().min(0).max(1),
    /** Globos por racimo. */
    racimo: z.number().int().min(1).max(8),
    /** Fracción de globos que se salen de la banda. */
    salientes: z.number().min(0).max(1),
  })
  .strict();

/** El globo grande sobre la punta: si está, de qué tamaño y de qué material de la pieza. */
export const CoronaColumnaOrganicaSchema = z
  .object({
    activa: z.boolean(),
    tamano: z.union([z.literal(5), z.literal(9), z.literal(12), z.literal(18), z.literal(24), z.literal(36)]),
    material: IndiceMaterialSchema,
  })
  .strict();

export const ArmadoColumnaOrganicaV1Schema = z
  .object({
    version: z.literal(ARMADO_COLUMNA_ORGANICA_VERSION),
    origen: z.enum(ORIGENES_ARMADO_COLUMNA_ORGANICA),
    forma: FormaColumnaOrganicaSchema,
    volumen: VolumenColumnaOrganicaSchema,
    tamanos: TamanosGuirnaldaSchema,
    colores: ColoresGuirnaldaSchema,
    adornos: AdornosGuirnaldaSchema,
    aspecto: AspectoGuirnaldaSchema,
    corona: CoronaColumnaOrganicaSchema,
  })
  .strict();

export type ArmadoColumnaOrganicaV1 = z.infer<typeof ArmadoColumnaOrganicaV1Schema>;

/** Un globo ya colocado por el motor (el de la punta, si lo hay, es el último en profundidad). */
export const GloboColumnaOrganicaSchema = z
  .object({
    /**
     * Posición y radio **en metros**: `x` a la derecha desde la base, `y` hacia arriba desde el piso. Quien quiera
     * dibujarlo no tiene que escalarlo: el SVG que emite el motor ya viene en su lienzo de 600 × 720 y sale por
     * `/api/plan-armado-columna-organica`. Estos números son para medir, no para pintar.
     */
    x: z.number(),
    y: z.number(),
    r: z.number().nonnegative(),
    /** Capa de profundidad: 0 es la del fondo. */
    capa: z.number().int().nonnegative(),
    tamano: z.literal(TAMANOS_GUIRNALDA),
    material: IndiceMaterialSchema,
    acabado: z.enum(ACABADOS_GUIRNALDA),
  })
  .strict();

/**
 * La columna orgánica resuelta: lo que Python devuelve y la gráfica muestra sin recalcular nada.
 *
 * El dibujo **no viaja aquí**: se pide a `/api/plan-armado-columna-organica`, como el del arco.
 */
export const ColumnaOrganicaResueltaSchema = z
  .object({
    version: z.literal(ARMADO_COLUMNA_ORGANICA_VERSION),
    globos: z.array(GloboColumnaOrganicaSchema).max(901),
    capas: z.number().int().nonnegative(),
    /** Medidas reales en metros. */
    ancho_m: z.number().nonnegative(),
    alto_m: z.number().nonnegative(),
    grosor_base_m: z.number().nonnegative(),
    grosor_punta_m: z.number().nonnegative(),
    globos_por_metro: z.number().nonnegative(),
    globos_por_pie: z.number().nonnegative(),
    /** Globos que quedaron sin tocar a ningún otro. Con el motor bien puesto es 0, y si no lo es, se ve. */
    sueltos: z.number().int().nonnegative(),
    conteo: z
      .array(
        z
          .object({
            material: IndiceMaterialSchema,
            tamano: z.literal(TAMANOS_GUIRNALDA),
            acabado: z.enum(ACABADOS_GUIRNALDA),
            cantidad: z.number().int().positive(),
          })
          .strict(),
      )
      .max(64),
    /** Lo que hay que comprar por material y tamaño, con el desperdicio redondeado hacia arriba. */
    compra: z
      .array(
        z
          .object({
            material: IndiceMaterialSchema,
            por_tamano: CantidadesPorTamanoSchema,
            cantidad: z.number().int().positive(),
            comprar: z.number().int().positive(),
          })
          .strict(),
      )
      .max(16),
    total_comprar: z.number().int().nonnegative(),
    /** Follaje y flores: se listan para que nadie los olvide, pero no están en el catálogo de globos. */
    adornos: z.object({ ramas: z.number().int().nonnegative(), flores: z.number().int().nonnegative() }).strict(),
    /** Lo que el motor corrigió del armado pedido, en español, para mostrarlo. */
    avisos: z.array(z.string().min(1).max(300)).max(32),
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

export type ColumnaOrganicaResuelta = z.infer<typeof ColumnaOrganicaResueltaSchema>;
