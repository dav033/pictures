import { asegurarCatalogo } from "@/lib/shopify/catalogo-vigente";
import { aProducto, buscarCatalogoShopify, type FiltrosCatalogo } from "@/lib/shopify/consultas";
import { z } from "zod";
import { conRegistro } from "@/lib/registro/servidor";

const FiltrosCatalogoSchema = z.object({
  texto: z.string().optional(),
  categorias: z.array(z.string()).optional(),
  colores: z.array(z.string()).optional(),
  ocasiones: z.array(z.string()).optional(),
  formas: z.array(z.string()).optional(),
  tamanos: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  precio_min: z.number().finite().nonnegative().optional(),
  precio_max: z.number().finite().nonnegative().optional(),
  solo_disponibles: z.boolean().optional(),
  limite: z.number().int().positive().max(100).optional(),
}).strict();

/**
 * Navegación directa por tipo de producto (§ page.tsx navegarCategoria): el
 * cliente ya sabe qué categoría quiere ver porque tocó un chip con el conteo
 * real, así que no hace falta gastar un turno de IA para traer las piezas —
 * es la misma búsqueda que ya validó `buscar_catalogo` en el chat, solo que
 * sin pasar por el modelo.
 */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/catalogo/piezas", atenderPOST, { vista: "clasica" });

async function atenderPOST(request: Request) {
  let filtros: FiltrosCatalogo;
  try {
    filtros = FiltrosCatalogoSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Filtros de catálogo inválidos." }, { status: 400 });
  }
  await asegurarCatalogo();
  const { resultados, total } = buscarCatalogoShopify({ ...filtros, limite: filtros.limite ?? 20 });
  return Response.json({ productos: resultados.map(aProducto), total });
}
