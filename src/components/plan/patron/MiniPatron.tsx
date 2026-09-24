import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { posicionesGiradas } from "./geometria-dibujo";
import { colorDe, type ColorLeyenda } from "./leyenda";

type Props = {
  resuelto: Pick<PatronColorResuelto, "geometria" | "celdas" | "extras" | "nombre" | "patron">;
  leyenda: readonly ColorLeyenda[];
  className?: string;
};

const MAX_RACIMOS = 12;
const MAX_FILAS_PARED = 5;
const MAX_COLUMNAS_PARED = 16;
const PASO = 5.4;
const RADIO = 2.25;

type Punto = { clave: string; x: number; y: number; r: number; color: ColorLeyenda };

/**
 * Tira del patrón para las tarjetas de resumen: los primeros racimos, cada uno
 * como una columnita de sus globos (base a la izquierda), o las primeras filas
 * de una pared. Dibuja las celdas de Python tal cual; en espiral, zig-zag o
 * franjas rectas cada racimo se corre lo que gira su capa (la cara de
 * adelante), así la tira ya se lee como el patrón. No repite, completa ni
 * cuenta celdas.
 */
export function MiniPatron({ resuelto, leyenda, className = "" }: Props) {
  const rejilla = resuelto.geometria === "rejilla";
  const base = resuelto.patron.base;
  const trazo = base.modo === "espiral" ? base.trazo : null;
  const filas = resuelto.celdas.slice(0, rejilla ? MAX_FILAS_PARED : MAX_RACIMOS);
  const puntos: Punto[] = filas.flatMap((materiales, fila) => {
    const visibles = rejilla ? materiales.slice(0, MAX_COLUMNAS_PARED) : materiales;
    const giro = trazo ? posicionesGiradas(fila, materiales.length, trazo) : 0;
    return visibles.map((_, columna) => ({
      clave: `${fila}:${columna}`,
      // Racimos: una columna por racimo. Pared: la fila tal cual, al tresbolillo.
      x: rejilla ? columna * PASO + (fila % 2) * (PASO / 2) : fila * PASO,
      y: rejilla ? fila * PASO * 0.9 : columna * PASO,
      r: RADIO,
      color: colorDe(leyenda, visibles[(columna + giro) % visibles.length]!),
    }));
  });
  if (!rejilla) {
    // Centro de flor: un punto pequeño en medio de su racimo.
    for (const [indice, extra] of resuelto.extras.entries()) {
      const globos = resuelto.celdas[extra.fila]?.length ?? 0;
      if (extra.fila >= filas.length || !globos) continue;
      puntos.push({ clave: `extra:${indice}`, x: extra.fila * PASO, y: ((globos - 1) / 2) * PASO, r: RADIO * 0.72, color: colorDe(leyenda, extra.material) });
    }
  }
  const ancho = Math.max(...puntos.map((punto) => punto.x), 0) + RADIO * 2 + 1;
  const alto = Math.max(...puntos.map((punto) => punto.y), 0) + RADIO * 2 + 1;
  return (
    <svg viewBox={`${-RADIO - 0.5} ${-RADIO - 0.5} ${ancho} ${alto}`} role="img" aria-label={`Patrón ${resuelto.nombre.toLowerCase()}`} className={className} preserveAspectRatio="xMinYMid meet">
      {puntos.map((punto) => {
        // Los claros (blanco, plateado) se pierden en la tarjeta clara: llevan contorno.
        const contorno = punto.color.muestra.conBorde || punto.color.brillo === "transparente";
        return (
          <circle
            key={punto.clave}
            cx={punto.x}
            cy={punto.y}
            r={punto.r}
            fill={punto.color.hex}
            fillOpacity={punto.color.brillo === "transparente" ? 0.35 : 1}
            className={contorno ? "stroke-texto-tenue" : undefined}
            strokeOpacity={contorno ? 0.6 : undefined}
            strokeWidth={contorno ? 0.5 : undefined}
          />
        );
      })}
    </svg>
  );
}
