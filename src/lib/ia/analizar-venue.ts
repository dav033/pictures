import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ErrorIA, type ChatPort, type Herramienta, type ImagenEtiquetada, type TurnoChat } from "./tipos";
import { analysisCacheKey } from "./reference-blueprint";
import { bytesDeBase64 } from "@sempertex/agente-core";
import { registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "./telemetria-llamadas";
import { toolArgs } from "./candidatos-referencia";

const PointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const BBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
}).strict().superRefine((value, ctx) => {
  if (value.x + value.width > 1) ctx.addIssue({ code: "custom", path: ["width"], message: "bbox must stay inside the image" });
  if (value.y + value.height > 1) ctx.addIssue({ code: "custom", path: ["height"], message: "bbox must stay inside the image" });
});

const OpeningSchema = z.object({
  opening_id: z.string().trim().min(1).max(80),
  kind: z.enum(["doorway", "porch", "archway", "window", "other"]),
  bbox: BBoxSchema,
  frameable: z.boolean(),
  confidence: z.number().min(0).max(1),
}).strict();

const FlatWallSchema = z.object({
  wall_id: z.string().trim().min(1).max(80),
  bbox: BBoxSchema,
  suitable_for_backdrop: z.boolean(),
  confidence: z.number().min(0).max(1),
}).strict();

const ObstacleSchema = z.object({
  obstacle_id: z.string().trim().min(1).max(80),
  kind: z.string().trim().min(1).max(100),
  bbox: BBoxSchema,
  confidence: z.number().min(0).max(1),
}).strict();

const MetricAnchorSchema = z.object({
  anchor_id: z.string().trim().min(1).max(80),
  kind: z.enum(["door", "chair", "person", "table", "other"]),
  bbox: BBoxSchema,
  measurement_axis: z.enum(["width", "height"]),
  real_world_m: z.number().positive().max(20),
  confidence: z.number().min(0).max(1),
}).strict();

export const VenueAnalysisSchema = z.object({
  schema_version: z.literal("1.0"),
  image_id: z.string().trim().min(1).max(80),
  openings: z.array(OpeningSchema).max(20),
  flat_walls: z.array(FlatWallSchema).max(20),
  floor_plane: z.object({
    bbox: BBoxSchema,
    polygon: z.array(PointSchema).min(3).max(20),
    wall_floor_line: z.object({ start: PointSchema, end: PointSchema }).strict(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  obstacles: z.array(ObstacleSchema).max(40),
  eye_level: z.object({ y: z.number().min(0).max(1), confidence: z.number().min(0).max(1) }).strict(),
  metric_anchors: z.array(MetricAnchorSchema).min(1).max(8),
}).strict();

export type VenueAnalysis = z.infer<typeof VenueAnalysisSchema>;

export type VenueAnalysisResult = {
  analysis: VenueAnalysis;
  metadata: {
    cached: boolean;
    cache_key: string;
    system_prompt_hash: string;
    passes: ["inventory", "audit"];
  };
};

const PARSER_VERSION = "venue-space-v1";
const MAX_FORMAT_ATTEMPTS = 2;
const INVENTORY_CAPABILITY = "analisis_referencia_inventario" as const;
const AUDIT_CAPABILITY = "analisis_referencia_auditoria" as const;
const INVENTORY_PARAMETERS = { temperatura: 0, maxTokens: 5000 } as const;
const AUDIT_PARAMETERS = { temperatura: 0, maxTokens: 4500 } as const;

const BBOX_TOOL_SCHEMA = {
  type: "object",
  required: ["x", "y", "width", "height"],
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
  },
};
const POINT_TOOL_SCHEMA = {
  type: "object",
  required: ["x", "y"],
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
  },
};
const VENUE_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["schema_version", "image_id", "openings", "flat_walls", "floor_plane", "obstacles", "eye_level", "metric_anchors"],
  properties: {
    schema_version: { type: "string", enum: ["1.0"] },
    image_id: { type: "string" },
    openings: {
      type: "array",
      items: {
        type: "object",
        required: ["opening_id", "kind", "bbox", "frameable", "confidence"],
        properties: {
          opening_id: { type: "string" },
          kind: { type: "string", enum: ["doorway", "porch", "archway", "window", "other"] },
          bbox: BBOX_TOOL_SCHEMA,
          frameable: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    flat_walls: {
      type: "array",
      items: {
        type: "object",
        required: ["wall_id", "bbox", "suitable_for_backdrop", "confidence"],
        properties: {
          wall_id: { type: "string" },
          bbox: BBOX_TOOL_SCHEMA,
          suitable_for_backdrop: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    floor_plane: {
      type: "object",
      required: ["bbox", "polygon", "wall_floor_line", "confidence"],
      properties: {
        bbox: BBOX_TOOL_SCHEMA,
        polygon: { type: "array", minItems: 3, items: POINT_TOOL_SCHEMA },
        wall_floor_line: { type: "object", required: ["start", "end"], properties: { start: POINT_TOOL_SCHEMA, end: POINT_TOOL_SCHEMA } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    obstacles: {
      type: "array",
      items: {
        type: "object",
        required: ["obstacle_id", "kind", "bbox", "confidence"],
        properties: {
          obstacle_id: { type: "string" },
          kind: { type: "string" },
          bbox: BBOX_TOOL_SCHEMA,
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    eye_level: {
      type: "object",
      required: ["y", "confidence"],
      properties: { y: { type: "number", minimum: 0, maximum: 1 }, confidence: { type: "number", minimum: 0, maximum: 1 } },
    },
    metric_anchors: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["anchor_id", "kind", "bbox", "measurement_axis", "real_world_m", "confidence"],
        properties: {
          anchor_id: { type: "string" },
          kind: { type: "string", enum: ["door", "chair", "person", "table", "other"] },
          bbox: BBOX_TOOL_SCHEMA,
          measurement_axis: { type: "string", enum: ["width", "height"] },
          real_world_m: { type: "number", exclusiveMinimum: 0, maximum: 20 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const INVENTORY_TOOL: Herramienta = {
  nombre: "return_venue_analysis",
  descripcion: "Return a normalized decorator-oriented analysis of the customer venue photo.",
  esquema: VENUE_TOOL_SCHEMA,
};

const AUDIT_TOOL: Herramienta = {
  nombre: "return_venue_analysis_audit",
  descripcion: "Return the corrected complete venue analysis after checking the draft against the photo.",
  esquema: VENUE_TOOL_SCHEMA,
};

const SYSTEM_PROMPT = `You are a forensic venue-layout analyst for an event decorator. Return only structured data through the tool.
Inspect the supplied customer venue photo, not a decoration reference. Use normalized image coordinates from 0 to 1 with x/y at the upper-left and boxes fully inside the image.
Find every doorway, porch opening, or archway worth framing; identify flat wall areas suitable for a backdrop; map the visible floor plane and the line where the floor meets the wall; mark columns, furniture, plants, vehicles, railings, steps, and other obstacles that a decorator must avoid; estimate the horizon or camera eye level; and identify at least one visible metric anchor. A typical door is approximately 2.0 m tall, a dining chair approximately 0.45 m wide, and a person approximately 1.7 m tall: state the conservative real-world size you used for each anchor.
Do not invent openings, walls, floor, obstacles, or anchors that are not visible. If a category is absent, return an empty array. For every metric anchor, set measurement_axis to the dimension represented by real_world_m. Boxes should describe the usable architectural or physical region, not an imagined decoration.`;
const AUDIT_PROMPT = `You are a strict second-pass venue-layout verifier. Reinspect the same customer venue photo and correct the draft analysis. Return the complete corrected analysis through the tool, preserving image_id and normalized coordinates. Check especially that an opening is actually frameable, a backdrop wall is genuinely flat, the floor-wall line is plausible, obstacles are not omitted, eye level is in the image, and at least one metric anchor has a defensible real-world size with the correct measurement axis. Do not invent anything absent from the photo.`;

const cache = new Map<string, VenueAnalysisResult>();
const MAX_CACHE = 40;
type InFlight = { promise: Promise<VenueAnalysisResult>; controller: AbortController; waiters: number };
const inFlight = new Map<string, InFlight>();

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("CLIENT_CANCELLED");
}

function sharedResult(key: string, entry: InFlight, signal: AbortSignal | undefined): Promise<VenueAnalysisResult> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  entry.waiters += 1;
  return new Promise<VenueAnalysisResult>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      entry.waiters -= 1;
      if (entry.waiters === 0) {
        if (inFlight.get(key) === entry) inFlight.delete(key);
        entry.controller.abort(abortReason(signal!));
      }
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (result) => {
        if (settled) return;
        settled = true;
        entry.waiters -= 1;
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        entry.waiters -= 1;
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function configHash(chat: ChatPort, systemPromptHash: string): string {
  return createHash("sha256").update(JSON.stringify({
    parser_version: PARSER_VERSION,
    system_prompt_hash: systemPromptHash,
    tools: [INVENTORY_TOOL, AUDIT_TOOL],
    model: chat.modelo,
    thinking_level: chat.thinkingLevel ?? "desconocido",
    inventory: INVENTORY_PARAMETERS,
    audit: AUDIT_PARAMETERS,
  })).digest("hex");
}

function isMalformed(error: unknown): boolean {
  return error instanceof SyntaxError
    || error instanceof z.ZodError
    || (error instanceof ErrorIA && error.message.includes("malformed output"));
}

async function executeAnalysis(input: {
  chat: ChatPort;
  venue: ImagenEtiquetada;
  telemetria?: ContextoTelemetriaIA;
  signal: AbortSignal;
  key: string;
  systemPromptHash: string;
}): Promise<VenueAnalysisResult> {
  const { chat, venue, telemetria, signal, key, systemPromptHash } = input;
  const bytesImagenEntrada = bytesDeBase64(venue.base64);
  const config = configHash(chat, systemPromptHash);

  const executeStep = async (capacidad: typeof INVENTORY_CAPABILITY | typeof AUDIT_CAPABILITY, request: Parameters<ChatPort["turno"]>[0], attempt: number): Promise<TurnoChat> => {
    const inicio = Date.now();
    try {
      const turno = await chat.turno(request);
      registrarGemini({
        flujo: "analisis_referencia",
        capacidad,
        modelo: turno.modelo || chat.modelo,
        inicio,
        resultado: "ok",
        contexto: { superficie: "/api/generate/venue-analysis", ...telemetria, intento: attempt },
        usage: {
          promptTokenCount: turno.uso.entrada,
          candidatesTokenCount: turno.uso.salida,
          thoughtsTokenCount: turno.uso.pensamiento,
          cachedContentTokenCount: turno.uso.cacheados,
          toolUsePromptTokenCount: turno.uso.promptHerramientas,
        },
        bytesImagenEntrada,
        promptVersion: systemPromptHash.slice(0, 16),
        thinkingLevel: chat.thinkingLevel,
        finishReason: turno.finishReason,
        configHash: config,
      });
      return turno;
    } catch (error) {
      registrarGemini({
        flujo: "analisis_referencia",
        capacidad,
        modelo: chat.modelo,
        inicio,
        resultado: resultadoTelemetria(error),
        contexto: { superficie: "/api/generate/venue-analysis", ...telemetria, intento: attempt },
        bytesImagenEntrada,
        promptVersion: systemPromptHash.slice(0, 16),
        thinkingLevel: chat.thinkingLevel,
        configHash: config,
      });
      throw error;
    }
  };

  const structuredStep = async (
    capacidad: typeof INVENTORY_CAPABILITY | typeof AUDIT_CAPABILITY,
    request: Parameters<ChatPort["turno"]>[0],
    toolName: string,
  ): Promise<VenueAnalysis> => {
    for (let attempt = 1; ; attempt += 1) {
      const turno = await executeStep(capacidad, request, attempt);
      let failure: unknown;
      try {
        return VenueAnalysisSchema.parse(toolArgs(turno, toolName));
      } catch (error) {
        failure = error;
      }
      if (!isMalformed(failure) || attempt >= MAX_FORMAT_ATTEMPTS || signal.aborted) {
        throw new ErrorIA("desconocido", chat.id, `The venue analysis returned malformed output (${capacidad}).`, true);
      }
    }
  };

  const inventory = await structuredStep(INVENTORY_CAPABILITY, {
    sistema: SYSTEM_PROMPT,
    historial: [{ rol: "usuario", texto: `Analyze this venue photo. Preserve the exact image ID: ${venue.id}.`, imagenes: [venue] }],
    herramientas: [INVENTORY_TOOL],
    ...INVENTORY_PARAMETERS,
    signal,
  }, INVENTORY_TOOL.nombre);
  const draft = JSON.stringify(inventory).slice(0, 24000);
  const audit = await structuredStep(AUDIT_CAPABILITY, {
    sistema: AUDIT_PROMPT,
    historial: [{ rol: "usuario", texto: `Audit the draft against the same venue photo. Preserve the exact image ID: ${venue.id}.\n<DRAFT_VENUE_ANALYSIS>${draft}</DRAFT_VENUE_ANALYSIS>`, imagenes: [venue] }],
    herramientas: [AUDIT_TOOL],
    ...AUDIT_PARAMETERS,
    signal,
  }, AUDIT_TOOL.nombre).catch((error: unknown) => {
    if (signal.aborted || !isMalformed(error)) throw error;
    console.warn("[venue/analyze] audit skipped after malformed output", { request_id: telemetria?.requestId });
    return inventory;
  });

  return {
    analysis: VenueAnalysisSchema.parse(audit),
    metadata: { cached: false, cache_key: key, system_prompt_hash: systemPromptHash, passes: ["inventory", "audit"] },
  };
}

export async function analizarVenue(chat: ChatPort, venue: ImagenEtiquetada, telemetria?: ContextoTelemetriaIA, signal?: AbortSignal): Promise<VenueAnalysisResult> {
  const systemPromptHash = createHash("sha256")
    .update(PARSER_VERSION)
    .update(SYSTEM_PROMPT)
    .update(AUDIT_PROMPT)
    .update(JSON.stringify([INVENTORY_TOOL, AUDIT_TOOL]))
    .digest("hex");
  const key = analysisCacheKey({
    model: chat.modelo,
    schemaVersion: PARSER_VERSION,
    systemPromptHash,
    images: [{ image_id: venue.id, mime: venue.mime, base64: venue.base64 }],
  });
  const cached = cache.get(key);
  if (cached) return { ...cached, metadata: { ...cached.metadata, cached: true } };
  let entry = inFlight.get(key);
  if (!entry) {
    const controller = new AbortController();
    const next: InFlight = {
      controller,
      waiters: 0,
      promise: executeAnalysis({ chat, venue, telemetria, signal: controller.signal, key, systemPromptHash })
        .then((result) => {
          if (cache.has(key)) cache.delete(key);
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
          cache.set(key, result);
          return result;
        })
        .finally(() => {
          if (inFlight.get(key) === next) inFlight.delete(key);
        }),
    };
    inFlight.set(key, next);
    entry = next;
  }
  return sharedResult(key, entry, signal);
}
