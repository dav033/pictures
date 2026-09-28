import { z } from "zod";

/**
 * Armado de una guirnalda por partes (ADR-0032): sobre qué se apoya, qué forma
 * toma, de qué racimos se arma, qué relleno lleva entre racimos y qué remates.
 * Es declarativo y apunta a `materiales` por índice, como `patron_color`
 * (ADR-0028) y `armado_bouquet` (ADR-0030). No lleva cantidades: los globos
 * los cuenta el resolutor con las medidas y la mezcla, y el armado los reparte
 * en racimos, relleno y remates sin cambiar lo que se compra.
 *
 * Solo forma. Las reglas cruzadas (pieza anfitriona, anclajes, relleno con
 * globos chicos, remates con globos grandes, racimos del patrón, que el armado
 * use exactamente lo que se compra) las valida únicamente
 * `services/ai-api/app/armado_guirnalda.py`. Ningún campo lleva `.default()`:
 * Zod 4 lo exportaría como requerido y lo escribiría dentro del plan que firma
 * `plan_hash`.
 */

export const ARMADO_GUIRNALDA_VERSION = "armado-guirnalda.v1" as const;

/** Sobre qué va la guirnalda: la pared, colgada de puntos de anclaje, el piso, una mesa u otra pieza del plan. */
export const SOPORTES_GUIRNALDA = ["pared", "colgada", "piso", "mesa", "sobre_estructura"] as const;
export type SoporteGuirnalda = (typeof SOPORTES_GUIRNALDA)[number];

/**
 * Soportes donde una forma que cuelga tiene de dónde colgar y donde un extremo
 * puede ir más alto que el otro (`desnivel_m`, ADR-0032 decisión 26): la
 * pared y colgada. En el piso, sobre la mesa o sobre otra pieza los extremos
 * van a la altura de lo que la sostiene. Viaja en `plan-decoracion.v1` como
 * `x-reglas-guirnalda` (`reglasGuirnalda`): Python lo lee como
 * `SOPORTES_CON_CAIDA` y el editor decide con él qué controles muestra; la
 * regla es una sola.
 */
export const SOPORTES_CON_CAIDA_GUIRNALDA = ["pared", "colgada"] as const satisfies readonly SoporteGuirnalda[];

/** Lo que viaja en `plan-decoracion.v1` como `x-reglas-guirnalda`. */
export function reglasGuirnalda(): { soportesConCaida: SoporteGuirnalda[] } {
  return { soportesConCaida: [...SOPORTES_CON_CAIDA_GUIRNALDA] };
}

/**
 * Forma de la guirnalda a lo largo de su eje. `u_invertida` y `arco_caido`
 * cuelgan de sus extremos: con `caida_m` su largo real es el de la cuerda
 * (geometría en `estructuras-oficiales.ts`, `x-geometria-estructuras-oficiales`).
 */
export const FORMAS_GUIRNALDA = ["recta", "curva", "ondulada", "u_invertida", "arco_caido"] as const;
export type FormaGuirnalda = (typeof FORMAS_GUIRNALDA)[number];

/** Unidades de armado de la técnica Sempertex que usa una guirnalda. */
export const UNIDADES_RACIMO_GUIRNALDA = ["trio", "cuarteto", "quinteto"] as const;
export type UnidadRacimoGuirnalda = (typeof UNIDADES_RACIMO_GUIRNALDA)[number];

/** Tamaño de los globos del racimo (11" es el estándar de Qualatex; 12", el de Sempertex). */
export const TAMANOS_BASE_RACIMO = [9, 11, 12] as const;

/** Dónde va un remate: un extremo, el centro, o repartido a lo largo (uno cada n racimos). */
export const POSICIONES_REMATE_GUIRNALDA = ["extremo_izq", "extremo_der", "centro", "cada_n"] as const;
export type PosicionRemateGuirnalda = (typeof POSICIONES_REMATE_GUIRNALDA)[number];

export const ORIGENES_ARMADO_GUIRNALDA = ["decorador", "referencia", "sugerido"] as const;

/** Lo que el armado necesita y el catálogo no vende: se lista, nunca se cotiza. */
export const INSUMOS_GUIRNALDA = ["tira", "cuerda", "ganchos", "pegante", "pesa", "amarres", "tijeras", "bomba"] as const;
export type InsumoGuirnalda = (typeof INSUMOS_GUIRNALDA)[number];

const IndiceMaterialSchema = z.number().int().min(0).max(11);
const EnteroPositivo = z.number().int().positive();
const EnteroNoNegativo = z.number().int().nonnegative();

export const ArmadoGuirnaldaV1Schema = z.object({
  version: z.literal(ARMADO_GUIRNALDA_VERSION),
  origen: z.enum(ORIGENES_ARMADO_GUIRNALDA),
  soporte: z.enum(SOPORTES_GUIRNALDA),
  /** Solo con `soporte: "sobre_estructura"`: la pieza del plan sobre la que va. */
  estructura_id: z.string().regex(/^EST_\d{2}_[A-Z_]+$/).optional(),
  forma: z.enum(FORMAS_GUIRNALDA),
  /**
   * Cuánto baja el centro respecto de la recta que une los extremos, en
   * metros (formas que cuelgan; en la U invertida, cuánto bajan sus lados).
   */
  caida_m: z.number().positive().max(5).optional(),
  /**
   * Altura del extremo derecho menos la del izquierdo, en metros: negativo si
   * la guirnalda cae hacia la derecha. Cualquier forma, solo en pared o
   * colgada (`SOPORTES_CON_CAIDA_GUIRNALDA`). La cuerda une dos
   * extremos a distinta altura, así que cambia los globos que se compran
   * (ADR-0032, decisión 26).
   */
  desnivel_m: z.number().min(-5).max(5).optional(),
  /** Puntos de donde se cuelga o se fija; obligatorio con `soporte: "colgada"`. */
  puntos_de_anclaje: z.number().int().min(2).max(6).optional(),
  racimo: z.object({
    unidad: z.enum(UNIDADES_RACIMO_GUIRNALDA),
    tamano_pulg_base: z.literal(TAMANOS_BASE_RACIMO),
  }).strict(),
  /**
   * Globos chicos entre racimos. `proporcion` es la parte de los globos de la
   * guirnalda que va de relleno; salen de la mezcla (nunca se compran aparte)
   * y `material` es el color que se usa primero.
   */
  relleno: z.object({
    material: IndiceMaterialSchema,
    proporcion: z.number().min(0).max(0.5),
  }).strict().nullable(),
  /** Globos grandes de la guirnalda puestos en un extremo, al centro o repartidos. */
  remates: z.array(z.object({
    material: IndiceMaterialSchema,
    posicion: z.enum(POSICIONES_REMATE_GUIRNALDA),
  }).strict()).max(6),
}).strict();

export type ArmadoGuirnaldaV1 = z.infer<typeof ArmadoGuirnaldaV1Schema>;

const CodigoCantidadSchema = z.object({ codigo: EnteroPositivo, cantidad: EnteroPositivo }).strict();

/**
 * Lo que Python devuelve de un armado: leyenda con un código por globo
 * comprado (material × tamaño), racimos numerados de izquierda a derecha
 * (la fila `i` de la rejilla del patrón es el racimo `i + 1`), relleno,
 * remates, sueltos, insumos no cotizados, duración estimada, pasos, avisos y
 * las frases del prompt de imagen. Viaja en `plan_resuelto.armados_guirnalda`,
 * fuera del snapshot que firma `plan_hash`. La UI solo lo dibuja.
 */
export const ArmadoGuirnaldaResueltoSchema = z.object({
  estructura_id: z.string().min(1).max(160),
  armado: ArmadoGuirnaldaV1Schema,
  repeticiones: EnteroPositivo,
  /** Largo declarado de la pieza y largo real de su cuerda (con la caída), en metros. */
  largo_m: z.number().nonnegative(),
  largo_cuerda_m: z.number().nonnegative(),
  /** Globos de una guirnalda: la suma de racimos, relleno, remates y sueltos. */
  globos_por_instancia: EnteroPositivo,
  leyenda: z.array(z.object({
    /** Un código por material y tamaño: cambia con el producto, su tamaño y su color. */
    codigo: EnteroPositivo,
    material: EnteroNoNegativo,
    product_id: z.string().min(1).nullable(),
    variant_id: z.string().min(1).nullable(),
    descripcion: z.string().min(1),
    color: z.string().nullable(),
    acabado: z.string().nullable(),
    tamano_pulg: z.number().positive(),
    unidades_por_instancia: EnteroPositivo,
    unidades_total: EnteroPositivo,
  }).strict()),
  /** De izquierda a derecha; `codigos` tiene los globos de la unidad del racimo. */
  racimos: z.array(z.object({
    numero: EnteroPositivo,
    codigos: z.array(EnteroPositivo).min(3).max(5),
  }).strict()).min(1),
  relleno: z.object({
    material: EnteroNoNegativo,
    total: EnteroPositivo,
    codigos: z.array(CodigoCantidadSchema).min(1),
  }).strict().nullable(),
  remates: z.array(z.object({
    posicion: z.enum(POSICIONES_REMATE_GUIRNALDA),
    codigo: EnteroPositivo,
    cantidad: EnteroPositivo,
    /** Racimo junto al que va cada globo del remate (1 = extremo izquierdo). */
    racimos: z.array(EnteroPositivo).min(1),
  }).strict()),
  /** Globos que no completan un racimo: van sueltos entre los racimos. */
  sueltos: z.array(CodigoCantidadSchema),
  insumos: z.array(z.object({
    insumo: z.enum(INSUMOS_GUIRNALDA),
    cantidad: z.number().nonnegative(),
    unidad: z.string().min(1),
    detalle: z.string(),
    estimado: z.boolean(),
  }).strict()),
  /** Tiempo de armado e instalación de todas las repeticiones; siempre es una estimación. */
  duracion_estimada: z.object({
    horas_min: z.number().nonnegative(),
    horas_max: z.number().nonnegative(),
    estimado: z.literal(true),
  }).strict(),
  nombre: z.string().min(1),
  descripcion: z.string(),
  pasos: z.array(z.string()),
  avisos: z.array(z.string()),
  /** Frase del armado para Uzume (inglés, imperativo); TypeScript la inserta tal cual (ADR-0028 §12). */
  prompt_gemini: z.string(),
  /** Fragmento para Kagutsuchi: inglés ASCII, sin cifras ni negaciones. */
  prompt_lora: z.string(),
}).strict();

export type ArmadoGuirnaldaResuelto = z.infer<typeof ArmadoGuirnaldaResueltoSchema>;

/** Clase de un globo de remate leído en la foto; la guirnalda solo compra látex. */
export const CLASES_REMATE_GUIRNALDA = ["latex", "metalizado", "burbuja"] as const;
/** Tope de forma de los racimos que se ven: rechaza lo absurdo, no decide nada. */
export const MAX_RACIMOS_LECTURA_GUIRNALDA = 2_500;
/** Tope de la caída leída, como fracción del largo: una U más honda ya no es una guirnalda que se lee. */
export const MAX_CAIDA_RELATIVA_LECTURA_GUIRNALDA = 0.6;
/** Tope del desnivel leído (en valor absoluto), como fracción del largo. */
export const MAX_DESNIVEL_RELATIVO_LECTURA_GUIRNALDA = 0.6;

const ColorLeido = z.string().trim().min(1).max(80);

/**
 * Lectura de una guirnalda en la foto de referencia (`lectura-guirnalda`,
 * ADR-0032, E4): cómo está armada según Amaterasu. Es una lectura, no una
 * decisión: la distribución (soporte, forma, unidad, relleno, remates) la usa
 * `armado_guirnalda.py` al confirmar, si la confianza alcanza; la cantidad no,
 * porque es del conteo (ADR-0031). `racimos_visibles` y `colores_por_racimo`
 * solo informan (el patrón por racimo es de E5). La caída y el desnivel se
 * leen RELATIVOS al largo horizontal, nunca en metros (una foto no los mide):
 * `armado_guirnalda.py` los pasa a `caida_m` y `desnivel_m` con el largo del
 * plan (ADR-0032, decisión 26). Opcionales para que una lectura guardada
 * antes de ellos (`lecturas_guirnalda`) siga valiendo.
 *
 * Este esquema es el dueño de la forma. Viaja exportado dentro de
 * `reference-blueprint.v2` (`appearance.armado_guirnalda`) y Python comprueba
 * cada lectura contra él.
 */
export const LecturaGuirnaldaSchema = z.object({
  soporte: z.enum(SOPORTES_GUIRNALDA),
  /** Con `soporte: "sobre_estructura"`: el elemento de la misma foto sobre el que va. */
  anfitriona_element_id: z.string().trim().min(1).max(80).optional(),
  forma: z.enum(FORMAS_GUIRNALDA),
  puntos_de_anclaje: z.number().int().min(2).max(6).optional(),
  /**
   * Cuánto baja el centro de la guirnalda bajo la recta que une sus extremos,
   * como fracción del largo horizontal (en la U invertida, cuánto bajan sus
   * lados). `null`: el modelo no lo distingue.
   */
  caida_relativa: z.number().min(0).max(MAX_CAIDA_RELATIVA_LECTURA_GUIRNALDA).nullable().optional(),
  /**
   * Altura del extremo derecho menos la del izquierdo, como fracción del largo
   * horizontal: negativo si cae hacia la derecha. `null`: no lo distingue.
   */
  desnivel_relativo: z.number().min(-MAX_DESNIVEL_RELATIVO_LECTURA_GUIRNALDA).max(MAX_DESNIVEL_RELATIVO_LECTURA_GUIRNALDA).nullable().optional(),
  racimos_visibles: z.number().int().min(0).max(MAX_RACIMOS_LECTURA_GUIRNALDA),
  unidad_racimo: z.enum(UNIDADES_RACIMO_GUIRNALDA).optional(),
  /** Colores de un racimo típico, en el orden de sus globos (nombres de la paleta del catálogo). */
  colores_por_racimo: z.array(ColorLeido).max(5),
  relleno: z.object({
    color: ColorLeido,
    proporcion: z.number().min(0).max(0.5),
  }).strict().nullable(),
  remates: z.array(z.object({
    clase: z.enum(CLASES_REMATE_GUIRNALDA),
    color: ColorLeido.optional(),
    posicion: z.enum(POSICIONES_REMATE_GUIRNALDA),
  }).strict()).max(6),
  confianza: z.number().min(0).max(1),
}).strict();

export type LecturaGuirnalda = z.infer<typeof LecturaGuirnaldaSchema>;

/** La lectura, dirigida al elemento de la referencia que materializa la estructura. */
export const PistaGuirnaldaSchema = LecturaGuirnaldaSchema.extend({
  referencia_element_id: z.string().trim().min(1).max(80),
}).strict();

export type PistaGuirnalda = z.infer<typeof PistaGuirnaldaSchema>;
