import { descripcionFisicaTamano } from "@/lib/ia/tamano-fisico";
import type { PlanResuelto } from "./resuelto";

export type ResultadoCoherencia = { ok: boolean; errores: string[] };

export function verificarCoherenciaPrompt(prompt: string, plan: PlanResuelto): ResultadoCoherencia {
  const errores: string[] = [];
  for (const estructura of plan.estructuras) {
    if (!prompt.includes(estructura.estructura_id) && !prompt.includes(estructura.nombre)) errores.push(`falta estructura ${estructura.estructura_id} en el prompt`);
  }
  const comprados = new Set(plan.compras.filter((compra) => compra.diam_pulg != null).map((compra) => compra.diam_pulg));
  for (const compra of plan.compras) {
    if (compra.diam_pulg == null) continue;
    const descripcion = descripcionFisicaTamano(compra.diam_pulg, "redondo");
    if (!descripcion || !prompt.includes(`${compra.diam_pulg}-inch`) || !prompt.includes(`${Math.round(compra.diam_pulg * 2.54 * 10) / 10} cm`)) {
      errores.push(`falta tamaño físico ${compra.tamano_codigo ?? `R-${compra.diam_pulg}`} en el prompt`);
    }
  }
  const sizeLines = [...prompt.matchAll(/(\d+(?:\.\d+)?)-inch/g)].map((match) => Number(match[1]));
  for (const diametro of sizeLines) if (!comprados.has(diametro)) errores.push(`el prompt menciona diámetro no cotizado: ${diametro} pulgadas`);
  return { ok: errores.length === 0, errores };
}
