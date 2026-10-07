"use client";

import { useId, useState } from "react";
import { acabadoVisual, type AcabadoGlobo, type AcabadoVisual } from "./color-globo";

/**
 * Un globo dibujado en SVG con su color y su acabado, para que el cliente vea el globo y no un punto de color.
 * Solo presentación: no decide nada del plan ni de la compra.
 *
 *   <GloboMiniatura hex="#c0c0c0" acabado="reflex" pulgadas={12} tamano={28} titulo="plateado" />
 *
 * - `tamano`: lado en px de la caja (cuadrada).
 * - `pulgadas`: opcional; escala el globo DENTRO de la caja (un 5″ se ve algo menor que un 18″).
 * - `titulo`: nombre accesible; sin él, el dibujo es decorativo (aria-hidden).
 * - `foto`: foto real del producto (catálogo); si no carga, se dibuja el SVG.
 */
export { acabadoVisual, type AcabadoGlobo, type AcabadoVisual };

type Rgb = { r: number; g: number; b: number };

const GRIS: Rgb = { r: 156, g: 163, b: 175 };

function leerHex(hex: string | null | undefined): Rgb {
  const limpio = (hex ?? "").trim().replace(/^#/, "");
  const largo = /^[0-9a-f]{3}$/i.test(limpio) ? limpio.split("").map((c) => c + c).join("") : limpio;
  if (!/^[0-9a-f]{6}$/i.test(largo)) return GRIS;
  const n = Number.parseInt(largo, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const aHex = ({ r, g, b }: Rgb): string => `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** Mezcla con blanco (t > 0) o con negro (t < 0). */
function tono(rgb: Rgb, t: number): string {
  const destino = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  return aHex({ r: rgb.r + (destino - rgb.r) * k, g: rgb.g + (destino - rgb.g) * k, b: rgb.b + (destino - rgb.b) * k });
}

/** Luminancia relativa (0 negro, 1 blanco). */
function luminancia({ r, g, b }: Rgb): number {
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Satura un color (para el neón): aleja cada canal del gris medio. */
function saturado(rgb: Rgb, k: number): string {
  const media = (rgb.r + rgb.g + rgb.b) / 3;
  return aHex({ r: media + (rgb.r - media) * k, g: media + (rgb.g - media) * k, b: media + (rgb.b - media) * k });
}

/** Escala dentro de la caja según las pulgadas: 5″ ≈ 0,69 · 12″ ≈ 0,83 · 18″ ≈ 0,89 · 36″ = 1. */
function escalaPulgadas(pulgadas: number | null | undefined): number {
  if (!pulgadas || !Number.isFinite(pulgadas) || pulgadas <= 0) return 1;
  const t = Math.min(1, Math.max(0, Math.log(pulgadas / 4) / Math.log(9)));
  return 0.66 + 0.34 * t;
}

// Cuerpo del globo (viewBox 100×100): algo más ancho arriba, cuello al centro abajo.
const CUERPO = "M50 3C70.5 3 83.5 19.5 83.5 39.5C83.5 60.5 66.5 77 53 81L47 81C33.5 77 16.5 60.5 16.5 39.5C16.5 19.5 29.5 3 50 3Z";
const NUDO = "M46.6 80.4L53.4 80.4L55.4 86.2Q50 84.4 44.6 86.2Z";
const CUERDA = "M50 85.8C47.2 89 52.8 91.6 50 95S48.6 98.6 50 100";

type Props = {
  hex: string;
  acabado?: AcabadoGlobo | string | null;
  pulgadas?: number | null;
  /** Lado de la caja en px. */
  tamano?: number;
  titulo?: string;
  /** Foto real del producto; si falla, se dibuja el SVG. */
  foto?: string | null;
  className?: string;
};

export function GloboMiniatura({ hex, acabado, pulgadas, tamano = 28, titulo, foto, className = "" }: Props) {
  const [fotoRota, setFotoRota] = useState(false);
  if (foto && !fotoRota) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- foto del catálogo (cdn.shopify.com) a tamaño de miniatura
      <img
        src={foto}
        alt={titulo ?? ""}
        aria-hidden={titulo ? undefined : true}
        width={tamano}
        height={tamano}
        loading="lazy"
        decoding="async"
        onError={() => setFotoRota(true)}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: tamano, height: tamano }}
      />
    );
  }
  return <GloboSvg hex={hex} acabado={acabado ?? null} pulgadas={pulgadas ?? null} tamano={tamano} titulo={titulo} className={className} />;
}

/**
 * El globo dentro de una baldosa redondeada, como la miniatura de un producto: con foto, fondo blanco (las fotos
 * del catálogo vienen sobre blanco); sin foto, un halo suave de su color detrás del dibujo.
 */
export function BaldosaGlobo({ hex, acabado, pulgadas, foto, titulo, tamano = 52, className = "" }: Omit<Props, "tamano"> & { tamano?: number }) {
  const [fotoRota, setFotoRota] = useState(false);
  const conFoto = Boolean(foto) && !fotoRota;
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-xl ring-1 ring-inset ${conFoto ? "bg-white ring-black/5" : "bg-superficie-2 ring-borde-suave"} ${className}`}
      style={{ width: tamano, height: tamano, ...(conFoto ? {} : { backgroundImage: `radial-gradient(circle at 50% 42%, ${hex}38 0%, transparent 68%)` }) }}
    >
      {conFoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto del catálogo (cdn.shopify.com) a tamaño de miniatura
        <img
          src={foto ?? undefined}
          alt={titulo ?? ""}
          aria-hidden={titulo ? undefined : true}
          width={tamano}
          height={tamano}
          loading="lazy"
          decoding="async"
          onError={() => setFotoRota(true)}
          className="size-full object-contain p-0.5"
        />
      ) : (
        <GloboSvg hex={hex} acabado={acabado ?? null} pulgadas={pulgadas ?? null} tamano={Math.round(tamano * 0.82)} titulo={titulo} className="" />
      )}
    </span>
  );
}

function GloboSvg({ hex, acabado, pulgadas, tamano, titulo, className }: { hex: string; acabado: string | null; pulgadas: number | null; tamano: number; titulo: string | undefined; className: string }) {
  const crudo = useId();
  const id = `g${crudo.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const visual = acabadoVisual(acabado);
  const rgb = leerHex(hex);
  const lum = luminancia(rgb);
  const claro = lum > 0.72;
  const escala = escalaPulgadas(pulgadas);
  const transformar = escala === 1 ? undefined : `translate(50 52) scale(${escala.toFixed(3)}) translate(-50 -52)`;
  const nudo = visual === "cristal" ? tono(rgb, claro ? -0.35 : -0.1) : tono(rgb, -0.22);
  // Contorno: los globos claros se pierden sobre fondo blanco; el cristal SIEMPRE lleva contorno.
  const contorno = visual === "cristal" ? (claro ? "#94a3b8" : tono(rgb, -0.1)) : claro ? "rgb(0 0 0 / 0.14)" : "none";

  return (
    <svg
      viewBox="0 0 100 100"
      width={tamano}
      height={tamano}
      role={titulo ? "img" : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
      focusable="false"
      className={`shrink-0 overflow-visible ${className}`}
    >
      {titulo && <title>{titulo}</title>}
      <defs>
        {visual === "mate" && (
          <radialGradient id={`${id}-c`} cx="0.36" cy="0.3" r="0.78">
            <stop offset="0" stopColor={tono(rgb, claro ? 0.6 : 0.32)} />
            <stop offset="0.5" stopColor={aHex(rgb)} />
            <stop offset="1" stopColor={tono(rgb, claro ? -0.16 : -0.32)} />
          </radialGradient>
        )}
        {visual === "perlado" && (
          <>
            <radialGradient id={`${id}-c`} cx="0.36" cy="0.3" r="0.8">
              <stop offset="0" stopColor={tono(rgb, 0.62)} />
              <stop offset="0.45" stopColor={tono(rgb, 0.12)} />
              <stop offset="1" stopColor={tono(rgb, claro ? -0.14 : -0.24)} />
            </radialGradient>
            <linearGradient id={`${id}-n`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="0.38" stopColor="#ffe3f1" stopOpacity="0.16" />
              <stop offset="0.66" stopColor="#d9ecff" stopOpacity="0.2" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </>
        )}
        {visual === "espejo" && (
          <>
            <linearGradient id={`${id}-c`} x1="0.08" y1="0" x2="0.92" y2="1">
              <stop offset="0" stopColor={tono(rgb, -0.42)} />
              <stop offset="0.16" stopColor={tono(rgb, 0.72)} />
              <stop offset="0.3" stopColor={tono(rgb, 0.08)} />
              <stop offset="0.5" stopColor={tono(rgb, -0.5)} />
              <stop offset="0.66" stopColor={tono(rgb, 0.18)} />
              <stop offset="0.8" stopColor={tono(rgb, 0.55)} />
              <stop offset="1" stopColor={tono(rgb, -0.45)} />
            </linearGradient>
            <radialGradient id={`${id}-s`} cx="0.5" cy="0.45" r="0.6">
              <stop offset="0.62" stopColor="#000000" stopOpacity="0" />
              <stop offset="1" stopColor="#000000" stopOpacity="0.38" />
            </radialGradient>
          </>
        )}
        {visual === "cristal" && (
          <radialGradient id={`${id}-c`} cx="0.4" cy="0.34" r="0.75">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="0.6" stopColor={aHex(rgb)} stopOpacity={claro ? 0.1 : 0.22} />
            <stop offset="1" stopColor={claro ? "#94a3b8" : aHex(rgb)} stopOpacity={claro ? 0.28 : 0.45} />
          </radialGradient>
        )}
        {visual === "neon" && (
          <>
            <radialGradient id={`${id}-c`} cx="0.38" cy="0.32" r="0.78">
              <stop offset="0" stopColor={tono(leerHex(saturado(rgb, 1.35)), 0.38)} />
              <stop offset="0.55" stopColor={saturado(rgb, 1.35)} />
              <stop offset="1" stopColor={tono(leerHex(saturado(rgb, 1.35)), -0.18)} />
            </radialGradient>
            <filter id={`${id}-h`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </>
        )}
        <filter id={`${id}-b`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={visual === "perlado" ? 2.4 : 1.3} />
        </filter>
      </defs>

      <g transform={transformar}>
        <path d={CUERDA} fill="none" stroke="#9ca3af" strokeOpacity="0.7" strokeWidth="1.3" strokeLinecap="round" />
        {visual === "neon" && <path d={CUERPO} fill={saturado(rgb, 1.35)} opacity="0.65" filter={`url(#${id}-h)`} />}
        <path d={NUDO} fill={nudo} />
        <path d={CUERPO} fill={`url(#${id}-c)`} stroke={contorno} strokeWidth={visual === "cristal" ? 1.8 : 1} />
        {visual === "perlado" && <path d={CUERPO} fill={`url(#${id}-n)`} />}
        {visual === "espejo" && <path d={CUERPO} fill={`url(#${id}-s)`} />}

        {/* Brillos: el principal arriba a la izquierda y, según el acabado, reflejos secundarios. */}
        {visual === "espejo" ? (
          <>
            <ellipse cx="35" cy="21" rx="10.5" ry="5" transform="rotate(-38 35 21)" fill="#ffffff" opacity="0.95" />
            <circle cx="27.5" cy="33" r="2.4" fill="#ffffff" opacity="0.85" />
            <path d="M70 58C66 68 59 74 52 77" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="64" cy="14" r="1.6" fill="#ffffff" opacity="0.7" />
          </>
        ) : visual === "cristal" ? (
          <>
            <path d="M27 34C27.5 22 35 12.5 46 10.5" fill="none" stroke="#ffffff" strokeOpacity="0.95" strokeWidth="3.4" strokeLinecap="round" />
            <circle cx="27" cy="41" r="1.8" fill="#ffffff" opacity="0.9" />
            <path d="M74 50C72 61 65 70 57 74" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.8" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse
              cx="36"
              cy="24"
              rx={visual === "perlado" ? 13 : 9.5}
              ry={visual === "perlado" ? 8 : 5.5}
              transform="rotate(-35 36 24)"
              fill="#ffffff"
              opacity={visual === "perlado" ? 0.7 : visual === "neon" ? 0.55 : claro ? 0.75 : 0.42}
              filter={`url(#${id}-b)`}
            />
            <circle cx="29" cy="35" r={visual === "perlado" ? 2.4 : 1.9} fill="#ffffff" opacity={visual === "perlado" ? 0.55 : 0.32} />
          </>
        )}
      </g>
    </svg>
  );
}
