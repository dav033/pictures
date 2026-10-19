import { crearClienteClaudeCli } from "@/lib/ia/claude/cli/cliente";
import { crearClienteAnthropic, type ClienteAnthropic } from "@/lib/ia/claude/cliente";
import { claudeLocalPermitido, configClaudeLocal } from "@/lib/ia/claude/config";
import { envolverClienteAnthropic } from "@/lib/registro/servidor";

let clienteCacheado: { clave: string; cliente: ClienteAnthropic } | undefined;

/**
 * Cliente de Claude compartido y ya auditado (el par de `getGeminiClient`): cada `messages.create`/`messages.stream`
 * deja `llamada_ia` + `respuesta_ia` en el registro de la conversación con este `proposito`. `null` fuera de local
 * (Vercel, `NODE_ENV=production`), sin `IA_PROVEEDOR=claude` o sin `ANTHROPIC_API_KEY` (salvo con
 * `IA_CLAUDE_TRANSPORTE=cli`, que usa el Claude Code instalado): ver `ia/claude/config.ts`.
 */
export function getClaudeClient(proposito: string): ClienteAnthropic | null {
  if (!claudeLocalPermitido()) return null;
  const config = configClaudeLocal();
  const clave = config.transporte === "cli" ? "cli" : `api:${config.apiKey}`;
  if (clienteCacheado?.clave !== clave) {
    clienteCacheado = { clave, cliente: config.transporte === "cli" ? crearClienteClaudeCli() : crearClienteAnthropic({ apiKey: config.apiKey }) };
  }
  return envolverClienteAnthropic(clienteCacheado.cliente, { proposito, transporte: config.transporte });
}
