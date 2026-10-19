import { z } from "zod";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

/**
 * El detalle de una idea de la biblioteca (pedido 2 del encargo del plan): sus piezas, cada una con sus globos
 * Sempertex por producto y tamaño, tal como los fijó la biblioteca. Lo escribe un script determinista
 * (`scripts/biblioteca/precomputar-detalles-ideas.ts`, sin red, sin Python, sin modelo) en `detalles-ideas.json`; la
 * tarjeta de la idea solo lo lee. Nunca cuenta ni reparte: cada cantidad es la de un material de `decoraciones.json`
 * (o, por pieza, la que resolvió Python en su `.plan.json`). Solo zod y constantes: seguro en el navegador.
 */

/** Una línea de globos de la idea: un material de la biblioteca (o la parte de él que lleva una pieza). */
export const LineaIdeaSchema = z.object({
  variantId: z.string().min(1),
  /** El globo Sempertex tal como se pide: «Reflex Dorado», «Fashion Palo de Rosa». */
  producto: z.string().min(1),
  /** Título del catálogo sin tamaño ni paquete («B2b Globo Latex Redondo Reflex Dorado»): con él se pinta el tono y el acabado. */
  titulo: z.string().min(1),
  /** Código de tamaño del catálogo (R-12, T260, LOL6, C-12, 18 IN); null si el producto no lo tiene (una cortina). */
  codigo: z.string().min(1).nullable(),
  /** El color en palabras de cliente que anota la biblioteca («dorado cromado», «rosa claro»). */
  color: z.string().min(1),
  /** Su color de la paleta, si lo tiene. */
  paleta: z.enum(PALETA_COLORES_V2).nullable(),
  /** Sin impresos, figuras ni frases. */
  liso: z.boolean(),
  unidades: z.number().int().positive(),
  /** La cantidad (o parte de ella) se contó a mano en la foto: aproximada. */
  estimado: z.boolean(),
}).strict();

const MedidasSchema = z.object({ ancho_m: z.number().positive().optional(), alto_m: z.number().positive().optional(), largo_m: z.number().positive().optional() }).strict();

/** Una pieza individual de la idea («Columna izquierda»), o una pareja igual que no se pudo partir («2 × Columna (iguales)»). */
export const PiezaIdeaSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  estructura: z.enum(ESTRUCTURAS_OFICIALES_IDS),
  repeticiones: z.number().int().min(1).max(12),
  medidas: MedidasSchema,
  /** Vacío si las cantidades de la idea no vienen separadas por pieza (van en `lineasSinPieza`). */
  lineas: z.array(LineaIdeaSchema),
  total: z.number().int().nonnegative(),
  /** Colores lisos de la paleta de esta pieza, del más usado al menos: con ellos se agrega la pieza a un plan. */
  colores: z.array(z.enum(PALETA_COLORES_V2)).max(5),
}).strict();

export const DetalleIdeaSchema = z.object({
  /** «plan»: todas las cantidades las resolvió Python; «estimado»: alguna se contó a mano en la foto. */
  fuente: z.enum(["plan", "estimado"]),
  /** El plan de Python que separó las piezas, si lo hubo. */
  planHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Suma de todas las líneas = suma de los materiales de la decoración. */
  total: z.number().int().positive(),
  piezas: z.array(PiezaIdeaSchema).min(1).max(8),
  /**
   * Lo que no se puede atribuir a una pieza sin inventar: o toda la decoración (cuando ninguna pieza trae líneas) o
   * lo contado a mano en la foto cuando hay varias piezas.
   */
  lineasSinPieza: z.array(LineaIdeaSchema).min(1).optional(),
}).strict();

export const DetallesIdeasArchivoSchema = z.object({
  /** Cómo se regenera: el archivo nunca se edita a mano. */
  generado: z.string().min(1),
  ideas: z.record(z.string(), z.unknown()),
}).strict();

export type LineaIdea = z.infer<typeof LineaIdeaSchema>;
export type PiezaIdea = z.infer<typeof PiezaIdeaSchema>;
export type DetalleIdea = z.infer<typeof DetalleIdeaSchema>;
