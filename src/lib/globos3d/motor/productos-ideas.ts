import { z } from "zod";
import datos from "./datos/productos-ideas.json";
import type { ProductoDelPlan, ResolverProducto } from "./espec-desde-plan";

/**
 * Los productos que usan las ideas de la biblioteca (título, color, acabado, talla por variante), generados por
 * `scripts/motor/generar-productos-ideas.ts` desde los planes resueltos. Es el `ResolverProducto` con que se
 * convierten los planes guardados de las ideas en espec (`especDesdePlan`).
 */
const ArchivoSchema = z.object({
  version: z.literal(1),
  snapshot: z.string(),
  variantes: z.record(z.string(), z.object({
    productId: z.string(), titulo: z.string(), color: z.string().nullable(), acabado: z.string().nullable(), tamano: z.string().nullable(),
  }).strict()),
}).strict();

const archivo = ArchivoSchema.parse(datos);

const porProducto = new Map<string, ProductoDelPlan>();
for (const v of Object.values(archivo.variantes)) if (!porProducto.has(v.productId)) porProducto.set(v.productId, { titulo: v.titulo, color: v.color, acabado: v.acabado });

export const resolverProductoDeIdeas: ResolverProducto = ({ product_id, variant_id }) => {
  const variante = variant_id ? archivo.variantes[variant_id] : undefined;
  return variante ? { titulo: variante.titulo, color: variante.color, acabado: variante.acabado } : porProducto.get(product_id) ?? null;
};
