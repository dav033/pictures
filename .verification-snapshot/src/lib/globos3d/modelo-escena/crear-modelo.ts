import { getClaudeClient } from "@/lib/claude";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { configClaudeLocal } from "@/lib/ia/claude/config";
import type { ProveedorId } from "@/lib/ia/nucleo/tipos";
import { crearModeloEscenaClaude } from "./sesion-claude";
import { crearModeloEscenaGemini } from "./sesion-gemini";
import type { ModeloEscenaIA } from "./tipos";

/**
 * El modelo de la escena para el proveedor que resolvió el registro (`resolverProveedor`). Los dos clientes vienen ya
 * auditados (`llamada_ia`/`respuesta_ia` con el propósito `escena_ia`). `null` si ese proveedor no está configurado
 * aquí; `getClaudeClient` además devuelve `null` fuera de local, así que Claude nunca corre en Vercel ni en producción.
 */
export function modeloEscenaIADe(proveedor: ProveedorId): ModeloEscenaIA | null {
  if (proveedor === "claude") {
    const cliente = getClaudeClient("escena_ia");
    return cliente ? crearModeloEscenaClaude(cliente, configClaudeLocal()) : null;
  }
  if (proveedor !== "gemini") return null;
  const cliente = getGeminiClient("escena_ia");
  return cliente ? crearModeloEscenaGemini(cliente, MODELO_CHAT) : null;
}
