import type { z } from "zod";
import { DecoracionSempertexSchema, type DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import type { CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";

export type ContextoCompra = { evento?: string; tematica?: string; edad?: number };

/**
 * «Comprar» de un plan: lo presenta como una decoración de la biblioteca para reutilizar ComprarMateriales (lista
 * con fotos del catálogo, tienda en línea y distribuidor). Las cantidades son las de la cotización de Python.
 * Movida desde VistaGuiada.tsx sin cambios de comportamiento.
 */
export function decoracionDePlan(
  plan: z.infer<typeof PlanGuiadoSchema>,
  cotizacion: z.infer<typeof CotizacionPlanGuiadoSchema>,
  contexto: ContextoCompra,
): DecoracionSempertex {
  return DecoracionSempertexSchema.parse({
    id: `deco-plan-${plan.plan_hash.slice(0, 16)}`,
    origen: "sempertex_manual",
    titulo: plan.plan.concepto.titulo,
    tematica: contexto.tematica ?? plan.plan.concepto.estilo ?? "Celebración",
    eventos: [contexto.evento ?? "Celebración"],
    edad: contexto.edad === undefined ? null : { min: contexto.edad, max: contexto.edad },
    fotos: [{ url: "/favicon.ico", fuente: "Catálogo de materiales", licencia: "ejemplo_sin_licencia" }],
    video: null,
    piezas: plan.plan.estructuras.flatMap((pieza) => pieza.estructura_oficial ? [{ estructura: pieza.estructura_oficial, cantidad: pieza.repeticiones }] : []),
    materiales: cotizacion.lineas.flatMap((linea) => linea.varianteId ? [{ variantId: linea.varianteId, sku: null, cantidad: linea.cantidadNecesaria, nota: linea.nombre ?? linea.tamano }] : []),
    pasos: [],
    shopifyHandle: null,
    fotoRepresentativa: false,
  });
}
