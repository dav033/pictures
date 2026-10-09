import { z } from "zod";
import { MAX_PIEZAS_PLAN } from "@/lib/plan/piezas-individuales";

/**
 * **Lo que «Ajustar mi plan» manda al servidor cuando el plan es del motor 3D** (REQ-007, fase 5): el mismo `CambioPlan` del
 * panel (`components/guiado/ajuste/ajuste-plan-guiado.ts`) sin lo que solo existe en el catálogo de Python (los productos y
 * variantes del globo): un color es su palabra o su código Sempertex. Un tipo nuevo del panel tiene que aparecer aquí y en
 * `edicion-desde-pedido.ts` (lo vigila una prueba de la tabla de equivalencias).
 */
const IdPieza = z.string().regex(/^EST_\d{2}_[A-Z_]+$/);
const Direccion = z.union([z.literal(1), z.literal(-1)]);
const Pareja = z.boolean().optional();
const ColorDicho = z.string().trim().min(1).max(80);
const Medida = z.number().positive().max(100);

export const CambioPanelV1Schema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("protagonismo"), estructuraId: IdPieza, indice: z.number().int().min(0).max(5), direccion: Direccion, pareja: Pareja }).strict(),
  z.object({ tipo: z.literal("cantidad"), estructuraId: IdPieza, indice: z.number().int().min(0).max(5), objetivo: z.number().int().min(0).max(100_000), desde: z.number().int().min(0).max(100_000), pareja: Pareja }).strict(),
  z.object({ tipo: z.literal("tamano"), estructuraId: IdPieza, direccion: Direccion, pareja: Pareja }).strict(),
  z.object({ tipo: z.literal("medidas"), estructuraId: IdPieza, medidas: z.object({ ancho_m: Medida.optional(), alto_m: Medida.optional(), largo_m: Medida.optional() }).strict(), pareja: Pareja }).strict(),
  z.object({ tipo: z.literal("quitar-color"), estructuraId: IdPieza, indice: z.number().int().min(0).max(5), pareja: Pareja }).strict(),
  z.object({ tipo: z.literal("agregar-color"), color: ColorDicho, estructuraIds: z.array(IdPieza).max(MAX_PIEZAS_PLAN).optional() }).strict(),
  z.object({ tipo: z.literal("reemplazar-color"), color: ColorDicho, nuevo: ColorDicho, estructuraIds: z.array(IdPieza).max(MAX_PIEZAS_PLAN).optional() }).strict(),
  z.object({ tipo: z.literal("tamano-todo"), direccion: Direccion }).strict(),
  z.object({ tipo: z.literal("quitar-pieza"), estructuraId: IdPieza }).strict(),
  z.object({ tipo: z.literal("tamano-globos"), estructuraId: IdPieza, direccion: Direccion, pareja: Pareja }).strict(),
]);

export type CambioPanelV1 = z.infer<typeof CambioPanelV1Schema>;
export const TIPOS_CAMBIO_PANEL: readonly CambioPanelV1["tipo"][] = [
  "protagonismo", "cantidad", "tamano", "medidas", "quitar-color", "agregar-color", "reemplazar-color", "tamano-todo", "quitar-pieza", "tamano-globos",
];
