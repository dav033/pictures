import { INFLADOS_TRAZO, MEZCLA_TRAZO, grosorParaFormato } from "./trazo-organico";
import type { MezclaLeida } from "./lectura-foto";

/**
 * **La mezcla de tamaños de una pieza orgánica leída**: de lo que midió el lector en la foto (`mezcla`: reparto por
 * escalón y diámetro de cada uno en fracción del alto de la imagen, o `tamanos`: globos por formato) a los pesos por
 * formato que usa el trazo orgánico. Con la escala de la foto (cm por alto de imagen) el diámetro medido decide el
 * formato (un globo que mide 0,2 del alto de una foto de 260 cm mide 52 cm: R-24), y el escalón grande decide cuánto
 * grosor necesita el cuerpo para que esos globos quepan (un R-24 no cabe en un cuerpo de 50 cm). Puro y sin red.
 */

/** Diámetro inflado (cm) de un globo por formato como se mide en una foto (suelto o a la vista), de grande a chico. */
const INFLADOS_SUELTOS_CM: ReadonlyArray<readonly [string, number]> = [["R-36", 85], ["R-24", 55], ["R-18", 42], ["R-12", 27], ["R-9", 20], ["R-5", 12]];
/** Diámetro con que el motor orgánico dibuja cada formato (van atados y apretados: menos que sueltos), de grande a chico: lo que da el grosor que necesita el cuerpo. */
const INFLADOS_ORGANICOS_CM: ReadonlyArray<readonly [string, number]> = Object.entries(INFLADOS_TRAZO).sort((a, b) => b[1] - a[1]);

const masCercano = (tabla: ReadonlyArray<readonly [string, number]>, cm: number) => tabla.reduce((m, o) => (Math.abs(o[1] - cm) < Math.abs(m[1] - cm) ? o : m));

/** El formato de un globo suelto por su diámetro en cm. */
export function formatoPorDiametro(cm: number): { formatoId: string; infladoCm: number } {
  const [formatoId, infladoCm] = masCercano(INFLADOS_SUELTOS_CM, cm);
  return { formatoId, infladoCm };
}

/** Lo que se asume de un escalón cuando el lector no midió su diámetro. */
const ESCALON_POR_OMISION = { grandes: { "R-24": 0.5, "R-18": 0.5 }, medianos: { "R-12": 1 }, chicos: { "R-9": 0.6, "R-5": 0.4 } } as const;
/** Un formato con menos de esta fracción de los globos no manda en el grosor del cuerpo. */
const PESO_RELEVANTE = 0.1;

const redondear = (n: number) => Math.round(n * 1000) / 1000;

function normalizar(pesos: Record<string, number>): Record<string, number> {
  const total = Object.values(pesos).reduce((s, w) => s + w, 0);
  if (total <= 0) return {};
  return Object.fromEntries(Object.entries(pesos).filter(([, w]) => w > 0).map(([f, w]) => [f, redondear(w / total)]));
}

/** El reparto por formato de los globos de un escalón: el formato que mide su diámetro, o el de por omisión. */
function formatosDelEscalon(escalon: keyof typeof ESCALON_POR_OMISION, diametro: number | undefined, altoImagenCm: number): Record<string, number> {
  return diametro === undefined ? { ...ESCALON_POR_OMISION[escalon] } : { [formatoPorDiametro(diametro * altoImagenCm).formatoId]: 1 };
}

/** Los pesos por formato de una `mezcla` medida (vacío si no trae ningún globo). */
export function pesosDeMezclaLeida(m: MezclaLeida, altoImagenCm: number): Record<string, number> {
  const acumulado: Record<string, number> = {};
  const sumar = (escalon: keyof typeof ESCALON_POR_OMISION, parte: number, diametro: number | undefined) => {
    for (const [f, w] of Object.entries(formatosDelEscalon(escalon, diametro, altoImagenCm))) acumulado[f] = (acumulado[f] ?? 0) + parte * w;
  };
  sumar("grandes", m.grandes, m.diametroGrande);
  sumar("medianos", m.medianos, m.diametroMediano);
  sumar("chicos", m.chicos, m.diametroChico);
  return normalizar(acumulado);
}

/**
 * Los pesos de una pieza orgánica leída: la `mezcla` medida si la trae; si no, `tamanos` (globos por formato, como
 * siempre); sin ninguna, la mezcla de partida del trazo.
 */
export function pesosDeLectura(p: { tamanos: Partial<Record<string, number>>; mezcla?: MezclaLeida }, altoImagenCm: number): Record<string, number> {
  const medida = p.mezcla ? pesosDeMezclaLeida(p.mezcla, altoImagenCm) : {};
  if (Object.keys(medida).length) return medida;
  const porFormato = normalizar(Object.fromEntries(Object.entries(p.tamanos).map(([f, w]) => [f, w ?? 0])));
  return Object.keys(porFormato).length ? porFormato : { ...MEZCLA_TRAZO };
}

/** Si la pieza trae algún dato de tamaños (`mezcla` o `tamanos` con algo): lo que se leyó y se puede honrar. */
export const traeMezcla = (p: { tamanos: Partial<Record<string, number>>; mezcla?: MezclaLeida }): boolean => Boolean(p.mezcla) || Object.values(p.tamanos).some((w) => (w ?? 0) > 0);

/**
 * El grosor (cm) que necesita el cuerpo en lo más grueso para que quepan los globos grandes de la mezcla (el mayor formato
 * con al menos un 10 % de los globos), o `null` si no hay ninguno relevante. Evita que una silueta medida delgada se quede
 * sin R-18 ni R-24: el motor solo pone en cada punto los formatos que caben en su grosor.
 */
export function grosorMinimoDePesos(pesos: Readonly<Record<string, number>>): number | null {
  const total = Object.values(pesos).reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  const grande = INFLADOS_ORGANICOS_CM.find(([f]) => (pesos[f] ?? 0) / total >= PESO_RELEVANTE);
  return grande ? grosorParaFormato(grande[0]) : null;
}
