import type { Brief } from "@/lib/types";
import { plegarTexto } from "@/lib/rag/taxonomy/v2";
import { interpretarConsultaDeterminista } from "./deterministic";
import type { IntentQuery } from "./schema";

export type FiltrosDurosBusqueda = IntentQuery["filtros_duros"];

/** Build only verifiable context used to lock retrieval filters for a turn. */
export function textoContextoRestricciones(solicitudOriginal: string, brief: Brief): string {
  const camposBrief = [
    brief.tipo_evento ? `evento: ${brief.tipo_evento}` : "",
    brief.espacio ? `espacio: ${brief.espacio}` : "",
    brief.colores?.length ? `colores: ${brief.colores.join(", ")}` : "",
    brief.estilo ? `estilo: ${brief.estilo}` : "",
    brief.momento_dia ? `momento: ${brief.momento_dia}` : "",
    typeof brief.presupuesto === "number" ? `presupuesto maximo: ${brief.presupuesto}` : brief.presupuesto ? `presupuesto: ${brief.presupuesto}` : "",
  ].filter(Boolean);
  return [solicitudOriginal.trim(), ...camposBrief].filter(Boolean).join("; ");
}

/**
 * `guirnalda_arco` is the category of ready-made garland/arch products
 * (E-DECORS kits and packaged garlands, 13 products in the catalog). In a
 * decoration request, "arco", "semi arco" or "guirnalda" names the figure that
 * will be built from balloon materials (`Figura` in medidas/geometria.ts,
 * `balloon_structure` covered by globo_latex/metalizado in
 * taxonomy/alcance-referencia.ts). Locking the category would exclude every
 * balloon needed to build it, so it is a hard filter only when the customer
 * explicitly asks for a ready-made kit.
 */
const CATEGORIA_PRODUCTO_ESTRUCTURA = "guirnalda_arco";

function pideKitPrearmado(texto: string): boolean {
  return /\b(?:kits?|e ?decors?|predisenad\w*|prearmad\w*)\b/.test(plegarTexto(texto));
}

/**
 * Parse constraints locally. No Gemini enrichment: an AI-generated component
 * query can never contribute a hard SQL predicate.
 */
export function extraerFiltrosDurosBusqueda(solicitudOriginal: string, brief: Brief): FiltrosDurosBusqueda {
  const contexto = textoContextoRestricciones(solicitudOriginal, brief);
  const filtros = interpretarConsultaDeterminista(contexto).intent.filtros_duros;
  if (!filtros.categorias.includes(CATEGORIA_PRODUCTO_ESTRUCTURA) || pideKitPrearmado(contexto)) return filtros;
  return {
    ...filtros,
    categorias: filtros.categorias.filter((categoria) => categoria !== CATEGORIA_PRODUCTO_ESTRUCTURA),
  };
}
