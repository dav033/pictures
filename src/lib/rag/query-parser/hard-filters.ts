import type { Brief } from "@/lib/types";
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
 * Parse constraints locally. No Gemini enrichment: an AI-generated component
 * query can never contribute a hard SQL predicate.
 */
export function extraerFiltrosDurosBusqueda(solicitudOriginal: string, brief: Brief): FiltrosDurosBusqueda {
  const contexto = textoContextoRestricciones(solicitudOriginal, brief);
  return interpretarConsultaDeterminista(contexto).intent.filtros_duros;
}
