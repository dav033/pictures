import { labDeRgb, type Lab } from "@/lib/rag/catalog/similitud-color";

/**
 * Los colores que de verdad hay en una zona de la foto: de 2 a 5, con cuánto ocupa cada uno.
 *
 * **En qué se diferencia de lo que ya había.** `dominancia-color.ts` clasifica cada píxel contra una paleta de
 * 26 palabras y descarta lo que queda a más de ΔE 30 de todas: con eso, dos azules distintos de la foto salen
 * los dos como «azul» y un tono que no está en la paleta no sale. Esto no parte de ninguna paleta: agrupa los
 * píxeles por lo que son y después, aparte, se cruzan con el catálogo (`referencia-sempertex.ts`).
 *
 * **El color de cada grupo es el de su banda media de claridad**, descartando el 30 % más claro y el 30 % más
 * oscuro. No es un adorno: el 30 % claro es el reflejo del látex y el oscuro es la sombra y la oclusión entre
 * globos, y promediarlo todo da un color más apagado y más oscuro que el globo. Está medido en
 * `clasificador-decoraciones/docs/fal-estructura-a-imagen.md` §21 y §23: promediando entero, un frambuesa salía
 * a ΔE 33 del pedido; comparando bandas iguales, a ΔE 14 y el tono a 0,2°.
 *
 * Puro y determinista: mismos píxeles, misma paleta. No decodifica imágenes (eso es `decodificar-pixeles.ts`).
 */

export type Pixel = { r: number; g: number; b: number };

export type ColorMedido = {
  /** El color de la banda media del grupo, `#rrggbb`. */
  hex: string;
  /** Parte de la zona que ocupa, de 0 a 1. */
  parte: number;
  pixeles: number;
};

export type PaletaMedida = {
  colores: ColorMedido[];
  /** Píxeles que se midieron (los de la zona, tras el muestreo). */
  pixeles: number;
  avisos: string[];
};

/**
 * Hasta cinco colores por pieza. **No hay mínimo**: una pieza de un solo color devuelve un solo color. Forzar
 * un segundo obligaba a inventar —en un árbol todo de globos dorados, el segundo era su propia sombra— y lo que
 * se quiere saber es qué globos lleva, no en cuántos tonos se reparte su luz.
 */
export const MAX_COLORES = 5;

/** Dos grupos a menos de esto son el mismo color con otra luz, y se juntan. */
const SEPARACION_MINIMA = 12;

/** Un grupo con menos parte que esta no es un color del diseño: es un reflejo, un borde o algo del fondo. */
const PARTE_MINIMA = 0.06;

/** Sin esto no hay nada que medir con fundamento (es el corte que usa la puerta de fidelidad de decoraciones). */
export const PIXELES_MINIMOS = 500;

/** Vueltas del agrupamiento. Con 12 ya no se mueven los centros en las pruebas sobre fotos reales. */
const VUELTAS = 12;

const distancia = (uno: Lab, otro: Lab): number =>
  Math.hypot(uno[0] - otro[0], uno[1] - otro[1], uno[2] - otro[2]);

function hexDeRgb(r: number, g: number, b: number): string {
  const canal = (valor: number) => Math.min(255, Math.max(0, Math.round(valor))).toString(16).padStart(2, "0");
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

/**
 * Centros de partida: los píxeles de claridad en los cuantiles repartidos. Es determinista a propósito —un
 * arranque al azar daría una paleta distinta en cada corrida y nadie podría comparar dos medidas— y reparte los
 * centros por el eje que más separa los colores de una decoración, que es la claridad.
 */
function centrosIniciales(puntos: readonly Lab[], k: number): Lab[] {
  const orden = [...puntos.keys()].sort((a, b) => puntos[a][0] - puntos[b][0]);
  const centros: Lab[] = [];
  for (let i = 0; i < k; i++) {
    const posicion = Math.floor(((i + 0.5) / k) * orden.length);
    centros.push(puntos[orden[Math.min(orden.length - 1, posicion)]]);
  }
  return centros;
}

function agrupar(puntos: readonly Lab[], k: number): number[] {
  let centros = centrosIniciales(puntos, k);
  const asignacion = new Array<number>(puntos.length).fill(0);
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    let movio = false;
    for (let i = 0; i < puntos.length; i++) {
      let mejor = 0;
      let dif = Infinity;
      for (let c = 0; c < centros.length; c++) {
        const d = distancia(puntos[i], centros[c]);
        if (d < dif) {
          dif = d;
          mejor = c;
        }
      }
      if (asignacion[i] !== mejor) {
        asignacion[i] = mejor;
        movio = true;
      }
    }
    const sumas = centros.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < puntos.length; i++) {
      const s = sumas[asignacion[i]];
      s[0] += puntos[i][0];
      s[1] += puntos[i][1];
      s[2] += puntos[i][2];
      s[3]++;
    }
    centros = sumas.map((s, c) => (s[3] === 0 ? centros[c] : ([s[0] / s[3], s[1] / s[3], s[2] / s[3]] as Lab)));
    if (!movio) break;
  }
  return asignacion;
}

/**
 * El color de un grupo: el promedio de su banda media de claridad. Con pocos píxeles se usan todos, porque
 * recortar el 60 % de doce píxeles no deja nada que promediar.
 */
function colorDeCuerpo(pixeles: readonly Pixel[], claridades: readonly number[]): string {
  const indices = [...pixeles.keys()].sort((a, b) => claridades[a] - claridades[b]);
  const desde = indices.length >= 20 ? Math.floor(indices.length * 0.3) : 0;
  const hasta = indices.length >= 20 ? Math.ceil(indices.length * 0.7) : indices.length;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = desde; i < hasta; i++) {
    const p = pixeles[indices[i]];
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const cuantos = Math.max(1, hasta - desde);
  return hexDeRgb(r / cuantos, g / cuantos, b / cuantos);
}

/**
 * De 2 a 5 colores de una zona ya recortada. Se agrupa con el máximo y se juntan los grupos que son el mismo
 * color: así el número de colores lo decide la foto y no un parámetro.
 */
export function paletaMedida(pixeles: readonly Pixel[]): PaletaMedida {
  const avisos: string[] = [];
  if (pixeles.length < PIXELES_MINIMOS) {
    return {
      colores: [],
      pixeles: pixeles.length,
      avisos: ["La pieza se ve demasiado pequeña en la foto para medir su color."],
    };
  }

  const puntos = pixeles.map((p) => labDeRgb(p.r, p.g, p.b));
  const claridades = puntos.map((p) => p[0]);
  const asignacion = agrupar(puntos, MAX_COLORES);

  // Un grupo por centro, con sus píxeles.
  type Grupo = { pixeles: Pixel[]; claridades: number[]; lab: Lab };
  const grupos: Grupo[] = [];
  for (let c = 0; c < MAX_COLORES; c++) {
    const suyos = [...asignacion.keys()].filter((i) => asignacion[i] === c);
    if (suyos.length === 0) continue;
    const suma = suyos.reduce((s, i) => [s[0] + puntos[i][0], s[1] + puntos[i][1], s[2] + puntos[i][2]], [0, 0, 0]);
    grupos.push({
      pixeles: suyos.map((i) => pixeles[i]),
      claridades: suyos.map((i) => claridades[i]),
      lab: [suma[0] / suyos.length, suma[1] / suyos.length, suma[2] / suyos.length],
    });
  }

  // Se juntan los que son el mismo color con otra luz, de los más grandes a los más chicos.
  grupos.sort((a, b) => b.pixeles.length - a.pixeles.length);
  const juntados: Grupo[] = [];
  for (const grupo of grupos) {
    const hermano = juntados.find((otro) => distancia(otro.lab, grupo.lab) < SEPARACION_MINIMA);
    if (hermano) {
      const total = hermano.pixeles.length + grupo.pixeles.length;
      hermano.lab = [
        (hermano.lab[0] * hermano.pixeles.length + grupo.lab[0] * grupo.pixeles.length) / total,
        (hermano.lab[1] * hermano.pixeles.length + grupo.lab[1] * grupo.pixeles.length) / total,
        (hermano.lab[2] * hermano.pixeles.length + grupo.lab[2] * grupo.pixeles.length) / total,
      ];
      hermano.pixeles.push(...grupo.pixeles);
      hermano.claridades.push(...grupo.claridades);
    } else {
      juntados.push(grupo);
    }
  }
  if (juntados.length < grupos.length) {
    const unidos = grupos.length - juntados.length;
    avisos.push(
      unidos === 1
        ? "Un tono era el mismo color con otra luz y se juntó con el suyo."
        : `${unidos} tonos eran el mismo color con otra luz y se juntaron con el suyo.`,
    );
  }

  juntados.sort((a, b) => b.pixeles.length - a.pixeles.length);
  const total = pixeles.length;
  const colores: ColorMedido[] = [];
  let descartados = 0;
  for (const grupo of juntados) {
    if (colores.length >= MAX_COLORES) break;
    const parte = grupo.pixeles.length / total;
    // Lo que no llega a la parte mínima no es un color del diseño: es un reflejo, un borde o algo del fondo.
    if (parte < PARTE_MINIMA) {
      descartados++;
      continue;
    }
    colores.push({
      hex: colorDeCuerpo(grupo.pixeles, grupo.claridades),
      parte: Math.round(parte * 1e4) / 1e4,
      pixeles: grupo.pixeles.length,
    });
  }
  if (descartados > 0) {
    const minimo = Math.round(PARTE_MINIMA * 100);
    avisos.push(
      descartados === 1
        ? `Se dejó fuera un color que ocupaba menos del ${minimo} % de la pieza (un reflejo, un borde o parte del fondo).`
        : `Se dejaron fuera ${descartados} colores que ocupaban menos del ${minimo} % de la pieza (reflejos, bordes o fondo).`,
    );
  }

  return { colores, pixeles: total, avisos };
}
