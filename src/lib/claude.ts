import { crearClienteAnthropic, type ClienteAnthropic } from "@/lib/ia/claude/cliente";
import { claudeLocalPermitido, configClaudeLocal } from "@/lib/ia/claude/config";
import { envolverClienteAnthropic } from "@/lib/registro/servidor";

let clienteCacheado: { apiKey: string; cliente: ClienteAnthropic } | undefined;

/**
 * Cliente de Claude compartido y ya auditado (el par de `getGeminiClient`): cada `messages.create`/`messages.stream`
 * deja `llamada_ia` + `respuesta_ia` en el registro de la conversación con este `proposito`. `null` fuera de local
 * (Vercel, `NODE_ENV=production`), sin `IA_PROVEEDOR=claude` o sin `ANTHROPIC_API_KEY`: ver `ia/claude/config.ts`.
 */
export function getClaudeClient(proposito: string): ClienteAnthropic | null {
  if (!claudeLocalPermitido()) return null;
  const { apiKey } = configClaudeLocal();
  if (clienteCacheado?.apiKey !== apiKey) clienteCacheado = { apiKey, cliente: crearClienteAnthropic({ apiKey }) };
  return envolverClienteAnthropic(clienteCacheado.cliente, { proposito });
}
