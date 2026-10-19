import { z } from "zod";

/**
 * Armado de un bouquet por partes (ADR-0030): qué globo va en cada nivel, cuál
 * es el remate y dónde van los globos número. Es declarativo y apunta a
 * `materiales` por índice, como `patron_color` (ADR-0028).
 *
 * Solo forma. Las reglas cruzadas (índices dentro de `materiales`, globos por
 * unidad, que el armado compre exactamente lo que el plan declara, helio con
 * látex chico) las valida únicamente `services/ai-api/app/armado_bouquet.py`.
 * Ningún campo lleva `.default()`: Zod 4 lo exportaría como requerido y lo
 * escribiría dentro del plan que firma `plan_hash`.
 */

export const ARMADO_BOUQUET_VERSION = "armado-bouquet.v1" as const;

/** Bouquet con base de aire, o de helio apilado (capas) o escalonado (alturas). */
export const VARIANTES_BOUQUET = ["base_aire", "helio_apilado", "helio_escalonado"] as const;
export type VarianteBouquet = (typeof VARIANTES_BOUQUET)[number];

/** Unidades de armado de la técnica Sempertex; `suelto` es un globo solo. */
export const UNIDADES_BOUQUET = ["suelto", "pareja", "trio", "cuarteto", "quinteto", "sexteto"] as const;
export type UnidadBouquet = (typeof UNIDADES_BOUQUET)[number];
export const ROLES_NIVEL_BOUQUET = ["base", "cuerpo", "capa", "alrededor", "acento", "relleno"] as const;
export type RolNivelBouquet = (typeof ROLES_NIVEL_BOUQUET)[number];
/** Dónde van los globos número: al centro, uno a cada lado (un bouquet por dígito), arriba como remate o abajo, en la base. */
export const DISPOSICIONES_NUMERO = ["centro", "lados", "arriba", "abajo"] as const;
export type DisposicionNumero = (typeof DISPOSICIONES_NUMERO)[number];
export const ORIGENES_ARMADO = ["decorador", "referencia", "sugerido"] as const;
export const TIPOS_GLOBO_BOUQUET = ["latex", "metalizado", "burbuja", "numero"] as const;
export const INSUMOS_BOUQUET = ["pesa", "cinta", "helio", "varilla", "base"] as const;

const IndiceMaterialSchema = z.number().int().min(0).max(11);
const EnteroPositivo = z.number().int().positive();
const EnteroNoNegativo = z.number().int().nonnegative();

/** Un nivel, de abajo hacia arriba: `cantidad` unidades iguales; `posiciones` es el color de cada globo de la unidad. */
const NivelBouquetSchema = z.object({
  rol: z.enum(ROLES_NIVEL_BOUQUET),
  unidad: z.enum(UNIDADES_BOUQUET),
  cantidad: z.number().int().min(1).max(24),
  posiciones: z.array(IndiceMaterialSchema).min(1).max(6),
}).strict();

export const ArmadoBouquetV1Schema = z.object({
  version: z.literal(ARMADO_BOUQUET_VERSION),
  origen: z.enum(ORIGENES_ARMADO),
  variante: z.enum(VARIANTES_BOUQUET),
  /** Describen un grupo; con `numero.disposicion = "lados"` hay un grupo por dígito. */
  niveles: z.array(NivelBouquetSchema).max(8),
  /** Un globo por entrada: metalizado, burbuja o látex grande arriba. */
  remate: z.array(IndiceMaterialSchema).min(1).max(4).optional(),
  numero: z.object({
    /** Un globo número por entrada, en el orden en que se lee la cifra. */
    digitos: z.array(IndiceMaterialSchema).min(1).max(3),
    disposicion: z.enum(DISPOSICIONES_NUMERO),
  }).strict().optional(),
}).strict();

export type ArmadoBouquetV1 = z.infer<typeof ArmadoBouquetV1Schema>;

/**
 * Lo que Python devuelve de un armado: leyenda con un código por globo
 * comprado, niveles en códigos, insumos no cotizados, pasos y avisos. Viaja en
 * `plan_resuelto.armados_bouquet`, fuera del snapshot que firma `plan_hash`.
 * La UI solo lo dibuja; nunca lo recalcula.
 */
export const ArmadoBouquetResueltoSchema = z.object({
  estructura_id: z.string().min(1).max(160),
  armado: ArmadoBouquetV1Schema,
  grupos: EnteroPositivo,
  repeticiones: EnteroPositivo,
  leyenda: z.array(z.object({
    /** Un código por material: cambia con el producto, su tamaño, su color y, en un número, su dígito. */
    codigo: EnteroPositivo,
    material: EnteroNoNegativo,
    product_id: z.string().min(1),
    variant_id: z.string().min(1),
    descripcion: z.string().min(1),
    tipo_globo: z.enum(TIPOS_GLOBO_BOUQUET),
    color: z.string().nullable(),
    acabado: z.string().nullable(),
    tamano_pulg: z.number().positive().nullable(),
    digito: z.string().regex(/^\d$/).nullable(),
    unidades_por_grupo: EnteroNoNegativo,
    unidades_total: EnteroNoNegativo,
  }).strict()),
  niveles: z.array(z.object({
    rol: z.enum(ROLES_NIVEL_BOUQUET),
    unidad: z.enum(UNIDADES_BOUQUET),
    cantidad: EnteroPositivo,
    codigos: z.array(EnteroPositivo).min(1),
  }).strict()),
  remate: z.array(EnteroPositivo),
  numero: z.object({ codigos: z.array(EnteroPositivo).min(1), disposicion: z.enum(DISPOSICIONES_NUMERO) }).strict().nullable(),
  /** Lo que el armado necesita y el catálogo no vende: nunca se cotiza. */
  insumos: z.array(z.object({
    insumo: z.enum(INSUMOS_BOUQUET),
    cantidad: z.number().nonnegative(),
    unidad: z.string().min(1),
    detalle: z.string(),
    estimado: z.boolean(),
  }).strict()),
  duracion_estimada: z.object({ horas_min: EnteroNoNegativo, horas_max: EnteroNoNegativo }).strict().nullable(),
  nombre: z.string().min(1),
  descripcion: z.string(),
  pasos: z.array(z.string()),
  avisos: z.array(z.string()),
  /** Frase del armado para Uzume (inglés, imperativo); TypeScript la inserta tal cual (ADR-0028 §12). */
  prompt_gemini: z.string(),
  /** Fragmento para Kagutsuchi: inglés ASCII, sin cifras ni negaciones. */
  prompt_lora: z.string(),
}).strict();

export type ArmadoBouquetResuelto = z.infer<typeof ArmadoBouquetResueltoSchema>;

/** Clase de tamaño que la lectura da a un nivel: 5"–9", 11"–12", 16"–18" o 24"–36" (dueño de los rangos: `armado_bouquet.py`). */
export const CLASES_TAMANO_NIVEL = ["chico", "mediano", "grande", "gigante"] as const;
export type ClaseTamanoNivel = (typeof CLASES_TAMANO_NIVEL)[number];
/** Niveles que se leen de un bouquet en la foto; el prompt de la lectura los nombra. */
export const MAX_NIVELES_LEIDOS = 8;
/** Globos sueltos de un grupo que se repite en un nivel. */
export const MAX_SUELTOS_LEIDOS = 6;
/** Unidades iguales que pueden formar un nivel alrededor de la pieza. */
export const MAX_CANTIDAD_NIVEL = 24;
/** Techo de `total_globos`: todos los niveles de sueltos al tope, remate y dos grupos (números a los lados), más tres dígitos. */
const MAX_TOTAL_LEIDO = (MAX_NIVELES_LEIDOS * MAX_SUELTOS_LEIDOS * MAX_CANTIDAD_NIVEL + 1) * 2 + 3;

/**
 * Lectura del armado en la foto de referencia (Amaterasu, ADR-0030).
 *
 * Desde `bouquet-referencia.v2` (2026-09-28) cada nivel trae `cantidad`
 * (cuántas unidades iguales lo forman alrededor de la pieza) y, si se ve,
 * `clase_tamano`; la lectura publica `total_globos`, que cuenta Python
 * (`armado_bouquet.total_leido`) y aquí solo se muestra, y `avisos` con lo que
 * la validación recortó. Una lectura anterior no los trae y sigue siendo
 * válida: cada nivel vale una unidad y no hay total que mostrar.
 */
export const LecturaArmadoSchema = z.object({
  variante: z.enum(VARIANTES_BOUQUET),
  niveles: z.array(z.object({
    unidad: z.enum(UNIDADES_BOUQUET),
    colores: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_SUELTOS_LEIDOS),
    cantidad: z.number().int().min(1).max(MAX_CANTIDAD_NIVEL).optional(),
    clase_tamano: z.enum(CLASES_TAMANO_NIVEL).optional(),
  }).strict()).max(MAX_NIVELES_LEIDOS),
  remate: z.object({
    clase: z.enum(["metalizado", "burbuja", "latex"]),
    color: z.string().trim().min(1).max(80).optional(),
  }).strict().optional(),
  numeros: z.array(z.object({
    digito: z.string().regex(/^\d$/),
    clase_tamano: z.enum(["chico", "grande"]),
  }).strict()).max(3).optional(),
  disposicion: z.enum(DISPOSICIONES_NUMERO).optional(),
  confianza: z.number().min(0).max(1),
  /** Globos de UNA pieza según la lectura, contados por Python. Nunca se recalcula en TypeScript. */
  total_globos: z.number().int().min(0).max(MAX_TOTAL_LEIDO).optional(),
  /** Lo que la validación de Python recortó o quitó de la lectura (solo observabilidad). */
  avisos: z.array(z.string().min(1).max(200)).max(12).optional(),
}).strict();

export type LecturaArmado = z.infer<typeof LecturaArmadoSchema>;

/** La lectura, dirigida al elemento de la referencia que materializa la estructura. */
export const PistaArmadoSchema = LecturaArmadoSchema.extend({
  referencia_element_id: z.string().trim().min(1).max(80),
}).strict();

export type PistaArmado = z.infer<typeof PistaArmadoSchema>;
