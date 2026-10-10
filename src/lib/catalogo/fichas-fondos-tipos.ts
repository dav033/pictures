import type { MedidasRegistro, RegistroTaller } from "@/lib/taller/fichas-tipos";
import type { ClaseEntrada } from "./tipos";

/** Las clases de mobiliario y escenografía que se indexan en el RAG (REQ-013 fase 3): su `clase` es el `tipo` de la fila. */
export type ClaseFondo = Extract<ClaseEntrada, "mueble" | "mueble-fijo" | "generador" | "fondo" | "decorado">;

/**
 * El registro buscable de una entrada de mobiliario o escenografía: la forma del de la biblioteca, con su clase por tipo y sin
 * medidas cuando no tiene medida de partida (un generador: en la base, NULL, así no pasa por cualquier filtro ni bono de medida).
 */
export type RegistroFondo = Omit<RegistroTaller, "tipo" | "medidas"> & { tipo: ClaseFondo; medidas: MedidasRegistro | null };
