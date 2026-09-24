import type { DetectedStructure } from "@/lib/ia/referencia/reference-structure";

/**
 * Step 1 of Fundamentos §4.7: detector v1 `structure_type` → `familia` v2.
 *
 * Temporary adapter (Plan A §A0.3 task 5), used only to score the current v13
 * recognizer. It is not a second owner of the official-class table: step 2
 * (familia + attributes → estructura_oficial) is not implemented here.
 * Removal condition: the taxonomy artifact of Fundamentos §4.8 (slices T0–T5)
 * publishes the generated table and this module consumes it instead.
 */

export const FAMILIAS_V2 = [
  "arco", "semiarco", "columna", "guirnalda", "pared", "centro_mesa", "techo", "figura", "bouquet", "aro",
] as const;
export type FamiliaV2 = (typeof FAMILIAS_V2)[number];

export type FamiliaDerivada =
  | { estado: "determinada"; familia: FamiliaV2; candidatos: [FamiliaV2] }
  | { estado: "ambigua"; familia: null; candidatos: FamiliaV2[] };

const PASO_1: Record<DetectedStructure["type"], FamiliaDerivada> = {
  arch: { estado: "determinada", familia: "arco", candidatos: ["arco"] },
  half_arch: { estado: "determinada", familia: "semiarco", candidatos: ["semiarco"] },
  column: { estado: "determinada", familia: "columna", candidatos: ["columna"] },
  garland: { estado: "determinada", familia: "guirnalda", candidatos: ["guirnalda"] },
  balloon_wall: { estado: "determinada", familia: "pared", candidatos: ["pared"] },
  centerpiece: { estado: "determinada", familia: "centro_mesa", candidatos: ["centro_mesa"] },
  ceiling_installation: { estado: "determinada", familia: "techo", candidatos: ["techo"] },
  // §4.7: a cluster has no single family.
  cluster: { estado: "ambigua", familia: null, candidatos: ["bouquet", "centro_mesa"] },
  sculpture: { estado: "determinada", familia: "figura", candidatos: ["figura"] },
  bouquet: { estado: "determinada", familia: "bouquet", candidatos: ["bouquet"] },
  hoop: { estado: "determinada", familia: "aro", candidatos: ["aro"] },
};

export function familiaDesdeDetectorV1(tipo: DetectedStructure["type"]): FamiliaDerivada {
  const derivada = PASO_1[tipo];
  // Copies, so a caller cannot mutate the shared table.
  return derivada.estado === "determinada"
    ? { ...derivada, candidatos: [derivada.familia] }
    : { ...derivada, candidatos: [...derivada.candidatos] };
}
