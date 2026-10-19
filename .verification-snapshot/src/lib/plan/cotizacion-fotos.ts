import type { Cotizacion } from "@/lib/cotizacion/motor";

/**
 * The plan quote reaches the chat and the editor without product photos (E2E
 * 2026-09-14: the quote card showed no photos while the plan lines had them).
 * Each consolidated purchase already carries the catalog image of its variant
 * (`compras[].imagen`, read from the catalog by both resolvers), so the quote
 * line takes it from there. A line that already has a photo keeps it; a
 * purchase without an image leaves the line without one. Pure.
 */
export function conFotosDeCatalogo(
  cotizacion: Cotizacion,
  compras: ReadonlyArray<{ variant_id: string; imagen?: string | null }>,
): Cotizacion {
  const imagenPorVariante = new Map(compras.flatMap((compra) => (compra.imagen ? [[compra.variant_id, compra.imagen] as const] : [])));
  return {
    ...cotizacion,
    lineas: cotizacion.lineas.map((linea) => {
      if (linea.foto) return linea;
      const imagen = imagenPorVariante.get(linea.varianteId ?? linea.id);
      return imagen ? { ...linea, foto: imagen } : linea;
    }),
  };
}
