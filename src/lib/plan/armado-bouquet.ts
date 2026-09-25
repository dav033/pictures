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

/** Lectura del armado en la foto de referencia (Amaterasu, ADR-0030). */
export const LecturaArmadoSchema = z.object({
  variante: z.enum(VARIANTES_BOUQUET),
  niveles: z.array(z.object({
    unidad: z.enum(UNIDADES_BOUQUET),
    colores: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
  }).strict()).max(8),
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
}).strict();

export type LecturaArmado = z.infer<typeof LecturaArmadoSchema>;

/** La lectura, dirigida al elemento de la referencia que materializa la estructura. */
export const PistaArmadoSchema = LecturaArmadoSchema.extend({
  referencia_element_id: z.string().trim().min(1).max(80),
}).strict();

export type PistaArmado = z.infer<typeof PistaArmadoSchema>;
