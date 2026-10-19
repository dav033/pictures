/**
 * **El solape que el diseño tolera entre dos piezas de una escena.** Una pieza que se cuelga de la pared o del techo (una
 * guirnalda, una pared de malla, un racimo, el techo de globos) se tiende a propósito sobre las que están en el piso: su caja
 * puede cruzar la de un semiarco o una columna. Dos piezas del piso, o dos colgadas, sí son un choque.
 *
 * Lo usan `test-motor-guiada-disposicion.ts` y la matriz de escenarios (`scripts/escenarios/invariantes.ts`): una sola regla,
 * para que las pruebas no discrepen sobre qué es un choque.
 */
export const COLGADAS_DE_PARED_O_TECHO: ReadonlySet<string> = new Set([
  "guirnalda", "pared_densa", "pared_no_densa", "pared_organica", "racimo_pared", "techo_globos",
]);

/** Verdadero si el solape entre una pieza de `oficialA` y una de `oficialB` es el que el diseño tiende a propósito. */
export function solapeTolerado(oficialA: string, oficialB: string): boolean {
  return COLGADAS_DE_PARED_O_TECHO.has(oficialA) !== COLGADAS_DE_PARED_O_TECHO.has(oficialB);
}
