import { z } from "zod";

/**
 * Patrón de color de una estructura (ADR-0028): DÓNDE va cada color, no solo
 * cuánto. Es declarativo y apunta a `materiales` por índice, nunca por nombre
 * de color: el catálogo reetiqueta colores y dos materiales pueden compartir
 * uno.
 *
 * Solo forma. Las reglas cruzadas (índices dentro de `materiales`, modos por
 * tipo de estructura, racimo del tamaño correcto, colores sin uso) las valida
 * únicamente `services/ai-api/app/patron_color.py`; repetirlas aquí sería un
 * segundo dueño. Ningún campo lleva `.default()`: Zod 4 lo exportaría como
 * requerido y lo escribiría dentro del plan que firma `plan_hash`.
 */

export const PATRON_COLOR_VERSION = "patron-color.v1" as const;

export const MODOS_PATRON_COLOR = ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor", "damero"] as const;
export type ModoPatronColor = (typeof MODOS_PATRON_COLOR)[number];

export const TRAZOS_ESPIRAL = ["espiral", "zigzag", "recto"] as const;
export const ORIGENES_PATRON_COLOR = ["decorador", "referencia", "sugerido"] as const;
export const DIRECCIONES_PATRON_COLOR = ["longitudinal", "transversal", "diagonal"] as const;

const IndiceMaterialSchema = z.number().int().min(0).max(11);
/**
 * Última fila o posición que puede tener una rejilla. Python expande hasta
 * 4000 celdas (`MAX_CELDAS`, ADR-0028 §2) y una pared puede salir con una sola
 * fila, así que una fila o una columna llegan a 4000 posiciones: una pared de
 * 10 m × 2,4 m ya tiene 76 columnas. Un tope menor dejaría globos de la gráfica
 * que el editor dibuja pero no puede pintar.
 */
const INDICE_REJILLA_MAXIMO = 3999;
const IndiceRejillaSchema = z.number().int().min(0).max(INDICE_REJILLA_MAXIMO);
const RacimoSchema = z.array(IndiceMaterialSchema).min(1).max(8);
const PesoMaterialSchema = z.object({
  material: IndiceMaterialSchema,
  peso: z.number().int().min(1).max(100),
}).strict();

export const BasePatronColorSchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("espiral"),
    /** Colores de las posiciones de cada racimo; todos los racimos son iguales. */
    racimo: RacimoSchema,
    trazo: z.enum(TRAZOS_ESPIRAL),
  }).strict(),
  z.object({
    modo: z.literal("anillos"),
    /** Cada racimo (o fila) de un solo color, en este orden, repitiéndose. */
    secuencia: z.array(IndiceMaterialSchema).min(1).max(12),
    /** Racimos (o filas) seguidos de cada color. */
    largo: z.number().int().min(1).max(24),
  }).strict(),
  z.object({
    modo: z.literal("bloques"),
    /** Secciones contiguas en este orden, con su peso relativo. */
    bloques: z.array(PesoMaterialSchema).min(2).max(12),
  }).strict(),
  z.object({
    modo: z.literal("degradado"),
    paradas: z.array(IndiceMaterialSchema).min(2).max(6),
    transicion: z.enum(["suave", "escalonada"]),
  }).strict(),
  z.object({
    modo: z.literal("aleatorio"),
    pesos: z.array(PesoMaterialSchema).min(1).max(6),
    /** Solo fija la posición de cada globo; el conteo sale de los pesos. */
    semilla: z.number().int().min(0).max(2147483647),
  }).strict(),
  z.object({
    modo: z.literal("flor"),
    fondo: IndiceMaterialSchema,
    petalo: IndiceMaterialSchema,
    centro: IndiceMaterialSchema,
    /** Racimos de fondo entre una flor y la siguiente. */
    separacion: z.number().int().min(1).max(6),
  }).strict(),
  z.object({
    modo: z.literal("damero"),
    secuencia: z.array(IndiceMaterialSchema).min(2).max(4),
    tamano: z.number().int().min(1).max(4),
  }).strict(),
]);

export const AcentoPatronColorSchema = z.object({
  material: IndiceMaterialSchema,
  cada: z.number().int().min(2).max(24),
  desde: z.number().int().min(1).max(24),
  posiciones: z.array(IndiceRejillaSchema).min(1).max(64).optional(),
}).strict();

export const PintadoPatronColorSchema = z.object({
  fila: IndiceRejillaSchema,
  /** Sin columna se pinta el racimo (o la fila) completo. */
  columna: IndiceRejillaSchema.optional(),
  material: IndiceMaterialSchema,
}).strict();

export const PatronColorV1Schema = z.object({
  version: z.literal(PATRON_COLOR_VERSION),
  origen: z.enum(ORIGENES_PATRON_COLOR),
  globos_por_racimo: z.number().int().min(1).max(8).optional(),
  base: BasePatronColorSchema,
  acentos: z.array(AcentoPatronColorSchema).max(4).optional(),
  pintados: z.array(PintadoPatronColorSchema).max(512).optional(),
  simetria: z.literal("espejo").optional(),
  direccion: z.enum(DIRECCIONES_PATRON_COLOR).optional(),
}).strict();

export type PatronColor = z.infer<typeof PatronColorV1Schema>;
export type BasePatronColor = z.infer<typeof BasePatronColorSchema>;
export type AcentoPatronColor = z.infer<typeof AcentoPatronColorSchema>;
export type PintadoPatronColor = z.infer<typeof PintadoPatronColorSchema>;

const EnteroNoNegativo = z.number().int().min(0);
const EnteroPositivo = z.number().int().min(1);

/**
 * Lo que Python devuelve de un patrón ya expandido: la rejilla, el conteo, el
 * paso a paso y los textos. Viaja en `plan_resuelto.patrones_color` (fuera del
 * snapshot que firma `plan_hash`) y en la vista previa del editor. La UI solo
 * lo dibuja; nunca lo recalcula.
 */
export const PatronColorResueltoSchema = z.object({
  estructura_id: z.string().min(1).max(160),
  /** `false`: sugerencia para una estructura sin `patron_color`; el plan no la usa. */
  aplicado: z.boolean(),
  patron: PatronColorV1Schema,
  geometria: z.enum(["racimos", "rejilla"]),
  filas: EnteroPositivo,
  columnas: EnteroPositivo,
  repeticiones: EnteroPositivo,
  globos_por_instancia: EnteroPositivo,
  /** `filas × columnas` índices de material. */
  celdas: z.array(z.array(EnteroNoNegativo)),
  /** Globos que no ocupan una posición del racimo (el centro de una flor). */
  extras: z.array(z.object({ fila: EnteroNoNegativo, material: EnteroNoNegativo }).strict()),
  conteo: z.array(z.object({
    material: EnteroNoNegativo,
    color: z.string().nullable(),
    acabado: z.string().nullable(),
    unidades_por_instancia: EnteroNoNegativo,
    unidades_total: EnteroNoNegativo,
  }).strict()),
  /** Filas idénticas consecutivas, 1-based e inclusivas. */
  pasos: z.array(z.object({
    desde: EnteroPositivo,
    hasta: EnteroPositivo,
    celdas: z.array(EnteroNoNegativo),
    extras: z.array(EnteroNoNegativo),
  }).strict()),
  nombre: z.string().min(1),
  descripcion: z.string(),
  instrucciones: z.array(z.string()),
  prompt_gemini: z.string(),
  prompt_lora: z.string(),
  avisos: z.array(z.string()),
}).strict();

export type PatronColorResuelto = z.infer<typeof PatronColorResueltoSchema>;

/**
 * Un estilo que el editor puede ofrecer para una estructura, con sus
 * direcciones y si admite espejo. Lo decide Python (`modos_admitidos` de la
 * vista previa, ADR-0028 §10): la interfaz no repite esas reglas.
 */
export const ModoAdmitidoSchema = z.object({
  modo: z.enum(MODOS_PATRON_COLOR),
  direcciones: z.array(z.enum(DIRECCIONES_PATRON_COLOR)).min(1),
  espejo: z.boolean(),
}).strict();

export type ModoAdmitido = z.infer<typeof ModoAdmitidoSchema>;

/** Pista de patrón leída en la foto de referencia (ADR-0028 §7). */
export const PistaPatronSchema = z.object({
  referencia_element_id: z.string().trim().min(1).max(80),
  modo: z.enum(MODOS_PATRON_COLOR),
  colores: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  globos_por_racimo: z.number().int().min(1).max(8).optional(),
  pesos: z.array(z.number().int().min(1).max(100)).max(12).optional(),
  confianza: z.number().min(0).max(1),
}).strict();

export type PistaPatron = z.infer<typeof PistaPatronSchema>;
