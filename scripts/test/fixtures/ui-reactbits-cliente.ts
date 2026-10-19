import type { Cotizacion } from "../../../src/lib/cotizacion/motor";
import type { PasoPlanGuiado } from "../../../src/lib/ia/guiado/generar-pasos-plan";

export const pasosFixture: readonly PasoPlanGuiado[] = [
  { orden: 1, texto: "Prepara el soporte y los materiales.", globos: "24 globos" },
  { orden: 2, texto: "Infla los globos y sepáralos por color." },
];

export const cotizacionFixture: Cotizacion = {
  lineas: [],
  total: 42_000,
  mermaPorcentaje: 0,
  incluyeIva: true,
  complementosSoportados: false,
};
