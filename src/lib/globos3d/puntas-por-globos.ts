import type { PiezaLeida } from "./lectura-foto";
import { MAXIMO_PUNTOS_EJE, proyectar, r3, type Globo, type P } from "./medir-geometria";

/**
 * **El largo de una guirnalda lo dicen sus globos, no el ojo del lector** (`medir-con-detecciones.ts`, caso del dueño «quince-mesa»):
 * el lector cortaba la guirnalda del fondo antes de su último racimo (el dorado de la punta derecha) y la guirnalda armada quedaba
 * más corta que el fondo y con menos dorado. Si después de un extremo del eje sigue una masa de globos detectados, continua (sin
 * huecos de más de `HUECO_EN_DIAMETROS` diámetros entre uno y el siguiente), a los lados del eje (dentro de su alcance) y que no
 * es de otra pieza, el eje se alarga hasta ella: un punto nuevo en la punta, con el grosor del extremo. Puro.
 */

/** Los globos que hace falta encadenar más allá de la punta para alargarla. */
const MINIMO_GLOBOS = 4;
/** El hueco más grande (en diámetros del globo siguiente) que todavía es la misma masa de globos. */
const HUECO_EN_DIAMETROS = 1;
/** Lo que alarga la punta tiene que pasar de esta parte de su grosor (menos es el borde de los globos de la punta). */
const ALARGUE_MINIMO_EN_GROSORES = 0.5;
/** El alcance a los lados del eje, en grosores (el mismo con que se le asignan los globos). */
const ALCANCE_EN_GROSORES = 0.85;

type Guirnalda = Extract<PiezaLeida, { tipo: "guirnalda_organica" }>;
type Punto = Guirnalda["puntos"][number];

const normalizar = (v: P): P => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const entre = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** El punto que alarga la punta `extremo` (0: la primera, 1: la última) hasta la masa de globos que la sigue, o `null`. */
function puntaNueva(p: Guirnalda, extremo: 0 | 1, candidatos: readonly Globo[], aspecto: number): Punto | null {
  const n = p.puntos.length;
  const [punta, previo] = extremo === 0 ? [p.puntos[0]!, p.puntos[1]!] : [p.puntos[n - 1]!, p.puntos[n - 2]!];
  const e: P = { x: punta.x * aspecto, y: punta.y };
  const t = normalizar({ x: e.x - previo.x * aspecto, y: e.y - previo.y });
  const normal: P = { x: -t.y, y: t.x };
  const alcance = punta.grosor * ALCANCE_EN_GROSORES;
  const delante = candidatos
    .map((g) => ({ g, s: (g.x - e.x) * t.x + (g.y - e.y) * t.y, lado: (g.x - e.x) * normal.x + (g.y - e.y) * normal.y }))
    .filter((c) => c.s > 0 && Math.abs(c.lado) <= alcance + c.g.d / 2)
    .sort((a, b) => a.s - b.s);
  let frontera = punta.grosor / 2;
  const cadena: typeof delante = [];
  for (const c of delante) {
    if (c.s - c.g.d / 2 > frontera + HUECO_EN_DIAMETROS * c.g.d) break;
    cadena.push(c);
    frontera = Math.max(frontera, c.s + c.g.d / 2);
  }
  const alargue = frontera - punta.grosor / 2;
  if (cadena.length < MINIMO_GLOBOS || alargue < ALARGUE_MINIMO_EN_GROSORES * punta.grosor) return null;
  const lado = cadena.reduce((s, c) => s + c.lado, 0) / cadena.length;
  return { x: r3(entre((e.x + t.x * alargue + normal.x * lado) / aspecto, -0.2, 1.2)), y: r3(entre(e.y + t.y * alargue + normal.y * lado, -0.2, 1.2)), grosor: punta.grosor };
}

/**
 * Cada guirnalda con sus puntas alargadas hasta los globos que las siguen. `libres` son los globos que no son de ningún fondo, montón ni
 * otra pieza; cada uno cuenta solo para la guirnalda cuyo eje tiene más cerca (no se le roba a la vecina).
 */
export function alargarPorLosGlobos(guirnaldas: readonly Guirnalda[], libres: readonly Globo[], aspecto: number): { guirnaldas: Guirnalda[]; notas: string[] } {
  const ejes = guirnaldas.map((p) => p.puntos.map((q) => ({ x: q.x * aspecto, y: q.y })));
  const masCercana = libres.map((g) => ejes.reduce((mejor, eje, j) => (proyectar(g, eje).d < proyectar(g, ejes[mejor]!).d ? j : mejor), 0));
  const notas: string[] = [];
  const salida = guirnaldas.map((p, j) => {
    const propios = libres.filter((_, k) => masCercana[k] === j);
    const inicio = p.puntos.length < MAXIMO_PUNTOS_EJE ? puntaNueva(p, 0, propios, aspecto) : null;
    const fin = p.puntos.length + (inicio ? 1 : 0) < MAXIMO_PUNTOS_EJE ? puntaNueva(p, 1, propios, aspecto) : null;
    if (!inicio && !fin) return p;
    notas.push(`La guirnalda ${j + 1} sigue más allá de donde la leyó el lector: sus globos detectados la alargan${inicio ? ` al principio hasta x ${inicio.x}` : ""}${fin ? `${inicio ? " y" : ""} al final hasta x ${fin.x}` : ""}.`);
    return { ...p, puntos: [...(inicio ? [inicio] : []), ...p.puntos, ...(fin ? [fin] : [])] };
  });
  return { guirnaldas: salida, notas };
}
