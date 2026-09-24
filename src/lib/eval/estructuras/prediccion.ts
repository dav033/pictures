import { z } from "zod";
import { DETECTED_DENSITIES, DETECTED_OUTLINES, DETECTED_OVERHANGS, DETECTED_POSITIONS, DETECTED_STRUCTURE_TYPES, type DetectedStructure } from "@/lib/ia/referencia/reference-structure";
import { FAMILIAS_V2, familiaDesdeDetectorV1 } from "./familia-v1-v2";

/**
 * `prediccion-estructuras.v1` (Fundamentos §8.5): one JSONL line per image and
 * run. It is the only interface between recognizer runners and metrics, so it
 * carries no image bytes, prompts or free text from the model — only hashes,
 * versions, boxes, derived families, the raw v1 attributes and usage.
 */

export const PREDICCION_ESTRUCTURAS_SCHEMA_ID = "prediccion-estructuras.v1";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const unidad = z.number().min(0).max(1);
const contador = z.number().int().nonnegative();

const BBoxSchema = z.object({ x: unidad, y: unidad, width: unidad, height: unidad }).strict()
  .refine((caja) => caja.x + caja.width <= 1 + 1e-9 && caja.y + caja.height <= 1 + 1e-9, "bbox fuera de la imagen");

const InstanciaSchema = z.object({
  instance_id: z.string().min(1).max(80),
  bbox: BBoxSchema,
  familia: z.enum(FAMILIAS_V2).nullable(),
  candidatos: z.array(z.enum(FAMILIAS_V2)).min(1).max(FAMILIAS_V2.length),
  estado: z.enum(["determinada", "ambigua"]),
  /** Attributes exactly as the v1 detector reported them; v2 attributes do not exist yet. */
  atributos_v1: z.object({
    structure_type: z.enum(DETECTED_STRUCTURE_TYPES),
    outline: z.enum(DETECTED_OUTLINES),
    density: z.enum(DETECTED_DENSITIES),
    horizontal_position: z.enum(DETECTED_POSITIONS),
    top_overhang: z.enum(DETECTED_OVERHANGS).nullable(),
    grounded: z.boolean(),
  }).strict(),
}).strict().superRefine((instancia, ctx) => {
  if (instancia.estado === "determinada" && (instancia.familia === null || instancia.candidatos.length !== 1 || instancia.candidatos[0] !== instancia.familia)) {
    ctx.addIssue({ code: "custom", path: ["candidatos"], message: "una instancia determinada tiene exactamente su familia como candidato" });
  }
  if (instancia.estado === "ambigua" && (instancia.familia !== null || instancia.candidatos.length < 2)) {
    ctx.addIssue({ code: "custom", path: ["familia"], message: "una instancia ambigua no elige familia y tiene al menos dos candidatos" });
  }
});

export const PrediccionEstructurasV1Schema = z.object({
  schema: z.literal(PREDICCION_ESTRUCTURAS_SCHEMA_ID),
  run_id: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  /** 1-based repetition of the same image inside the run (N=5 in A0.4a). */
  corrida: z.number().int().min(1).max(99),
  image_sha256: sha256,
  sistema: z.object({
    id: z.string().min(1).max(80),
    modelo: z.string().min(1).max(200),
    parser_version: z.string().min(1).max(120),
    system_prompt_sha256: sha256,
    config_hash: sha256,
    thinking_level: z.string().min(1).max(20).nullable(),
    taxonomy_version: z.string().min(1).max(60),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  }).strict(),
  resultado: z.enum(["ok", "error", "timeout", "cancelado", "omitida_por_presupuesto"]),
  instancias: z.array(InstanciaSchema).max(60),
  /** sha256 of the stored raw provider output (kept privately by hash), null when there was no output. */
  raw_output_sha256: sha256.nullable(),
  uso_reportado: z.object({
    tokens_entrada: contador,
    tokens_salida: contador,
    tokens_pensamiento: contador,
    tokens_cacheados: contador,
    llamadas: contador,
    finish_reasons: z.array(z.string().regex(/^[A-Z_]{1,64}$/)).max(20),
  }).strict(),
  latencia_ms: z.object({ total: contador, inventario: contador.nullable(), auditoria: contador.nullable() }).strict(),
}).strict().superRefine((linea, ctx) => {
  if (linea.resultado !== "ok" && linea.instancias.length > 0) {
    ctx.addIssue({ code: "custom", path: ["instancias"], message: "solo una corrida ok tiene instancias" });
  }
});

export type PrediccionEstructurasV1 = z.infer<typeof PrediccionEstructurasV1Schema>;
export type InstanciaPrediccion = PrediccionEstructurasV1["instancias"][number];

/** A detected balloon structure as the v1 parser returns it, with its element id and box. */
export type DeteccionV1 = { elementId: string; bbox: { x: number; y: number; width: number; height: number }; structure: DetectedStructure };

/** Maps parsed v1 detections to contract instances; the family comes only from the step-1 adapter. */
export function instanciasDesdeDetecciones(detecciones: readonly DeteccionV1[]): InstanciaPrediccion[] {
  return detecciones.map(({ elementId, bbox, structure }) => {
    const derivada = familiaDesdeDetectorV1(structure.type);
    return {
      instance_id: elementId,
      bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      familia: derivada.familia,
      candidatos: derivada.candidatos,
      estado: derivada.estado,
      atributos_v1: {
        structure_type: structure.type,
        outline: structure.outline,
        density: structure.density,
        horizontal_position: structure.position,
        top_overhang: structure.topOverhang ?? null,
        grounded: structure.grounded,
      },
    };
  });
}

/** Validates and serializes one JSONL line; throws on a line that breaks the contract. */
export function lineaJsonl(prediccion: unknown): string {
  return `${JSON.stringify(PrediccionEstructurasV1Schema.parse(prediccion))}\n`;
}

/** Parses a JSONL file of predictions, reporting the 1-based line of the first invalid entry. */
export function leerPrediccionesJsonl(texto: string): PrediccionEstructurasV1[] {
  return texto.split(/\r?\n/).flatMap((linea, indice) => {
    if (!linea.trim()) return [];
    let valor: unknown;
    try {
      valor = JSON.parse(linea);
    } catch {
      throw new Error(`prediccion-estructuras.v1: línea ${indice + 1} no es JSON`);
    }
    const resultado = PrediccionEstructurasV1Schema.safeParse(valor);
    if (!resultado.success) throw new Error(`prediccion-estructuras.v1: línea ${indice + 1} inválida: ${resultado.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    return [resultado.data];
  });
}
