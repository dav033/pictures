import { z } from "zod";
import { SOPORTES_GUIRNALDA, TAMANOS_BASE_RACIMO, UNIDADES_RACIMO_GUIRNALDA } from "./armado-guirnalda";

/**
 * Lo que el editor de armado de guirnaldas puede ofrecer para una pieza
 * (`opciones_admitidas` en services/ai-api/app/armado_guirnalda.py), decidido
 * por Python con la compra y el plan: soportes, piezas anfitrionas, unidades
 * del racimo, tamaños base y los colores (índices de `materiales`) que pueden
 * ir de relleno o de remate. Parte del contrato local de la vista previa
 * (`plan-armado-guirnalda-result.v1`); cada valor es de `armado-guirnalda.v1`.
 * Sin dependencias de servidor: lo leen la ruta de Next y el navegador.
 */

/** Cada valor una sola vez. */
const sinRepetidos = <T>(lista: readonly T[]) => new Set(lista).size === lista.length;
const IndiceMaterial = z.number().int().min(0).max(11);

export const OpcionesArmadoGuirnaldaSchema = z.object({
  soportes: z.array(z.enum(SOPORTES_GUIRNALDA)).max(SOPORTES_GUIRNALDA.length).refine(sinRepetidos),
  anfitrionas: z.array(z.string().regex(/^EST_\d{2}_[A-Z_]+$/)).max(40).refine(sinRepetidos),
  unidades: z.array(z.enum(UNIDADES_RACIMO_GUIRNALDA)).max(UNIDADES_RACIMO_GUIRNALDA.length).refine(sinRepetidos),
  tamanos_base: z.array(z.literal(TAMANOS_BASE_RACIMO)).max(TAMANOS_BASE_RACIMO.length).refine(sinRepetidos),
  materiales_relleno: z.array(IndiceMaterial).max(12).refine(sinRepetidos),
  materiales_remate: z.array(IndiceMaterial).max(12).refine(sinRepetidos),
}).strict();

export type OpcionesArmadoGuirnalda = z.infer<typeof OpcionesArmadoGuirnaldaSchema>;
