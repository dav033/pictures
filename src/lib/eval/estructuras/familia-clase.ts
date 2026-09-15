import type { FamiliaV2 } from "./familia-v1-v2";

/**
 * Family of each official class (inverse of Fundamentos §4.7 step 2), used only
 * to stratify evaluation suites. Temporary adapter with the same removal
 * condition as familia-v1-v2.ts: the taxonomy artifact (§4.8, T0–T5).
 */
const FAMILIA_DE_CLASE: Record<string, FamiliaV2> = {
  arco: "arco", arco_organico: "arco", arco_no_denso: "arco",
  semiarco: "semiarco", semiarco_organico: "semiarco",
  columna: "columna", columna_organica: "columna", columna_no_densa: "columna",
  pared_densa: "pared", pared_no_densa: "pared",
  guirnalda: "guirnalda", centro_mesa: "centro_mesa", bouquet: "bouquet", figura: "figura",
  aro_circular: "aro", techo_globos: "techo",
};

export function familiaDesdeClaseOficial(clase: string): FamiliaV2 {
  const familia = FAMILIA_DE_CLASE[clase];
  if (!familia) throw new Error(`clase oficial desconocida: ${clase}`);
  return familia;
}

export const CLASES_OFICIALES = Object.keys(FAMILIA_DE_CLASE);
