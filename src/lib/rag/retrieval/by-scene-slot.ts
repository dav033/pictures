/**
 * Búsqueda híbrida por slot de escena (Tarea 04.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 9.2-9.3 / "Plan 04,
 * Tarea 04.2" en la sección 11).
 *
 * `retrieveCandidatesBySlot` ejecuta búsqueda híbrida (full-text + trigram +
 * vector) PARA CADA `SlotQuery` individual, usando la misma infraestructura
 * `buscarHibrido` del pipeline RAG V2 (`./search.ts`). Cada slot recibe:
 *   - su propia consulta semántica construida a partir de función + zona +
 *     preferencias de estilo/paleta (sección 9.2);
 *   - filtros duros derivados del slot: fuentes permitidas, ambiente,
 *     presupuesto provisional, dimensiones (cuando estén disponibles);
 *   - su propio embedding semántico (sección 9.3: "un embedding semántico
 *     distinto por cada slot recuperable").
 *
 * Los slots se ejecutan en paralelo con un límite de concurrencia
 * configurable (sección 9.3: "PostgreSQL queries en paralelo con límite de
 * concurrencia"). Un slot que excede el timeout se marca como brecha técnica
 * (`TIMEOUT`), nunca se rellena con invención.
 *
 * Este módulo NO resuelve compatibilidad entre slots ni selecciona el
 * conjunto global — eso es el optimizador (Plan 05, Tarea 05.1). Aquí solo se
 * recuperan candidatos elegibles por slot, cada uno con su fuente y
 * evidencia.
 */

import type { Pool } from "pg";
import { buscarHibrido } from "./search";
import type { ConsultaRetrieval, FiltrosDuros } from "./types";
import { embeberTexto } from "../embeddings";
import type { SlotQuery } from "./slot-query-planner";
import type { SlotCandidate } from "@/lib/scene/tipos";
import { RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED, RAG_USE_VECTOR } from "@/lib/ia/feature-flags";
import { seleccionarBackendPython } from "@/lib/ia/python-adapter";

// ---------------------------------------------------------------------------
// Tipos de brecha (sección 9.3 / 9.4)
// ---------------------------------------------------------------------------

export type SlotGapKind = "NO_SOURCE" | "NO_STOCK" | "NO_PRICE" | "INCOMPATIBLE" | "BUDGET" | "TIMEOUT" | "EMPTY_RESULTS";

export type SlotGap = {
  slot_id: string;
  kind: SlotGapKind;
  reason: string;
};

export type SlotRetrievalResult = {
  slot_id: string;
  view_id: string;
  zone: string;
  function: string;
  /** Candidatos elegibles encontrados por este slot (hasta 20 raw, 5-8 after rerank). */
  candidates: SlotCandidate[];
  /** Brecha si no se encontró ningún candidato elegible. */
  gap?: SlotGap;
  /** Latencia de búsqueda en ms para telemetría (sección 9.3). */
  latency_ms: number;
};

// ---------------------------------------------------------------------------
// Concurrencia y timeout (sección 9.3)
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 4;
const MAX_RAW_CANDIDATES = 20;

// ---------------------------------------------------------------------------
// Construcción de consulta semántica por slot
// ---------------------------------------------------------------------------

function buildSlotSemanticQuery(slot: SlotQuery): string {
  const parts: string[] = [];

  // Core: función + zona
  parts.push(`elemento decorativo para la función "${slot.function}" en la zona "${slot.zone}"`);

  // Ambiente (sección 9.2: "ambiente interior/exterior")
  if (slot.environment) {
    parts.push(`para un evento ${slot.environment === "indoor" ? "bajo techo" : "al aire libre"}`);
  }

  // Estilo y paleta como preferencias blandas — NUNCA como filtros duros
  // (regla crítica de la Tarea 04.1, verificada en el eval).
  if (slot.style_preferences.style_terms.length > 0) {
    parts.push(`con estilo ${slot.style_preferences.style_terms.join(", ")}`);
  }
  if (slot.style_preferences.palette.length > 0) {
    parts.push(`en colores ${slot.style_preferences.palette.join(", ")}`);
  }

  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Construcción de filtros duros por slot
// ---------------------------------------------------------------------------

function buildSlotHardFilters(slot: SlotQuery): FiltrosDuros {
  const filtros: FiltrosDuros = { disponible: true };

  if (slot.provisional_budget_cop !== undefined) {
    filtros.precioMax = slot.provisional_budget_cop;
  }

  return filtros;
}

// ---------------------------------------------------------------------------
// Executor con concurrencia limitada
// ---------------------------------------------------------------------------

async function withConcurrencyLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let running = 0;
  let nextIndex = 0;
  const pending = new Set<Promise<void>>();

  return new Promise<T[]>((resolveAll, rejectAll) => {
    let done = false;

    function launch(): void {
      while (running < limit && nextIndex < tasks.length) {
        const idx = nextIndex++;
        running++;
        const p = tasks[idx]!()
          .then((value) => {
            results[idx] = value;
          })
          .catch((err) => {
            if (!done) {
              done = true;
              rejectAll(err);
            }
          })
          .finally(() => {
            running--;
            pending.delete(p);
            if (!done && pending.size === 0 && nextIndex >= tasks.length) {
              done = true;
              resolveAll(results);
            } else if (!done) {
              launch();
            }
          });
        pending.add(p);
        if (pending.size === 0 && nextIndex >= tasks.length && !done) {
          done = true;
          resolveAll(results);
        }
      }
    }

    launch();
  });
}

// ---------------------------------------------------------------------------
// Búsqueda por slot individual
// ---------------------------------------------------------------------------

async function retrieveSingleSlot(
  pool: Pool,
  slot: SlotQuery,
  minCapabilityConfidence: number,
): Promise<SlotRetrievalResult> {
  const t0 = performance.now();

  try {
    const semanticQuery = buildSlotSemanticQuery(slot);
    const filtros: FiltrosDuros = {
      ...buildSlotHardFilters(slot),
      // Fuentes permitidas: filtramos por source_class en los productos que tengan
      // oferta comercial verificada. Si allowed_sources incluye catalog_sale o catalog_rental,
      // solo traemos productos con ofertas en esas clases. venue_existing y context_non_quotable
      // no pasan por esta ruta de retrieval (se resuelven en el optimizador).
      disponible: true,
    };

    // Determinar si necesitamos embedding semántico
    let embeddingPrecalculado: number[] | undefined;
    let embeddingFallido = false;
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    const hasPythonEmbedding =
      RAG_USE_VECTOR
      && RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED
      && seleccionarBackendPython().backend === "python";
    if (RAG_USE_VECTOR && (hasGeminiKey || hasPythonEmbedding)) {
      try {
        embeddingPrecalculado = await embeberTexto(semanticQuery, "RETRIEVAL_QUERY");
      } catch {
        embeddingFallido = true;
        // Si falla el embedding, seguimos sin él — las ramas lexicales aún funcionan.
      }
    }

    const consulta: ConsultaRetrieval = {
      semanticQuery,
      filtros,
      embeddingPrecalculado,
      embeddingFallido,
    };

    const respuesta = await buscarHibrido(pool, consulta);

    const rawCandidates = respuesta.results.slice(0, MAX_RAW_CANDIDATES);

    const t1 = performance.now();

    if (rawCandidates.length === 0) {
      return {
        slot_id: slot.slot_id,
        view_id: slot.view_id,
        zone: slot.zone,
        function: slot.function,
        candidates: [],
        gap: {
          slot_id: slot.slot_id,
          kind: "EMPTY_RESULTS",
          reason: `Ningún candidato encontrado para la función "${slot.function}" en la zona "${slot.zone}"`,
        },
        latency_ms: Math.round(t1 - t0),
      };
    }

    // Mapear ResultadoRetrieval → SlotCandidate (stub: sin oferta real todavía,
    // la resolución completa de fuente/evidencia es parte de la siguiente fase — Plan 05).
    const candidates: SlotCandidate[] = rawCandidates.map((r) => ({
      slot_id: slot.slot_id,
      item: {
        item_id: r.productId,
        category_v3: "balloon_material" as const, // placeholder real — se resuelve en la fase siguiente
        media_refs: [],
        scene_functions: [],
        compatibility: {
          indoor_outdoor: slot.environment ? [slot.environment] : undefined,
        },
      },
      offer: undefined, // Se resuelve con catalog_commercial_offers en la fase siguiente (Plan 05)
      supply_binding: {
        kind: "sale",
        item_id: r.productId,
        offer_id: "stub-offer", // Placeholder — Tarea 04.2 no resuelve ofertas reales
        snapshot_id: "stub-snapshot",
      },
      retrieval: {
        lexical: r.textScore,
        semantic: r.vectorScore,
        rerank: r.finalScore,
      },
      eligibility: {
        pass: true,
        reasons: r.reasons ?? [],
      },
      estimated_cost_cop: undefined, // Se resuelve con oferta real en Plan 05
    }));

    return {
      slot_id: slot.slot_id,
      view_id: slot.view_id,
      zone: slot.zone,
      function: slot.function,
      candidates,
      latency_ms: Math.round(t1 - t0),
    };
  } catch (err: unknown) {
    const t1 = performance.now();
    return {
      slot_id: slot.slot_id,
      view_id: slot.view_id,
      zone: slot.zone,
      function: slot.function,
      candidates: [],
      gap: {
        slot_id: slot.slot_id,
        kind: "TIMEOUT",
        reason: err instanceof Error ? err.message : "Error desconocido en búsqueda por slot",
      },
      latency_ms: Math.round(t1 - t0),
    };
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada público
// ---------------------------------------------------------------------------

/**
 * Ejecuta búsqueda híbrida EN PARALELO para cada `SlotQuery`, con límite de
 * concurrencia configurable. Cada slot produce sus propios `SlotCandidate[]`
 * con scores de recuperación, evidencia léxica/semántica y elegibilidad.
 *
 * Los slots que no producen resultados se reportan como brechas con `kind`
 * específico (sección 9.3: "timeout parcial: un slot vencido se marca como
 * brecha técnica").
 */
export async function retrieveCandidatesBySlot(
  pool: Pool,
  slotQueries: SlotQuery[],
  opts?: {
    concurrency?: number;
    minCapabilityConfidence?: number;
  },
): Promise<SlotRetrievalResult[]> {
  const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;
  const minConfidence = opts?.minCapabilityConfidence ?? 0.5;

  const tasks = slotQueries.map((slot) => () => retrieveSingleSlot(pool, slot, minConfidence));

  if (slotQueries.length <= 1) {
    const result = await tasks[0]!();
    return [result];
  }

  return withConcurrencyLimit(tasks, concurrency);
}
