import type { MedidasRegistro } from "@/lib/taller/fichas-tipos";
import type { ClaseFondo } from "./fichas-fondos-tipos";

/**
 * El texto que se embebe de una entrada de mobiliario o escenografía (REQ-013 fase 3): español natural de ~80 a ~250 palabras,
 * con lo que el dueño escribe al buscar (qué es y para qué sirve, medidas, puestos, dónde va, el texto que lleva, cómo más le
 * dicen), su procedencia y su repositorio. No nombra globos ni la tienda: lo que no es (no lleva globos, no tiene precio) va en los
 * datos del registro, no en el texto, para no acercarlo a las búsquedas de globos. Puro.
 */

export type DatosTextoFondo = {
  nombre: string;
  clase: ClaseFondo;
  /** La de la entrada; en un mueble, con qué es cada color en orden (`descripcionConColores`). */
  descripcion: string;
  /** Para qué sirve, según su grupo (asiento, mesa, fondo, decorado) y si es telón o va sobre una mesa. */
  uso: string;
  /** `null`: no tiene medida de partida (un generador). */
  medidas: MedidasRegistro | null;
  /** Puestos, dónde se pone, el texto o rótulo que admite, sus acabados. */
  detalles: readonly string[];
  /** Un generador: qué arma, tipo por tipo, con sus límites. */
  variantes: readonly string[];
  sinonimos: readonly string[];
  procedencia: string;
  repositorio: { nombre: string; atribucion: string | null };
};

const FRASE_CLASE: Readonly<Record<ClaseFondo, string>> = {
  mueble: "Mueble de alquiler para el montaje del evento, modelado por medidas y colores",
  "mueble-fijo": "Mueble fijo del montaje: viene armado y no cambia de medida ni de color",
  generador: "Generador de mobiliario a medida: arma la pieza con el tipo y las medidas que se pidan",
  fondo: "Fondo de foto del montaje (escenografía fija: viene armado y no cambia de medida ni de color)",
  decorado: "Decorado del montaje (escenografía), modelado por medidas y colores",
};

/** Cómo se usa cada clase al ponerla: solo en la ficha que queda corta (como el glosario de partes en la de la biblioteca). */
const COMO_SE_USA: Readonly<Record<ClaseFondo, string>> = {
  mueble: "Al ponerlo en la escena se le cambian las medidas y los colores; el primer color es el principal",
  "mueble-fijo": "Viene tal como está: para otra medida u otro color se usa la mesa a medida",
  generador: "Se arma al pedirlo, con el tipo, las medidas, el mantel y los colores que se elijan",
  fondo: "Se pone tal como viene: para otra medida u otro color se cambia por un decorado, que se modela por medidas y colores",
  decorado: "Al ponerlo en la escena se le cambian las medidas y los colores; el primer color es el principal",
};

/** El mismo piso de palabras que las fichas de la biblioteca (`PALABRAS_MIN_FICHA`). */
const PALABRAS_MIN = 80;
const palabras = (texto: string): number => texto.split(/\s+/).filter(Boolean).length;

/** Lo plano (un tapete, una cortina) no dice su alto ni su fondo de pocos centímetros. */
const MEDIDA_MINIMA_CM = 5;

const conPunto = (t: string): string => { const x = t.trim(); return /[.!?»)…]$/.test(x) ? x : `${x}.`; };
const enLista = (xs: readonly string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const largo = (cm: number): string => (cm >= 100 ? `${(Math.round(cm / 10) / 10).toString().replace(".", ",")} m` : `${Math.round(cm)} cm`);

function medidasTexto(m: MedidasRegistro | null): string | null {
  if (!m) return null;
  const partes = [
    m.altoCm >= MEDIDA_MINIMA_CM ? `${largo(m.altoCm)} de alto` : null,
    m.anchoCm >= MEDIDA_MINIMA_CM ? `${largo(m.anchoCm)} de ancho` : null,
    m.fondoCm >= MEDIDA_MINIMA_CM ? `${largo(m.fondoCm)} de fondo` : null,
  ].filter((p): p is string => p !== null);
  return partes.length ? `Mide unos ${enLista(partes)}.` : null;
}

export function redactarFichaFondo(d: DatosTextoFondo): string {
  const corta = redactar(d, false);
  return palabras(corta) < PALABRAS_MIN ? redactar(d, true) : corta;
}

function redactar(d: DatosTextoFondo, explicada: boolean): string {
  const bloques = [conPunto(d.nombre), `${FRASE_CLASE[d.clase]}.`, conPunto(d.descripcion), conPunto(d.uso)];
  if (explicada) bloques.push(conPunto(COMO_SE_USA[d.clase]));
  if (d.variantes.length) bloques.push(`Tipos que arma: ${d.variantes.join("; ")}.`);
  const medidas = medidasTexto(d.medidas);
  if (medidas) bloques.push(medidas);
  bloques.push(...d.detalles.map(conPunto));
  if (d.sinonimos.length) bloques.push(`También le dicen ${enLista(d.sinonimos.map((s) => `«${s}»`))}.`);
  bloques.push(conPunto(d.procedencia), `Del repositorio ${d.repositorio.nombre}.`);
  if (d.repositorio.atribucion) bloques.push(conPunto(d.repositorio.atribucion));
  return bloques.join(" ");
}
