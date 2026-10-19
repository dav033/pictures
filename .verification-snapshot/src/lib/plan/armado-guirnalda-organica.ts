import { z } from "zod";

/**
 * Armado de una guirnalda con el motor del diseñador (ADR-0034): una tira larga de globos de varios tamaños
 * que corre en horizontal con una ondulación suave, con racimos que se solapan, globos que se salen de la
 * banda, follaje y flores. Es declarativo y apunta a `materiales` por índice, como el resto de los armados.
 *
 * **Convive con `armado-guirnalda.v1`, no lo reemplaza.** Aquel describe la guirnalda por racimos, relleno y
 * remates (ADR-0032) y está vivo, con su editor y sus fixtures. Este describe la del motor migrado, que
 * coloca cada globo. Cuando una pieza trae los dos, manda este.
 *
 * **El dueño de la lógica es `clasificador-decoraciones`** (`src/lib/guirnalda/` y `src/lib/organico/`),
 * migrado a `services/ai-api/app/guirnalda/` y `app/organico/` y probado contra 199 vectores de oro. Este
 * archivo es solo la forma: las reglas cruzadas —qué grosor admite un largo, qué tamaños caben en esa banda,
 * cuántos festones se sostienen— las valida únicamente `app/armado_guirnalda_organica.py`.
 *
 * Ningún campo lleva `.default()`: Zod 4 lo exportaría como requerido y lo escribiría dentro del plan que
 * firma `plan_hash`. **Los mandos del motor van en camelCase** porque son su vocabulario y viajan tal cual
 * hasta él; lo que mira el plan va en snake_case, como el resto de los contratos.
 */

export const ARMADO_GUIRNALDA_ORGANICA_VERSION = "armado-guirnalda-organica.v1" as const;

/** El acabado del látex, que es lo que de verdad distingue un globo de otro del mismo color. */
export const ACABADOS_GUIRNALDA = ["mate", "cromado", "confeti", "transparente"] as const;
export type AcabadoGuirnalda = (typeof ACABADOS_GUIRNALDA)[number];

/** Cómo se reparten los colores a lo largo de la tira. */
export const REPARTOS_GUIRNALDA = ["azar", "tramos", "racimos"] as const;
export type RepartoGuirnalda = (typeof REPARTOS_GUIRNALDA)[number];

/** Un color normal, o un acento: globos sueltos repartidos entre los demás. */
export const ROLES_GUIRNALDA = ["normal", "acento"] as const;
export type RolGuirnalda = (typeof ROLES_GUIRNALDA)[number];

/** Tamaños de globo redondo del catálogo (la pulgada nominal). */
export const TAMANOS_GUIRNALDA = [5, 9, 12, 18, 24, 36] as const;

export const ORIGENES_ARMADO_GUIRNALDA_ORGANICA = ["decorador", "referencia", "sugerido"] as const;

const IndiceMaterialSchema = z.number().int().min(0).max(11);

/** Un valor por tamaño de globo, todos opcionales: una mezcla nombra los tamaños que usa y no más. */
const porTamano = <T extends z.ZodType>(valor: T) =>
  z.object({
    "5": valor.optional(),
    "9": valor.optional(),
    "12": valor.optional(),
    "18": valor.optional(),
    "24": valor.optional(),
    "36": valor.optional(),
  }).strict();

const PesosPorTamanoSchema = porTamano(z.number().min(0).max(100));
export const CantidadesPorTamanoSchema = porTamano(z.number().int().nonnegative());

/** La línea de la guirnalda, en metros. */
export const FormaGuirnaldaOrganicaSchema = z
  .object({
    /** Largo de un extremo al otro. */
    largoM: z.number().min(0.8).max(10),
    /** Altura de la línea guía sobre el piso en el extremo izquierdo. */
    alturaM: z.number().min(0).max(4.5),
    /** Cuánto sube (+) o baja (−) el extremo derecho respecto al izquierdo. */
    pendienteM: z.number().min(-2).max(2),
    /** Amplitud de la ondulación y cuántas ondas hay a lo largo. */
    ondaM: z.number().min(0).max(0.8),
    ondas: z.number().min(0).max(6),
    /**
     * Cuánto se separa la línea de la recta que une sus extremos: 0 = tensa,
     * **positivo cuelga** en U entre los puntos de sujeción y **negativo arquea
     * hacia arriba** — la guirnalda tendida sobre un fondo que cae por los dos
     * lados hasta el piso, que es la más común sobre un backdrop y que hasta
     * 2026-10-03 no se podía dibujar: salía una tira plana.
     */
    colgadoM: z.number().min(-1.5).max(1.5),
    /** Cuántos festones (tramos colgados) forman la guirnalda. */
    festones: z.number().int().min(1).max(6),
    /** Lado más cargado: −1 izquierda, +1 derecha. Ese lado es más grueso y lleva los globos más grandes. */
    carga: z.number().min(-1).max(1),
    suelo: z.boolean(),
    /** Dibuja una persona de 1,70 m al lado para dar escala. */
    persona: z.boolean(),
  })
  .strict();

/** Grosor visible de la banda y cómo se agrupan los globos. */
export const VolumenGuirnaldaSchema = z
  .object({
    /** Grosor en los extremos y en el centro de la tira. */
    grosorPatasM: z.number().min(0.3).max(1.4),
    grosorCimaM: z.number().min(0.3).max(1.4),
    irregularidad: z.number().min(0).max(1),
    relleno: z.number().min(0).max(1),
    /** Globos por racimo. */
    racimo: z.number().int().min(1).max(8),
    /** Fracción de globos que se salen de la banda. */
    salientes: z.number().min(0).max(1),
  })
  .strict();

/**
 * Mezcla de tamaños y cómo se infla cada globo. Los pesos son relativos y el motor los normaliza; un tamaño
 * que no quepa en el grosor lo quita él, y lo dice en los avisos.
 */
export const TamanosGuirnaldaSchema = z
  .object({
    /**
     * Peso de cada tamaño, con la pulgada nominal como clave. Se escriben uno a uno y opcionales en vez de
     * con un `record`: Zod 4 exporta un record de claves enumeradas como un objeto con **todas** las claves
     * requeridas, y una mezcla de solo R5 y R12 —que es lo normal— dejaba de validar contra su propio
     * contrato.
     */
    mezcla: PesosPorTamanoSchema,
    grandesAbajo: z.number().min(0).max(1),
    inflado: z.number().min(0.8).max(1.1),
    variacion: z.number().min(0).max(0.3),
  })
  .strict();

/** Un color de la paleta: qué material de la pieza es, cuánto pesa, con qué acabado y en qué papel. */
export const ColorGuirnaldaSchema = z
  .object({
    material: IndiceMaterialSchema,
    /** Proporción relativa; el motor la normaliza. */
    peso: z.number().min(1).max(100),
    acabado: z.enum(ACABADOS_GUIRNALDA),
    rol: z.enum(ROLES_GUIRNALDA),
  })
  .strict();

export const ColoresGuirnaldaSchema = z
  .object({
    paleta: z.array(ColorGuirnaldaSchema).min(1).max(8),
    reparto: z.enum(REPARTOS_GUIRNALDA),
    /** Difuminado entre tramos / pureza de los racimos. */
    mezcla: z.number().min(0).max(1),
  })
  .strict();

/** Tallos de follaje y flores por metro de línea guía. No se cotizan: se listan. */
export const AdornosGuirnaldaSchema = z
  .object({ follaje: z.number().min(0).max(3), flores: z.number().min(0).max(3) })
  .strict();

export const AspectoGuirnaldaSchema = z
  .object({
    brillo: z.number().min(0).max(1),
    sombra: z.number().min(0).max(0.5),
    contorno: z.number().min(0).max(2),
    /** Cuánto se oscurecen los globos del fondo. */
    profundidad: z.number().min(0).max(1),
    semilla: z.number().int().min(1).max(99999),
  })
  .strict();

export const ArmadoGuirnaldaOrganicaV1Schema = z
  .object({
    version: z.literal(ARMADO_GUIRNALDA_ORGANICA_VERSION),
    origen: z.enum(ORIGENES_ARMADO_GUIRNALDA_ORGANICA),
    forma: FormaGuirnaldaOrganicaSchema,
    volumen: VolumenGuirnaldaSchema,
    tamanos: TamanosGuirnaldaSchema,
    colores: ColoresGuirnaldaSchema,
    adornos: AdornosGuirnaldaSchema,
    aspecto: AspectoGuirnaldaSchema,
  })
  .strict();

export type ArmadoGuirnaldaOrganicaV1 = z.infer<typeof ArmadoGuirnaldaOrganicaV1Schema>;

/** Un globo ya colocado por el motor. */
export const GloboGuirnaldaOrganicaSchema = z
  .object({
    /**
     * Posición y radio **en metros**, no en píxeles: `x` a la derecha desde el extremo izquierdo de la tira,
     * `y` hacia arriba desde el piso. Es la diferencia con el arco, cuyo motor coloca sobre su lienzo.
     *
     * Quien quiera dibujarlo no tiene que escalarlo: el SVG que emite el motor ya viene en su lienzo de
     * 760 × 440 y sale por `/api/plan-armado-guirnalda-organica`. Estos números son para medir, no para pintar.
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
 * La guirnalda resuelta: lo que Python devuelve y la gráfica muestra sin recalcular nada.
 *
 * El dibujo **no viaja aquí**: se pide a `/api/plan-armado-guirnalda-organica`, como el del arco.
 */
export const GuirnaldaOrganicaResueltaSchema = z
  .object({
    version: z.literal(ARMADO_GUIRNALDA_ORGANICA_VERSION),
    globos: z.array(GloboGuirnaldaOrganicaSchema).max(900),
    capas: z.number().int().nonnegative(),
    /** Medidas reales en metros. */
    ancho_m: z.number().nonnegative(),
    alto_m: z.number().nonnegative(),
    largo_m: z.number().nonnegative(),
    grosor_extremos_m: z.number().nonnegative(),
    grosor_centro_m: z.number().nonnegative(),
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
     * Derivados para la imagen, igual que en el arco (ADR-0035): a qué estructura pertenece y cómo le cuenta
     * Python este armado a los modelos de imagen, en inglés (el del LoRA en ASCII y sin cifras). Opcionales:
     * los escribe la resolución, no el motor, y viajan **fuera** del snapshot, así que no entran en
     * `plan_hash`. TypeScript solo los inserta, tal cual.
     *
     * Sin ellos el caption solo sabía decir «an organic balloon garland ... against the rear wall», que en el
     * vocabulario del LoRA v004 es la frase del arco a una palabra: la imagen salía como un arco de pie con
     * patas (2026-10-03, y ya anotado en la decisión 28 de ADR-0032 para la otra guirnalda).
     */
    estructura_id: z.string().min(1).max(160).optional(),
    prompt_gemini: z.string().max(1500).optional(),
    prompt_lora: z.string().max(600).optional(),
  })
  .strict();

export type GuirnaldaOrganicaResuelta = z.infer<typeof GuirnaldaOrganicaResueltaSchema>;
