import { z } from "zod";

/** Same bounds the Python adapter already enforces on `plan-edit-result.v1`. */
const AvisosEdicionSchema = z.array(z.string().min(1).max(400)).max(8);

/**
 * Python's sentences about an edit (`avisos` of /api/plan-editar, e.g. "El
 * patrón se rehízo porque quitaste un color."), verbatim and without
 * repeats. The route only sends them when there is something to say; a body
 * without them, or with something else in their place, has none.
 */
export function avisosDeEdicion(datos: unknown): string[] {
  if (typeof datos !== "object" || datos === null || !("avisos" in datos)) return [];
  const leidos = AvisosEdicionSchema.safeParse((datos as { avisos: unknown }).avisos);
  return leidos.success ? [...new Set(leidos.data)] : [];
}
