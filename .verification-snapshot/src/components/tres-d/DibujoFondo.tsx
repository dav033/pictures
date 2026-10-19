import { memo } from "react";
import { armarEscenografia, puntosSolido, type ElementoEscenografia, type SolidoEscenografia } from "@/lib/globos3d/escenografia";
import type { Punto2 } from "@/lib/globos3d/trenza";
import { FUENTE_ROTULOS, useFuenteRotulos } from "./fuente-rotulos";
import { AVANCE_LINEA_EM, textoDeMiniatura, type TextoMiniatura } from "./miniatura-rotulo";

type Forma = { s: SolidoEscenografia; pts: Punto2[]; huecos: Punto2[][]; z: number };

/** Envolvente convexa (cadena monótona) de unos puntos. */
function envolvente(puntos: readonly Punto2[]): Punto2[] {
  const p = [...puntos].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const giro = (o: Punto2, a: Punto2, b: Punto2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const mitad = (lista: Punto2[]) => { const h: Punto2[] = []; for (const q of lista) { while (h.length >= 2 && giro(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
  return [...mitad(p), ...mitad([...p].reverse())];
}

const derecho = (s: SolidoEscenografia) => Math.abs(s.ejeX.x - 1) < 1e-6 && Math.abs(s.ejeY.y - 1) < 1e-6;

/** Cada sólido visto de frente: su silueta (la del panel si va derecho, si no la envolvente de sus puntos) y qué tan al fondo está. */
function formasDe(elementos: readonly ElementoEscenografia[]): Forma[] {
  // Lo oculto no se dibuja, salvo el nombre de acrílico (su tablero no se ve, sus letras sí).
  return armarEscenografia(elementos).filter((s) => !s.oculto || s.rotulo).map((s) => {
    const pts3 = puntosSolido(s);
    const z = pts3.reduce((a, p) => a + p.z, 0) / pts3.length;
    if (s.forma === "panel" && derecho(s)) {
      const mover = (p: Punto2): Punto2 => ({ x: p.x + s.origen.x, y: p.y + s.origen.y });
      return { s, pts: s.contorno.map(mover), huecos: s.huecos.map((h) => h.map(mover)), z };
    }
    return { s, pts: envolvente(pts3.map((p) => ({ x: p.x, y: p.y }))), huecos: [], z };
  });
}

type Dibujo = { forma: Forma; d: string; texto?: TextoMiniatura }[];

/** Los dibujos ya hechos por entrada del catálogo: armar 48 siluetas con su envolvente en cada pintada era trabajo tirado (se calculan una vez). */
const DIBUJOS = new Map<string, { dibujo: Dibujo; vista: { x0: number; y0: number; escala: number; ancho: number } }>();

function dibujoDe(id: string, elementos: () => readonly ElementoEscenografia[]) {
  const guardado = DIBUJOS.get(id);
  if (guardado) return guardado;
  const formas = formasDe(elementos());
  const puntos = formas.flatMap((f) => f.pts);
  const x0 = Math.min(...puntos.map((p) => p.x)), x1 = Math.max(...puntos.map((p) => p.x)), y0 = Math.min(...puntos.map((p) => p.y)), y1 = Math.max(...puntos.map((p) => p.y));
  const escala = 52 / Math.max(1, x1 - x0, y1 - y0);
  const px = (x: number) => 4 + (x - x0) * escala + (52 - (x1 - x0) * escala) / 2, py = (y: number) => 56 - (y - y0) * escala;
  const trazo = (c: readonly Punto2[]) => `M${c.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join("L")}Z`;
  const dibujo = [...formas].sort((a, b) => a.z - b.z).map((f) => ({ forma: f, d: f.s.oculto ? "" : [f.pts, ...f.huecos].map(trazo).join(""), texto: textoDeMiniatura(f.s, px, py, escala) }));
  const hecho = { dibujo, vista: { x0, y0, escala, ancho: x1 - x0 } };
  DIBUJOS.set(id, hecho);
  return hecho;
}

/** Dibujo plano del fondo o mueble, de frente y con sus colores (de sus propios elementos), para la tarjeta del panel. */
export const DibujoFondo = memo(function DibujoFondo({ id, elementos }: { id: string; elementos: () => readonly ElementoEscenografia[] }) {
  const { dibujo } = dibujoDe(id, elementos);
  // La letra de los rótulos es la del visor (se baja la primera vez y las miniaturas con texto se vuelven a pintar con ella).
  useFuenteRotulos();
  if (!dibujo.length) return null;
  return (
    <svg viewBox="0 0 60 60" width="52" height="52" aria-hidden>
      {dibujo.map(({ forma, d, texto }, i) => (
        <g key={i}>
          {d && <path d={d} fillRule="evenodd" fill={forma.s.hex} stroke="rgba(0,0,0,.25)" strokeWidth={0.4} />}
          {texto && (
            <text x={texto.x} y={texto.y} textAnchor="middle" fill={texto.color} stroke="rgba(0,0,0,.2)" strokeWidth={0.12} fontFamily={`"${FUENTE_ROTULOS.familia}"`} fontSize={texto.tam}>
              {texto.lineas.map((linea, k) => <tspan key={k} x={texto.x} dy={k === 0 ? `${0.3 - 0.5 * (texto.lineas.length - 1) * AVANCE_LINEA_EM}em` : `${AVANCE_LINEA_EM}em`}>{linea}</tspan>)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
});
