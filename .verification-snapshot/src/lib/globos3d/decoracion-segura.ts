/**
 * **Una decoración que falla no tira la pieza** (`compilar-lectura.ts`): el follaje de una guirnalda o el rótulo de un panel son
 * adornos de una pieza que ya está medida y colocada. Si uno no se puede armar, la pieza se arma igual sin él y se dice sin disimularlo: una nota
 * y una entrada en `omitidas` (lo que el resumen para la persona cuenta como «no se armó»), con qué se perdió y por qué.
 */
export function conNotaSiFalla<T>(que: string, notas: string[], omitidas: string[], hacer: () => T, alternativa: T): T {
  try {
    return hacer();
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    notas.push(`${que}: no se pudo armar y se omite (${motivo}); el resto de la pieza se arma igual.`);
    omitidas.push(`${que}: no se armó (${motivo}).`);
    return alternativa;
  }
}
