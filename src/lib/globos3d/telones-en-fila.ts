import type { PiezaLeida } from "./lectura-foto";

/**
 * **Varios paneles iguales en fila** (tres puertas blancas con arco, dos paredes de lentejuelas a los lados, tres paneles redondos): el lector los puede dar como UNA
 * pieza con `cantidad` y el ancho de todo el grupo (como las sillas). Los muebles ya salían en fila (`compilar-mobiliario.ts`); estos telones del catálogo se armaban
 * como UNO solo con todo el ancho (tres puertas de 1,5 m salían como una de 4,5 m). Aquí la pieza se parte en `cantidad` copias, cada una con su parte del ancho,
 * repartidas de lado a lado de lo leído; el nombre rotulado, si lo trae, queda en la del centro. Puro.
 */

type Fondo = Extract<PiezaLeida, { tipo: "fondo" }>;

/** Los fondos de pared o de piso del catálogo (no muebles) que se arman con un ancho y un alto: los que admiten una fila de copias y otro igual detectado. */
const TELONES_EN_FILA: ReadonlySet<string> = new Set(["lentejuelas", "arcos_chiara", "panel_redondo", "media_luna", "cortina_luces"]);

/** ¿Es uno de los fondos que se arman con un ancho y un alto y que pueden estar varias veces iguales en una foto? Los muebles-telón (aros, biombo, escalera, cortina de flecos) no: su pieza se cobra y no se agrega solo por una detección. */
export const esTelonRepetible = (id: string): boolean => TELONES_EN_FILA.has(id);

/** El hueco entre dos copias vecinas (fracción del ancho de una): un panel no se pega al de al lado. */
const HUECO_ENTRE_COPIAS = 0.06;

/**
 * Las `cantidad` copias de un telón leído en fila, de izquierda a derecha y sin `cantidad`, o `null` si la pieza no es una fila (un solo telón, un fondo
 * que no se repite así o un juego de arcos de varios colores). El ancho va en fracción del alto de la foto y la x en fracción del ancho: la distancia entre centros se pasa con `aspecto`.
 */
export function copiasDeTelon(p: Fondo, aspecto: number): Fondo[] | null {
  const n = p.cantidad ?? 1;
  if (n <= 1 || !TELONES_EN_FILA.has(p.id)) return null;
  // Los arcos chiara escalonados llevan un arco por color (hasta tres): con varios colores es UN solo juego de arcos, no una fila (3 colores × 3 copias serían 9 arcos).
  if (p.id === "arcos_chiara" && p.colores.length > 1) return null;
  const ancho = p.ancho / (n + (n - 1) * HUECO_ENTRE_COPIAS);
  const paso = ancho * (1 + HUECO_ENTRE_COPIAS);
  return Array.from({ length: n }, (_, k) => {
    const copia: Fondo = { ...p };
    delete copia.cantidad;
    // El nombre rotulado (el texto del panel) va una sola vez, en la copia del centro de la fila.
    if (k !== Math.floor((n - 1) / 2)) for (const campo of ["texto", "colorTexto", "acabadoTexto"] as const) delete copia[campo];
    return { ...copia, x: Math.round((p.x + ((k - (n - 1) / 2) * paso) / aspecto) * 1000) / 1000, ancho: Math.round(ancho * 1000) / 1000 };
  });
}
