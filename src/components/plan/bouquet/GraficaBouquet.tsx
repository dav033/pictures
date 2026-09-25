"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useReducedMotion } from "motion/react";
import type { ColorLeyenda } from "../patron/leyenda";
import { mismaPosicion, type Posicion } from "./borrador-armado";
import { colorDeCodigo, ETIQUETA_DISPOSICION, NOMBRE_ROL, unidadesTexto } from "./leyenda-bouquet";
import { dibujarBouquet, type EntradaDibujoBouquet, type GloboBouquet } from "./geometria-bouquet";

type Props = {
  resuelto: EntradaDibujoBouquet;
  leyenda: readonly ColorLeyenda[];
  /** Globos marcados en el editor (el primero del intercambio). */
  seleccion?: readonly Posicion[];
  /** Con él, cada globo es un botón: tocar uno y luego otro los intercambia. */
  onSeleccionar?: (posicion: Posicion) => void;
  /** Texto accesible de la figura estática. */
  etiqueta?: string;
  className?: string;
  /** Entrada escalonada desde la base (se omite con movimiento reducido). */
  animar?: boolean;
};

/** "Nivel 1 (base): 1 trío de R-12 blanco (1), R-12 rosado (2), R-12 blanco (1)". Para el lector de pantalla. */
export function describirArmado(resuelto: EntradaDibujoBouquet, leyenda: readonly ColorLeyenda[]): string[] {
  const nombre = (codigo: number) => `${colorDeCodigo(leyenda, codigo).etiqueta} (${codigo})`;
  const lineas = resuelto.niveles.map((nivel, indice) => `Nivel ${indice + 1} (${NOMBRE_ROL[nivel.rol]}): ${unidadesTexto(nivel.cantidad, nivel.unidad)} de ${nivel.codigos.map(nombre).join(", ")}`);
  if (resuelto.remate.length) lineas.push(`Remate: ${resuelto.remate.map(nombre).join(", ")}`);
  if (resuelto.numero) lineas.push(`Números: ${resuelto.numero.codigos.map(nombre).join(", ")}, ${ETIQUETA_DISPOSICION[resuelto.numero.disposicion].toLowerCase()}`);
  if (resuelto.grupos > 1) lineas.push(`${resuelto.grupos} bouquets iguales`);
  return lineas;
}

/** Nombre de un globo para el botón: "Nivel 2, globo 3: R-12 rosado (2)". */
function nombreGlobo(globo: GloboBouquet, leyenda: readonly ColorLeyenda[]): string {
  const color = `${colorDeCodigo(leyenda, globo.codigo).etiqueta} (${globo.codigo})`;
  const posicion = globo.posicion;
  if ("digito" in posicion) return `Número ${posicion.digito + 1}: ${color}`;
  if ("remate" in posicion) return `Remate ${posicion.remate + 1}: ${color}`;
  return `Nivel ${posicion.nivel + 1}, unidad ${posicion.unidad + 1}, globo ${posicion.globo + 1}: ${color}`;
}

function Pesa({ x, y }: { x: number; y: number }) {
  const medio = 8;
  return <path d={`M ${x - medio * 0.6} ${y - 6} L ${x + medio * 0.6} ${y - 6} L ${x + medio} ${y + 6} L ${x - medio} ${y + 6} Z`} className="fill-superficie-2 stroke-borde" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
}

/**
 * Un globo: el color de catálogo (`hex` de la leyenda) con su número al
 * centro; un número es un rectángulo redondeado con la cifra. Entra con una
 * animación CSS (`patron-globo-entra`), sin componente animado por globo.
 */
function Globo({ globo, color, id, retraso, elegido, enfocado }: { globo: GloboBouquet; color: ColorLeyenda; id: string; retraso: number | null; elegido: boolean; enfocado: boolean }) {
  const contorno = color.muestra.conBorde || color.numeroClaro;
  const relleno = color.brillo === "multicolor" ? `url(#${id}-multicolor)` : color.hex;
  const texto = color.numeroClaro ? "#fff" : "rgb(0 0 0 / 0.75)";
  const numero = globo.forma === "numero" ? (
    <>
      <rect x={globo.x - globo.r * 0.8} y={globo.y - globo.r} width={globo.r * 1.6} height={globo.r * 2} rx={globo.r * 0.35} fill={relleno} fillOpacity={color.brillo === "transparente" ? 0.28 : 1} className={contorno ? "stroke-borde" : undefined} strokeWidth={contorno ? 1 : undefined} vectorEffect="non-scaling-stroke" />
      <rect x={globo.x - globo.r * 0.8} y={globo.y - globo.r} width={globo.r * 1.6} height={globo.r * 2} rx={globo.r * 0.35} fill={`url(#${id}-brillo)`} />
      <text x={globo.x} y={globo.y - globo.r * 0.05} textAnchor="middle" fontSize={globo.r * 1.1} fontWeight={700} fill={texto} style={{ paintOrder: "stroke" }}>{globo.digito ?? "#"}</text>
      <text x={globo.x} y={globo.y + globo.r * 0.72} textAnchor="middle" fontSize={globo.r * 0.55} fontWeight={600} fill={texto}>{globo.codigo}</text>
    </>
  ) : (
    <>
      <ellipse cx={globo.x} cy={globo.y} rx={globo.r} ry={globo.r * 1.06} fill={relleno} fillOpacity={color.brillo === "transparente" ? 0.28 : 1} className={contorno ? "stroke-borde" : undefined} strokeWidth={contorno ? 1 : undefined} vectorEffect="non-scaling-stroke" />
      <ellipse cx={globo.x} cy={globo.y} rx={globo.r} ry={globo.r * 1.06} fill={`url(#${id}-brillo)`} />
      <text x={globo.x} y={globo.y + globo.r * 0.36} textAnchor="middle" fontSize={globo.r} fontWeight={700} fill={texto}>{globo.digito ?? globo.codigo}</text>
      {globo.digito && <text x={globo.x} y={globo.y + globo.r * 0.85} textAnchor="middle" fontSize={globo.r * 0.45} fontWeight={600} fill={texto}>{globo.codigo}</text>}
    </>
  );
  const anillo = (elegido || enfocado) && (
    <ellipse cx={globo.x} cy={globo.y} rx={Math.max(globo.r, globo.forma === "numero" ? globo.r * 0.95 : globo.r) + 3} ry={globo.r * 1.06 + 3} fill="none" className="stroke-acento" strokeWidth={elegido ? 2.5 : 1.5} strokeDasharray={elegido ? undefined : "3 2"} vectorEffect="non-scaling-stroke" />
  );
  const contenido = <>{anillo}{numero}</>;
  if (retraso === null) return <g>{contenido}</g>;
  return <g className="patron-globo-entra" style={{ animationDelay: `${retraso}s` }}>{contenido}</g>;
}

/**
 * Gráfica numerada por niveles de un bouquet: el nivel 1 abajo, cada unidad
 * como un racimo apretado, el remate arriba y los números donde van. Estática
 * en el bloque y en la hoja (una figura con su texto); en el editor cada globo
 * es un botón de un grupo con foco itinerante: flechas para moverse, Enter o
 * Espacio para elegir; el segundo elegido se intercambia con el primero.
 */
export function GraficaBouquet({ resuelto, leyenda, seleccion = [], onSeleccionar, etiqueta = "Gráfica del bouquet", className = "", animar = true }: Props) {
  const reducir = useReducedMotion();
  const id = `bouquet-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dibujo = dibujarBouquet(resuelto);
  const animarGlobos = animar && !reducir;
  const { caja } = dibujo;
  const elegibles = dibujo.globos.filter((globo) => globo.orden !== null).sort((a, b) => a.orden! - b.orden!);
  const [activo, setActivo] = useState(0);
  const [enfocado, setEnfocado] = useState<number | null>(null);
  const botones = useRef(new Map<number, SVGGElement>());
  const editable = Boolean(onSeleccionar);
  const activoValido = Math.min(activo, Math.max(0, elegibles.length - 1));
  const filas = Math.max(1, resuelto.niveles.length + 1);
  const retrasoDe = (globo: GloboBouquet) => {
    if (!animarGlobos) return null;
    const nivel = "nivel" in globo.posicion ? globo.posicion.nivel : resuelto.niveles.length;
    return Math.min(0.8, (nivel / filas) * 0.8);
  };

  function mover(destino: number): void {
    const puesto = (destino + elegibles.length) % elegibles.length;
    setActivo(puesto);
    botones.current.get(puesto)?.focus();
  }

  function teclado(evento: KeyboardEvent<HTMLDivElement>): void {
    if (!elegibles.length) return;
    const pasos: Record<string, number | undefined> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const paso = pasos[evento.key];
    if (paso !== undefined) {
      evento.preventDefault();
      mover(activoValido + paso);
    } else if (evento.key === "Home") {
      evento.preventDefault();
      mover(0);
    } else if (evento.key === "End") {
      evento.preventDefault();
      mover(elegibles.length - 1);
    }
  }

  const registrar = (orden: number) => (nodo: SVGGElement | null) => {
    if (nodo) botones.current.set(orden, nodo);
    else botones.current.delete(orden);
  };

  const svg = (
    <svg viewBox={`${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`} aria-hidden={editable ? undefined : true} preserveAspectRatio="xMidYMid meet" shapeRendering="geometricPrecision" className={editable ? "size-full" : className}>
      <defs>
        <radialGradient id={`${id}-brillo`} cx="34%" cy="28%" r="58%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-multicolor`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d32f2f" />
          <stop offset="30%" stopColor="#f5d33a" />
          <stop offset="55%" stopColor="#2e9d57" />
          <stop offset="80%" stopColor="#1f4fbf" />
          <stop offset="100%" stopColor="#7b3fa0" />
        </linearGradient>
      </defs>
      <g className="stroke-texto-tenue" strokeWidth={dibujo.soporte === "helio" ? 0.8 : 1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke">
        {dibujo.lineas.map((linea, indice) => <line key={indice} x1={linea.x1} y1={linea.y1} x2={linea.x2} y2={linea.y2} vectorEffect="non-scaling-stroke" />)}
      </g>
      {dibujo.bases.map((base, indice) => <rect key={indice} x={base.x - base.ancho / 2} y={base.y} width={base.ancho} height={9} rx={4} className="fill-superficie-2 stroke-borde" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      {dibujo.pesas.map((pesa, indice) => <Pesa key={indice} x={pesa.x} y={pesa.y} />)}
      {dibujo.globos.map((globo) => {
        const color = colorDeCodigo(leyenda, globo.codigo);
        const elegido = seleccion.some((posicion) => mismaPosicion(posicion, globo.posicion));
        const dibujado = <Globo globo={globo} color={color} id={id} retraso={retrasoDe(globo)} elegido={elegido} enfocado={enfocado !== null && enfocado === globo.orden} />;
        if (!editable || globo.orden === null) return <g key={globo.clave}>{dibujado}</g>;
        const orden = globo.orden;
        return (
          <g
            key={globo.clave}
            ref={registrar(orden)}
            role="button"
            tabIndex={orden === activoValido ? 0 : -1}
            aria-label={nombreGlobo(globo, leyenda)}
            aria-pressed={elegido}
            onFocus={() => { setActivo(orden); setEnfocado(orden); }}
            onBlur={() => setEnfocado((actual) => (actual === orden ? null : actual))}
            onClick={() => onSeleccionar?.(globo.posicion)}
            onKeyDown={(evento) => {
              if (evento.key === "Enter" || evento.key === " ") {
                evento.preventDefault();
                onSeleccionar?.(globo.posicion);
              }
            }}
            className="cursor-pointer outline-none"
          >
            {dibujado}
          </g>
        );
      })}
    </svg>
  );

  if (!editable) {
    return (
      <figure aria-label={etiqueta} className={className}>
        {svg}
        <figcaption className="sr-only">{describirArmado(resuelto, leyenda).join(". ")}.</figcaption>
      </figure>
    );
  }
  return (
    <div role="group" aria-label="Gráfica del bouquet: elige un globo y luego otro para intercambiarlos" onKeyDown={teclado} className={`min-w-0 ${className}`}>
      {svg}
    </div>
  );
}
