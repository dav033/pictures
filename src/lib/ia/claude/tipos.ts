/**
 * Lo que este proyecto usa de la API de mensajes de Anthropic (POST /v1/messages), con `fetch` directo: el SDK no está
 * instalado. Referencia: https://platform.claude.com/docs/en/api/messages (consultada 2026-10-09) y
 * C:/Users/davidt/bitacora/pictures/research/w5-anthropic/NOTES.md.
 */

/** Profundidad de razonamiento (`output_config.effort`). Haiku 5.5 admite también `xhigh`/`max`; aquí no se usan. */
export type EsfuerzoClaude = "low" | "medium" | "high";

export type ControlCache = { type: "ephemeral" };

export type BloqueTexto = { type: "text"; text: string; cache_control?: ControlCache };
export type BloqueImagen = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
  cache_control?: ControlCache;
};
export type BloqueUsoHerramienta = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type BloqueResultadoHerramienta = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: ControlCache;
};
export type BloquePensamiento = { type: "thinking"; thinking: string; signature: string };

/**
 * Un bloque tal como llega de la API. Los de razonamiento (`thinking`, `redacted_thinking`) y cualquier tipo nuevo se
 * reenvían SIN tocar en la vuelta siguiente: la API rechaza (400) un historial con bloques de razonamiento alterados.
 */
export type BloqueCrudo = { type: string; [clave: string]: unknown };

export type BloqueEntrada = BloqueTexto | BloqueImagen | BloqueUsoHerramienta | BloqueResultadoHerramienta | BloqueCrudo;

export type MensajeAnthropic = { role: "user" | "assistant"; content: BloqueEntrada[] };

export type HerramientaAnthropic = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: ControlCache;
};

export type EleccionHerramienta = { type: "auto" } | { type: "any" } | { type: "tool"; name: string };

export type CuerpoMensajes = {
  model: string;
  max_tokens: number;
  system?: BloqueTexto[];
  messages: MensajeAnthropic[];
  tools?: HerramientaAnthropic[];
  tool_choice?: EleccionHerramienta;
  thinking: { type: "adaptive" } | { type: "disabled" };
  output_config: { effort: EsfuerzoClaude };
  /** Caché automática: la API pone el punto de corte en el último bloque y lo corre a medida que crece la conversación. */
  cache_control?: ControlCache;
};

export type UsoAnthropic = {
  /** Solo la entrada SIN caché (lo que va después del último punto de corte). */
  input_tokens: number;
  /** Incluye el razonamiento. */
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
};

export type RespuestaAnthropic = {
  id: string;
  model: string;
  content: BloqueCrudo[];
  stop_reason: string | null;
  usage: UsoAnthropic;
};

export type DeltaBloque =
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string };

export type EventoFlujoAnthropic =
  | { type: "message_start"; message: RespuestaAnthropic }
  | { type: "content_block_start"; index: number; content_block: BloqueCrudo }
  | { type: "content_block_delta"; index: number; delta: DeltaBloque }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason?: string | null }; usage?: Partial<UsoAnthropic> }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error: { type: string; message: string } };
