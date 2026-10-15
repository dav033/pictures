import { z } from "zod";
import { VERSION_MOTOR } from "@/lib/globos3d/motor/v1";

/**
 * Un plan que el cliente armó con una versión anterior del motor sigue verificándose (el token firma el hash con la versión
 * que trae), pero editarlo, sumarle una idea o rehacerlo lo vuelve a armar con el motor de ahora (P-091). Si al volver a
 * armar SU plan sin tocar nada salen otros globos que los que tenía, el cambio que pidió no es la causa y se lo decimos.
 * Sin aviso cuando la versión es la actual o las cifras coinciden: no hay ruido si nada se movió.
 */
export function avisoMotorActualizado(versionPlan: string, globosAntes: number, globosAhora: number): string | null {
  if (versionPlan === VERSION_MOTOR || globosAntes === globosAhora) return null;
  return `El motor se actualizó desde que armaste este plan: lo recalculé con la versión nueva (antes ${globosAntes} globos, ahora ${globosAhora}).`;
}

export const totalGlobosDeBom = (bom: { total: ReadonlyArray<{ cantidad: number }> }): number => bom.total.reduce((suma, linea) => suma + linea.cantidad, 0);

const TotalesSchema = z.object({ totales: z.object({ total_unidades: z.number().int().nonnegative() }).passthrough() }).passthrough();

/** Los globos que el plan del cliente decía tener (`totales.total_unidades`); `null` si el plan no los trae. Solo alimenta el texto del aviso: no se firma ni se usa para precios. */
export function totalGlobosDelPlan(plan: unknown): number | null {
  const leido = TotalesSchema.safeParse(plan);
  return leido.success ? leido.data.totales.total_unidades : null;
}
