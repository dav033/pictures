/**
 * Hashes canónicos de la cadena de trazabilidad de escena (Tarea 01.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 7.5).
 *
 * Los siete hashes mínimos exigidos por el plan son:
 *
 *   intent_hash, program_hash, selection_hash, plan_hash, quote_hash,
 *   scene_spec_hash, qa_hash
 *
 * Cada función toma la porción de datos relevante y devuelve un hash
 * SHA-256 hexadecimal determinista: mismo input (mismo contenido, sin
 * importar el orden de las claves del objeto) produce siempre el mismo
 * hash. Esto se logra serializando a JSON canónico (claves ordenadas
 * recursivamente) antes de hashear — así dos objetos con las mismas
 * propiedades en distinto orden dan el mismo hash, pero cualquier cambio de
 * contenido (incluyendo `snapshot_id`, precio, disponibilidad, etc. —
 * sección 6.4, invalidación por cambio de oferta) sí cambia el hash.
 *
 * `plan_hash`, `quote_hash`, `scene_spec_hash` y `qa_hash` reciben los
 * *stubs* de `src/lib/scene/tipos.ts` (`ScenePlanV2Stub`,
 * `ResolvedScenePlanV2Stub`, `SceneSpecV2Stub`, `SceneQaReportStub`) — sus
 * cuerpos completos son de Plan 05/07, pero la firma de estas funciones ya
 * es estable y no debería necesitar romperse cuando esos contratos se
 * expandan (los campos nuevos simplemente entran al hash canónico).
 */

import { createHash } from "node:crypto";
import type {
  EventIntentV2,
  ResolvedScenePlanV2Stub,
  SceneCoverageReport,
  SceneProgramV1,
  SceneQaReportStub,
  ScenePlanV2Stub,
  SceneSpecV2Stub,
  SlotCandidate,
  SupplyBinding,
} from "./tipos";

// ---------------------------------------------------------------------------
// JSON canónico + SHA-256
// ---------------------------------------------------------------------------

/**
 * Ordena recursivamente las claves de cualquier objeto plano anidado
 * (arreglos conservan su orden; solo se ordenan las claves de objetos).
 * `undefined` se omite igual que `JSON.stringify` para no depender de si un
 * campo opcional se declaró explícitamente como `undefined` o se omitió.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [key, v] of entries) {
      sorted[key] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}

/** Serialización JSON determinista: mismo contenido -> mismo string, sin importar el orden de las claves de entrada. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 hexadecimal de un string arbitrario. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash canónico determinista de cualquier valor serializable a JSON. */
export function computeCanonicalHash(value: unknown): string {
  return sha256Hex(canonicalJsonStringify(value));
}

// ---------------------------------------------------------------------------
// Hashes mínimos de la sección 7.5
// ---------------------------------------------------------------------------

/** `intent_hash` — hash de la intención capturada (`EventIntentV2`, sección 7.1). */
export function computeIntentHash(intent: EventIntentV2): string {
  return computeCanonicalHash(intent);
}

/** `program_hash` — hash del programa de escena expandido (`SceneProgramV1`, sección 7.2). */
export function computeProgramHash(program: SceneProgramV1): string {
  return computeCanonicalHash(program);
}

/**
 * Entrada de `computeSelectionHash`: el conjunto de candidatos
 * efectivamente elegidos por el optimizador (sección 9.4) para cada slot,
 * anclado al `program_hash` del que salieron (así un mismo conjunto de
 * candidatos bajo un programa distinto produce un `selection_hash`
 * distinto). No es `SlotCandidate` completo — solo la porción que
 * identifica *cuál* candidato se eligió para *cuál* slot y con qué
 * `supply_binding`, que es lo que la sección 7.5 llama "selección".
 */
export type SelectionHashInput = {
  program_hash: string;
  selected: Array<
    Pick<SlotCandidate, "slot_id"> & {
      item_id: string;
      offer_id?: string;
      supply_binding: SupplyBinding;
    }
  >;
};

/** `selection_hash` — hash del conjunto de candidatos seleccionados por slot (sección 9.4 / 7.5). */
export function computeSelectionHash(selection: SelectionHashInput): string {
  return computeCanonicalHash(selection);
}

/** `plan_hash` — hash de `ScenePlanV2` (stub; cuerpo completo en Plan 05). */
export function computePlanHash(plan: ScenePlanV2Stub): string {
  return computeCanonicalHash(plan);
}

/** `quote_hash` — hash de `ResolvedScenePlanV2` (stub; cuerpo completo en Plan 05, Tarea 05.2). */
export function computeQuoteHash(resolvedPlan: ResolvedScenePlanV2Stub): string {
  return computeCanonicalHash(resolvedPlan);
}

/** `scene_spec_hash` — hash de `SceneSpecV2` (stub; cuerpo completo en Plan 07, Tarea 07.1). */
export function computeSceneSpecHash(spec: SceneSpecV2Stub): string {
  return computeCanonicalHash(spec);
}

/** `qa_hash` — hash del informe QA visual (stub; cuerpo completo en Plan 07, Tarea 07.2). */
export function computeQaHash(qaReport: SceneQaReportStub): string {
  return computeCanonicalHash(qaReport);
}

/**
 * Utilidad opcional: hash de un `SceneCoverageReport` (sección 7.4). No es
 * uno de los siete hashes mínimos de la sección 7.5, pero surge del mismo
 * mecanismo canónico y es útil para detectar cambios de cobertura sin
 * comparar el reporte campo por campo.
 */
export function computeCoverageReportHash(report: SceneCoverageReport): string {
  return computeCanonicalHash(report);
}
