/**
 * Where each numbered label goes on the animated photo analysis (D6 del E2E
 * real): by default at the bottom-left corner inside its box, but when boxes
 * overlap two labels can land on top of each other ("2" covering "1" at
 * 1440 px). Labels are placed in order; a label that would collide with an
 * earlier one tries the top of its own box and then stacks right above (or
 * below) the label it hits. Pure: no React or DOM, sizes in photo fractions.
 */

export type CajaNormalizada = { x: number; y: number; width: number; height: number };

export type EtiquetaParaUbicar = {
  bbox: CajaNormalizada;
  /** Visible characters of the label's name, to estimate its width. */
  caracteres: number;
  /** Characters of the optional short place ("derecha"), shown only when the label fits it. */
  caracteresExtra?: number;
};

export type PosicionEtiqueta = {
  /** Left edge, fraction of the photo width. */
  izquierda: number;
  /** Bottom edge, fraction of the photo height. */
  inferior: number;
  /** Maximum width, fraction of the photo width. */
  anchoMaximo: number;
  /** Whether the short place fits after the name without cutting either. */
  conExtra: boolean;
};

/** Rendered photo size in px; without it (server render) a typical desktop size is assumed. */
export type TamanoFoto = { ancho: number; alto: number };

const TAMANO_POR_DEFECTO: TamanoFoto = { ancho: 720, alto: 480 };
/** Label pill height in px (text 12–13 px plus padding, and the 8 px it sits above the edge) and gap between stacked labels. */
const ALTO_ETIQUETA_PX = 38;
const SEPARACION_PX = 4;
/** Pill padding + number badge + gaps, and average glyph width at 13 px. */
const BASE_ANCHO_PX = 44;
const ANCHO_CARACTER_PX = 7.2;
/**
 * A label is never narrower than this in px (or the whole photo when the
 * photo is narrower). A fraction alone gave ~100 px on a phone and cut
 * "Columna orgánica derecha" down to "Colu… d…" (2026-09-24).
 */
const ANCHO_MINIMO_PX = 200;

type Rect = { izquierda: number; derecha: number; arriba: number; abajo: number };

function rectDe(izquierda: number, inferior: number, ancho: number, alto: number): Rect {
  return { izquierda, derecha: izquierda + ancho, arriba: inferior - alto, abajo: inferior };
}

function seCruzan(a: Rect, b: Rect): boolean {
  return a.izquierda < b.derecha && b.izquierda < a.derecha && a.arriba < b.abajo && b.arriba < a.abajo;
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}

export function ubicarEtiquetas(etiquetas: readonly EtiquetaParaUbicar[], tamano: TamanoFoto = TAMANO_POR_DEFECTO): PosicionEtiqueta[] {
  const ancho = Math.max(1, tamano.ancho);
  const alto = Math.max(1, tamano.alto);
  const altoEtiqueta = Math.min(1, ALTO_ETIQUETA_PX / alto);
  const separacion = SEPARACION_PX / alto;
  const colocadas: Rect[] = [];

  return etiquetas.map(({ bbox, caracteres, caracteresExtra = 0 }) => {
    const anchoMaximo = Math.min(1, Math.max(bbox.width, 0.46, ANCHO_MINIMO_PX / ancho));
    // The place is dropped before the name is cut.
    const conExtra = caracteresExtra > 0 && (BASE_ANCHO_PX + (caracteres + caracteresExtra) * ANCHO_CARACTER_PX) / ancho <= anchoMaximo;
    const anchoEstimado = Math.min(anchoMaximo, (BASE_ANCHO_PX + (caracteres + (conExtra ? caracteresExtra : 0)) * ANCHO_CARACTER_PX) / ancho);
    const izquierda = limitar(Math.min(bbox.x, 1 - anchoMaximo), 0, 1);
    const cabe = (inferior: number) => {
      const rect = rectDe(izquierda, inferior, anchoEstimado, altoEtiqueta);
      return rect.arriba >= 0 && rect.abajo <= 1 && !colocadas.some((otra) => seCruzan(rect, otra));
    };

    const abajoDeLaCaja = limitar(bbox.y + bbox.height, altoEtiqueta, 1);
    const arribaDeLaCaja = limitar(bbox.y + altoEtiqueta + separacion, altoEtiqueta, 1);
    const candidatas = [abajoDeLaCaja, arribaDeLaCaja];
    // Stack against every label it would hit: right above it, or right below it.
    for (const otra of colocadas) {
      candidatas.push(otra.arriba - separacion, otra.abajo + separacion + altoEtiqueta);
    }
    // The two spots inside its own box first; otherwise the free stacked spot nearest to the default one.
    const [propias, apiladas] = [candidatas.slice(0, 2), candidatas.slice(2).sort((a, b) => Math.abs(a - abajoDeLaCaja) - Math.abs(b - abajoDeLaCaja))];
    const libre = [...propias, ...apiladas].find(cabe);
    const inferior = libre ?? abajoDeLaCaja;
    colocadas.push(rectDe(izquierda, inferior, anchoEstimado, altoEtiqueta));
    return { izquierda, inferior, anchoMaximo, conExtra };
  });
}
