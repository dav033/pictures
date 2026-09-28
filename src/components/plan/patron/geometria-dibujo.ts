import type { FormaGuirnalda } from "@/lib/plan/armado-guirnalda";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";

/**
 * Dónde DIBUJAR cada globo de la rejilla que devuelve Python. Solo geometría
 * de pantalla: las celdas (qué material va en cada globo) llegan resueltas y
 * aquí no se decide ni se cuenta ninguna. El giro por capa (espiral,
 * zig-zag, recto) es el del ADR-0028 §3 y solo cambia el dibujo, nunca el
 * conteo.
 *
 * Un racimo se dibuja pseudo-3D: sus globos rodean el eje de la estructura;
 * los de adelante (z = 1) son más grandes y claros, los de atrás más chicos y
 * oscuros. Puro: sin React.
 */

export type GloboDibujo = {
  clave: string;
  x: number;
  y: number;
  r: number;
  /** Profundidad: 1 adelante, -1 atrás; los centros de flor van encima de todo. */
  z: number;
  material: number;
  fila: number;
  /** `null` para un globo extra (centro de flor). */
  columna: number | null;
};

export type SoporteDibujo = { tipo: "base" | "mesa"; x: number; y: number; ancho: number };

export type Dibujo = {
  caja: { x: number; y: number; ancho: number; alto: number };
  globos: GloboDibujo[];
  soporte: SoporteDibujo | null;
};

export type TrazoDibujo = "espiral" | "zigzag" | "recto";

/**
 * Forma real de una guirnalda con armado (ADR-0032): la curva sobre la que
 * van sus racimos. Sale tal cual del `armado_guirnalda` que resolvió Python;
 * aquí solo se dibuja.
 */
export type CurvaGuirnalda = {
  forma: FormaGuirnalda;
  /** Largo declarado de la pieza (m): el ancho del dibujo. */
  largo_m: number;
  /** Cuánto baja el centro respecto de la recta entre los extremos (m), en las formas que cuelgan. */
  caida_m?: number;
  /** Cuánto SUBE el centro sobre la recta entre los extremos (m): la curva arqueada hacia arriba (decisión 28). */
  arqueo_m?: number;
  /** Altura del extremo derecho menos la del izquierdo (m): negativo si cae hacia la derecha. */
  desnivel_m?: number;
  puntos_de_anclaje?: number;
};

export type EntradaDibujo = {
  geometria: PatronColorResuelto["geometria"];
  tipo: string;
  oficialId?: string;
  celdas: readonly (readonly number[])[];
  extras: readonly { fila: number; material: number }[];
  /** Solo en modo espiral; los demás modos anidan los racimos como franjas rectas. */
  trazo?: TrazoDibujo;
  /** Semiarco a la derecha: la curva se voltea. */
  espejo?: boolean;
  /** Alto / ancho declarado de la estructura, para la forma del arco. */
  proporcion?: number;
  /** Guirnalda con armado: los racimos van sobre su forma real (sin ella, la onda de siempre). */
  guirnalda?: CurvaGuirnalda;
};

export type Punto = { x: number; y: number };
type Eje = { centro: Punto; normal: Punto; escala: number };

/** Radio de un globo, en unidades del dibujo. */
export const R = 10;
/** Distancia del eje del racimo al centro de cada globo. */
export const ANILLO = R * 1.28;
const PASO_COLUMNA = R * 1.22;
const PASO_CURVA = R * 1.18;
/** Muestras con que se mide una curva para repartir los racimos a igual distancia. */
const MUESTRAS_CURVA = 720;

/**
 * Centésimas de unidad: el servidor y el navegador pueden diferir en el último
 * decimal de un seno y React lo tomaría como un error de hidratación.
 */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Giro de la capa `fila` en radianes: 1/(2k) de vuelta es `π / k`. */
function giro(fila: number, globos: number, trazo: TrazoDibujo): number {
  const paso = Math.PI / globos;
  if (trazo === "espiral") return fila * paso;
  if (trazo === "zigzag") {
    const fase = fila % 4;
    return (fase <= 2 ? fase : 4 - fase) * paso;
  }
  return (fila % 2) * paso;
}

/**
 * Posiciones que la capa `fila` giró respecto de la base (medio paso por
 * capa en la espiral). Solo para dibujar la cara de adelante en planos, como
 * la tira del resumen; las celdas y su conteo no cambian.
 */
export function posicionesGiradas(fila: number, globos: number, trazo: TrazoDibujo): number {
  return Math.floor(giro(fila, globos, trazo) / ((2 * Math.PI) / globos) + 1e-9);
}

function globosDeRacimo(fila: number, materiales: readonly number[], eje: Eje, angulo: number): GloboDibujo[] {
  const k = materiales.length;
  return materiales.map((material, columna) => {
    const theta = angulo + (columna + (k === 1 ? 0 : 0.5)) * ((2 * Math.PI) / k);
    const lateral = Math.sin(theta);
    const z = Math.cos(theta);
    return {
      clave: `${fila}:${columna}`,
      x: eje.centro.x + eje.normal.x * ANILLO * eje.escala * lateral,
      // Mirando un poco desde arriba: lo de atrás asoma más alto.
      y: eje.centro.y + eje.normal.y * ANILLO * eje.escala * lateral - (1 - z) * R * 0.2 * eje.escala,
      r: R * eje.escala * (0.8 + 0.1 * (z + 1)),
      z,
      material,
      fila,
      columna,
    };
  });
}

/** Largo de una curva paramétrica medido con `MUESTRAS_CURVA` tramos rectos, y sus puntos. */
function medirCurva(curva: (t: number) => Punto): { puntos: Punto[]; acumulado: number[]; total: number } {
  const puntos = Array.from({ length: MUESTRAS_CURVA + 1 }, (_, indice) => curva(indice / MUESTRAS_CURVA));
  const acumulado = [0];
  for (let indice = 1; indice < puntos.length; indice += 1) {
    const a = puntos[indice - 1]!;
    const b = puntos[indice]!;
    acumulado.push(acumulado[indice - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { puntos, acumulado, total: acumulado[MUESTRAS_CURVA]! };
}

/**
 * Escala con que `repartirEnCurva` lleva la curva al dibujo: los racimos
 * quedan a `PASO_CURVA` uno de otro, así que el dibujo conserva las
 * proporciones de la curva (una caída se ve a escala del largo).
 */
export function escalaEnCurva(curva: (t: number) => Punto, cantidad: number, cerrada: boolean): number {
  const { total } = medirCurva(curva);
  return total > 0 ? (PASO_CURVA * (cerrada ? cantidad : Math.max(1, cantidad - 1))) / total : 1;
}

/** Puntos de una curva paramétrica repartidos a igual distancia, con su normal. */
export function repartirEnCurva(curva: (t: number) => Punto, cantidad: number, cerrada: boolean): Array<{ punto: Punto; normal: Punto; t: number }> {
  const muestras = MUESTRAS_CURVA;
  const { puntos, acumulado, total } = medirCurva(curva);
  const escala = total > 0 ? (PASO_CURVA * (cerrada ? cantidad : Math.max(1, cantidad - 1))) / total : 1;
  let cursor = 0;
  return Array.from({ length: cantidad }, (_, indice) => {
    const fraccion = cantidad === 1 ? 0.5 : cerrada ? indice / cantidad : indice / (cantidad - 1);
    const objetivo = fraccion * total;
    while (cursor < muestras - 1 && acumulado[cursor + 1]! < objetivo) cursor += 1;
    const a = puntos[cursor]!;
    const b = puntos[cursor + 1]!;
    const tramo = acumulado[cursor + 1]! - acumulado[cursor]! || 1;
    const u = Math.min(1, Math.max(0, (objetivo - acumulado[cursor]!) / tramo));
    const largo = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {
      punto: { x: (a.x + (b.x - a.x) * u) * escala, y: (a.y + (b.y - a.y) * u) * escala },
      normal: { x: (b.y - a.y) / largo, y: -(b.x - a.x) / largo },
      t: (cursor + u) / muestras,
    };
  });
}

/**
 * Caída de muestra, como fracción del tramo, para dibujar una forma que
 * cuelga sin `caida_m` declarada (la cuerda de Python es entonces el largo
 * recto): solo para que la forma se reconozca; el dibujo avisa que no es a escala.
 */
export const CAIDA_DE_MUESTRA: Readonly<Record<"u_invertida" | "arco_caido", number>> = { u_invertida: 0.45, arco_caido: 0.25 };
/** Una onda cada tanto de largo y su altura (m) en una guirnalda ondulada. */
const LARGO_ONDA_M = 1.2;
const ALTURA_ONDA_M = 0.18;

/**
 * La curva de una guirnalda con armado, en metros (y hacia abajo), del
 * extremo izquierdo (t = 0) al derecho (t = 1), con `x = t · largo`:
 * - recta: el largo en línea recta;
 * - curva: se arquea hacia arriba sobre la recta entre los extremos. Con
 *   `arqueo_m` (decisión 28) es la parábola que sube `arqueo_m` a mitad de
 *   tramo, a escala del largo (la misma que mide Python, reflejada); sin él,
 *   el arco suave de E6, que no es a escala. La curva que cuelga es el arco caído;
 * - ondulada: sube y baja, una onda cada 1,2 m;
 * - u_invertida: una U invertida cuyos lados bajan `caida_m` (arco de
 *   parábola de ancho `largo`, el mismo con que Python mide la cuerda);
 * - arco_caido: un arco de parábola que baja `caida_m` entre cada par de
 *   anclajes (`puntos_de_anclaje − 1` tramos, como en Python).
 * Con `desnivel_m` (decisión 27) la forma va sobre la recta que une los dos
 * extremos a distinta altura, no sobre la horizontal: el extremo derecho
 * queda `desnivel_m` más alto (más bajo si es negativo) y los anclajes
 * sobre esa recta, como la cuerda que mide Python.
 * Solo geometría de pantalla: el largo de la cuerda y los globos los da Python.
 */
export function curvaGuirnalda(entrada: CurvaGuirnalda): (t: number) => Punto {
  const forma = formaSobreLaHorizontal(entrada);
  const desnivel = Number.isFinite(entrada.desnivel_m) ? entrada.desnivel_m ?? 0 : 0;
  if (!desnivel) return forma;
  // La pantalla crece hacia abajo: un extremo derecho más alto tiene la y menor.
  return (t) => {
    const punto = forma(t);
    return { x: punto.x, y: punto.y - desnivel * t };
  };
}

function formaSobreLaHorizontal({ forma, largo_m, caida_m, arqueo_m, puntos_de_anclaje }: CurvaGuirnalda): (t: number) => Punto {
  const largo = largo_m > 0 ? largo_m : 1;
  switch (forma) {
    case "curva": {
      if (arqueo_m !== undefined && Number.isFinite(arqueo_m) && arqueo_m > 0) {
        // La pantalla crece hacia abajo: arquearse hacia arriba es restar.
        return (t) => {
          const u = 2 * t - 1;
          return { x: t * largo, y: -arqueo_m * (1 - u * u) };
        };
      }
      return (t) => ({ x: t * largo, y: -0.12 * largo * Math.sin(Math.PI * t) });
    }
    case "ondulada": {
      const ondas = Math.max(1, Math.round(largo / LARGO_ONDA_M));
      const altura = Math.min(ALTURA_ONDA_M, 0.06 * largo);
      return (t) => ({ x: t * largo, y: altura * Math.sin(2 * Math.PI * ondas * t) });
    }
    case "u_invertida": {
      const caida = caida_m ?? CAIDA_DE_MUESTRA.u_invertida * largo;
      return (t) => {
        const u = 2 * t - 1;
        return { x: t * largo, y: -caida * (1 - u * u) };
      };
    }
    case "arco_caido": {
      const tramos = Math.max(1, (puntos_de_anclaje ?? 2) - 1);
      const caida = caida_m ?? CAIDA_DE_MUESTRA.arco_caido * (largo / tramos);
      return (t) => {
        const s = Math.min(1, Math.max(0, t)) * tramos;
        const tramo = Math.min(tramos - 1, Math.floor(s));
        const u = 2 * (s - tramo) - 1;
        return { x: t * largo, y: caida * (1 - u * u) };
      };
    }
    default:
      return (t) => ({ x: t * largo, y: 0 });
  }
}

function curvaDe(entrada: EntradaDibujo, filas: number): { curva: (t: number) => Punto; cerrada: boolean; afinar: boolean } {
  if (entrada.oficialId === "aro_circular") {
    // Empieza abajo y sube por la izquierda, como se arma el aro.
    return { curva: (t) => ({ x: Math.cos(Math.PI / 2 + 2 * Math.PI * t), y: Math.sin(Math.PI / 2 + 2 * Math.PI * t) }), cerrada: true, afinar: false };
  }
  if (entrada.tipo === "semiarco") {
    return { curva: (t) => { const phi = Math.PI - t * Math.PI * 0.6; return { x: Math.cos(phi), y: -1.7 * Math.sin(phi) }; }, cerrada: false, afinar: true };
  }
  if (entrada.tipo === "guirnalda" && entrada.guirnalda) {
    return { curva: curvaGuirnalda(entrada.guirnalda), cerrada: false, afinar: false };
  }
  if (entrada.tipo === "guirnalda") {
    const ondas = Math.max(1, Math.round(filas / 16));
    return { curva: (t) => ({ x: t, y: 0.1 * Math.sin(2 * Math.PI * ondas * t) / ondas }), cerrada: false, afinar: false };
  }
  // Arco: media elipse del pie izquierdo al derecho, con la proporción declarada.
  const alto = Math.min(2.6, Math.max(0.8, 2 * (entrada.proporcion ?? 0.85)));
  return { curva: (t) => { const phi = Math.PI * (1 - t); return { x: Math.cos(phi), y: -alto * Math.sin(phi) }; }, cerrada: false, afinar: false };
}

function franjaProfundidad(z: number): number {
  if (z > 1) return 3;
  if (z > 0.35) return 2;
  return z > -0.35 ? 1 : 0;
}

function dibujarRacimos(entrada: EntradaDibujo): { globos: GloboDibujo[]; soporte: SoporteDibujo | null } {
  const filas = entrada.celdas.length;
  const trazo = entrada.trazo ?? "recto";
  const apilada = entrada.tipo === "columna" || entrada.tipo === "centro_mesa";
  const ejes: Eje[] = apilada
    ? Array.from({ length: filas }, (_, fila) => ({ centro: { x: 0, y: -fila * PASO_COLUMNA }, normal: { x: 1, y: 0 }, escala: 1 }))
    : (() => {
      const { curva, cerrada, afinar } = curvaDe(entrada, filas);
      return repartirEnCurva(curva, filas, cerrada).map(({ punto, normal, t }) => ({
        centro: { x: entrada.espejo ? -punto.x : punto.x, y: punto.y },
        normal: { x: entrada.espejo ? -normal.x : normal.x, y: normal.y },
        // Todo semiarco es orgánico: los racimos se afinan hacia la punta.
        escala: afinar ? 1 - 0.32 * t : 1,
      }));
    })();
  const globos = entrada.celdas.flatMap((materiales, fila) => {
    const eje = ejes[fila]!;
    return globosDeRacimo(fila, materiales, eje, giro(fila, Math.max(1, materiales.length), trazo));
  });
  entrada.extras.forEach((extra, indice) => {
    const eje = ejes[extra.fila];
    if (!eje) return;
    globos.push({ clave: `extra:${extra.fila}:${indice}`, x: eje.centro.x, y: eje.centro.y - R * 0.12 * eje.escala, r: R * 0.56 * eje.escala, z: 2, material: extra.material, fila: extra.fila, columna: null });
  });
  // Atrás, costados, adelante y centros de flor; dentro de cada franja la capa
  // de arriba tapa a la de abajo, como se ve una columna un poco desde arriba.
  globos.sort((a, b) => franjaProfundidad(a.z) - franjaProfundidad(b.z) || a.fila - b.fila || a.z - b.z);
  const soporte: SoporteDibujo | null = apilada
    ? { tipo: entrada.tipo === "centro_mesa" ? "mesa" : "base", x: 0, y: R * 1.15, ancho: entrada.tipo === "centro_mesa" ? R * 7.5 : R * 5 }
    : null;
  return { globos, soporte };
}

/** Pared: rejilla al tresbolillo (cada fila impar corrida medio globo), fila 0 arriba. */
function dibujarRejilla(entrada: EntradaDibujo): GloboDibujo[] {
  return entrada.celdas.flatMap((materiales, fila) => materiales.map((material, columna) => ({
    clave: `${fila}:${columna}`,
    x: columna * R * 1.84 + (fila % 2) * R * 0.92,
    y: fila * R * 1.6,
    r: R * 0.98,
    z: 1,
    material,
    fila,
    columna,
  })));
}

export function dibujarPatron(entrada: EntradaDibujo): Dibujo {
  const { globos, soporte } = entrada.geometria === "rejilla" ? { globos: dibujarRejilla(entrada), soporte: null } : dibujarRacimos(entrada);
  if (!globos.length) return { caja: { x: 0, y: 0, ancho: R * 4, alto: R * 4 }, globos, soporte };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const globo of globos) {
    minX = Math.min(minX, globo.x - globo.r);
    maxX = Math.max(maxX, globo.x + globo.r);
    minY = Math.min(minY, globo.y - globo.r * 1.08);
    maxY = Math.max(maxY, globo.y + globo.r * 1.08);
  }
  if (soporte) {
    minX = Math.min(minX, soporte.x - soporte.ancho / 2);
    maxX = Math.max(maxX, soporte.x + soporte.ancho / 2);
    maxY = Math.max(maxY, soporte.y + R * 0.7);
  }
  // Lo justo para el contorno y la sombra: el dibujo llena el hueco que le dan.
  const margen = R * 0.3;
  return {
    caja: { x: redondear(minX - margen), y: redondear(minY - margen), ancho: redondear(maxX - minX + margen * 2), alto: redondear(maxY - minY + margen * 2) },
    globos: globos.map((globo) => ({ ...globo, x: redondear(globo.x), y: redondear(globo.y), r: redondear(globo.r) })),
    soporte,
  };
}
