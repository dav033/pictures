import type { IdEstilo } from "./modos";

/**
 * Esquema fijo de cada estilo para las fichas de la galería: tres tonos del
 * color del texto (`currentColor`), no una expansión del patrón real.
 */
const A = 0.95;
const B = 0.28;
const C = 0.6;

type Punto = readonly [number, number, number];

function filas(tonos: readonly (readonly number[])[]): Punto[] {
  return tonos.flatMap((fila, indiceFila) => fila.map((tono, columna): Punto => [6 + columna * 6, 19 - indiceFila * 4.6, tono]));
}

function rejilla(tono: (fila: number, columna: number) => number): Punto[] {
  return Array.from({ length: 16 }, (_, indice): Punto => {
    const fila = Math.floor(indice / 4);
    const columna = indice % 4;
    return [4.5 + columna * 5 + (fila % 2) * 1.2, 4.5 + fila * 5, tono(fila, columna)];
  });
}

const ESQUEMAS: Readonly<Record<IdEstilo, readonly Punto[]>> = {
  espiral: filas([[A, B, B], [B, A, B], [B, B, A], [A, B, B]]),
  zigzag: filas([[A, B, B], [B, A, B], [A, B, B], [B, A, B]]),
  recto: filas([[A, B, A], [A, B, A], [A, B, A], [A, B, A]]),
  anillos: filas([[A, A, A], [B, B, B], [A, A, A], [B, B, B]]),
  bloques: filas([[A, A, A], [A, A, A], [B, B, B], [B, B, B]]),
  degradado: filas([[A, A, A], [A, C, A], [C, B, C], [B, B, B]]),
  diagonal: rejilla((fila, columna) => [A, A, C, C, B, B, B][fila + columna] ?? B),
  aleatorio: filas([[A, B, C], [B, A, B], [C, B, A], [B, C, B]]),
  flor: [[12, 12, C], [12, 6.4, A], [17.3, 10.3, A], [15.3, 16.6, A], [8.7, 16.6, A], [6.7, 10.3, A], [3.5, 3.5, B], [20.5, 3.5, B], [3.5, 20.5, B], [20.5, 20.5, B]],
  damero: rejilla((fila, columna) => ((fila >> 1) + (columna >> 1)) % 2 === 0 ? A : B),
};

export function IconoEstilo({ estilo, className }: { estilo: IdEstilo; className?: string }) {
  const radio = estilo === "diagonal" || estilo === "damero" ? 2.3 : 2.6;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {ESQUEMAS[estilo].map(([x, y, tono], indice) => (
        <circle key={indice} cx={x} cy={y} r={estilo === "flor" && indice === 0 ? 2.2 : radio} fill="currentColor" opacity={tono} />
      ))}
    </svg>
  );
}
