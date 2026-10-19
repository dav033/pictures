import type { SolidoEscenografia } from "@/lib/globos3d/escenografia";
import { altoEnEm, aspectoEstimado, caraDe, colocarRotulo, lineasDeRotulo } from "@/lib/globos3d/rotulos";

/** El texto de un rótulo en una miniatura (SVG): dónde va su centro, el tamaño de la letra, el color y sus líneas (unidades de la miniatura). */
export type TextoMiniatura = { x: number; y: number; tam: number; color: string; lineas: string[] };

/** Cuánto avanza cada línea del texto, en em de la letra (la separación con que lo dibuja el visor). */
export const AVANCE_LINEA_EM = 1.3;

/**
 * El rótulo de un sólido como se ve en una miniatura: con el mismo tamaño y lugar que le da el visor (`colocarRotulo`, con la
 * proporción que sale de lo que avanza la letra de los rótulos), no con un tamaño aparte. `px` y `py` pasan de cm a la miniatura y
 * `escala` es cuántas unidades de la miniatura mide un cm.
 */
export function textoDeMiniatura(s: SolidoEscenografia, px: (xCm: number) => number, py: (yCm: number) => number, escala: number): TextoMiniatura | undefined {
  const r = s.rotulo, cara = s.forma === "cilindro" ? null : caraDe(s);
  if (!r || !cara) return undefined;
  const c = colocarRotulo(cara, r, aspectoEstimado(r.texto));
  return { x: px(s.origen.x + c.xCm), y: py(s.origen.y + c.yCm), tam: (c.altoCm * escala) / altoEnEm(r.texto), color: r.color, lineas: lineasDeRotulo(r.texto) };
}
