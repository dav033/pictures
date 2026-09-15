import type { Brief } from "@/lib/types";
import { colorDeCatalogo } from "@/lib/plan/colores-catalogo";
import { extraerFiltrosDurosBusqueda, type FiltrosDurosBusqueda } from "@/lib/rag/query-parser/hard-filters";

/**
 * Hard filters of ONE `buscar_catalogo_rag` call.
 *
 * Customer constraints (colors, occasion, category, finish, price) stay locked
 * from the original request and the brief, so a model enrichment cannot turn a
 * style word into a SQL predicate. Sizes are different: they describe the
 * component being searched, not the whole event. "Boda … globos de 24 pulgadas
 * en dorado" applied `diametros_pulgadas: [24]` to the searches for R-12, R-18
 * and R-5 too, every search returned the same six R-24 products and the
 * assistant told the customer there were no gold balloons "in other sizes",
 * while Reflex Dorado R-5…R-18 was in the LoRA pool (E2E 2026-09-15, rid
 * bc991913). The size filter therefore comes from the search message, and only
 * for sizes the customer asked for: a size the model writes on its own ("globo
 * azul R-12 R-5 R-18") would narrow the turn whitelist to that size and force a
 * classic R-12 structure (real run 70b491fc). The customer's mandatory sizes
 * are still enforced on the plan (`restricciones.tamanos`).
 *
 * Colors a later customer message withdrew are not filters either.
 */
export function filtrosDurosDeBusqueda(input: {
  mensaje: string;
  solicitudOriginal: string;
  brief: Brief;
  coloresRetirados?: readonly string[];
}): FiltrosDurosBusqueda {
  const solicitud = input.solicitudOriginal.trim() || input.mensaje;
  const delTurno = extraerFiltrosDurosBusqueda(solicitud, input.brief);
  const deLaBusqueda = extraerFiltrosDurosBusqueda(input.mensaje, {});
  const fuera = new Set((input.coloresRetirados ?? []).map(colorDeCatalogo));
  return {
    ...delTurno,
    colores: fuera.size ? delTurno.colores.filter((color) => !fuera.has(colorDeCatalogo(color))) : delTurno.colores,
    diametros_pulgadas: deLaBusqueda.diametros_pulgadas.filter((diametro) => delTurno.diametros_pulgadas.includes(diametro)),
  };
}

/**
 * What a search result must say about its own filters, so the model never reads
 * a filtered result as "the catalog has nothing else".
 */
export function avisoFiltrosBusqueda(filtros: FiltrosDurosBusqueda): string | null {
  const partes = [
    filtros.diametros_pulgadas.length ? `solo tamaños de ${filtros.diametros_pulgadas.join(", ")} pulgadas` : "",
    filtros.formas.length ? `solo formas ${filtros.formas.join(", ")}` : "",
    filtros.acabados.length ? `solo acabados ${filtros.acabados.join(", ")}` : "",
    filtros.categorias.length ? `solo categorías ${filtros.categorias.join(", ")}` : "",
  ].filter(Boolean);
  if (!partes.length) return null;
  return `Esta búsqueda está limitada a ${partes.join("; ")}. No le digas al cliente que el catálogo no tiene un color o producto en otros tamaños o formas: para saberlo busca sin ese límite.`;
}
