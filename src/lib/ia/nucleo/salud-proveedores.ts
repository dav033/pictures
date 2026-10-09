import { MODELO_CHAT as MODELO_CHAT_GEMINI } from "@/lib/gemini";
import { configClaudeLocal } from "@/lib/ia/claude/config";
import type { ProveedorId } from "./tipos";

export type ProveedorEnSalud = {
  id: ProveedorId;
  disponible: boolean;
  /** Claude: solo existe en local (IA_PROVEEDOR=claude) y no se puede elegir como ajuste global. */
  soloLocal?: boolean;
  modelo: { chat: string; esfuerzo?: string };
  /** Claude: lo que sigue en Gemini aunque Claude esté activo (no se presenta como «todo es Claude»). */
  sigueEnGemini?: readonly string[];
};

/** Llamadas que no pasan por el registro y siguen en Gemini con Claude activo en local. */
export const SIGUE_EN_GEMINI: readonly string[] = [
  "embeddings (catálogo RAG, búsqueda por foto y similitud del refinado)",
  "Happie (recomendador de paquetes y conversación del webhook)",
];

/**
 * La lista de proveedores de `/api/ia/salud` (pestaña «Motor IA» del admin y barra de la vista clásica). Gemini siempre;
 * Claude solo cuando está disponible, es decir en local con IA_PROVEEDOR=claude: en producción la lista es la de antes.
 */
export function proveedoresEnSalud(disponibles: readonly ProveedorId[]): ProveedorEnSalud[] {
  const lista: ProveedorEnSalud[] = [{ id: "gemini", disponible: disponibles.includes("gemini"), modelo: { chat: MODELO_CHAT_GEMINI } }];
  if (disponibles.includes("claude")) {
    const claude = configClaudeLocal();
    lista.push({ id: "claude", disponible: true, soloLocal: true, modelo: { chat: claude.modelo, esfuerzo: claude.esfuerzo }, sigueEnGemini: SIGUE_EN_GEMINI });
  }
  return lista;
}
