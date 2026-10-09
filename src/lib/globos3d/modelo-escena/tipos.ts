import type { Part } from "@google/genai";
import type { ProveedorId } from "@/lib/ia/nucleo/tipos";
import type { DeclaracionHerramienta } from "../herramientas-escena";

/**
 * El modelo que arma la escena del taller 3D (`/api/escena-ia`), sin atarse a un proveedor: la ruta corre el mismo bucle
 * de herramientas (aplicar, decidir, verificar) y la sesión solo habla con el modelo. Gemini en producción; Claude solo
 * en local (W5). El proveedor lo elige el registro (`resolverProveedor`), nunca la ruta.
 */

export type LlamadaEscena = {
  id?: string;
  nombre: string;
  /** Tal cual llegó del modelo (Gemini puede omitirlos); cada herramienta los valida con zod. */
  args?: Record<string, unknown>;
};

/** Tokens de una vuelta. `entrada` es todo el prompt (con lo leído y lo escrito en la caché). */
export type UsoPasoEscena = { entrada: number; salida: number; pensamiento: number; cacheLeidos: number; cacheEscritos: number };

export type PasoEscena = {
  /** Texto visible del modelo (sin razonamiento). */
  texto: string;
  llamadas: LlamadaEscena[];
  uso: UsoPasoEscena;
};

export type RespuestaHerramientaEscena = { nombre: string; id?: string; respuesta: Record<string, unknown> };

export type EntradaSesionEscena = {
  sistema: string;
  declaraciones: readonly DeclaracionHerramienta[];
  /** Turnos anteriores de la conversación, solo texto. */
  historial: ReadonlyArray<{ rol: "usuario" | "asistente"; texto: string }>;
  /** El mensaje del usuario de esta vuelta, en orden: texto e imágenes (`inlineData`), como lo arman la foto y el refinado. */
  partesUsuario: Part[];
  signal: AbortSignal;
};

export interface SesionEscenaIA {
  /** Una vuelta del modelo con todo lo conversado; el turno del modelo queda guardado tal cual para la siguiente. */
  pedir(forzar?: readonly string[]): Promise<PasoEscena>;
  /** Los resultados de las herramientas de la última vuelta, en el orden en que se aplicaron. */
  responder(respuestas: RespuestaHerramientaEscena[]): void;
}

export interface ModeloEscenaIA {
  readonly proveedor: ProveedorId;
  readonly modelo: string;
  iniciar(entrada: EntradaSesionEscena): SesionEscenaIA;
  /** Coste estimado (USD, sin redondear) de las vueltas hechas, con los precios del proveedor. */
  costeUsd(usos: readonly UsoPasoEscena[]): number;
}
