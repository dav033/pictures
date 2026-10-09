/**
 * **Una decoración que falla no tira la pieza** (`compilar-lectura.ts`): el follaje de una guirnalda o el rótulo de un panel son
 * adornos de una pieza que ya está medida y colocada. Si uno no se puede armar, la pieza se arma igual sin él y queda una nota que
 * dice qué se perdió y por qué (antes, un follaje mal nombrado hacía que se omitiera la guirnalda entera).
 */
export function conNotaSiFalla<T>(que: string, notas: string[], hacer: () => T, alternativa: T): T {
  try {
    return hacer();
  } catch (error) {
    notas.push(`${que}: no se pudo armar y se omite (${error instanceof Error ? error.message : String(error)}); el resto de la pieza se arma igual.`);
    return alternativa;
  }
}
