import "server-only";
import { ThinkingLevel } from "@google/genai";
import { guardarMeta, obtenerMeta } from "@/lib/db";
import { ErrorIA } from "./tipos";
import type { ChatPort, ProveedorId } from "./tipos";
import { CHAT_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { decidir, envolverChatPort } from "@/lib/registro";
import { MODELO_LECTURA_FOTO } from "@/lib/ia/amaterasu/config-lectura-foto";
import { claudeLocalPermitido, configClaudeLocal } from "@/lib/ia/claude/config";

const CLAVE_META = "ia_proveedor";

const FALTA_LLAVE = "No hay ninguna llave de IA configurada. Pon GEMINI_API_KEY en .env.local.";

/**
 * Único punto donde un proveedor pasa a ser elegible. `claude` solo en local (`claudeLocalPermitido`): como el
 * override del cuerpo, la cookie y el ajuste global solo eligen entre los disponibles, en Vercel o en producción no hay
 * forma de llegar a Claude.
 */
export function proveedoresDisponibles(): ProveedorId[] {
  const disponibles: ProveedorId[] = [];
  if (process.env.GEMINI_API_KEY) disponibles.push("gemini");
  if (claudeLocalPermitido()) disponibles.push("claude");
  return disponibles;
}

/** El ai-api de Python solo habla con Gemini: con Claude local, los caminos por Python se saltan. */
export function usaPython(id: ProveedorId, banderaPython: boolean): boolean {
  return banderaPython && id === "gemini";
}

export function obtenerAjusteGlobal(): ProveedorId | undefined {
  const valor = obtenerMeta(CLAVE_META);
  return valor === "gemini" ? valor : undefined;
}

export function guardarAjusteGlobal(id: ProveedorId): void {
  guardarMeta(CLAVE_META, id);
}

/**
 * Precedencia, de mayor a menor:
 * 1. override por request (body.proveedor)      ← A/B en vivo
 * 2. cookie de sesión (ia_proveedor)             ← switch del cliente
 * 3. ajuste global (tabla meta)                  ← switch del admin
 * 4. variable de entorno (IA_PROVEEDOR)
 * 5. primero disponible con llave configurada
 * Excepción (W5): si Claude está disponible (solo local, IA_PROVEEDOR=claude), gana siempre.
 */
export function resolverProveedor(pistas: {
  override?: string | null;
  cookie?: string | null;
}): ProveedorId {
  const libres = proveedoresDisponibles();
  if (libres.length === 0) throw new ErrorIA("sin_llave", "gemini", FALTA_LLAVE, false);
  // W5: con Claude habilitado (solo local y con IA_PROVEEDOR=claude explícito) toda la IA local corre en Claude. Las pistas
  // del cliente y el ajuste global solo pueden decir "gemini", que siempre está (los embeddings necesitan su llave): si
  // ganaran, una cookie vieja o una fila de `meta` devolvían la IA local a Gemini sin avisar.
  if (libres.includes("claude")) return "claude";

  const global = obtenerAjusteGlobal();
  const candidatos = [pistas.override, pistas.cookie, global, process.env.IA_PROVEEDOR];

  for (const c of candidatos) {
    if (c && libres.includes(c as ProveedorId)) return c as ProveedorId;
  }
  return libres[0];
}

/**
 * PLAN_RENDIMIENTO_RAG.md Fase 4: gemini-3.6-flash razona en "medium" por
 * defecto también en el turno de CHAT (no solo en el parser de intención),
 * y era el mayor bloque de latencia del turno completo. Se midió con
 * scripts/eval/eval-chat-thinking.ts contra 7 diálogos reales (elección de
 * herramienta, honestidad ante NO_MATCH/SKU inexistente, guardar_brief,
 * franjas de presupuesto) — "low" y "minimal" dieron 7/7 estables en 2
 * repeticiones cada uno, sin ninguna regresión estructural. "low" activado
 * por default aquí (más margen de razonamiento que "minimal" para casos no
 * cubiertos por esas 7 pruebas, casi el mismo ahorro de latencia medido:
 * p50 14.047ms→7.166ms). Vacía la env var para volver al comportamiento de
 * siempre sin tocar código.
 */
function thinkingLevelDeChatDesdeEnv(): ThinkingLevel | undefined {
  const valor = process.env.GEMINI_CHAT_THINKING_LEVEL;
  if (valor === "low") return ThinkingLevel.LOW;
  if (valor === "minimal") return ThinkingLevel.MINIMAL;
  return undefined;
}

/**
 * `proposito` etiqueta la auditoría (src/lib/registro): cada turno del ChatPort devuelto deja `llamada_ia`
 * (sistema, historial, herramientas, parámetros) y `respuesta_ia` (texto, llamadas, tokens, ms o error).
 */
export async function chatDe(id: ProveedorId, proposito = "chat"): Promise<ChatPort> {
  if (id === "claude") return chatClaude(proposito);
  const { crearChatGemini } = await import("@sempertex/agente-core/gemini");
  return envolverChatPort(crearChatGemini({ thinkingLevel: thinkingLevelDeChatDesdeEnv() }), { proposito });
}

/** `configClaudeLocal` vuelve a exigir local + `IA_PROVEEDOR=claude` + llave: aunque alguien pase el id a mano, fuera de local lanza. */
async function chatClaude(proposito: string): Promise<ChatPort> {
  const { crearChatClaude } = await import("@/lib/ia/claude/chat");
  const config = configClaudeLocal();
  // Por Claude Code, la auditoría de cada turno lo dice (`parametros.transporte`): lo paga la suscripción, no la API.
  return envolverChatPort(crearChatClaude(config), { proposito, ...(config.transporte === "cli" ? { parametros: { transporte: "cli" } } : {}) });
}

/**
 * El modelo que lee la foto de referencia por el camino directo (sin Python). NO es `chatDe()`: la lectura no hereda
 * el modelo ni el razonamiento del chat (`GEMINI_CHAT_*`), sino `config-lectura-foto.ts`, la misma configuración
 * que usa el camino de Python. Con Claude local, el mismo Haiku que el resto (con imágenes).
 */
export async function chatLecturaFotoDe(id: ProveedorId): Promise<ChatPort> {
  if (id === "claude") return chatClaude("analisis_foto");
  const { crearChatGemini } = await import("@sempertex/agente-core/gemini");
  return envolverChatPort(crearChatGemini({ modelo: MODELO_LECTURA_FOTO }), { proposito: "analisis_foto" });
}

/**
 * Omoikane's own entry point (only /api/chat): `chatDe()` also serves
 * Amaterasu, so the chat's migration flag (ADR-0027) lives here instead of
 * inside it, and Amaterasu keeps its own flag and path untouched.
 */
export async function chatOmoikaneDe(id: ProveedorId, ids: { requestId: string; correlationId: string }, proposito = "chat_clasico"): Promise<ChatPort> {
  const porPython = usaPython(id, CHAT_PYTHON_ENABLED);
  decidir("regla:proveedor_chat", "por dónde corre el turno del chat", { proveedor: id, via: porPython ? "python" : `${id}_directo`, proposito, thinkingLevel: process.env.GEMINI_CHAT_THINKING_LEVEL ?? "(por defecto)" }, { motivo: "CHAT_PYTHON_ENABLED y GEMINI_CHAT_THINKING_LEVEL" });
  if (porPython) {
    const { crearChatGeminiPython } = await import("../omoikane/chat-python");
    return envolverChatPort(crearChatGeminiPython({ ...ids, thinkingLevel: thinkingLevelDeChatDesdeEnv() }), { proposito });
  }
  return chatDe(id, proposito);
}
