"use client";

import { useId } from "react";
import { useReducedMotion } from "motion/react";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { dibujarPatron, type Dibujo, type EntradaDibujo, type GloboDibujo, type SoporteDibujo } from "./geometria-dibujo";
import { colorDe, type BrilloGlobo, type ColorLeyenda } from "./leyenda";

type ResueltoDibujo = Pick<PatronColorResuelto, "geometria" | "celdas" | "extras" | "patron">;
type Forma = { tipo: string; oficialId?: string; espejo?: boolean; proporcion?: number };

/** Lo que dibuja `VistaPatron` para una expansión de Python (el trazo solo cambia el giro del dibujo). */
function entradaDibujo(resuelto: ResueltoDibujo, forma: Forma, celdas?: readonly (readonly number[])[]): EntradaDibujo {
  const base = resuelto.patron.base;
  return {
    geometria: resuelto.geometria,
    tipo: forma.tipo,
    oficialId: forma.oficialId,
    celdas: celdas ?? resuelto.celdas,
    extras: resuelto.extras,
    trazo: base.modo === "espiral" ? base.trazo : undefined,
    espejo: forma.espejo ?? false,
    proporcion: forma.proporcion,
  };
}

/**
 * El dibujo de una expansión de Python, para quien lo enmarca: con su `caja`
 * le da un hueco de su forma (una columna alta y angosta, un arco ancho) y se
 * lo pasa a `VistaPatron` (`dibujo`) para no calcularlo dos veces.
 */
export function dibujoPatron(resuelto: ResueltoDibujo, forma: Forma): Dibujo {
  return dibujarPatron(entradaDibujo(resuelto, forma));
}

type Props = {
  resuelto: ResueltoDibujo;
  /** Celdas a dibujar en lugar de las de `resuelto` (pintura optimista del editor). */
  celdas?: readonly (readonly number[])[];
  /** `dibujoPatron` de este mismo `resuelto` y esta forma, si quien lo enmarca ya lo calculó (sin `celdas`). */
  dibujo?: Dibujo;
  leyenda: readonly ColorLeyenda[];
  tipo: string;
  oficialId?: string;
  espejo?: boolean;
  /** Alto / ancho declarado de la estructura. */
  proporcion?: number;
  /** Texto accesible del dibujo. */
  etiqueta: string;
  className?: string;
  /** Entrada escalonada desde la base (se omite con movimiento reducido y en rejillas enormes). */
  animar?: boolean;
};

/** Sobre este número de globos no se anima globo por globo: la pared entra de una vez. */
const MAXIMO_ANIMADOS = 360;

const BRILLOS: Readonly<Record<BrilloGlobo, string>> = {
  mate: "mate",
  cromado: "cromado",
  perlado: "perlado",
  transparente: "mate",
  multicolor: "mate",
};

function Soporte({ soporte }: { soporte: SoporteDibujo }) {
  if (soporte.tipo === "mesa") {
    return <ellipse cx={soporte.x} cy={soporte.y + 3} rx={soporte.ancho / 2} ry={4} className="fill-superficie-2 stroke-borde" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
  }
  return (
    <g className="fill-superficie-2 stroke-borde" strokeWidth={1}>
      <rect x={soporte.x - soporte.ancho / 2} y={soporte.y} width={soporte.ancho} height={5} rx={2.5} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/**
 * Un globo. Entra con una animación CSS (`patron-globo-entra`), no con un
 * componente animado por globo: la vista previa en vivo vuelve a pintar el
 * dibujo con cada respuesta y cada uno de esos componentes se volvía a
 * evaluar. La animación corre una sola vez, al montar.
 */
function Globo({ globo, color, id, retraso, transicion }: { globo: GloboDibujo; color: ColorLeyenda; id: string; retraso: number | null; transicion: boolean }) {
  const ry = globo.r * 1.06;
  // Los de atrás quedan en sombra; los centros de flor (z > 1) no.
  const sombra = globo.z < 1 ? ((1 - globo.z) / 2) * 0.34 : 0;
  const relleno = color.brillo === "multicolor" ? `url(#${id}-multicolor)` : color.hex;
  const forma = { cx: globo.x, cy: globo.y, rx: globo.r, ry };
  const contenido = (
    <>
      <ellipse
        {...forma}
        fill={relleno}
        fillOpacity={color.brillo === "transparente" ? 0.28 : 1}
        // Los claros se pierden en el fondo claro y los oscuros en el oscuro: los dos llevan contorno.
        className={color.muestra.conBorde || color.numeroClaro ? "stroke-borde" : undefined}
        // Contorno de un píxel a cualquier escala: nítido en un bloque pequeño y en la vista grande.
        strokeWidth={color.muestra.conBorde || color.numeroClaro ? 1 : undefined}
        vectorEffect="non-scaling-stroke"
        // El color cambia con un fundido corto (la vista previa en vivo); sin movimiento, al instante.
        style={transicion ? { transition: "fill 260ms var(--ease-out)" } : undefined}
      />
      <ellipse {...forma} fill={`url(#${id}-volumen)`} />
      <ellipse {...forma} fill={`url(#${id}-${BRILLOS[color.brillo]})`} />
      {/* `fillOpacity`, no `opacity`: se ve igual (solo relleno) y no hace de cada sombra una capa que el navegador recompone en cada cuadro. */}
      {sombra > 0.02 && <ellipse {...forma} fill="#000" fillOpacity={sombra} />}
    </>
  );
  if (retraso === null) return <g>{contenido}</g>;
  return <g className="patron-globo-entra" style={{ animationDelay: `${retraso}s` }}>{contenido}</g>;
}

/**
 * Dibujo pseudo-3D del patrón que devolvió Python: cada racimo alrededor del
 * eje de la estructura (columna apilada, arco en media elipse, semiarco en un
 * cuarto de curva, guirnalda ondulada, aro en círculo, pared al tresbolillo).
 * Los colores son datos de catálogo (`hex` de la leyenda); el soporte y los
 * bordes usan tokens del tema.
 */
export function VistaPatron({ resuelto, celdas, dibujo: calculado, leyenda, tipo, oficialId, espejo = false, proporcion, etiqueta, className = "", animar = true }: Props) {
  const reducir = useReducedMotion();
  const id = `patron-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const celdasDibujo = celdas ?? resuelto.celdas;
  const dibujo = (!celdas && calculado) || dibujarPatron(entradaDibujo(resuelto, { tipo, oficialId, espejo, proporcion }, celdasDibujo));
  const animarGlobos = animar && !reducir && dibujo.globos.length <= MAXIMO_ANIMADOS;
  const filas = Math.max(1, celdasDibujo.length);
  const { caja } = dibujo;
  return (
    <svg
      viewBox={`${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`}
      role="img"
      aria-label={etiqueta}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
      className={className}
    >
      <defs>
        <radialGradient id={`${id}-volumen`} cx="46%" cy="42%" r="62%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.26" />
        </radialGradient>
        <radialGradient id={`${id}-mate`} cx="34%" cy="28%" r="58%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.62" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-cromado`} cx="33%" cy="27%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="22%" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="46%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-perlado`} cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-multicolor`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d32f2f" />
          <stop offset="30%" stopColor="#f5d33a" />
          <stop offset="55%" stopColor="#2e9d57" />
          <stop offset="80%" stopColor="#1f4fbf" />
          <stop offset="100%" stopColor="#7b3fa0" />
        </linearGradient>
      </defs>
      {dibujo.soporte && <Soporte soporte={dibujo.soporte} />}
      {dibujo.globos.map((globo) => (
        <Globo
          key={globo.clave}
          globo={globo}
          color={colorDe(leyenda, globo.material)}
          id={id}
          retraso={animarGlobos ? Math.min(0.9, (globo.fila / filas) * 0.9) : null}
          transicion={!reducir}
        />
      ))}
    </svg>
  );
}

