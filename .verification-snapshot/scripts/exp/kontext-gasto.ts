/**
 * El registro del gasto del experimento de color de Kontext (`gasto.json` en la bitácora) y su tope DURO: cada llamada, también la que
 * falla, cuenta como gasto (se reserva antes de llamar).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CARPETA = "C:/Users/davidt/bitacora/pictures/research/kontext-color";

// Tope total acordado: US$1,28 = US$0,48 de las 6 llamadas que fallaron o se cortaron + US$0,40 de a, b, c y las segundas semillas de b y c
// + US$0,24 de la variante d + US$0,16 de la comprobación en una escena de plata cromada. 16 imágenes.
export const TOPE_USD = 1.28;
export const TOPE_IMAGENES = 16;
export const COSTO_IMAGEN = 0.08;

export type Llamada = {
  variante: string;
  semilla: number;
  archivo: string;
  /** La idea del experimento; sin ella es la 07, con la que empezó. */
  escena?: string;
  costo: number;
  resultado: "ok" | "fallo" | "pendiente";
  cuando: string;
  motivo?: string;
  requestId?: string;
  /** Cuánto esperó el script, de punta a punta (envío, cola, inferencia y descarga). */
  ms?: number;
  /** El tiempo de inferencia que informa fal (sin la espera en cola); solo las tomas recuperadas a mano lo traen. */
  inferenciaS?: number;
};
export type Gasto = { total: number; llamadas: Llamada[] };

const rutaGasto = join(CARPETA, "gasto.json");
export const leerGasto = (): Gasto => (existsSync(rutaGasto) ? (JSON.parse(readFileSync(rutaGasto, "utf8")) as Gasto) : { total: 0, llamadas: [] });
export const guardarGasto = (gasto: Gasto): void => writeFileSync(rutaGasto, JSON.stringify(gasto, null, 2));

export const cabeOtraLlamada = (gasto: Gasto): boolean => gasto.llamadas.length < TOPE_IMAGENES && gasto.total + COSTO_IMAGEN <= TOPE_USD + 1e-9;

/** Lanza si otra imagen ya no cabe en el tope. */
export function reservar(gasto: Gasto): void {
  if (gasto.llamadas.length >= TOPE_IMAGENES) throw new Error(`Tope de ${TOPE_IMAGENES} imágenes alcanzado.`);
  if (gasto.total + COSTO_IMAGEN > TOPE_USD + 1e-9) throw new Error(`Tope de US$${TOPE_USD} alcanzado (gastado US$${gasto.total.toFixed(2)}).`);
}
