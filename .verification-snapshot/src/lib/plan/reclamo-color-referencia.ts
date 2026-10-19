/**
 * Si un color de la foto que el plan NO compra se le exige al modelo (`COLORES_REFERENCIA_OMITIDOS`) o solo se
 * le avisa al cliente.
 *
 * El rechazo existía para que el modelo no perdiera en silencio un color que la foto sí tiene. Pero la lista de
 * colores de cada pieza sale de lo que el analizador NOMBRÓ, y el analizador también nombra lo que la luz pinta:
 * en una foto de columnas rosa, plata y blanco con luz morada, la lectura dijo «azul pastel», el rechazo obligó al
 * modelo a comprarlo, el único azul con cobertura fue un Reflex Azul oscuro y la imagen salió con ese azul de
 * protagonista (2026-10-06). Un color así no tiene respaldo en la foto: ni los píxeles del elemento lo miden ni la
 * lectura de la disposición (`patron_color`) lo pone en un tramo de la pieza.
 *
 * Regla: se exige solo un color con evidencia de peso en la pieza —medido en píxeles o puesto por la disposición—
 * de al menos `PARTE_MINIMA_RECLAMO`. Uno nombrado sin ninguna evidencia (dudoso) o con poca (un acento) queda
 * fuera del rechazo; el plan sigue y el aviso de sustitución al cliente no cambia. Dos excepciones conservan la
 * regla de siempre: el transparente (los píxeles ven lo que hay detrás de un cristal, nunca el globo) y un neutro
 * claro cuando otro neutro claro sí se midió (la medida no separa el blanco perlado de la plata).
 *
 * Puro: sin proveedor, HTTP, base de datos ni entorno.
 */

/** Parte mínima de la pieza (medida o en la disposición) para exigirle el color al modelo. */
export const PARTE_MINIMA_RECLAMO = 0.1;
/** Peso con que cuenta un color salpicado (`patron_color.motas`): un acento, nunca un tramo. */
const PARTE_MOTA = 0.05;
/** Neutros claros que la medida en píxeles confunde entre sí (perla, plata, gris, crema bajo luz cálida). */
const NEUTROS_CLAROS: ReadonlySet<string> = new Set(["blanco", "plateado", "gris", "crema"]);
const TRANSPARENTE = "transparente";

type AparienciaParaReclamo = {
  measured_colors?: ReadonlyArray<{ color: string; share: number }>;
  patron_color?: { colores: readonly string[]; pesos?: readonly number[]; motas?: readonly string[] };
};

export type MotivoReclamo =
  | "evidencia_suficiente"
  | "sin_evidencia_medible"
  | "transparente"
  | "neutro_confundible"
  | "baja_proporcion"
  | "sin_respaldo_en_la_foto";

export type EvidenciaColorFoto = {
  color: string;
  /** Parte medida en los píxeles del elemento: 0 si se midió y no aparece, null si el elemento no tiene medida. */
  medida: number | null;
  /** Parte en la lectura de la disposición (`patron_color`), o null si no lo pone en la pieza. */
  disposicion: number | null;
  reclamable: boolean;
  motivo: MotivoReclamo;
};

function normalizar(color: string): string {
  return color.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function parteEnDisposicion(patron: AparienciaParaReclamo["patron_color"], color: string): number | null {
  if (!patron) return null;
  const colores = patron.colores.map(normalizar);
  const indice = colores.indexOf(color);
  if (indice >= 0) {
    const pesos = patron.pesos && patron.pesos.length === colores.length ? patron.pesos : undefined;
    const total = pesos ? pesos.reduce((suma, peso) => suma + peso, 0) : 0;
    return pesos && total > 0 ? pesos[indice]! / total : 1 / colores.length;
  }
  return (patron.motas ?? []).map(normalizar).includes(color) ? PARTE_MOTA : null;
}

/** La evidencia de un color en un elemento de la foto y si se le puede exigir al plan. */
export function evidenciaColorFoto(apariencia: AparienciaParaReclamo, colorPedido: string): EvidenciaColorFoto {
  const color = normalizar(colorPedido);
  const medidos = apariencia.measured_colors ?? [];
  const medida = medidos.length
    ? medidos.filter((entrada) => normalizar(entrada.color) === color).reduce((suma, entrada) => suma + entrada.share, 0)
    : null;
  const disposicion = parteEnDisposicion(apariencia.patron_color, color);
  const base = { color, medida, disposicion };
  if (color === TRANSPARENTE) return { ...base, reclamable: true, motivo: "transparente" };
  if (medida === null && disposicion === null) return { ...base, reclamable: true, motivo: "sin_evidencia_medible" };
  const parte = Math.max(medida ?? 0, disposicion ?? 0);
  if (parte >= PARTE_MINIMA_RECLAMO) return { ...base, reclamable: true, motivo: "evidencia_suficiente" };
  const otroNeutroMedido = NEUTROS_CLAROS.has(color)
    && medidos.some((entrada) => normalizar(entrada.color) !== color && NEUTROS_CLAROS.has(normalizar(entrada.color)) && entrada.share >= PARTE_MINIMA_RECLAMO);
  if (otroNeutroMedido) return { ...base, reclamable: true, motivo: "neutro_confundible" };
  return { ...base, reclamable: false, motivo: parte > 0 ? "baja_proporcion" : "sin_respaldo_en_la_foto" };
}
