"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { dibujarPatron, type GloboDibujo, type SoporteDibujo } from "./geometria-dibujo";
import { colorDe, type BrilloGlobo, type ColorLeyenda } from "./leyenda";

type Props = {
  resuelto: Pick<PatronColorResuelto, "geometria" | "celdas" | "extras" | "patron">;
  /** Celdas a dibujar en lugar de las de `resuelto` (pintura optimista del editor). */
  celdas?: readonly (readonly number[])[];
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
    return <ellipse cx={soporte.x} cy={soporte.y + 3} rx={soporte.ancho / 2} ry={4} className="fill-superficie-2 stroke-borde" strokeWidth={0.8} />;
  }
  return (
    <g className="fill-superficie-2 stroke-borde" strokeWidth={0.8}>
      <rect x={soporte.x - soporte.ancho / 2} y={soporte.y} width={soporte.ancho} height={5} rx={2.5} />
    </g>
  );
}

function Globo({ globo, color, id, retraso }: { globo: GloboDibujo; color: ColorLeyenda; id: string; retraso: number | null }) {
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
        strokeWidth={color.muestra.conBorde || color.numeroClaro ? 0.7 : undefined}
        style={{ transition: "fill 260ms var(--ease-out)" }}
      />
      <ellipse {...forma} fill={`url(#${id}-volumen)`} />
      <ellipse {...forma} fill={`url(#${id}-${BRILLOS[color.brillo]})`} />
      {sombra > 0.02 && <ellipse {...forma} fill="#000" opacity={sombra} />}
    </>
  );
  if (retraso === null) return <g>{contenido}</g>;
  return (
    <motion.g initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, delay: retraso, ease: [0.23, 1, 0.32, 1] }}>
      {contenido}
    </motion.g>
  );
}

/**
 * Dibujo pseudo-3D del patrón que devolvió Python: cada racimo alrededor del
 * eje de la estructura (columna apilada, arco en media elipse, semiarco en un
 * cuarto de curva, guirnalda ondulada, aro en círculo, pared al tresbolillo).
 * Los colores son datos de catálogo (`hex` de la leyenda); el soporte y los
 * bordes usan tokens del tema.
 */
export function VistaPatron({ resuelto, celdas, leyenda, tipo, oficialId, espejo = false, proporcion, etiqueta, className = "", animar = true }: Props) {
  const reducir = useReducedMotion();
  const id = `patron-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const celdasDibujo = celdas ?? resuelto.celdas;
  const trazo = resuelto.patron.base.modo === "espiral" ? resuelto.patron.base.trazo : undefined;
  const dibujo = dibujarPatron({ geometria: resuelto.geometria, tipo, oficialId, celdas: celdasDibujo, extras: resuelto.extras, trazo, espejo, proporcion });
  const animarGlobos = animar && !reducir && dibujo.globos.length <= MAXIMO_ANIMADOS;
  const filas = Math.max(1, celdasDibujo.length);
  const { caja } = dibujo;
  return (
    <svg
      viewBox={`${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`}
      role="img"
      aria-label={etiqueta}
      preserveAspectRatio="xMidYMid meet"
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
        />
      ))}
    </svg>
  );
}

