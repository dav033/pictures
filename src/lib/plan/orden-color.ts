import { z } from "zod";
import { MAX_PIEZAS_PLAN } from "@/lib/plan/piezas-individuales";

/**
 * **Esquemas y tipos del contexto de orden de color en la aprobación firmada** (REQ-016 T2, D-046).
 *
 * Módulo puro en `src/lib/plan/` para que `aprobacion.ts` no dependa del motor 3D
 * y respete la frontera arquitectónica de `test-motor-guiada-fronteras.ts`.
 */

export const MAX_COLORES_ORDEN = 8;
// D-048: the v2 reader must ship before writers; strict v1 records remain readable below.
export const VERSION_ORDEN_COLOR = "colour-order.v2" as const;

const CodigoSchema = z.string().regex(/^\d{3}$/);
const IdPieza = z.string().regex(/^EST_\d{2}_[A-Z0-9_]+$/);

export const IdentidadColorSchema = z.object({
  codigo: CodigoSchema,
  nombrePlegado: z.string().min(1).max(80),
}).strict();
export type IdentidadColor = z.infer<typeof IdentidadColorSchema>;

export const ResolucionSinCambioSchema = z.object({
  piezaId: IdPieza,
  destinosEfectivos: z.array(CodigoSchema).min(1).max(MAX_COLORES_ORDEN),
  coloresResultantes: z.array(IdentidadColorSchema).min(1).max(MAX_COLORES_ORDEN),
}).strict();
export type ResolucionSinCambio = z.infer<typeof ResolucionSinCambioSchema>;

export const CambioPiezaReemplazoSchema = ResolucionSinCambioSchema.extend({
  codigosOrigen: z.array(CodigoSchema).min(1).max(MAX_COLORES_ORDEN),
});
export type CambioPiezaReemplazo = z.infer<typeof CambioPiezaReemplazoSchema>;

const RegistroReemplazoColorV1Schema = z.object({
  fraseOrigenPlegada: z.string().trim().min(1).max(80),
  piezasSolicitadas: z.array(IdPieza).min(1).max(MAX_PIEZAS_PLAN),
  piezasCambiadas: z.array(IdPieza).min(1).max(MAX_PIEZAS_PLAN),
  cambiosPorPieza: z.array(CambioPiezaReemplazoSchema).min(1).max(MAX_PIEZAS_PLAN),
}).strict();
const RegistroReemplazoColorV2Schema = RegistroReemplazoColorV1Schema.extend({
  piezasCambiadas: z.array(IdPieza).max(MAX_PIEZAS_PLAN),
  cambiosPorPieza: z.array(CambioPiezaReemplazoSchema).max(MAX_PIEZAS_PLAN),
  resolucionesSinCambio: z.array(ResolucionSinCambioSchema).max(MAX_PIEZAS_PLAN),
}).refine((record) => record.cambiosPorPieza.length + record.resolucionesSinCambio.length > 0, "A replacement must retain at least one resolved piece");
export const RegistroReemplazoColorSchema = z.union([RegistroReemplazoColorV2Schema, RegistroReemplazoColorV1Schema]);
export type RegistroReemplazoColor = z.infer<typeof RegistroReemplazoColorSchema>;

export const ContextoOrdenColorSchema = z.discriminatedUnion("v", [
  z.object({ v: z.literal("colour-order.v1"), lastReplacement: RegistroReemplazoColorV1Schema.nullable() }).strict(),
  z.object({ v: z.literal(VERSION_ORDEN_COLOR), lastReplacement: RegistroReemplazoColorV2Schema.nullable() }).strict(),
]);
export type ContextoOrdenColor = z.infer<typeof ContextoOrdenColorSchema>;

export function crearContextoOrdenColorVacio(): ContextoOrdenColor {
  return { v: VERSION_ORDEN_COLOR, lastReplacement: null };
}
