import type { Escena } from "./escena";
import { EncuadreSchema, type Encuadre } from "./encuadre-foto";

/**
 * Lo que devuelve `/api/escena-ia` leído en el navegador: la respuesta buena (escena, texto, acciones, pregunta, uso) o el
 * mensaje de error. El servidor ya validó lo que recibió y lo que arma; aquí solo se comprueba la forma para no romper la
 * pantalla con una respuesta rara (un proxy, una versión vieja). Puro.
 */

export type AccionIA = { herramienta: string; resumen: string; consulta: boolean };
export type PreguntaIA = { texto: string; opciones: string[] };
export type RespuestaIA = {
  escena: Escena;
  respuesta: string;
  acciones: AccionIA[];
  pregunta: PreguntaIA | null;
  costeEstimadoUsd: number | null;
  /** Lo que devolvió la lectura de la foto (para compararla después con la escena), tal cual. */
  foto: unknown;
};

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esAccion = (v: unknown): v is AccionIA => esObjeto(v) && typeof v.herramienta === "string" && typeof v.resumen === "string" && typeof v.consulta === "boolean";
const esEscena = (v: unknown): v is Escena => esObjeto(v) && esObjeto(v.sala) && Array.isArray(v.nodos);

function preguntaDe(v: unknown): PreguntaIA | null {
  if (!esObjeto(v) || typeof v.texto !== "string" || !Array.isArray(v.opciones) || !v.opciones.every((o) => typeof o === "string") || v.opciones.length === 0) return null;
  return { texto: v.texto, opciones: v.opciones as string[] };
}

export function leerRespuestaIA(datos: unknown): RespuestaIA | null {
  if (!esObjeto(datos) || !esEscena(datos.escena) || typeof datos.respuesta !== "string" || !Array.isArray(datos.acciones) || !datos.acciones.every(esAccion)) return null;
  const coste = esObjeto(datos.uso) && typeof datos.uso.costeEstimadoUsd === "number" ? datos.uso.costeEstimadoUsd : null;
  return { escena: datos.escena, respuesta: datos.respuesta, acciones: datos.acciones, pregunta: preguntaDe(datos.pregunta), costeEstimadoUsd: coste, foto: datos.foto };
}

/** El mensaje de error de una respuesta que no sirvió: el del servidor, o uno por defecto. */
export function mensajeDeError(datos: unknown): string {
  return esObjeto(datos) && typeof datos.error === "string" && datos.error ? datos.error : "No pude hablar con la IA ahora.";
}

/** Lo que devuelve el servidor de la foto al armar la escena y hace falta para compararla después (la lectura y el encuadre de la cámara). */
export function datosDeRefinado(foto: unknown): { lectura: unknown; encuadre: Encuadre } | null {
  if (!esObjeto(foto)) return null;
  const encuadre = EncuadreSchema.safeParse(foto.encuadre);
  return foto.aplicada === true && foto.lectura && encuadre.success ? { lectura: foto.lectura, encuadre: encuadre.data } : null;
}
