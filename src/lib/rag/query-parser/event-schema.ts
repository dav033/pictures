/**
 * Esquema de entrada cruda del extractor de intención de evento (Tarea 04.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 9.1 paso 1 / "Plan 04,
 * Tarea 04.1" en la sección 11).
 *
 * `EventIntentV2` (`src/lib/scene/tipos.ts`, Tarea 01.1) es el contrato FINAL
 * ya validado. Este módulo define el paso anterior: un borrador parcial
 * (`RawEventIntentDraft`) tal como lo produce `parse-event.ts` mientras va
 * extrayendo campo por campo de un mensaje en español, ANTES de rellenar
 * defaults y de congelarlo contra `EventIntentV2Schema`.
 *
 * Cada campo extraído del texto lleva procedencia explícita
 * (`EventFieldProvenance`), con el mismo vocabulario de tres valores que
 * `src/lib/plan/tipos.ts` (`PROCEDENCIAS = ["explicito", "inferido",
 * "supuesto"]`, usado por `src/lib/plan/restricciones.ts`) — se reutiliza el
 * mismo concepto en vez de inventar uno nuevo, tal como pide la Tarea 04.1
 * ("tu EventIntentV2 debería usar un concepto compatible o al menos no
 * contradictorio con ese"):
 *   - `"explicito"`: el texto del cliente lo dice literalmente (p. ej. un
 *     color, un número de estructuras, un presupuesto).
 *   - `"inferido"`: se dedujo de una señal indirecta pero concreta del texto
 *     (p. ej. `event_scope: "both"` deducido de mencionar ceremonia Y
 *     recepción a la vez, sin que el cliente haya escrito la palabra
 *     "ambas").
 *   - `"supuesto"`: no hay señal en el texto; es el default determinista
 *     documentado en `parse-event.ts` (p. ej. `complexity_requested:
 *     "balanced_scene"` cuando nada en el mensaje lo sugiere).
 *
 * `RawEventIntentDraft.hard_constraint_candidates` es la pieza crítica: cada
 * candidato ya lleva `provenance: "user" | "image"` — EXACTAMENTE el mismo
 * vocabulario cerrado de dos valores que `EventIntentV2.hard_constraints`
 * (sección 7.1) — porque un candidato a restricción dura NUNCA puede quedar
 * en un estado intermedio "tal vez". O el cliente lo dijo literalmente
 * (`"user"`), o viene de análisis de foto (`"image"`, hook sin implementar
 * todavía — ver `parse-event.ts`), o simplemente no se genera candidato. Un
 * campo "inferido"/"supuesto" jamás llega a `hard_constraint_candidates`;
 * como mucho llega a `palette`/`style_terms` (preferencias blandas) — así es
 * estructuralmente imposible que este extractor determinista convierta una
 * preferencia sugerida (p. ej. "glamour") en un filtro duro.
 */

import { z } from "zod";
import {
  ComplexityProfileSchema,
  EventLocationSchema,
  EventScopeSchema,
  RentalPeriodSchema,
  RequestedViewSchema,
} from "@/lib/scene/tipos";

// ---------------------------------------------------------------------------
// Procedencia por campo — mismo vocabulario que src/lib/plan/tipos.ts (PROCEDENCIAS).
// ---------------------------------------------------------------------------

export const EVENT_FIELD_PROVENANCES = ["explicito", "inferido", "supuesto"] as const;
export const EventFieldProvenanceSchema = z.enum(EVENT_FIELD_PROVENANCES);
export type EventFieldProvenance = z.infer<typeof EventFieldProvenanceSchema>;

/**
 * Procedencia de un candidato a `hard_constraints` — literalmente el mismo
 * enum cerrado que `HardConstraintSchema.provenance` en `src/lib/scene/tipos.ts`
 * (sección 7.1). Se re-declara aquí (en vez de importarlo) únicamente porque
 * `HardConstraintSchema` no se exporta como símbolo independiente de
 * `tipos.ts` hoy; el valor literal es idéntico y `parse-event.ts` construye
 * `EventIntentV2.hard_constraints` a partir de este mismo campo sin ninguna
 * conversión, así que una divergencia futura rompería la compilación en
 * `finalizeEventIntent`.
 */
export const HardConstraintProvenanceSchema = z.enum(["user", "image"]);
export type HardConstraintProvenance = z.infer<typeof HardConstraintProvenanceSchema>;

/** Un valor extraído del texto, con procedencia y el fragmento de texto que lo sustenta. */
function rawField<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    provenance: EventFieldProvenanceSchema,
    /** Fragmento (o descripción) del mensaje que sustenta este valor; cadena vacía para defaults sin señal textual. */
    source_text: z.string(),
  });
}

export type RawField<T> = { value: T; provenance: EventFieldProvenance; source_text: string };

// ---------------------------------------------------------------------------
// Candidato a hard_constraints
// ---------------------------------------------------------------------------

export const RawHardConstraintCandidateSchema = z.object({
  /**
   * Vocabulario abierto pero deliberadamente pequeño y estable (documentado
   * en `parse-event.ts`): "color", "estructura_focal", "tamano", "acabado".
   * No es un enum Zod cerrado porque `EventIntentV2.hard_constraints[].key`
   * tampoco lo es (sección 7.1: `key: string`) — la disciplina "nunca
   * inventar" vive en las reglas de extracción de `parse-event.ts`, no en la
   * forma del dato.
   */
  key: z.string().min(1),
  value: z.unknown(),
  provenance: HardConstraintProvenanceSchema,
  source_text: z.string().min(1),
  /** Identificador estable de QUÉ regla determinista produjo este candidato — trazabilidad para el eval de la Tarea 04.1. */
  rule_id: z.string().min(1),
});
export type RawHardConstraintCandidate = z.infer<typeof RawHardConstraintCandidateSchema>;

// ---------------------------------------------------------------------------
// Borrador crudo — proyección parcial de EventIntentV2 con procedencia por campo.
// ---------------------------------------------------------------------------

export const RawEventIntentDraftSchema = z.object({
  event_scope: rawField(EventScopeSchema).optional(),
  requested_views: rawField(z.array(RequestedViewSchema).min(1)).optional(),
  complexity_requested: rawField(ComplexityProfileSchema).optional(),
  /** COP enteros positivos (sección 6.3, invariante 1), si el texto/contexto lo declara. */
  budget_cop: rawField(z.number().int().positive()).optional(),
  event_date: rawField(z.string().min(1)).optional(),
  event_location: rawField(EventLocationSchema).optional(),
  rental_period: rawField(RentalPeriodSchema).optional(),
  venue_environment: rawField(z.enum(["indoor", "outdoor"])).optional(),
  existing_asset_refs: rawField(z.array(z.string().min(1))).optional(),
  palette: rawField(z.array(z.string().min(1))).optional(),
  style_terms: rawField(z.array(z.string().min(1))).optional(),
  hard_constraint_candidates: z.array(RawHardConstraintCandidateSchema).default([]),
});
export type RawEventIntentDraft = z.infer<typeof RawEventIntentDraftSchema>;
