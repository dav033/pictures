import type { RellenoOrganico } from "./organico";

export type FormatoCompensable = {
  formatoId: string;
  infladoCm: number;
  diametroMaxCm: number;
};

const FORMATO_R5 = "R-5";
const INFLADO_MEDIANO_CM = 18;
const INFLADO_MINIMO_RELATIVO = 0.4;

/** Shared by the P-087 wrapper and motor calibration: no color offers R-9 and an actual format allows 18 cm. */
export function compensarRellenoMediano(
  relleno: readonly RellenoOrganico[],
  coloresOfrecenR9: boolean,
  formatosDisponibles: readonly FormatoCompensable[],
  infladoR9NominalCm: number,
  rellenoR9: RellenoOrganico | undefined,
): RellenoOrganico[] {
  if (coloresOfrecenR9 || !rellenoR9) return [...relleno];

  const siguiente = formatosDisponibles
    .filter((formato) => formato.formatoId !== FORMATO_R5
      && formato.infladoCm > infladoR9NominalCm
      && formato.diametroMaxCm * INFLADO_MINIMO_RELATIVO <= INFLADO_MEDIANO_CM)
    .sort((a, b) => a.infladoCm - b.infladoCm)[0];
  if (!siguiente) return [...relleno];

  return [
    ...relleno.filter((item) => item.formatoId !== siguiente.formatoId),
    { ...rellenoR9, formatoId: siguiente.formatoId },
  ];
}
