import type { FamiliaV2 } from "./familia-v1-v2";

/**
 * Family of each class, used only to stratify evaluation suites and compare
 * against folder labels. Follows the user's decision of 2026-09-15 that retires
 * the dense / non-dense split (13 classes; pared_densa + pared_no_densa → pared),
 * which Fundamentos §4 still lists as 16 until that document is updated.
 * Temporary adapter with the same removal condition as familia-v1-v2.ts: the
 * taxonomy artifact (§4.8, T0–T5).
 */
const FAMILIA_DE_CLASE: Record<string, FamiliaV2> = {
  arco: "arco", arco_organico: "arco",
  semiarco: "semiarco", semiarco_organico: "semiarco",
  columna: "columna", columna_organica: "columna",
  pared: "pared",
  guirnalda: "guirnalda", centro_mesa: "centro_mesa", bouquet: "bouquet", figura: "figura",
  aro_circular: "aro", techo_globos: "techo",
};

export function familiaDesdeClaseOficial(clase: string): FamiliaV2 {
  const familia = FAMILIA_DE_CLASE[clase];
  if (!familia) throw new Error(`clase oficial desconocida: ${clase}`);
  return familia;
}

export const CLASES_OFICIALES = Object.keys(FAMILIA_DE_CLASE);
