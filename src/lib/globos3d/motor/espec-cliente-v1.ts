import { z } from "zod";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { MAX_PIEZAS_PLAN } from "@/lib/plan/piezas-individuales";
import { formatoPorId } from "../formatos";

/**
 * **La especificación del cliente**: la fuente de verdad de lo que el cliente de la vista guiada tiene entre manos.
 * Es chica, versionada y de datos puros: las propuestas, las ideas del catálogo y las ediciones la producen o la
 * modifican, y el motor de globos 3D la convierte en escena, lista de materiales y dibujo (`v1.ts`).
 * Cada campo nuevo se declara en `consumo.ts` (dónde lo lee el motor) o la compilación falla.
 */

export const VERSION_ESPEC = "espec-cliente.v1" as const;

export const ORIGENES_ESPEC = ["propuesta", "idea", "idea_sumada", "edicion"] as const;
export const LUGARES_ESPEC = ["centro", "izquierda", "derecha", "fondo", "techo", "mesa"] as const;
/** La proporción de tamaños de globo de la pieza (las `MEZCLAS` del plan). */
export const TAMANOS_ESPEC = ["clasica", "organica_fina", "organica_gruesa", "solo_grandes"] as const;
export const DENSIDADES_ESPEC = ["sencilla", "media", "lujosa"] as const;
export const MIN_COLORES_PIEZA = 1;
export const MAX_COLORES_PIEZA = 6;
export const MIN_PETALOS = 3;
export const MAX_PETALOS = 6;
export const MAX_FLORES = 24;
/** Los globos redondos que pueden coronar una columna. */
export const FORMATOS_REMATE = ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] as const;
/** Lo que se tolera que se aparte de 1 la suma de los pesos de color de una pieza. */
export const TOLERANCIA_PESOS = 0.02;

export type OrigenEspec = (typeof ORIGENES_ESPEC)[number];
export type LugarEspec = (typeof LUGARES_ESPEC)[number];
export type TamanosEspec = (typeof TAMANOS_ESPEC)[number];
export type DensidadEspec = (typeof DENSIDADES_ESPEC)[number];

const CodigoSchema = z.string().regex(/^\d{3}$/);
const MedidaSchema = z.number().positive().max(100);

export const ColorEspecSchema = z.object({
  /** Código Sempertex de tres cifras («570»). */
  codigo: CodigoSchema,
  /** Cómo lo dice el cliente («dorado»). */
  nombre: z.string().trim().min(1).max(80),
  peso: z.number().gt(0).lte(1),
}).strict();

export const FloresEspecSchema = z.object({
  cantidad: z.number().int().min(1).max(MAX_FLORES),
  petalos: z.number().int().min(MIN_PETALOS).max(MAX_PETALOS),
  codigo: CodigoSchema,
  centro: CodigoSchema.optional(),
}).strict();

export const DeclaradaEspecSchema = z.object({
  materiales: z.array(z.object({
    formatoId: z.string().min(1).max(16).refine((id) => formatoPorId(id) !== undefined, "Formato de globo que no existe"),
    codigo: CodigoSchema,
    cantidad: z.number().int().positive().max(100_000),
  }).strict()).min(1).max(64),
  motivo: z.string().trim().min(1).max(240),
}).strict();

export const PiezaEspecSchema = z.object({
  /** `EST_01_ARCO`: estable aunque se edite el plan. */
  id: z.string().regex(/^EST_\d{2}_[A-Z_]+$/),
  oficial: z.enum(ESTRUCTURAS_OFICIALES_IDS),
  nombre: z.string().trim().min(1).max(160),
  lugar: z.enum(LUGARES_ESPEC),
  medidas: z.object({
    anchoM: MedidaSchema.optional(),
    altoM: MedidaSchema.optional(),
    largoM: MedidaSchema.optional(),
    grosorM: MedidaSchema.optional(),
  }).strict(),
  colores: z.array(ColorEspecSchema).min(MIN_COLORES_PIEZA).max(MAX_COLORES_PIEZA),
  tamanos: z.enum(TAMANOS_ESPEC),
  densidad: z.enum(DENSIDADES_ESPEC).optional(),
  /** Una forma de `formas-pieza` (el aro «parcial» u «organico»). */
  forma: z.string().trim().min(1).max(40).optional(),
  flores: FloresEspecSchema.nullable().optional(),
  /** Cuántos globos o racimos lleva lo que se cuenta por unidades (el bouquet, el racimo de pared). */
  unidades: z.number().int().min(1).max(999).optional(),
  /** El globo de arriba de una columna. */
  remate: z.object({ formatoId: z.enum(FORMATOS_REMATE), codigo: CodigoSchema }).strict().nullable().optional(),
  /** Lo que ningún constructor dibuja: se cuenta de una lista del catálogo, no se dibuja. */
  declarada: DeclaradaEspecSchema.optional(),
}).strict();

export const EspecClienteV1Schema = z.object({
  version: z.literal(VERSION_ESPEC),
  origen: z.object({
    tipo: z.enum(ORIGENES_ESPEC),
    ideaIds: z.array(z.string().min(1).max(160)).max(MAX_PIEZAS_PLAN).optional(),
  }).strict(),
  piezas: z.array(PiezaEspecSchema).min(1).max(MAX_PIEZAS_PLAN),
}).strict().superRefine((espec, contexto) => {
  const ids = new Set<string>();
  espec.piezas.forEach((pieza, indice) => {
    if (ids.has(pieza.id)) contexto.addIssue({ code: "custom", path: ["piezas", indice, "id"], message: `Pieza repetida: ${pieza.id}` });
    ids.add(pieza.id);
    const suma = pieza.colores.reduce((total, color) => total + color.peso, 0);
    if (Math.abs(suma - 1) > TOLERANCIA_PESOS) contexto.addIssue({ code: "custom", path: ["piezas", indice, "colores"], message: `Los pesos de color de ${pieza.id} suman ${suma.toFixed(3)} y deben sumar 1.` });
  });
});

export type ColorEspec = z.infer<typeof ColorEspecSchema>;
export type FloresEspec = z.infer<typeof FloresEspecSchema>;
export type DeclaradaEspec = z.infer<typeof DeclaradaEspecSchema>;
export type PiezaEspec = z.infer<typeof PiezaEspecSchema>;
export type EspecClienteV1 = z.infer<typeof EspecClienteV1Schema>;
