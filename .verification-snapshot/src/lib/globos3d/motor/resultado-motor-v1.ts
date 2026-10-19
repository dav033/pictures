import { z } from "zod";
import { ArmadaCompactaV1Schema } from "./armada-compacta";

/**
 * Lo que el motor 3D le devuelve al producto guiado (contrato `resultado-motor.v1`). La lista de materiales
 * (`bom`) no lleva precios ni variantes de la tienda: eso es el cruce de la fase de cotización.
 */
export const BomLineaSchema = z.object({
  formatoId: z.string().min(1).max(16),
  codigo: z.string().regex(/^\d{3}$/),
  cantidad: z.number().int().positive(),
}).strict();

export const ResultadoMotorV1Schema = z.object({
  motor: z.object({ id: z.literal("globos3d"), version: z.string().min(1).max(40) }).strict(),
  /** sha256 de la espec en JSON estable más la versión del motor: cambia si cambia cualquiera de las dos. */
  especHash: z.string().regex(/^[0-9a-f]{64}$/),
  armada: ArmadaCompactaV1Schema,
  bom: z.object({
    porPieza: z.record(z.string(), z.array(BomLineaSchema)),
    total: z.array(BomLineaSchema),
  }).strict(),
  /** Frases para el cliente («Las flores no se dibujan…»). */
  avisos: z.array(z.string()),
  /** Las piezas que ningún constructor arma: quien llama resuelve este plan con el motor de Python. */
  noRepresentable: z.array(z.object({ piezaId: z.string(), motivo: z.string() }).strict()),
}).strict();

export type BomLinea = z.infer<typeof BomLineaSchema>;
export type ResultadoMotorV1 = z.infer<typeof ResultadoMotorV1Schema>;
