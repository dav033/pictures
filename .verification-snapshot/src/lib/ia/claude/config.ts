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
 *
 * Dos transportes (`IA_CLAUDE_TRANSPORTE`): `api` (por defecto, la API de mensajes con ANTHROPIC_API_KEY) y `cli`
 * (pedido del dueño sin llave: el Claude Code instalado en el equipo, con la sesión de su suscripción; ver `cli/`).
 */

export const MODELO_CLAUDE_POR_DEFECTO = "claude-haiku-5-5";
/** El alias que entiende `claude --model` (el último Haiku). */
export const MODELO_CLAUDE_CLI_POR_DEFECTO = "haiku";
/** Sin flujo, ~16K deja respuestas dentro de los plazos HTTP; el razonamiento cuenta dentro de este tope. */
export const MAX_TOKENS_CLAUDE = 16_000;

type Entorno = Readonly<Record<string, string | undefined>>;

export type TransporteClaude = "api" | "cli";

type ConfigComun = {
  modelo: string;
  esfuerzo: EsfuerzoClaude;
  /** `false` manda `thinking: {type: "disabled"}` (solo válido con esfuerzo high o menos; el transporte `cli` lo ignora). */
  pensamiento: boolean;
  maxTokens: number;
};

export type ConfigClaude = ConfigComun & ({ transporte: "api"; apiKey: string } | { transporte: "cli" });

const EntornoClaudeSchema = z.object({
  IA_CLAUDE_TRANSPORTE: z.enum(["api", "cli"]).default("api"),
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  ANTHROPIC_CHAT_MODEL: z.string().trim().min(1).optional(),
  IA_LOCAL_ESFUERZO: z.enum(["low", "medium", "high"]).optional(),
  IA_LOCAL_PENSAMIENTO: z.enum(["on", "off"]).default("on"),
});

/** Local de verdad: `next dev` (NODE_ENV=development) y fuera de Vercel. El transporte `cli` lo vuelve a exigir antes de lanzar. */
export function entornoLocal(entorno: Entorno = process.env): boolean {
  return !entorno.VERCEL && entorno.NODE_ENV === "development";
}

function transporteDe(entorno: Entorno): TransporteClaude {
  return entorno.IA_CLAUDE_TRANSPORTE?.trim().toLowerCase() === "cli" ? "cli" : "api";
}

/** Local + IA_PROVEEDOR=claude + (la llave, o el transporte `cli`, que no la usa). La llave solo se mira si existe (nunca se imprime). */
export function claudeLocalPermitido(entorno: Entorno = process.env): boolean {
  return entornoLocal(entorno)
    && entorno.IA_PROVEEDOR === "claude"
    && (transporteDe(entorno) === "cli" || Boolean(entorno.ANTHROPIC_API_KEY?.trim()));
}

/** El transporte con el que corre Claude en este proceso; `null` si Claude no está activo (siempre en producción). */
export function transporteClaudeActivo(entorno: Entorno = process.env): TransporteClaude | null {
  return claudeLocalPermitido(entorno) ? transporteDe(entorno) : null;
}

/**
 * Claude por Claude Code tarda minutos donde la API tarda segundos (prueba real: 5 s a 4 min por llamada): los plazos que
 * esperan a la IA se estiran por este factor SOLO con el transporte `cli` activo (local). En producción, en Vercel y con
 * la API el factor es 1 y cada plazo queda en su número de siempre.
 */
export const FACTOR_PLAZO_CLI = 4;

export function factorPlazoIA(entorno: Entorno = process.env): number {
  return transporteClaudeActivo(entorno) === "cli" ? FACTOR_PLAZO_CLI : 1;
}

export function plazoIA(ms: number, entorno: Entorno = process.env): number {
  return ms * factorPlazoIA(entorno);
}

/** Lanza `ErrorIA` (no reintentable) fuera de local o con una variable inválida; el mensaje nombra la variable, nunca su valor. */
export function configClaudeLocal(entorno: Entorno = process.env): ConfigClaude {
  if (!claudeLocalPermitido(entorno)) {
    throw new ErrorIA("sin_llave", "claude", "Claude solo corre en local (NODE_ENV=development, sin VERCEL) con IA_PROVEEDOR=claude y ANTHROPIC_API_KEY (o IA_CLAUDE_TRANSPORTE=cli) en .env.local.", false);
  }
  const vacioComoAusente = (valor: string | undefined) => (valor?.trim() ? valor.trim() : undefined);
  const leido = EntornoClaudeSchema.safeParse({
    IA_CLAUDE_TRANSPORTE: vacioComoAusente(entorno.IA_CLAUDE_TRANSPORTE)?.toLowerCase(),
    ANTHROPIC_API_KEY: entorno.ANTHROPIC_API_KEY,
    ANTHROPIC_CHAT_MODEL: vacioComoAusente(entorno.ANTHROPIC_CHAT_MODEL),
    IA_LOCAL_ESFUERZO: vacioComoAusente(entorno.IA_LOCAL_ESFUERZO),
    IA_LOCAL_PENSAMIENTO: vacioComoAusente(entorno.IA_LOCAL_PENSAMIENTO),
  });
  if (!leido.success) {
    const variables = [...new Set(leido.error.issues.map((problema) => String(problema.path[0])))].join(", ");
    throw new ErrorIA("desconocido", "claude", `Configuración de Claude inválida en .env.local: ${variables} (IA_CLAUDE_TRANSPORTE: api|cli; IA_LOCAL_ESFUERZO: low|medium|high; IA_LOCAL_PENSAMIENTO: on|off).`, false);
  }
  const datos = leido.data;
  const cli = datos.IA_CLAUDE_TRANSPORTE === "cli";
  const comun = {
    // Por Claude Code, low por defecto: cada llamada ya tarda minutos (IA_LOCAL_ESFUERZO lo cambia).
    esfuerzo: datos.IA_LOCAL_ESFUERZO ?? (cli ? "low" : "medium"),
    pensamiento: datos.IA_LOCAL_PENSAMIENTO === "on",
    maxTokens: MAX_TOKENS_CLAUDE,
  };
  if (cli) {
    return { transporte: "cli", modelo: datos.ANTHROPIC_CHAT_MODEL ?? MODELO_CLAUDE_CLI_POR_DEFECTO, ...comun };
  }
  return { transporte: "api", apiKey: datos.ANTHROPIC_API_KEY ?? "", modelo: datos.ANTHROPIC_CHAT_MODEL ?? MODELO_CLAUDE_POR_DEFECTO, ...comun };
}
