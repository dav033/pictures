/**
 * Cálculo de cobertura de un `SceneProgramV1` (Tarea 01.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, secciones 5.1, 7.4 y 9.4,
 * "Plan 01, Tarea 01.2" en la sección 11).
 *
 * `computeCoverageReport` es la versión real y con criterio que reemplaza,
 * para futuras olas (Plan 05 la usará formalmente), la heurística
 * deliberadamente tosca de `scripts/eval-scene-baseline.ts` (Ola 0, hecha
 * solo para demostrar el problema "solo arco" antes de que existiera este
 * motor). No modifica ni depende de ese script.
 *
 * DESVIACIÓN DELIBERADA de la firma "tipo" de la Tarea 01.2 — tercer
 * parámetro `requestedProfile`:
 * `SceneCoverageReport.requested_profile` (sección 7.4) necesita saber qué
 * perfil pidió el usuario, pero `SceneProgramV1` (sección 7.2) NO persiste
 * `complexity_requested` — ni en el plan ni en `tipos.ts` (Tarea 01.1). El
 * programa solo lleva `intent_hash` (una huella opaca), no la intención
 * completa. Inventarle un campo a `SceneProgramV1` para cargar el perfil
 * sería una responsabilidad ajena a "expandir slots" y además rompería la
 * superficie ya validada por la Tarea 01.1. Por eso `computeCoverageReport`
 * recibe el perfil solicitado explícitamente como tercer argumento — quien
 * ya tiene la `EventIntentV2` a mano (el mismo caller que llamó a
 * `expandIntentToProgram`) también tiene `intent.complexity_requested`.
 */

import {
  COMPLEXITY_PROFILE_ORDER,
  PROFILE_COVERAGE_CONDITIONS,
  complexityProfileTier,
} from "./recipes";
import {
  SceneCoverageReportSchema,
  type ComplexityProfile,
  type SceneCoverageReport,
  type SceneProgramV1,
  type SceneSlot,
  type SlotCandidate,
} from "./tipos";

/**
 * Primer candidato elegible (`eligibility.pass === true`) de un slot, si
 * existe. La Tarea 01.2 no exige optimización de conjunto (eso es Plan 05,
 * `src/lib/scene/optimizer.ts`) — aquí solo importa SI el slot tiene al
 * menos un candidato utilizable, para poder calcular cobertura. El orden de
 * `candidatesBySlot[slot_id]` se respeta tal cual llega (determinismo: el
 * mismo arreglo de candidatos siempre produce el mismo elegido).
 */
function firstEligibleCandidate(candidates: SlotCandidate[] | undefined): SlotCandidate | undefined {
  return candidates?.find((candidate) => candidate.eligibility.pass === true);
}

/**
 * Familia semántica de un slot cubierto — verdad observable #1 (sección 1):
 * "la complejidad se mide por cobertura de funciones y zonas, no por
 * cantidad de SKU ni por cantidad de globos".
 *
 * Se usa `category_v3` del item del candidato ELEGIDO (identidad física
 * real, sección 7.3), no de todos los candidatos del slot: diez candidatos
 * distintos para el mismo slot siguen aportando UNA sola familia (la del
 * elegido), nunca diez. Si el slot está cubierto pero, por alguna razón, el
 * candidato no trae una categoría resoluble (no debería ocurrir con el Zod
 * actual, donde `item.category_v3` es obligatorio), se cae a `zone:function`
 * del slot como identificador de familia de respaldo — nunca a "sin
 * candidato" para un slot que SÍ está cubierto.
 */
function familyOf(slot: SceneSlot, candidate: SlotCandidate | undefined): string {
  if (candidate) {
    return candidate.item.category_v3;
  }
  return `${slot.zone}:${slot.function}`;
}

export function computeCoverageReport(
  program: SceneProgramV1,
  candidatesBySlot: Record<string, SlotCandidate[]>,
  requestedProfile: ComplexityProfile
): SceneCoverageReport {
  const requestedTier = complexityProfileTier(requestedProfile);

  // 1. Candidato elegible por slot (si existe) y helper de "slot cubierto".
  const chosenBySlot = new Map<string, SlotCandidate | undefined>();
  for (const slot of program.slots) {
    chosenBySlot.set(slot.slot_id, firstEligibleCandidate(candidatesBySlot[slot.slot_id]));
  }
  const isCovered = (slot: SceneSlot): boolean => chosenBySlot.get(slot.slot_id) !== undefined;

  // 2. required_covered / required_gaps, a partir del programa TAL COMO fue
  //    instanciado por `expandIntentToProgram` — su `requirement` por slot
  //    ya está ajustado al perfil solicitado (Tarea 01.2, punto 2).
  const requiredSlots = program.slots.filter((slot) => slot.requirement === "required");
  const required_covered: string[] = [];
  const required_gaps: SceneCoverageReport["required_gaps"] = [];

  for (const slot of requiredSlots) {
    if (isCovered(slot)) {
      required_covered.push(slot.slot_id);
      continue;
    }
    const evaluated = candidatesBySlot[slot.slot_id] ?? [];
    const reason =
      evaluated.length === 0
        ? `sin candidatos evaluados para el slot ${slot.slot_id} (función ${slot.function}, zona ${slot.zone})`
        : `${evaluated.length} candidato(s) evaluado(s) para ${slot.slot_id}, ninguno elegible: ` +
          evaluated.flatMap((candidate) => candidate.eligibility.reasons).join("; ");
    required_gaps.push({
      slot_id: slot.slot_id,
      reason,
      suggested_source_type: slot.allowed_sources[0],
    });
  }

  // 3. optional_covered — slots no obligatorios (conditional/optional) que sí tienen candidato elegible.
  const optional_covered = program.slots
    .filter((slot) => slot.requirement !== "required" && isCovered(slot))
    .map((slot) => slot.slot_id);

  // 4. weighted_coverage — peso de los slots cubiertos sobre el peso total del programa (0..1).
  const totalWeight = program.slots.reduce((sum, slot) => sum + slot.weight, 0);
  const coveredWeight = program.slots
    .filter((slot) => isCovered(slot))
    .reduce((sum, slot) => sum + slot.weight, 0);
  const weighted_coverage = totalWeight > 0 ? coveredWeight / totalWeight : 0;

  // 5. distinct_families — SOLO de slots cubiertos (verdad observable #1: nunca premiar cantidad de candidatos).
  const distinct_families = Array.from(
    new Set(
      program.slots
        .filter((slot) => isCovered(slot))
        .map((slot) => familyOf(slot, chosenBySlot.get(slot.slot_id)))
    )
  );

  // 6. achieved_profile.
  //    - Si no hay required_gaps, el programa —instanciado para
  //      `requestedProfile`— está plenamente satisfecho: achieved = requested.
  //      Esto es lo que garantiza que una boda genérica bien cubierta SÍ
  //      alcance el perfil que pidió, no solo que "no baje".
  //    - Si hay gaps, degradar ESTRICTAMENTE por debajo de
  //      `requestedProfile` usando las condiciones zonales/de familia de la
  //      sección 5.1 (`PROFILE_COVERAGE_CONDITIONS`) — nunca igual o mayor
  //      al perfil solicitado cuando faltan slots obligatorios (regla
  //      explícita de la Tarea 01.2 y de la sección 5.1: "el sistema no
  //      bajará automáticamente a focal_only sin decirlo").
  let achieved_profile: ComplexityProfile;
  if (required_gaps.length === 0) {
    achieved_profile = requestedProfile;
  } else {
    const coveredZones = new Set(program.slots.filter((slot) => isCovered(slot)).map((slot) => slot.zone));
    achieved_profile = "focal_only";
    for (let tier = requestedTier - 1; tier >= 0; tier -= 1) {
      const candidateProfile = COMPLEXITY_PROFILE_ORDER[tier]!;
      const condition = PROFILE_COVERAGE_CONDITIONS[candidateProfile];
      const zonesOk = condition.requiredZones.every((zone) => coveredZones.has(zone));
      const visibleZonesOk = coveredZones.size >= condition.minVisibleZones;
      const familiesOk = distinct_families.length >= condition.minDistinctFamilies;
      if (zonesOk && visibleZonesOk && familiesOk) {
        achieved_profile = candidateProfile;
        break;
      }
    }
  }

  // 7. status — COMPLETE solo si no hay brechas obligatorias (regla Zod ya
  //    existente en SceneCoverageReportSchema); BLOCKED cuando NI SIQUIERA
  //    hay un solo slot obligatorio cubierto (cobertura real nula); PARTIAL
  //    en el resto de los casos con brechas.
  let status: SceneCoverageReport["status"];
  if (required_gaps.length === 0) {
    status = "COMPLETE";
  } else if (required_covered.length === 0 && requiredSlots.length > 0) {
    status = "BLOCKED";
  } else {
    status = "PARTIAL";
  }

  const report: SceneCoverageReport = {
    requested_profile: requestedProfile,
    achieved_profile,
    weighted_coverage,
    required_covered,
    required_gaps,
    waivers: [],
    optional_covered,
    distinct_families,
    status,
  };

  // Validación final: aprovecha la regla Zod ya existente de que COMPLETE
  // nunca puede tener required_gaps (y cualquier otra invariante de forma
  // de `SceneCoverageReportSchema`) antes de devolver el reporte.
  return SceneCoverageReportSchema.parse(report);
}
