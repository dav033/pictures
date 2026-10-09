import { z } from "zod";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { MAX_PIEZAS_PLAN } from "@/lib/plan/piezas-individuales";
import { FloresEspecSchema, LUGARES_ESPEC, MAX_COLORES_PIEZA } from "./espec-cliente-v1";

/**
 * **Lo que el cliente puede cambiarle a su plan del motor 3D** (REQ-007, fase 5, D-020): peticiones a la IA, colores y
 * proporciones de color, y proporciones de tamaño. Nada de arrastrar, mover, crear ni seleccionar en el visor: cada
 * operación cambia campos de la espec (`EspecClienteV1`) y nada más, y la única forma de sumar geometría es una pieza de la
 * lista oficial (`agregar_pieza`) o las piezas de una idea del catálogo (`agregar_idea`). La espec nueva se vuelve a armar
 * y a cotizar en el servidor; el navegador solo recibe el resultado.
 *
 * Los colores se dicen como el cliente los diría (una palabra del catálogo de colores, «dorado») o como el código Sempertex
 * de tres cifras («970»); `ediciones-espec.ts` los resuelve y, si el globo no se fabrica en la medida de la pieza, pone el
 * más parecido y lo dice.
 */
const IdPieza = z.string().regex(/^EST_\d{2}_[A-Z_]+$/);
const ColorDicho = z.string().trim().min(1).max(80);
const Piezas = z.array(IdPieza).min(1).max(MAX_PIEZAS_PLAN);
const Direccion = z.union([z.literal(1), z.literal(-1)]);
const Medida = z.number().positive().max(100);

export const MedidasEdicionSchema = z.object({ anchoM: Medida.optional(), altoM: Medida.optional(), largoM: Medida.optional() }).strict();
export const LADOS_EDICION = ["izquierda", "derecha"] as const;

export const EdicionEspecV1Schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reemplazar_color"), de: ColorDicho, a: ColorDicho, piezas: Piezas.optional() }).strict(),
  z.object({ op: z.literal("agregar_color"), color: ColorDicho, piezas: Piezas.optional() }).strict(),
  z.object({ op: z.literal("quitar_color"), color: ColorDicho, piezas: Piezas.optional() }).strict(),
  /** `pesos`: uno por color de la pieza, en el orden en que la pieza los lleva. Se normalizan a 1. */
  z.object({ op: z.literal("proporcion_color"), pieza: IdPieza, pesos: z.array(z.number().positive()).min(2).max(MAX_COLORES_PIEZA) }).strict(),
  z.object({ op: z.literal("mas_menos_color"), color: ColorDicho, direccion: Direccion, piezas: Piezas.optional() }).strict(),
  /** `medidas` fija las que se dicen; `direccion` agranda o achica un 10 %. Ambas quedan dentro de lo que el constructor arma. */
  z.object({ op: z.literal("tamano_pieza"), pieza: IdPieza, medidas: MedidasEdicionSchema.optional(), direccion: Direccion.optional() }).strict()
    .refine((e) => (e.medidas !== undefined && Object.keys(e.medidas).length > 0) !== (e.direccion !== undefined), "Se pide una medida o una dirección, no las dos ni ninguna"),
  /** Mueve la pieza por la escala de la proporción de tamaños (`MEZCLAS`): más globos pequeños o más globos grandes. */
  z.object({ op: z.literal("tamano_globos"), pieza: IdPieza.optional(), direccion: Direccion }).strict(),
  z.object({ op: z.literal("quitar_pieza"), pieza: IdPieza }).strict(),
  z.object({
    op: z.literal("agregar_pieza"),
    oficial: z.enum(ESTRUCTURAS_OFICIALES_IDS),
    lugar: z.enum(LUGARES_ESPEC).optional(),
    medidas: MedidasEdicionSchema.optional(),
    colores: z.array(ColorDicho).min(1).max(MAX_COLORES_PIEZA).optional(),
    /** «Arco orgánico»: mezcla de tamaños aunque la oficial sea de cuartetos. */
    organica: z.boolean().optional(),
  }).strict(),
  z.object({ op: z.literal("agregar_idea"), ideaId: z.string().trim().min(1).max(200) }).strict(),
  z.object({ op: z.literal("flores"), pieza: IdPieza, flores: FloresEspecSchema.nullable() }).strict(),
  z.object({ op: z.literal("lado"), pieza: IdPieza, lado: z.enum(LADOS_EDICION) }).strict(),
]);

export type EdicionEspecV1 = z.infer<typeof EdicionEspecV1Schema>;
export type OperacionEdicion = EdicionEspecV1["op"];
export const OPERACIONES_EDICION: readonly OperacionEdicion[] = [
  "reemplazar_color", "agregar_color", "quitar_color", "proporcion_color", "mas_menos_color",
  "tamano_pieza", "tamano_globos", "quitar_pieza", "agregar_pieza", "agregar_idea", "flores", "lado",
];

/** Una tanda de ediciones de un mismo pedido (el chat pide varias a la vez: «quita las dos columnas»). */
export const EdicionesEspecSchema = z.array(EdicionEspecV1Schema).min(1).max(2 * MAX_PIEZAS_PLAN);
