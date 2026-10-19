/**
 * El croquis de una pieza detectada, usado como **zona de muestreo de color**.
 *
 * Una caja de detección no es la pieza: la caja de un arco contiene la pared, el suelo y la mesa que hay bajo
 * el arco, y medir el color ahí mezcla el fondo con los globos. El croquis recorta, dentro de la caja, la forma
 * que de verdad ocupa ese tipo de estructura: un anillo para el arco, una franja vertical para la columna, una
 * banda para la guirnalda.
 *
 * **Qué es y qué no es.** Es una forma geométrica por tipo, no una segmentación: no sabe dónde acaba un globo.
 * Su trabajo es quitar fondo, no dibujar la pieza — para dibujarla están los motores de
 * `clasificador-decoraciones`, que necesitan la forma y las medidas reales, y eso una detección no las da. Por
 * eso es aproximado por diseño y deja fuera lo que se sale del contorno típico (los globos salientes de un arco
 * orgánico, por ejemplo).
 *
 * **Las coordenadas son las de la caja, no las de la foto**: `u` de 0 (izquierda) a 1 (derecha) y `v` de 0
 * (arriba) a 1 (abajo), dentro de la caja de la pieza. Así la forma se estira con la caja, que es lo que se
 * quiere: un arco ancho y bajo sigue siendo un arco.
 *
 * Puro: sin píxeles, sin `sharp` y sin red. Quien mide los píxeles es `dominancia-color.ts`.
 */

/** Los tipos de estructura del plan, más las estructuras oficiales que merecen una forma propia. */
export type ClaveZona = string;

export type Zona = {
  /** Con qué forma se recortó, para poder diagnosticar una medida rara. */
  forma: string;
  /** ¿Está este punto de la caja dentro del croquis? `u` y `v` van de 0 a 1 dentro de la caja. */
  dentro: (u: number, v: number) => boolean;
  /**
   * Parte de la caja que ocupa la forma, estimada por muestreo. Sirve para avisar: una zona que se queda con
   * el 8 % de una caja pequeña puede no tener píxeles suficientes para medir nada.
   */
  parteDeLaCaja: number;
};

/**
 * Margen que se recorta en todos los bordes de la caja. Las cajas de detección vienen holgadas y el borde es
 * justo donde entra el fondo.
 */
const MARGEN = 0.04;

/** Grosor de la banda de globos de un arco, en partes del radio de su caja. Un arco de cuartetos es grueso. */
const GROSOR_ARCO = 0.3;

const dentroDelMargen = (u: number, v: number): boolean =>
  u >= MARGEN && u <= 1 - MARGEN && v >= MARGEN && v <= 1 - MARGEN;

/**
 * Anillo alrededor de la media elipse que va de una pata a la otra pasando por la cima. Se mide con la elipse
 * implícita (`X² + Y² = 1`) y no con una altura por columna, porque junto a las patas el arco es vertical y una
 * función de `u` se rompe ahí.
 */
function anilloDeArco(grosor: number): (u: number, v: number) => boolean {
  return (u, v) => {
    if (!dentroDelMargen(u, v)) return false;
    const x = 2 * u - 1;
    const y = 1 - v;
    if (y < 0) return false;
    return Math.abs(Math.hypot(x, y) - 1) <= grosor;
  };
}

/** Franja vertical centrada: lo que ocupa una columna dentro de su caja, sin el suelo ni el aire de los lados. */
function franjaVertical(ancho: number, centro = 0.5): (u: number, v: number) => boolean {
  return (u, v) => dentroDelMargen(u, v) && Math.abs(2 * (u - centro)) <= ancho;
}

/** Banda horizontal con una caída suave al centro: una guirnalda cuelga aunque su caja sea un rectángulo. */
function bandaHorizontal(grosor: number, caida: number): (u: number, v: number) => boolean {
  return (u, v) => {
    if (!dentroDelMargen(u, v)) return false;
    const centro = 0.5 + caida * (4 * u * (1 - u) - 0.5);
    return Math.abs(v - centro) <= grosor / 2;
  };
}

/** Elipse inscrita, opcionalmente solo en la parte de arriba de la caja (un bouquet no llega al suelo). */
function elipse(hasta: number): (u: number, v: number) => boolean {
  return (u, v) => {
    if (!dentroDelMargen(u, v)) return false;
    if (v > hasta) return false;
    const x = 2 * u - 1;
    const y = (2 * v) / hasta - 1;
    return Math.hypot(x, y) <= 1;
  };
}

/** Anillo centrado: el aro de globos, que es hueco por dentro. */
function anilloCircular(grosor: number): (u: number, v: number) => boolean {
  return (u, v) => {
    if (!dentroDelMargen(u, v)) return false;
    const r = Math.hypot(2 * u - 1, 2 * v - 1);
    return r <= 1 && r >= 1 - grosor;
  };
}

/** Toda la caja menos el margen: para una pared o un fondo, que sí llenan su caja. */
const cajaEntera = (u: number, v: number): boolean => dentroDelMargen(u, v);

/**
 * La forma de cada tipo. Las claves son los tipos del plan (`TIPOS_ESTRUCTURA` de `composicion.ts`) y los ids
 * de estructura oficial que cambian la forma (`estructuras-oficiales.ts`); el id oficial gana cuando existe.
 */
const FORMAS: Readonly<Record<string, { forma: string; dentro: (u: number, v: number) => boolean }>> = {
  // Tipos del plan.
  arco: { forma: "anillo de arco", dentro: anilloDeArco(GROSOR_ARCO) },
  semiarco: { forma: "anillo de arco (parcial)", dentro: anilloDeArco(GROSOR_ARCO * 1.35) },
  columna: { forma: "franja vertical", dentro: franjaVertical(0.9) },
  guirnalda: { forma: "banda con caída", dentro: bandaHorizontal(0.8, 0.35) },
  pared: { forma: "caja entera", dentro: cajaEntera },
  backdrop: { forma: "caja entera", dentro: cajaEntera },
  centro_mesa: { forma: "elipse alta", dentro: elipse(0.8) },
  kit: { forma: "elipse alta", dentro: elipse(0.85) },
  escultura: { forma: "caja entera", dentro: cajaEntera },
  accesorio: { forma: "caja entera", dentro: cajaEntera },
  // Estructuras oficiales con forma propia.
  aro_circular: { forma: "anillo circular", dentro: anilloCircular(0.45) },
  techo_globos: { forma: "banda superior", dentro: bandaHorizontal(0.9, -0.2) },
  bouquet: { forma: "elipse alta", dentro: elipse(0.85) },
};

/** Cuántos puntos se muestrean para estimar `parteDeLaCaja`. 64 × 64 da dos decimales de sobra. */
const MUESTRA = 64;

function parteCubierta(dentro: (u: number, v: number) => boolean): number {
  let contados = 0;
  for (let i = 0; i < MUESTRA; i++) {
    for (let j = 0; j < MUESTRA; j++) {
      if (dentro((i + 0.5) / MUESTRA, (j + 0.5) / MUESTRA)) contados++;
    }
  }
  return Math.round((contados / (MUESTRA * MUESTRA)) * 1e4) / 1e4;
}

const RESPALDO = { forma: "caja entera", dentro: cajaEntera };

/**
 * La zona de muestreo de una pieza. `oficialId` gana sobre `tipo` cuando tiene forma propia (un `aro_circular`
 * es un `kit` en el plan, y un aro es hueco). Un tipo desconocido se queda con la caja entera menos el margen:
 * medir la caja es lo que se hacía antes, así que nunca empeora.
 */
export function zonaDeCroquis(tipo: string, oficialId?: string | null, placement?: string, proporcionCaja?: number): Zona {
  // A lateral detector box can also enclose the neighboring arch/panel. Sample
  // the outside lane nearest its declared side; the measured owner column's
  // wide boxes (width/height >= 0.5) need side alignment. Narrow columns keep
  // centered crop; CASE-002 uses narrow boxes and contains silver code 981.
  if (tipo === "columna" && !oficialId && (proporcionCaja ?? 0) >= 0.5 && placement === "lateral_derecho") {
    const dentro = franjaVertical(0.3, 0.9);
    return { forma: "franja vertical del lado derecho", dentro, parteDeLaCaja: parteCubierta(dentro) };
  }
  if (tipo === "columna" && !oficialId && (proporcionCaja ?? 0) >= 0.5 && placement === "lateral_izquierdo") {
    const dentro = franjaVertical(0.3, 0.1);
    return { forma: "franja vertical del lado izquierdo", dentro, parteDeLaCaja: parteCubierta(dentro) };
  }
  const elegida = (oficialId ? FORMAS[oficialId] : undefined) ?? FORMAS[tipo] ?? RESPALDO;
  return { forma: elegida.forma, dentro: elegida.dentro, parteDeLaCaja: parteCubierta(elegida.dentro) };
}

/** Los tipos e ids que tienen una forma propia declarada. Lo usa la prueba para que no se quede ninguno fuera. */
export const CLAVES_CON_FORMA: readonly string[] = Object.keys(FORMAS);
