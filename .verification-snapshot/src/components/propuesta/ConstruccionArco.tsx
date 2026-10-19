"use client";

import { useId } from "react";

const ANCHO = 300;
const ALTO = 200;
const CENTRO = { x: 150, y: 184 };
const ARCO_GUIA = `M ${CENTRO.x - 106} ${CENTRO.y} A 106 106 0 0 1 ${CENTRO.x + 106} ${CENTRO.y}`;
const COLORES_RESPALDO = ["var(--acento)", "var(--acento-2)", "#f4c542", "#ffffff"];

type Globo = { x: number; y: number; r: number; indiceColor: number };

/**
 * The arch's balloons in the order a decorator builds it: from both bases
 * toward the top, alternating sides. Two rings, the inner one offset half a
 * balloon, so it reads as an organic cluster and not a line of beads.
 */
function globosDelArco(): Globo[] {
  const anillos = [
    { radio: 116, cantidad: 15, r: 12.5, desfase: 0 },
    { radio: 95, cantidad: 12, r: 10.5, desfase: 0.5 },
  ];
  const globos: Array<Globo & { orden: number }> = [];
  anillos.forEach((anillo, indiceAnillo) => {
    for (let paso = 0; paso < anillo.cantidad; paso += 1) {
      const t = (paso + anillo.desfase) / (anillo.cantidad - 1 + anillo.desfase * 2);
      const angulo = Math.PI * (1 - t);
      // Deterministic variation, so every render (and the server) draws the same arch.
      const variacion = ((paso * 7 + indiceAnillo * 3) % 5) / 10 - 0.2;
      globos.push({
        x: CENTRO.x + Math.cos(angulo) * anillo.radio,
        y: CENTRO.y - Math.sin(angulo) * anillo.radio,
        r: anillo.r * (1 + variacion * 0.35),
        indiceColor: paso + indiceAnillo,
        // Distance to the nearest base first; the left side goes first on a tie.
        orden: Math.min(t, 1 - t) * 2 + (t > 0.5 ? 0.001 : 0) + indiceAnillo * 0.02,
      });
    }
  });
  return globos.sort((a, b) => a.orden - b.orden).map(({ x, y, r, indiceColor }) => ({ x, y, r, indiceColor }));
}

const GLOBOS = globosDelArco();

const CHISPAS = [
  { x: 52, y: 40, retraso: 0 }, { x: 250, y: 58, retraso: 0.8 }, { x: 150, y: 22, retraso: 1.6 },
  { x: 92, y: 120, retraso: 0.4 }, { x: 212, y: 132, retraso: 1.2 },
] as const;

/**
 * How many balloons are in place after `segundos`: fast at first, then
 * slower, never the whole arch. The provider reports no progress, so the
 * arch only says "it is being built", not how much is left.
 */
export function globosColocados(segundos: number, total = GLOBOS.length): number {
  if (segundos < 1) return 0;
  return Math.min(total - 1, Math.round(total * (1 - Math.exp(-(segundos - 1) / 18))));
}

/**
 * The wait for the proposal image, as a decoration being built: a dashed
 * guide draws the arch and its balloons, in the proposal's own colors,
 * inflate one by one from the bases toward the top, with a ghost where the
 * next one goes. A showcase: its CSS animations (`construir-*` in
 * globals.css) also run with reduced motion.
 */
export function ConstruccionArco({ segundos, colores, className = "" }: { segundos: number; colores: readonly string[]; className?: string }) {
  const id = useId().replace(/:/g, "");
  const paleta = colores.length ? colores : COLORES_RESPALDO;
  const colocados = globosColocados(segundos);
  const siguiente = GLOBOS[colocados];
  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className={className} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id={`rejilla-${id}`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="var(--acento)" strokeOpacity="0.12" strokeWidth="1" />
        </pattern>
        <radialGradient id={`brillo-${id}`} cx="32%" cy="28%" r="65%">
          <stop offset="0%" stopColor="white" stopOpacity="0.7" />
          <stop offset="45%" stopColor="white" stopOpacity="0.12" />
          <stop offset="100%" stopColor="black" stopOpacity="0.18" />
        </radialGradient>
        <radialGradient id={`halo-${id}`} cx="50%" cy="100%" r="70%">
          <stop offset="0%" stopColor="var(--acento)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--acento)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width={ANCHO} height={ALTO} fill={`url(#rejilla-${id})`} />
      <ellipse cx={CENTRO.x} cy={CENTRO.y} rx="150" ry="110" fill={`url(#halo-${id})`} />

      {/* The guide: the arch as a dashed plan, drawn from one base to the other before any balloon is in place. */}
      <mask id={`trazo-${id}`}>
        <path className="construir-trazo" d={ARCO_GUIA} fill="none" stroke="white" strokeWidth="4" />
      </mask>
      <path d={ARCO_GUIA} mask={`url(#trazo-${id})`} fill="none" stroke="var(--acento)" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="6 6" />
      <rect x={CENTRO.x - 128} y={CENTRO.y + 2} width="42" height="8" rx="3" fill="var(--texto-suave)" fillOpacity="0.45" />
      <rect x={CENTRO.x + 86} y={CENTRO.y + 2} width="42" height="8" rx="3" fill="var(--texto-suave)" fillOpacity="0.45" />

      <g className="construir-flotar">
        {GLOBOS.slice(0, colocados).map((globo, indice) => {
          const color = paleta[globo.indiceColor % paleta.length]!;
          return (
            <g key={indice} className="construir-globo">
              <circle cx={globo.x} cy={globo.y} r={globo.r} style={{ fill: color }} />
              <circle cx={globo.x} cy={globo.y} r={globo.r} fill={`url(#brillo-${id})`} />
              <ellipse cx={globo.x - globo.r * 0.35} cy={globo.y - globo.r * 0.4} rx={globo.r * 0.22} ry={globo.r * 0.14} fill="white" fillOpacity="0.75" />
            </g>
          );
        })}
      </g>

      {siguiente && (
        <circle
          key={colocados}
          className="construir-fantasma"
          cx={siguiente.x}
          cy={siguiente.y}
          r={siguiente.r}
          fill="none"
          stroke="var(--acento)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      )}

      {CHISPAS.map((chispa) => (
        <path
          key={`${chispa.x}-${chispa.y}`}
          className="construir-chispa"
          style={{ animationDelay: `${chispa.retraso}s` }}
          d={`M ${chispa.x} ${chispa.y - 6} L ${chispa.x + 1.6} ${chispa.y - 1.6} L ${chispa.x + 6} ${chispa.y} L ${chispa.x + 1.6} ${chispa.y + 1.6} L ${chispa.x} ${chispa.y + 6} L ${chispa.x - 1.6} ${chispa.y + 1.6} L ${chispa.x - 6} ${chispa.y} L ${chispa.x - 1.6} ${chispa.y - 1.6} Z`}
          fill="var(--acento-2)"
        />
      ))}
    </svg>
  );
}
