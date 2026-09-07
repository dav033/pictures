import { z } from "zod";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { LoraModeSlugSchema } from "@/lib/lora/schema";

/** Versioned wire contracts for the Next facade and the future Python service. */
export const CHAT_CONTRACT_VERSION = "chat.v1" as const;
export const CHAT_SSE_CONTRACT_VERSION = "chat.sse.v1" as const;
export const TRANSCRIPT_CONTRACT_VERSION = "transcript.v1" as const;
export const TOOL_CALL_CONTRACT_VERSION = "tools.v1" as const;
export const ERROR_CONTRACT_VERSION = "error.v1" as const;

export const RequestIdV1Schema = z.string().uuid();

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const imageSchema = z.object({
  // ~6 MB decoded por imagen; evita que el chat convierta un payload enorme
  // en tokens/ram antes de llegar al proveedor.
  base64: z.string().min(1).max(8_000_000),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  id: z.string().min(1).optional(),
  descripcion: z.string().min(1).optional(),
}).strict();

const briefSchema = z.object({
  tipo_evento: z.string().min(1).optional(),
  espacio: z.string().min(1).optional(),
  invitados: z.number().int().positive().optional(),
  colores: z.array(z.string().min(1)).optional(),
  estilo: z.string().min(1).optional(),
  momento_dia: z.string().min(1).optional(),
  fecha: z.string().min(1).optional(),
  presupuesto: z.union([z.number().finite(), z.string().min(1)]).optional(),
}).strict();

export const ChatMessageV1Schema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
}).strict();

export const ChatRequestV1Schema = z.object({
  schema_version: z.literal(CHAT_CONTRACT_VERSION),
  messages: z.array(ChatMessageV1Schema).min(1),
  brief: briefSchema,
  proveedor: z.string().min(1).optional(),
  fotoEspacio: imageSchema.optional(),
  imagenesReferencia: z.array(imageSchema).max(8).optional(),
  referenceBlueprint: ReferenceBlueprintV2Schema.optional(),
  loraMode: LoraModeSlugSchema.optional(),
}).strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts the current legacy body once, then validates the normalized v1 contract. */
export function parseChatRequestV1(input: unknown): ChatRequestV1 {
  if (!isRecord(input)) return ChatRequestV1Schema.parse(input);
  const version = input.schema_version;
  if (version !== undefined && version !== CHAT_CONTRACT_VERSION) return ChatRequestV1Schema.parse(input);
  return ChatRequestV1Schema.parse({
    ...input,
    schema_version: CHAT_CONTRACT_VERSION,
    brief: input.brief ?? {},
    proveedor: input.proveedor ?? undefined,
    fotoEspacio: input.fotoEspacio ?? undefined,
    imagenesReferencia: input.imagenesReferencia ?? undefined,
    referenceBlueprint: input.referenceBlueprint ?? undefined,
    loraMode: input.loraMode ?? undefined,
  });
}

export const ChatTranscriptTextV1Schema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  images: z.array(imageSchema).optional(),
}).strict();

export const ToolCallV1Schema = z.object({
  schema_version: z.literal(TOOL_CALL_CONTRACT_VERSION),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), jsonValueSchema),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
}).strict();

export const ChatTranscriptToolResultV1Schema = z.object({
  role: z.literal("tool"),
  call_id: z.string().min(1),
  name: z.string().min(1),
  result: jsonValueSchema,
}).strict();

export const ChatTranscriptMessageV1Schema = z.union([
  ChatTranscriptTextV1Schema,
  z.object({
    role: z.literal("assistant"),
    tool_calls: z.array(ToolCallV1Schema).min(1),
  }).strict(),
  ChatTranscriptToolResultV1Schema,
]);

export const ChatTranscriptV1Schema = z.object({
  schema_version: z.literal(TRANSCRIPT_CONTRACT_VERSION),
  messages: z.array(ChatTranscriptMessageV1Schema),
}).strict();

export const ChatTextEventV1Schema = z.object({
  schema_version: z.literal(CHAT_SSE_CONTRACT_VERSION),
  type: z.literal("texto"),
  request_id: RequestIdV1Schema,
  correlation_id: RequestIdV1Schema,
  delta: z.string(),
}).strict();

export const ChatToolEventV1Schema = z.object({
  schema_version: z.literal(CHAT_SSE_CONTRACT_VERSION),
  type: z.literal("herramienta"),
  request_id: RequestIdV1Schema,
  correlation_id: RequestIdV1Schema,
  nombre: z.string().min(1),
  estado: z.enum(["ejecutando", "lista"]),
}).strict();

export const ChatFinishEventV1Schema = z.object({
  schema_version: z.literal(CHAT_SSE_CONTRACT_VERSION),
  type: z.literal("fin"),
  request_id: RequestIdV1Schema,
  correlation_id: RequestIdV1Schema,
  reply: z.string(),
  brief: briefSchema,
  proveedor: z.string().min(1),
  modelo: z.string().min(1),
  result: z.record(z.string(), jsonValueSchema).optional(),
}).passthrough();

export const ErrorCodeV1Schema = z.enum([
  "INVALID_JSON",
  "INVALID_INPUT",
  "PAYLOAD_TOO_LARGE",
  "UNAUTHORIZED",
  "INVALID_ORIGIN",
  "AI_KEY_MISSING",
  "AI_QUOTA",
  "AI_FILTERED",
  "AI_TIMEOUT",
  "AI_NETWORK",
  "AI_PROVIDER",
  "RAG_UNAVAILABLE",
  "TOOL_NOT_FOUND",
  "INVALID_TOOL_ARGUMENTS",
  "CLIENT_CANCELLED",
  "INTERNAL_ERROR",
]);
export type ErrorCodeV1 = z.infer<typeof ErrorCodeV1Schema>;

export const ErrorEnvelopeV1Schema = z.object({
  schema_version: z.literal(ERROR_CONTRACT_VERSION),
  code: ErrorCodeV1Schema,
  message: z.string().min(1),
  retryable: z.boolean(),
  request_id: RequestIdV1Schema,
}).strict();

export const ChatErrorEventV1Schema = z.object({
  schema_version: z.literal(CHAT_SSE_CONTRACT_VERSION),
  type: z.literal("error"),
  request_id: RequestIdV1Schema,
  correlation_id: RequestIdV1Schema,
  /** Legacy UI contract: error remains displayable text. */
  error: z.string().min(1),
  code: ErrorCodeV1Schema,
  retryable: z.boolean(),
  causa: z.string().optional(),
  proveedor: z.string().optional(),
}).strict();

export const ChatSseEventV1Schema = z.discriminatedUnion("type", [
  ChatTextEventV1Schema,
  ChatToolEventV1Schema,
  ChatFinishEventV1Schema,
  ChatErrorEventV1Schema,
]);

export type ChatRequestV1 = z.infer<typeof ChatRequestV1Schema>;
export type ChatSseEventV1 = z.infer<typeof ChatSseEventV1Schema>;
export type ChatTranscriptV1 = z.infer<typeof ChatTranscriptV1Schema>;
export type ErrorEnvelopeV1 = z.infer<typeof ErrorEnvelopeV1Schema>;
