import type { Organico } from "./organico-ajustes";

export type TipoRellenoCompensado = "columna" | "guirnalda";

export type PoliticaRellenoCompensado = {
  tipo: TipoRellenoCompensado;
  factorInfladoMaximo: number;
};

/** Direct, single-tramo columns and garlands share P-087/P-089 palette-dependent fill. */
export function politicaRellenoCompensado(pieza: Organico): PoliticaRellenoCompensado | null {
  const tramo = pieza.opciones.tramos[0];
  if (pieza.generador || pieza.opciones.tramos.length !== 1) return null;
  if (tramo?.id === "columna") return { tipo: "columna", factorInfladoMaximo: 0.75 };
  if (tramo?.id === "guirnalda") return { tipo: "guirnalda", factorInfladoMaximo: 0.8 };
  return null;
}
