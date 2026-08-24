/**
 * Layout espacial por zona para SceneSpec V2 (Tarea 07.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 10.1-10.2).
 *
 * Mapea las zonas de escena V2 (sección 5.2) a cajas de composición
 * (`BBox` + `depthLayer`) para construir la especificación de imagen sin
 * colapsar categorías a `balloon_structure` (problema diagnosticado en la
 * sección 2.4 del plan).
 *
 * Una ceremonia equilibrada debe producir:
 *   - foco inequívoco en fondo/medio
 *   - pasillo como línea de profundidad
 *   - elementos repetidos con ritmo
 *   - asientos a ambos lados sin bloquear circulación
 *   - acentos de primer plano sin tapar el foco
 *   - espacio negativo suficiente
 *
 * Valores calibrados para una vista de ceremonia con aspect ratio 3:2 o 16:9.
 */

export type BBox = { x: number; y: number; width: number; height: number };
export type ZoneLayout = { bbox: BBox; depthLayer: number; zoneName: string };

/**
 * Zonas de la sección 5.2 del plan, mapeadas a cajas de composición.
 * depthLayer: 1 = fondo lejano, 10-12 = medio/foco, 20+ = primer plano.
 */
const ZONE_LAYOUT: Record<string, ZoneLayout> = {
  ceremony_focal: {
    zoneName: "ceremony_focal",
    bbox: { x: 0.15, y: 0.08, width: 0.70, height: 0.65 },
    depthLayer: 10,
  },
  ceremony_aisle: {
    zoneName: "ceremony_aisle",
    bbox: { x: 0.30, y: 0.50, width: 0.40, height: 0.45 },
    depthLayer: 14,
  },
  guest_seating: {
    zoneName: "guest_seating",
    // Dividido en dos sub-zonas: izquierda y derecha del pasillo
    // guest_seating_left / guest_seating_right se instancian dinámicamente
    bbox: { x: 0.04, y: 0.40, width: 0.92, height: 0.50 },
    depthLayer: 16,
  },
  ambient_overhead: {
    zoneName: "ambient_overhead",
    bbox: { x: 0.10, y: 0.02, width: 0.80, height: 0.18 },
    depthLayer: 8,
  },
  entrance_welcome: {
    zoneName: "entrance_welcome",
    bbox: { x: 0.04, y: 0.12, width: 0.24, height: 0.30 },
    depthLayer: 18,
  },
  floor_foreground: {
    zoneName: "floor_foreground",
    bbox: { x: 0.12, y: 0.72, width: 0.76, height: 0.22 },
    depthLayer: 20,
  },
  reception_head_table: {
    zoneName: "reception_head_table",
    bbox: { x: 0.15, y: 0.10, width: 0.70, height: 0.40 },
    depthLayer: 12,
  },
  reception_guest_tables: {
    zoneName: "reception_guest_tables",
    bbox: { x: 0.06, y: 0.48, width: 0.88, height: 0.40 },
    depthLayer: 18,
  },
};

/**
 * Sub-zonas de seating (izquierda/derecha del pasillo) para
 * elementos repetidos con ritmo sin clonación rígida.
 */
export type SeatingSide = "left" | "right";

export function seatingBBox(side: SeatingSide, rowIndex: number, totalRows: number): BBox {
  const seatWidth = 0.12;
  const seatHeight = 0.08;
  const aisleCenter = 0.50;

  const x = side === "left"
    ? aisleCenter - 0.22 - (rowIndex * 0.06) - seatWidth
    : aisleCenter + 0.22 + (rowIndex * 0.06);

  const rowHeight = 0.50 / totalRows;
  const y = 0.42 + rowIndex * rowHeight;

  return { x, y, width: seatWidth, height: seatHeight };
}

/**
 * Spatial relation → layout instruction for the generator.
 * No IDs internos visibles — solo descripciones espaciales.
 */
export type SpatialLayoutInstruction = {
  sourceSlotId: string;
  targetSlotId?: string;
  targetZone?: string;
  relation: string;
  instruction: string;
};

/**
 * Deriva instrucciones espaciales concretas a partir de las restricciones
 * espaciales declaradas en los slots (SceneSlot.spatial_constraints).
 */
export function deriveSpatialInstructions(
  slotIds: string[],
  spatialConstraints: Record<string, Array<{ relation: string; target_slot_id?: string; target_zone?: string; note?: string }>>,
): SpatialLayoutInstruction[] {
  const instructions: SpatialLayoutInstruction[] = [];

  for (const slotId of slotIds) {
    const constraints = spatialConstraints[slotId] ?? [];
    for (const constraint of constraints) {
      instructions.push({
        sourceSlotId: slotId,
        targetSlotId: constraint.target_slot_id,
        targetZone: constraint.target_zone,
        relation: constraint.relation,
        instruction: constraint.note ?? `Relación espacial: ${constraint.relation}`,
      });
    }
  }

  return instructions;
}

/**
 * Obtiene el layout de una zona. Si no existe, devuelve un layout
 * por defecto centrado.
 */
export function zoneLayout(zoneName: string): ZoneLayout {
  return ZONE_LAYOUT[zoneName] ?? {
    zoneName,
    bbox: { x: 0.15, y: 0.15, width: 0.70, height: 0.70 },
    depthLayer: 15,
  };
}

/**
 * Visibilidad de una instancia (sección 10.2).
 */
export type VisibilityPolicy = "visible" | "support_hidden" | "context_preserved";

/**
 * Determina la política de visibilidad para un slot dado su función.
 * - Estructuras de soporte estructural → support_hidden
 * - Elementos existentes del lugar → context_preserved
 * - Todo lo demás → visible
 */
export function visibilityPolicy(
  slotFunction: string,
  sourceClass: string,
): VisibilityPolicy {
  if (sourceClass === "venue_existing" || sourceClass === "context_non_quotable") {
    return "context_preserved";
  }
  // Funciones de soporte no decorativo
  if (["service_support", "plinth_pedestal"].includes(slotFunction)) {
    return "support_hidden";
  }
  return "visible";
}
