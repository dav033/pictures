"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useReducedMotion } from "motion/react";
import type { ArmadoGuirnaldaResuelto } from "@/lib/plan/armado-guirnalda";
import type { ColorLeyenda } from "../patron/leyenda";
import { R } from "../patron/geometria-dibujo";
import { dibujarGuirnalda, type GloboGuirnalda } from "./geometria-guirnalda";
import { cantidadesTexto, colorDeCodigo, formaTexto, metros, NOMBRE_SOPORTE, racimosEnOrden, racimosTexto } from "./leyenda-guirnalda";

type ResueltoDibujo = Pick<ArmadoGuirnaldaResuelto, "armado" | "largo_m" | "largo_cuerda_m" | "racimos" | "relleno" | "remates" | "sueltos" | "leyenda">;

/** El editor lleva un remate a un racimo: con él, cada racimo es un destino (botón o zona de arrastre). */
export type DestinoRemate = {
  /** Qué remate se está moviendo ("Remate 2: R-24 blanco"), para el nombre de cada destino. */
  remate: string;
  onSoltar: (racimo: number) => void;
};

type Props = {
  resuelto: ResueltoDibujo;
  leyenda: readonly ColorLeyenda[];
  /** Texto accesible de la figura (el nombre de la pieza y del armado). */
  etiqueta?: string;
  /** El código de cada globo sobre el globo (la hoja y el editor); el bloque compacto no lo lleva. */
  conCodigos?: boolean;
  /** Con un remate elegido en el editor: los racimos se eligen con el teclado o se sueltan con el puntero. */
  destino?: DestinoRemate | null;
  /** Racimo bajo el puntero mientras se arrastra un remate. */
  resaltado?: number | null;
  /** Al aparecer los destinos (se eligió un remate con el teclado o un toque), el foco va al racimo activo. */
  enfocarDestinos?: boolean;
  className?: string;
  /** Entrada escalonada de izquierda a derecha (se omite con movimiento reducido y al imprimir). */
  animar?: boolean;
};

/**
 * "Guirnalda sobre la mesa. Recta, 3,5 m de largo. 12 cuartetos de 12″,
 * numerados de izquierda a derecha." Lo que dice la figura en una frase.
 */
export function resumenGrafica(resuelto: ResueltoDibujo): string {
  const cuerda = resuelto.largo_cuerda_m !== resuelto.largo_m ? ` (cuerda de ${metros(resuelto.largo_cuerda_m)})` : "";
  return `${NOMBRE_SOPORTE[resuelto.armado.soporte].nombre}. ${formaTexto(resuelto.armado)}, ${metros(resuelto.largo_m)} de largo${cuerda}. ${racimosTexto(resuelto.armado, resuelto.racimos.length)}, numerados de izquierda a derecha.`;
}

function Globo({ globo, color, id, retraso, conCodigo }: { globo: GloboGuirnalda; color: ColorLeyenda; id: string; retraso: number | null; conCodigo: boolean }) {
  const contorno = color.muestra.conBorde || color.numeroClaro;
  const relleno = color.brillo === "multicolor" ? `url(#${id}-multicolor)` : color.hex;
  const texto = color.numeroClaro ? "#fff" : "rgb(0 0 0 / 0.75)";
  // Los de atrás del racimo quedan en sombra, como en la vista del patrón.
  const sombra = globo.papel === "racimo" && globo.z < 1 ? ((1 - globo.z) / 2) * 0.3 : 0;
  const forma = { cx: globo.x, cy: globo.y, rx: globo.r, ry: globo.r * 1.06 };
  const contenido = (
    <>
      <ellipse {...forma} fill={relleno} fillOpacity={color.brillo === "transparente" ? 0.28 : 1} className={contorno ? "stroke-borde" : undefined} strokeWidth={contorno ? 1 : undefined} strokeDasharray={globo.papel === "suelto" ? "3 2" : undefined} vectorEffect="non-scaling-stroke" />
      <ellipse {...forma} fill={`url(#${id}-brillo)`} />
      {sombra > 0.02 && <ellipse {...forma} fill="#000" fillOpacity={sombra} />}
      {conCodigo && globo.r >= 6 && (globo.papel !== "racimo" || globo.z > 0.3) && (
        <text x={globo.x} y={globo.y + globo.r * 0.34} textAnchor="middle" fontSize={globo.r * 0.95} fontWeight={700} fill={texto}>{globo.codigo}</text>
      )}
    </>
  );
  if (retraso === null) return <g>{contenido}</g>;
  return <g className="patron-globo-entra" style={{ animationDelay: `${retraso}s` }}>{contenido}</g>;
}

/**
 * Gráfica numerada del armado de una guirnalda (ADR-0032): los racimos del 1
 * (extremo izquierdo) al último sobre la forma real, con la caída a escala,
 * el relleno entre racimos, los sueltos (borde punteado), los remates junto a
 * su racimo y el soporte (pared, cuerda y anclajes, piso con pesas, mesa u
 * otra pieza). Estática es una figura con su texto alternativo y la lista de
 * racimos en orden de lectura; en el editor, con un remate elegido, cada
 * racimo es un botón de un grupo con foco itinerante (flechas, Inicio, Fin;
 * Enter o Espacio suelta el remate) y una zona donde soltarlo con el puntero.
 */
export function GraficaGuirnalda({ resuelto, leyenda, etiqueta = "Gráfica de la guirnalda", conCodigos = true, destino = null, resaltado = null, enfocarDestinos = false, className = "", animar = true }: Props) {
  const reducir = useReducedMotion();
  const id = `guirnalda-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dibujo = dibujarGuirnalda(resuelto);
  const { caja } = dibujo;
  const animarGlobos = animar && !reducir && dibujo.globos.length <= 240;
  const [activo, setActivo] = useState(0);
  const [enfocado, setEnfocado] = useState<number | null>(null);
  const botones = useRef(new Map<number, SVGGElement>());
  const total = dibujo.racimos.length;
  const activoValido = Math.min(activo, Math.max(0, total - 1));
  const orden = racimosEnOrden(resuelto, leyenda);
  const r = R;

  function mover(destinoIndice: number): void {
    const puesto = (destinoIndice + total) % total;
    setActivo(puesto);
    botones.current.get(puesto)?.focus();
  }

  function teclado(evento: KeyboardEvent<HTMLDivElement>): void {
    if (!destino || !total) return;
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
      mover(total - 1);
    }
  }

  // Con "Mover", el foco salta a los racimos: si no, el lector y el teclado quedaban en el botón y los destinos detrás.
  const conDestino = destino !== null;
  useEffect(() => {
    if (conDestino && enfocarDestinos) botones.current.get(activoValido)?.focus();
  }, [conDestino, enfocarDestinos, activoValido]);

  const registrar = (indice: number) => (nodo: SVGGElement | null) => {
    if (nodo) botones.current.set(indice, nodo);
    else botones.current.delete(indice);
  };

  const retrasoDe = (globo: GloboGuirnalda) => {
    if (!animarGlobos) return null;
    const x = caja.ancho > 0 ? (globo.x - caja.x) / caja.ancho : 0;
    return Math.min(0.8, Math.max(0, x) * 0.8);
  };

  const svg = (
    <svg viewBox={`${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`} aria-hidden={destino ? undefined : true} preserveAspectRatio="xMidYMid meet" shapeRendering="geometricPrecision" className="size-full">
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
      {dibujo.soporte === "pared" && <rect data-soporte="pared" x={caja.x} y={caja.y} width={caja.ancho} height={caja.alto} rx={r * 0.8} className="fill-superficie-2" fillOpacity={0.55} />}
      {dibujo.soporte === "sobre_estructura" && (
        <path data-soporte="sobre_estructura" d={dibujo.tira} fill="none" className="stroke-borde" strokeWidth={r * 2.6} strokeOpacity={0.45} strokeLinecap="round" strokeDasharray={`${r * 0.8} ${r * 0.6}`} />
      )}
      {dibujo.soporte === "colgada" && dibujo.anclajes.map((anclaje, indice) => (
        <line key={`cuerda-${indice}`} data-soporte="colgada" x1={anclaje.x} y1={anclaje.y} x2={anclaje.x} y2={caja.y + r * 0.4} className="stroke-texto-tenue" strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
      ))}
      {dibujo.apoyo && dibujo.soporte === "mesa" && (
        <rect data-soporte="mesa" x={dibujo.apoyo.x1} y={dibujo.apoyo.y} width={dibujo.apoyo.x2 - dibujo.apoyo.x1} height={r * 0.9} rx={r * 0.35} className="fill-superficie-2 stroke-borde" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      )}
      {dibujo.apoyo && dibujo.soporte === "piso" && (
        <g data-soporte="piso">
          <line x1={dibujo.apoyo.x1} y1={dibujo.apoyo.y} x2={dibujo.apoyo.x2} y2={dibujo.apoyo.y} className="stroke-borde" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {[dibujo.apoyo.x1 + r * 1.2, dibujo.apoyo.x2 - r * 1.2].map((x) => (
            <path key={x} d={`M ${x - 4} ${dibujo.apoyo!.y - 7} L ${x + 4} ${dibujo.apoyo!.y - 7} L ${x + 6} ${dibujo.apoyo!.y} L ${x - 6} ${dibujo.apoyo!.y} Z`} className="fill-superficie-2 stroke-borde" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      )}
      <path d={dibujo.tira} fill="none" className="stroke-texto-tenue" strokeWidth={1.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {dibujo.globos.map((globo) => (
        <Globo key={globo.clave} globo={globo} color={colorDeCodigo(leyenda, globo.codigo)} id={id} retraso={retrasoDe(globo)} conCodigo={conCodigos} />
      ))}
      {dibujo.anclajes.map((anclaje, indice) => (
        <circle key={`anclaje-${indice}`} cx={anclaje.x} cy={anclaje.y} r={r * 0.32} className="fill-superficie stroke-texto" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
      {dibujo.racimos.map((racimo) => (
        <g key={`numero-${racimo.numero}`}>
          <circle cx={racimo.etiqueta.x} cy={racimo.etiqueta.y} r={r * 0.62} className="fill-superficie stroke-borde" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <text x={racimo.etiqueta.x} y={racimo.etiqueta.y + r * 0.27} textAnchor="middle" fontSize={r * 0.72} fontWeight={700} className="fill-texto">{racimo.numero}</text>
        </g>
      ))}
      {destino && dibujo.racimos.map((racimo, indice) => {
        const marcado = resaltado === racimo.numero || enfocado === indice;
        const texto = orden[indice]?.texto ?? `Racimo ${racimo.numero}`;
        return (
          <g
            key={`destino-${racimo.numero}`}
            ref={registrar(indice)}
            role="button"
            tabIndex={indice === activoValido ? 0 : -1}
            aria-label={`${texto}. Poner aquí ${destino.remate}`}
            data-racimo={racimo.numero}
            onFocus={() => { setActivo(indice); setEnfocado(indice); }}
            onBlur={() => setEnfocado((actual) => (actual === indice ? null : actual))}
            onClick={() => destino.onSoltar(racimo.numero)}
            onKeyDown={(evento) => {
              if (evento.key === "Enter" || evento.key === " ") {
                evento.preventDefault();
                destino.onSoltar(racimo.numero);
              }
            }}
            className="cursor-pointer outline-none"
          >
            <circle cx={racimo.centro.x} cy={racimo.centro.y} r={racimo.alcance} fill="transparent" className={marcado ? "stroke-acento" : "stroke-transparent"} strokeWidth={marcado ? 2.5 : 1} strokeDasharray={marcado ? undefined : "3 2"} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );

  const texto = (
    <>
      <p>{resumenGrafica(resuelto)}{dibujo.caidaDeMuestra ? " La caída no está declarada: se dibuja una de muestra." : ""}</p>
      <ol aria-label="Racimos de izquierda a derecha">
        {orden.map((racimo) => <li key={racimo.numero}>{racimo.texto}</li>)}
      </ol>
      {resuelto.relleno && <p>Relleno entre racimos: {resuelto.relleno.total} globos chicos, {cantidadesTexto(resuelto.relleno.codigos, leyenda)}.</p>}
      {resuelto.sueltos.length > 0 && <p>Sueltos entre racimos: {cantidadesTexto(resuelto.sueltos, leyenda)}.</p>}
    </>
  );

  if (!destino) {
    return (
      <figure aria-label={etiqueta} data-testid="grafica-guirnalda" data-forma={resuelto.armado.forma} className={`min-w-0 ${className}`}>
        {svg}
        <figcaption className="sr-only">{texto}</figcaption>
      </figure>
    );
  }
  return (
    <div className={`min-w-0 ${className}`} data-testid="grafica-guirnalda" data-forma={resuelto.armado.forma}>
      <div role="group" aria-label={`Racimos de la guirnalda: elige junto a cuál va ${destino.remate}`} onKeyDown={teclado} className="size-full">
        {svg}
      </div>
      <div className="sr-only">{texto}</div>
    </div>
  );
}
