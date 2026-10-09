import { z } from "zod";
import { ErrorIA } from "@sempertex/agente-core";
import type { EsfuerzoClaude } from "./tipos";

/**
 * Claude (Haiku) es el proveedor de IA SOLO en local (W5, pedido del dueño: «en local y únicamente en local la IA que se
 * utiliza dentro sea Haiku 5.5 (medium)»; producción sigue con Gemini Flash). Se hace cumplir aquí, en el código: el
 * registro (`proveedoresDisponibles`) y `destinoGenerativo` solo lo ofrecen si `claudeLocalPermitido()`, así que ni la
 * cookie, ni el cuerpo de la petición, ni el ajuste global pueden elegirlo fuera de local.
 * Local = `NODE_ENV === "development"` exactamente (lo pone `next dev`) y sin `VERCEL`. Todo lo demás lo rechaza:
 * Vercel, el VPS (Docker con NODE_ENV=production, sin VERCEL: deploy.yml / compose.vps.yml), `next start` y también un
 * proceso SIN NODE_ENV. Por eso un script local con tsx (p. ej. el arnés de W4) tiene que poner NODE_ENV=development
 * de forma explícita al lanzarlo (`NODE_ENV=development npx tsx --env-file=.env.local …`).
 */

export const MODELO_CLAUDE_POR_DEFECTO = "claude-haiku-5-5";
/** Sin flujo, ~16K deja respuestas dentro de los plazos HTTP; el razonamiento cuenta dentro de este tope. */
export const MAX_TOKENS_CLAUDE = 16_000;

type Entorno = Readonly<Record<string, string | undefined>>;

export type ConfigClaude = {
  apiKey: string;
  modelo: string;
  esfuerzo: EsfuerzoClaude;
  /** `false` manda `thinking: {type: "disabled"}` (solo válido con esfuerzo high o menos). */
  pensamiento: boolean;
  maxTokens: number;
};

const EntornoClaudeSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().min(1),
  ANTHROPIC_CHAT_MODEL: z.string().trim().min(1).default(MODELO_CLAUDE_POR_DEFECTO),
  IA_LOCAL_ESFUERZO: z.enum(["low", "medium", "high"]).default("medium"),
  IA_LOCAL_PENSAMIENTO: z.enum(["on", "off"]).default("on"),
});

/** Las cuatro condiciones juntas; la llave solo se mira si existe (nunca se imprime). */
export function claudeLocalPermitido(entorno: Entorno = process.env): boolean {
  return !entorno.VERCEL
    && entorno.NODE_ENV === "development"
    && entorno.IA_PROVEEDOR === "claude"
    && Boolean(entorno.ANTHROPIC_API_KEY?.trim());
}

/** Lanza `ErrorIA` (no reintentable) fuera de local o con una variable inválida; el mensaje nombra la variable, nunca su valor. */
export function configClaudeLocal(entorno: Entorno = process.env): ConfigClaude {
  if (!claudeLocalPermitido(entorno)) {
    throw new ErrorIA("sin_llave", "claude", "Claude solo corre en local (NODE_ENV=development, sin VERCEL) con IA_PROVEEDOR=claude y ANTHROPIC_API_KEY en .env.local.", false);
  }
  const vacioComoAusente = (valor: string | undefined) => (valor?.trim() ? valor.trim() : undefined);
  const leido = EntornoClaudeSchema.safeParse({
    ANTHROPIC_API_KEY: entorno.ANTHROPIC_API_KEY,
    ANTHROPIC_CHAT_MODEL: vacioComoAusente(entorno.ANTHROPIC_CHAT_MODEL),
    IA_LOCAL_ESFUERZO: vacioComoAusente(entorno.IA_LOCAL_ESFUERZO),
    IA_LOCAL_PENSAMIENTO: vacioComoAusente(entorno.IA_LOCAL_PENSAMIENTO),
  });
  if (!leido.success) {
    const variables = [...new Set(leido.error.issues.map((problema) => String(problema.path[0])))].join(", ");
    throw new ErrorIA("desconocido", "claude", `Configuración de Claude inválida en .env.local: ${variables} (IA_LOCAL_ESFUERZO: low|medium|high; IA_LOCAL_PENSAMIENTO: on|off).`, false);
  }
  return {
    apiKey: leido.data.ANTHROPIC_API_KEY,
    modelo: leido.data.ANTHROPIC_CHAT_MODEL,
    esfuerzo: leido.data.IA_LOCAL_ESFUERZO,
    pensamiento: leido.data.IA_LOCAL_PENSAMIENTO === "on",
    maxTokens: MAX_TOKENS_CLAUDE,
  };
}
