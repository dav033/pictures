import { z } from "zod";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

const LineaSchema = z.object({
  product_id: z.string(),
  color: z.string().nullish(),
  unidades: z.number(),
  adorno: z.unknown().optional(),
}).passthrough();

function normal(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

/** Globos por pieza, producto y color (el cuerpo y las flores aparte). */
function cifras(plan: PlanGuiado): Map<string, number> {
  const suma = new Map<string, number>();
  for (const estructura of plan.estructuras) {
    for (const cruda of estructura.lineas) {
      const linea = LineaSchema.safeParse(cruda);
      if (!linea.success) continue;
      const clave = `${estructura.estructura_id}|${linea.data.product_id}|${normal(linea.data.color)}|${linea.data.adorno ? "flor" : "cuerpo"}`;
      suma.set(clave, (suma.get(clave) ?? 0) + linea.data.unidades);
    }
  }
  return suma;
}

/**
 * Si un cambio dejó igual «lo demás» (juez 2026-10-11, D4): las piezas que no tocó llevan exactamente los mismos globos
 * (pieza, producto y color) y, en las tocadas, cada globo que está antes y después conserva su cifra; lo que salió (un
 * color cambiado, una pieza quitada) o entró no cuenta. Si al volver a contar se movió cualquier otra cifra, la
 * confirmación no puede decir «igual». Sin líneas que comparar, tampoco: se dice menos.
 */
export function otrasCifrasIguales(antes: PlanGuiado, despues: PlanGuiado, tocadas: readonly string[]): boolean {
  const deAntes = cifras(antes);
  const deDespues = cifras(despues);
  const tocada = (clave: string) => tocadas.includes(clave.slice(0, clave.indexOf("|")));
  let comparadas = 0;
  for (const clave of new Set([...deAntes.keys(), ...deDespues.keys()])) {
    const previa = deAntes.get(clave);
    const ahora = deDespues.get(clave);
    if (previa === undefined || ahora === undefined) {
      if (tocada(clave)) continue;
      return false;
    }
    if (ahora !== previa) return false;
    comparadas += 1;
  }
  return comparadas > 0;
}
