import type { FormatoGlobo } from "./formatos";
import { armarTrenza, type AnclaTrenza, type GloboDeTrenza, type PatronTrenza, type Punto2 } from "./trenza";

/**
 * El arco de cuartetos: la misma trenza de Sempertex (cuartetos apretados, giro de 1/8 por nivel), siguiendo
 * una curva de piso a piso sobre un armazón (varilla o PVC). Formas:
 * - redondo: media elipse de ancho × alto (el arco de entrada clásico);
 * - parabólico: más puntiagudo arriba, con las patas casi rectas;
 * - rectangular: patas rectas y travesaño con esquinas redondeadas (el arco «Π» de entrada o marco).
 * Ancho y alto son los del eje de la trenza; por fuera mide un diámetro más.
 */
export type FormaArco = "redondo" | "parabolico" | "rectangular";

export const FORMAS_ARCO: ReadonlyArray<{ id: FormaArco; nombre: string; descripcion: string }> = [
  { id: "redondo", nombre: "Redondo", descripcion: "Media elipse de piso a piso: el arco de entrada clásico." },
  { id: "parabolico", nombre: "Parabólico", descripcion: "Patas casi rectas y punta más cerrada arriba." },
  { id: "rectangular", nombre: "Rectangular", descripcion: "Dos patas rectas y un travesaño, con las esquinas redondeadas." },
];

const MUESTRAS = 160;

export function recorridoArco(forma: FormaArco, anchoCm: number, altoCm: number): Punto2[] {
  const a = anchoCm / 2;
  const puntos: Punto2[] = [];
  if (forma === "redondo") {
    for (let i = 0; i <= MUESTRAS; i++) {
      const t = Math.PI - (Math.PI * i) / MUESTRAS;
      puntos.push({ x: a * Math.cos(t), y: altoCm * Math.sin(t) });
    }
  } else if (forma === "parabolico") {
    // y = alto · (1 − (x/a)^4): patas casi rectas, arriba redondeado.
    for (let i = 0; i <= MUESTRAS; i++) {
      const x = -a + (2 * a * i) / MUESTRAS;
      puntos.push({ x, y: altoCm * (1 - Math.pow(Math.abs(x) / a, 4)) });
    }
  } else {
    const r = Math.min(a * 0.35, altoCm * 0.25, 45); // radio de las esquinas
    puntos.push({ x: -a, y: 0 }, { x: -a, y: altoCm - r });
    for (let i = 1; i <= 16; i++) { const t = Math.PI - (Math.PI / 2) * (i / 16); puntos.push({ x: -a + r + r * Math.cos(t), y: altoCm - r + r * Math.sin(t) }); }
    puntos.push({ x: a - r, y: altoCm });
    for (let i = 1; i <= 16; i++) { const t = Math.PI / 2 - (Math.PI / 2) * (i / 16); puntos.push({ x: a - r + r * Math.cos(t), y: altoCm - r + r * Math.sin(t) }); }
    puntos.push({ x: a, y: 0 });
  }
  return puntos;
}

export type ArcoArmado = {
  niveles: number;
  anclas: AnclaTrenza[];
  longitudCm: number;
  globos: GloboDeTrenza[];
  materiales: Array<{ codigo: string; cantidad: number }>;
};

export function armarArco(opciones: { formato: FormatoGlobo; infladoCm: number; forma: FormaArco; anchoCm: number; altoCm: number; patron: PatronTrenza; colores: readonly string[] }): ArcoArmado {
  const { formato, infladoCm, forma, anchoCm, altoCm, patron, colores } = opciones;
  const trenza = armarTrenza({ formato, infladoCm, patron, colores, recorrido: recorridoArco(forma, anchoCm, altoCm), reparto: "extremos" });
  return { niveles: trenza.niveles, anclas: trenza.anclas, longitudCm: trenza.longitudCm, globos: trenza.globos, materiales: trenza.materiales };
}
