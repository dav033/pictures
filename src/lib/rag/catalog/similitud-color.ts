const HUES: Record<string, number> = {
  rojo: 0,
  burdeos: 350,
  coral: 12,
  naranja: 30,
  dorado: 44,
  "dorado rosa": 12,
  champagne: 42,
  amarillo: 52,
  cafe: 28,
  beige: 38,
  crema: 48,
  nude: 24,
  verde: 120,
  menta: 155,
  turquesa: 180,
  azul: 220,
  lila: 270,
  violeta: 276,
  morado: 280,
  fucsia: 320,
  rosado: 335,
};

function normalizarColor(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function distanciaCircular(a: number, b: number): number {
  const distancia = Math.abs(a - b);
  return Math.min(distancia, 360 - distancia) / 180;
}

/** Lower scores mean a closer visual color. Unknown/neutral colors stay usable. */
export function puntuacionCromatica(actuales: string[], candidatas: string[]): number {
  const base = actuales.map(normalizarColor).filter(Boolean);
  const opciones = candidatas.map(normalizarColor).filter(Boolean);
  if (!base.length || !opciones.length) return 0.7;
  if (opciones.some((color) => base.includes(color))) return 1;

  const huesBase = base.map((color) => HUES[color]).filter((hue): hue is number => hue != null);
  const huesOpciones = opciones.map((color) => HUES[color]).filter((hue): hue is number => hue != null);
  if (!huesBase.length || !huesOpciones.length) return 0.7;

  return Math.min(...huesBase.flatMap((baseHue) => huesOpciones.map((optionHue) => distanciaCircular(baseHue, optionHue))));
}
