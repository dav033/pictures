import "server-only";
import { ThinkingLevel } from "@google/genai";
import { guardarMeta, obtenerMeta } from "@/lib/db";
import { ErrorIA } from "./tipos";
import type { ChatPort, ImagenPort, ProveedorId } from "./tipos";

const CLAVE_META = "ia_proveedor";

const FALTA_LLAVE = "No hay ninguna llave de IA configurada. Pon GEMINI_API_KEY en .env.local.";

export function proveedoresDisponibles(): ProveedorId[] {
  const disponibles: ProveedorId[] = [];
  if (process.env.GEMINI_API_KEY) disponibles.push("gemini");
  return disponibles;
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
 */
export function resolverProveedor(pistas: {
  override?: string | null;
  cookie?: string | null;
}): ProveedorId {
  const libres = proveedoresDisponibles();
  if (libres.length === 0) throw new ErrorIA("sin_llave", "gemini", FALTA_LLAVE, false);

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
 * scripts/eval-chat-thinking.ts contra 7 diálogos reales (elección de
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

export async function chatDe(id: ProveedorId): Promise<ChatPort> {
  void id;
  const { crearChatGemini } = await import("./gemini/chat");
  return crearChatGemini({ thinkingLevel: thinkingLevelDeChatDesdeEnv() });
}

export async function imagenDe(id: ProveedorId): Promise<ImagenPort> {
  void id;
  const { crearImagenGemini } = await import("./gemini/imagen");
  return crearImagenGemini();
}
